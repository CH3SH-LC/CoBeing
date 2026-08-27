/**
 * E2E 自检流程：真实走一遍三界面核心路径（GUI ↔ Rust 桥 ↔ 内核子进程全链路）
 * 入口：URL hash 含 #e2e 时 App 渲染 E2EPanel；数据目录用 COBEING_DATA_ROOT 隔离。
 * 自检实体均以 e2e- 前缀命名，结束后销毁/归档，不留污染。
 */

import { rpc } from './rpc'
import { getModelConfigs, saveModelSource, setActiveModelSource, deleteModelSource } from './settings'

export interface E2EStep {
  name: string
  state: 'pending' | 'running' | 'pass' | 'fail'
  detail?: string
}

export interface E2EOptions {
  /** 轮询等待回复的超时（默认 30s；测试注入小值加速） */
  timeoutMs?: number
}

/** 真实渲染布局测量：统计全部消息气泡（浏览器环境；无 DOM 返回 null） */
export function measureBubbleLayout(): {
  rowWidth: number
  maxBubbleWidth: number
  maxRatio: number
  minBubbleWidth: number
} | null {
  if (typeof document === 'undefined') return null
  const rows = Array.from(document.querySelectorAll('.msg-row'))
  if (rows.length === 0) return null
  const stats = rows
    .map((row) => {
      const bubble = row.querySelector('.msg-bubble')
      if (!bubble) return null
      const rowRect = row.getBoundingClientRect()
      const bubbleRect = bubble.getBoundingClientRect()
      if (rowRect.width === 0) return null
      return { bubbleWidth: Math.round(bubbleRect.width), ratio: +(bubbleRect.width / rowRect.width).toFixed(2) }
    })
    .filter((x): x is { bubbleWidth: number; ratio: number } => x !== null)
  if (stats.length === 0) return null
  const rowWidth = Math.round(rows[0].getBoundingClientRect().width)
  return {
    rowWidth,
    maxBubbleWidth: Math.max(...stats.map((s) => s.bubbleWidth)),
    maxRatio: Math.max(...stats.map((s) => s.ratio)),
    minBubbleWidth: Math.min(...stats.map((s) => s.bubbleWidth)),
  }
}

async function waitForLayout(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const layout = measureBubbleLayout()
    if (layout) return layout
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

export async function runE2E(onStep: (index: number, step: E2EStep) => void, opts: E2EOptions = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  let layout: ReturnType<typeof measureBubbleLayout> = null
  let confirmSeen = false
  const steps: E2EStep[] = [
    { name: 'ping 内核', state: 'pending' },
    { name: '创建智能体 e2e-tester 并批准', state: 'pending' },
    { name: '主对话发言 → 但丁回复', state: 'pending' },
    { name: '开启新对话窗口 → 当前清空 + 历史可回看', state: 'pending' },
    { name: '创建群组 e2e-smoke（user+butler+e2e-tester）', state: 'pending' },
    { name: '群内 mention e2e-tester → 群组发言', state: 'pending' },
    { name: '归档群组 → 归档索引可见', state: 'pending' },
    { name: '销毁 e2e-tester → 名录移除', state: 'pending' },
    { name: '模型配置读写往返（设置界面命令链路）', state: 'pending' },
  ]
  const update = (i: number, patch: Partial<E2EStep>) => {
    steps[i] = { ...steps[i], ...patch }
    onStep(i, steps[i])
  }
  const fail = (i: number, detail: string) => {
    update(i, { state: 'fail', detail })
    return false
  }
  const ok = (i: number, detail?: string) => update(i, { state: 'pass', detail })

  let allPass = true

  // 1. ping
  update(0, { state: 'running' })
  try {
    const ping = await rpc.ping()
    if (ping.pong) ok(0)
    else return fail(0, `pong 不为 true: ${JSON.stringify(ping)}`)
  } catch (e) {
    return fail(0, e instanceof Error ? e.message : String(e))
  }

  // 2. 创建 + 批准
  update(1, { state: 'running' })
  try {
    await rpc.requestCreateAgent({ name: 'e2e-tester', role: 'E2E 自检工作智能体', createdAt: Date.now() })
    const pendingList = await rpc.listPendingApprovals()
    if (!pendingList.some((a) => a.name === 'e2e-tester')) {
      allPass = false
      return fail(1, '待批准队列未出现 e2e-tester')
    }
    await rpc.confirmAgent('e2e-tester')
    const agents = await rpc.listAgents()
    if (!agents.some((a) => a.name === 'e2e-tester')) return fail(1, '名录未出现 e2e-tester')
    ok(1)
  } catch (e) {
    return fail(1, e instanceof Error ? e.message : String(e))
  }

  // 3. 主对话
  update(2, { state: 'running' })
  try {
    const before = await rpc.butlerProjection()
    const baseSeq = before.publicMessages.at(-1)?.seq ?? 0
    await rpc.mainWindowSpeak('你好（E2E 自检），请简单回应')
    const deadline = Date.now() + timeoutMs
    let reply = ''
    while (Date.now() < deadline) {
      const proj = await rpc.butlerProjection()
      const msg = proj.publicMessages.find((m) => m.seq > baseSeq && m.actor === 'butler')
      if (msg) {
        reply = msg.content
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!reply) return fail(2, '30s 内未收到但丁回复')
    ok(2, reply.slice(0, 60))
    // 真实渲染布局测量（浏览器环境断言；node 测试环境 layout 为 null 自动跳过）
    layout = await waitForLayout(3000)
    if (layout) {
      const layoutOk =
        layout.maxBubbleWidth >= 120 && // 长消息气泡至少容纳 5 个字（防"一行两个字"）
        layout.maxRatio <= 0.75 && // 68% 行宽上限
        layout.minBubbleWidth >= 60 // 短消息气泡贴合内容
      if (!layoutOk) {
        return fail(2, `布局异常：max=${layout.maxBubbleWidth}px maxRatio=${layout.maxRatio} min=${layout.minBubbleWidth}px`)
      }
      ok(2, `回复：${reply.slice(0, 40)}（布局 max=${layout.maxBubbleWidth}px ratio=${layout.maxRatio}）`)
    }
    // 追加：真实任务请求 → 观察但丁群组感知与确认卡片（ask-user）行为（真实 key 下）
    // 不强制要求卡片（模型行为），仅记录 confirmSeen 供外部验证
    const beforeSeq = (await rpc.butlerProjection()).publicMessages.at(-1)?.seq ?? 0
    await rpc.mainWindowSpeak('现在帮我调研江苏旅游。如果有需要确认的事项，请使用确认卡片让我选择。')
    const dl2 = Date.now() + timeoutMs
    while (Date.now() < dl2) {
      if (typeof document !== 'undefined' && document.querySelector('.confirm-card')) {
        confirmSeen = true
        break
      }
      const proj2 = await rpc.butlerProjection()
      const newButler = proj2.publicMessages.find((m) => m.actor === 'butler' && m.seq > beforeSeq)
      if (newButler) break
      await new Promise((r) => setTimeout(r, 500))
    }
  } catch (e) {
    return fail(2, e instanceof Error ? e.message : String(e))
  }

  // 4. 新对话窗口（步骤 3 的任务可能仍在跑，busy 时重试等待）
  update(3, { state: 'running' })
  try {
    const before = await rpc.butlerProjection()
    const hadMessages = before.publicMessages.length > 0
    const deadline = Date.now() + timeoutMs
    let created: { id: string } | null = null
    while (Date.now() < deadline) {
      try {
        created = await rpc.newButlerConversation()
        break
      } catch (e) {
        if (!String(e).includes('工作中')) throw e
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    if (!created || !created.id.startsWith('conv-')) return fail(3, '新对话 id 异常')
    const convs = await rpc.listButlerConversations()
    const hist = convs.find((c) => !c.current)
    if (!hist) return fail(3, '会话列表缺少历史会话')
    if (hadMessages) {
      const histProj = await rpc.butlerConversationProjection(hist.id)
      if (histProj.publicMessages.length === 0) return fail(3, '历史会话投影为空（归档丢失）')
    }
    const cur = await rpc.butlerProjection()
    if (cur.publicMessages.length > 0) return fail(3, '新会话投影未清空')
    ok(3, `归档 ${hist.id}（${hist.messageCount} 条事件，可回看）`)
  } catch (e) {
    return fail(3, e instanceof Error ? e.message : String(e))
  }

  // 5. 建群
  update(4, { state: 'running' })
  try {
    const created = await rpc.createGroup('e2e-smoke', ['user', 'butler', 'e2e-tester'])
    if (created.status !== 'working') return fail(4, `status=${created.status}`)
    ok(4)
  } catch (e) {
    return fail(4, e instanceof Error ? e.message : String(e))
  }

  // 6. 群内 mention 工作
  update(5, { state: 'running' })
  try {
    await rpc.speakToGroup('e2e-smoke', 'user', '请 e2e-tester 写一句问候语', { mention: ['e2e-tester'], task: '写一句问候语' })
    const deadline = Date.now() + timeoutMs
    let reply = ''
    while (Date.now() < deadline) {
      const proj = await rpc.groupProjection('e2e-smoke')
      const msg = proj.publicMessages.find((m) => m.actor === 'e2e-tester')
      if (msg) {
        reply = msg.content
        break
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!reply) return fail(5, '30s 内未收到 e2e-tester 群内发言')
    ok(5, reply.slice(0, 60))
  } catch (e) {
    return fail(5, e instanceof Error ? e.message : String(e))
  }

  // 7. 归档
  update(6, { state: 'running' })
  try {
    await rpc.archiveGroup('e2e-smoke')
    const archived = await rpc.listArchivedGroups()
    if (!archived.some((g) => g.name === 'e2e-smoke')) return fail(6, '归档索引未出现 e2e-smoke')
    ok(6)
  } catch (e) {
    return fail(6, e instanceof Error ? e.message : String(e))
  }

  // 8. 销毁
  update(7, { state: 'running' })
  try {
    await rpc.destroyAgent('e2e-tester')
    const agents = await rpc.listAgents()
    if (agents.some((a) => a.name === 'e2e-tester')) return fail(7, '名录仍含 e2e-tester')
    ok(7)
  } catch (e) {
    return fail(7, e instanceof Error ? e.message : String(e))
  }

  // 9. 模型配置读写往返（设置界面命令链路：多来源 get → save → setActive → delete → 还原）
  update(8, { state: 'running' })
  try {
    // 新增测试来源 → 自动激活 → 切换 active → 删除还原
    const testId = 'e2e-src'
    await saveModelSource({ id: testId, name: 'E2E 测试', api_key: 'sk-e2e-test', base_url: '', model: 'deepseek-v4-flash' })
    let cfg = await getModelConfigs()
    if (!cfg.sources.some((s) => s.id === testId)) return fail(8, '新增来源未出现')
    if (cfg.active_source !== testId) return fail(8, `首来源未自动激活: ${cfg.active_source}`)
    await setActiveModelSource(testId)
    cfg = await getModelConfigs()
    if (cfg.active_source !== testId) return fail(8, 'set_active 未生效')
    await deleteModelSource(testId)
    cfg = await getModelConfigs()
    if (cfg.sources.some((s) => s.id === testId)) return fail(8, '删除未生效')
    ok(8, '新增/激活/切换/删除链路一致')
  } catch (e) {
    return fail(8, e instanceof Error ? e.message : String(e))
  }

  // 报告落盘（best-effort，供外部验证读取；失败不影响判定）
  try {
    await rpc.e2eReport(
      JSON.stringify(
        { ok: allPass, finishedAt: Date.now(), layout, confirmSeen, steps },
        null,
        2,
      ),
    )
  } catch {
    /* 忽略 */
  }

  return allPass
}
