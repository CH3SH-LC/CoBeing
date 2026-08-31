/**
 * 经验总结服务测试（方案 v0.1）：
 * - ExperienceStore 扩展（loadAll / rewrite / count）
 * - ExperienceService：自适 scope / 自适总结 / 注入块 / 画像合并 / 成员总结 / 轮次总结
 * - AgentInstance 经验注入（user 动态区）
 *
 * 全部使用 MockProvider 可编程 responder 驱动（LLM 环节隔离）。
 */

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentDef, ToolRunContext } from '@cobeing/types'
import { WindowLog } from '../src/event-log/window-log.js'
import { project } from '../src/event-log/projection.js'
import { LLMGateway, MockProvider, type ChatRequest } from '../src/llm/gateway.js'
import { ExperienceStore } from '../src/memory/store.js'
import { PathGuard } from '../src/permission/guard.js'
import { AgentInstance, DEFAULT_PROTOCOL_TEXT } from '../src/runtime/agent-loop.js'
import { ToolScheduler } from '../src/scheduler/scheduler.js'
import { DefaultToolRegistry } from '../src/tools/registry.js'
import { ToolAgentRegistry } from '../src/tools/call-tool-agent.js'
import { registerBuiltinToolAgents } from '../src/tools/builtin-tool-agents.js'
import {
  ExperienceService,
  EXPERIENCE_CONTEXT_ENTRIES,
  EXPERIENCE_MAX_ENTRIES,
  EXPERIENCE_PROFILE_SOURCE,
  memberMaterial,
} from '../src/runtime/experience.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), tag))
  dirs.push(dir)
  return dir
}

/** 捕获每次 LLM 调用的 instruction（system 内容）与素材（user 内容） */
function captureLlm() {
  const calls: Array<{ instruction: string; text: string }> = []
  const llm = async (text: string, instruction: string) => {
    calls.push({ instruction, text })
    return '- 提炼出的经验条目'
  }
  return { calls, llm }
}

// ---------- ExperienceStore 扩展 ----------

describe('ExperienceStore 扩展（loadAll / rewrite / count）', () => {
  test('空档案 loadAll/count 为空', async () => {
    const store = new ExperienceStore(join(tempDir('cb-exp-store-'), 'memory'))
    expect(await store.loadAll('a')).toEqual([])
    expect(await store.count('a')).toBe(0)
  })

  test('append 后 loadAll 返回完整条目（含 id/ts/source/content/tags）', async () => {
    const store = new ExperienceStore(join(tempDir('cb-exp-store-'), 'memory'))
    await store.append('a', { source: 's1', content: '内容一', tags: ['x'] })
    await store.append('a', { source: 's2', content: '内容二' })
    const all = await store.loadAll('a')
    expect(all).toHaveLength(2)
    expect(all[0]!.source).toBe('s1')
    expect(all[0]!.content).toBe('内容一')
    expect(all[0]!.tags).toEqual(['x'])
    expect(all[1]!.source).toBe('s2')
    expect(all[1]!.id).toBeTruthy()
    expect(all[1]!.ts).toBeGreaterThan(0)
  })

  test('rewrite 全量重写（旧条目被替换）', async () => {
    const store = new ExperienceStore(join(tempDir('cb-exp-store-'), 'memory'))
    await store.append('a', { source: 'old', content: '旧条目' })
    await store.rewrite('a', [
      { id: 'p1', ts: 1, source: EXPERIENCE_PROFILE_SOURCE, content: '画像', tags: ['profile'] },
      { id: 'e1', ts: 2, source: 'group:g', content: '新条目' },
    ])
    const all = await store.loadAll('a')
    expect(all).toHaveLength(2)
    expect(all[0]!.source).toBe(EXPERIENCE_PROFILE_SOURCE)
    expect(all[1]!.content).toBe('新条目')
    expect(await store.count('a')).toBe(2)
  })

  test('search：关键词匹配内容/来源/标签（不区分大小写）+ 空关键词返回最新', async () => {
    const store = new ExperienceStore(join(tempDir('cb-exp-search-'), 'memory'))
    await store.append('a', { source: 'group:g1', content: '记录路径 D:\\x\\a.txt 与字符数', tags: ['file'] })
    await store.append('a', { source: 'turn:g1', content: 'node 脚本运行等待 3 秒', tags: ['bash'] })
    await store.append('a', { source: 'group:g2', content: '设计文档放 docs 目录', tags: ['doc'] })
    // 内容匹配
    expect((await store.search('a', 'node')).map((e) => e.content)).toEqual(['node 脚本运行等待 3 秒'])
    // 来源匹配
    expect((await store.search('a', 'g2')).map((e) => e.content)).toEqual(['设计文档放 docs 目录'])
    // 标签匹配
    expect((await store.search('a', 'file')).map((e) => e.content)).toEqual(['记录路径 D:\\x\\a.txt 与字符数'])
    // 大小写不敏感
    expect((await store.search('a', 'NODE')).map((e) => e.content)).toEqual(['node 脚本运行等待 3 秒'])
    // 无匹配
    expect(await store.search('a', '不存在的词')).toEqual([])
    // 空关键词 → 最新在前（等价 recall）
    const latest = await store.search('a', '')
    expect(latest[0]!.content).toBe('设计文档放 docs 目录')
    expect(latest).toHaveLength(3)
  })
})

// ---------- ExperienceService ----------

describe('ExperienceService 自适 scope（总结适合自己的经验）', () => {
  test('scopeFor：登记智能体含角色/工具/定义 + 既有画像', async () => {
    const dir = tempDir('cb-exp-svc-')
    const store = new ExperienceStore(join(dir, 'memory'))
    // 画像条目（source=profile）并入 scope；普通条目不进 scope
    await store.rewrite('fe-dev', [
      { id: 'p1', ts: 1, source: EXPERIENCE_PROFILE_SOURCE, content: '用户偏好浅色主题', tags: ['profile'] },
    ])
    const svc = new ExperienceService({
      memory: store,
      llm: async () => '',
      defOf: (name) =>
        name === 'fe-dev'
          ? { role: '前端开发者', tools: ['str-replace-editor', 'grep-files'], basePrompt: '负责前端代码' }
          : undefined,
    })
    const scope = await svc.scopeFor('fe-dev')
    expect(scope).toContain('fe-dev')
    expect(scope).toContain('前端开发者')
    expect(scope).toContain('str-replace-editor')
    expect(scope).toContain('负责前端代码')
    expect(scope).toContain('用户偏好浅色主题') // 既有画像并入
  })

  test('scopeFor：管家用铃音人格；未登记实例退化按名字', async () => {
    const svc = new ExperienceService({
      memory: new ExperienceStore(join(tempDir('cb-exp-svc-'), 'memory')),
      llm: async () => '',
      defOf: () => undefined,
      butlerPersona: '你是管家铃音（Suzune）\n【职责】观察、总结、协调、向用户汇报',
    })
    const butlerScope = await svc.scopeFor('butler')
    expect(butlerScope).toContain('铃音')
    expect(butlerScope).toContain('观察、总结、协调')
    const bareScope = await svc.scopeFor('unknown-agent')
    expect(bareScope).toContain('unknown-agent')
  })

  test('memoryAgentInstruction：完整方法论（自适 scope + 提炼要点 + 条目格式）进【记忆】上下文', async () => {
    const dir = tempDir('cb-exp-svc-')
    const store = new ExperienceStore(join(dir, 'memory'))
    await store.rewrite('writer', [
      { id: 'p1', ts: 1, source: EXPERIENCE_PROFILE_SOURCE, content: '用户偏好简短汇报', tags: ['profile'] },
    ])
    const svc = new ExperienceService({
      memory: store,
      llm: async () => '',
      defOf: (name) => (name === 'writer' ? { role: '写作者', tools: ['str-replace-editor'] } : undefined),
    })
    const instruction = await svc.memoryAgentInstruction('writer')
    expect(instruction).toContain('记忆工具智能体')
    expect(instruction).toContain('写作者') // 自适 scope 进上下文
    expect(instruction).toContain('str-replace-editor')
    expect(instruction).toContain('用户偏好简短汇报') // 既有画像并入
    expect(instruction).toContain('条目化') // 条目格式方法论
    expect(instruction).toContain('无关知识不总结') // 只总结自己的经验
  })

  test('contextBlock：空档案返回空；画像 + 最近 N 条；长内容截断', async () => {
    const dir = tempDir('cb-exp-svc-')
    const store = new ExperienceStore(join(dir, 'memory'))
    const svc = new ExperienceService({ memory: store, llm: async () => '', defOf: () => undefined })
    expect(await svc.contextBlock('empty')).toBe('')

    await store.rewrite('a', [
      { id: 'p1', ts: 1, source: EXPERIENCE_PROFILE_SOURCE, content: '长期画像内容', tags: ['profile'] },
    ])
    for (let i = 0; i < EXPERIENCE_CONTEXT_ENTRIES + 3; i++) {
      await store.append('a', { source: `group:g${i}`, content: `条目${i}` })
    }
    const block = await svc.contextBlock('a')
    expect(block).toContain('长期画像内容')
    expect(block).toContain('条目' + (EXPERIENCE_CONTEXT_ENTRIES + 2)) // 最新条目在
    expect(block).not.toContain('条目0') // 超出的旧条目不在

    // 超长单条截断
    const long = '长'.repeat(2000)
    await store.rewrite('b', [{ id: 'p1', ts: 1, source: EXPERIENCE_PROFILE_SOURCE, content: long }])
    const longBlock = await svc.contextBlock('b')
    expect(longBlock.length).toBeLessThan(1000)
    expect(longBlock).toContain('[截断]')
  })

  test('consolidate：普通条目超阈值 → 合并为画像 + 保留最新一半', async () => {
    const dir = tempDir('cb-exp-svc-')
    const store = new ExperienceStore(join(dir, 'memory'))
    const { calls, llm } = captureLlm()
    const svc = new ExperienceService({ memory: store, llm, defOf: () => undefined })
    for (let i = 0; i < EXPERIENCE_MAX_ENTRIES + 10; i++) {
      await store.append('a', { source: `s${i}`, content: `内容${i}` })
    }
    await svc.consolidate('a')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.instruction).toContain('合并')
    const all = await store.loadAll('a')
    const profile = all.filter((e) => e.source === EXPERIENCE_PROFILE_SOURCE)
    const normal = all.filter((e) => e.source !== EXPERIENCE_PROFILE_SOURCE)
    expect(profile).toHaveLength(1)
    expect(profile[0]!.content).toContain('提炼出的经验条目')
    // 保留最新一半（60 条 → 旧 30 合并，新 30 保留）
    expect(normal.length).toBe(Math.floor((EXPERIENCE_MAX_ENTRIES + 10) / 2))
    expect(normal[normal.length - 1]!.source).toBe(`s${EXPERIENCE_MAX_ENTRIES + 9}`)
  })

  test('maybeConsolidate：追加超阈值自动合并', async () => {
    const dir = tempDir('cb-exp-svc-')
    const store = new ExperienceStore(join(dir, 'memory'))
    const { llm } = captureLlm()
    const svc = new ExperienceService({ memory: store, llm, defOf: () => undefined })
    for (let i = 0; i < EXPERIENCE_MAX_ENTRIES; i++) {
      await store.append('a', { source: `s${i}`, content: `内容${i}` })
    }
    await svc.maybeConsolidate('a')
    expect(await store.count('a')).toBe(EXPERIENCE_MAX_ENTRIES) // 未到阈值不合并
    await store.append('a', { source: 's-over', content: '内容 over' })
    await svc.maybeConsolidate('a')
    const all = await store.loadAll('a')
    expect(all.some((e) => e.source === EXPERIENCE_PROFILE_SOURCE)).toBe(true) // 超阈值触发合并
    expect(all.length).toBeLessThan(EXPERIENCE_MAX_ENTRIES)
  })

  test('memberMaterial：有活动返回素材（发言/思考/工具）；无活动返回空', async () => {
    const dir = tempDir('cb-exp-svc-')
    const log = new WindowLog(join(dir, 'log.jsonl'))
    await log.append({ type: 'speak', actor: 'user', content: '请干活' })
    await log.append({ type: 'think', actor: 'writer', content: '我先看看文件' })
    await log.append({ type: 'tool/call', actor: 'writer', callId: 'c1', name: 'glob-files', arguments: { pattern: '**' } })
    await log.append({ type: 'tool/result', actor: 'writer', callId: 'c1', ok: true, content: '找到 3 个文件' })
    const projection = project(log.readCached())

    const material = memberMaterial('writer', projection, 0)
    expect(material).toContain('我的思考过程')
    expect(material).toContain('我的工具记录')
    expect(material).toContain('我先看看文件')

    // 无活动成员 → 空（kernel 据此跳过【记忆】调用）
    expect(memberMaterial('idle-agent', projection, 0)).toBe('')
  })

  test('memberMaterial：sinceSeq 水位过滤（只取之后事件）', async () => {
    const dir = tempDir('cb-exp-svc-')
    const log = new WindowLog(join(dir, 'log.jsonl'))
    await log.append({ type: 'speak', actor: 'writer', content: '第一轮发言' })
    await log.append({ type: 'speak', actor: 'writer', content: '第二轮发言' })
    const projection = project(log.readCached())
    // 水位 = 第一轮结束时的最后 seq：之后只有第二轮发言 → 素材只含第二轮
    const firstSeq = projection.publicMessages.find((m) => m.content === '第一轮发言')!.seq

    const material = memberMaterial('writer', projection, firstSeq)
    expect(material).toContain('第二轮发言')
    expect(material).not.toContain('第一轮发言')

    // 水位 = 最后 seq：之后无活动 → 空
    const lastSeq = projection.events.at(-1)!.seq
    expect(memberMaterial('writer', projection, lastSeq)).toBe('')
  })
})

// ---------- AgentInstance 经验注入 ----------

describe('AgentInstance 经验注入（user 动态区，前缀稳定）', () => {
  function makeAgent(opts: { experience?: () => Promise<string>; responder?: (req: ChatRequest) => string }) {
    const dir = tempDir('cb-exp-inject-')
    const log = new WindowLog(join(dir, 'log.jsonl'))
    const gateway = new LLMGateway()
    gateway.registerProvider(new MockProvider(opts.responder ?? (() => '{"reply":"ok"}')))
    const registry = new DefaultToolRegistry()
    const def: AgentDef = { name: 'tester', role: '测试员', provider: 'mock', model: 'm', maxTokens: 200, createdAt: Date.now() }
    const agent = new AgentInstance({
      def,
      group: 'main',
      cwd: dir,
      log,
      projection: () => project(log.readCached()),
      gateway,
      scheduler: new ToolScheduler(registry, 10),
      registry,
      memory: new ExperienceStore(join(dir, 'memory')),
      guard: new PathGuard(dir, true, 'readwrite'),
      protocolText: DEFAULT_PROTOCOL_TEXT,
      maxToolRounds: 3,
      experience: opts.experience,
    })
    return { agent, log }
  }

  async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
    const start = Date.now()
    while (!fn()) {
      if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  test('提供 experience → 模型收到的 user 含 [我的经验档案] 段', async () => {
    let seenUser = ''
    const { agent } = makeAgent({
      experience: async () => '- [长期] 用户偏好中文回复\n- [2026-08-24 group:g1] 完成过类似任务',
      responder: (req) => {
        seenUser = req.messages[req.messages.length - 1]!.content
        return '{"reply":"ok"}'
      },
    })
    agent.wake({ content: 'hello' })
    await waitFor(() => seenUser.includes('[我的经验档案]'))
    expect(seenUser).toContain('用户偏好中文回复')
    expect(seenUser.indexOf('[我的经验档案]')).toBeGreaterThan(seenUser.indexOf('[我的最近工具结果]'))
  })

  test('不提供 experience → 无经验段；experience 抛错 → 降级为空不中断', async () => {
    let seenUser = ''
    const { agent } = makeAgent({
      experience: async () => {
        throw new Error('boom')
      },
      responder: (req) => {
        seenUser = req.messages[req.messages.length - 1]!.content
        return '{"reply":"ok"}'
      },
    })
    agent.wake({ content: 'hello' })
    await waitFor(() => seenUser.includes('[我的最近工具结果]'))
    expect(seenUser).not.toContain('[我的经验档案]')
  })
})

// ---------- Kernel 接线（归档/新对话/存档信息） ----------

describe('Kernel 经验接线', () => {
  test('newButlerConversation 归档 → butler.md 写自适经验条目（含铃音 scope）', async () => {
    const dir = tempDir('cb-exp-kernel-')
    const seenInstructions: string[] = []
    const { Kernel } = await import('../src/kernel.js')
    const kernel = new Kernel(dir, {
      mockResponder: (req) => {
        const system = req.messages[0]?.content ?? ''
        // 【记忆】工具智能体调用（指令含"记忆工具智能体"）→ 返回条目文本；否则模型 JSON
        if (system.includes('记忆工具智能体')) {
          seenInstructions.push(system)
          return '- 用户希望管家记住北极熊皮肤是黑色的'
        }
        if (system.includes('[输出协议]')) return '{"reply":"你好，我是管家铃音"}'
        return '{"reply":"(mock)"}'
      },
      notifyUser: () => undefined,
    })
    await kernel.start()
    await kernel.mainWindowSpeak('你好铃音，请记住：北极熊的皮肤是黑色的。')
    await waitFor(() => kernel.butlerProjection().publicMessages.some((m) => m.actor === 'butler'))
    await kernel.newButlerConversation()
    // 归档总结经【记忆】工具智能体：指令含铃音自适 scope
    expect(seenInstructions.length).toBeGreaterThan(0)
    expect(seenInstructions[0]).toContain('铃音')
    const memoryFile = join(dir, 'memory', 'butler.md')
    expect(existsSync(memoryFile)).toBe(true)
    const text = readFileSync(memoryFile, 'utf8')
    expect(text).toContain('北极熊')
    const info = await kernel.experienceInfo('butler')
    expect(info.count).toBeGreaterThan(0)
    expect(info.lastUpdated).toBeGreaterThan(0)
    await kernel.stop()
  }, 15_000)

  test('archiveGroup → 工作智能体经验档案写 group 条目（自适 scope 含角色）', async () => {
    const dir = tempDir('cb-exp-kernel-')
    const seenScopes: string[] = []
    const { Kernel } = await import('../src/kernel.js')
    const kernel = new Kernel(dir, {
      mockResponder: (req) => {
        const system = req.messages[0]?.content ?? ''
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        if (system.includes('[输出协议]')) {
          if (last.includes('欢迎语')) return '{"reply":"欢迎来到 CoBeing！"}'
          return '{"reply":"(mock) 已收到"}'
        }
        // 经验总结调用：记录 scope（指令含"你是"）并返回条目
        seenScopes.push(system)
        return '- 我是写作者，完成了欢迎语任务'
      },
      notifyUser: () => undefined,
    })
    await kernel.start()
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', tools: ['str-replace-editor'], createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    const group = await kernel.createGroup('demo', ['user', 'butler', 'writer'])
    await kernel.speakToGroup('demo', 'user', '请 writer 写欢迎语', ['writer'], '写欢迎语')
    await waitFor(() => group.projection().publicMessages.some((m) => m.actor === 'writer'))
    await kernel.archiveGroup('demo')
    // 成员总结 scope 含该智能体定义（自适）
    const scoped = seenScopes.find((s) => s.includes('写作者'))
    expect(scoped).toBeTruthy()
    const memoryFile = join(dir, 'memory', 'writer.md')
    expect(existsSync(memoryFile)).toBe(true)
    const text = readFileSync(memoryFile, 'utf8')
    expect(text).toContain('group:demo')
    expect(text).toContain('欢迎语')
    const info = await kernel.experienceInfo('writer')
    expect(info.count).toBeGreaterThan(0)
    await kernel.stop()
  }, 15_000)

  test('experience/info：无档案智能体 count=0', async () => {
    const dir = tempDir('cb-exp-kernel-')
    const { Kernel } = await import('../src/kernel.js')
    const kernel = new Kernel(dir, { mockResponder: () => '{"reply":"(mock)"}', notifyUser: () => undefined })
    await kernel.start()
    const info = await kernel.experienceInfo('ghost')
    expect(info).toEqual({ agent: 'ghost', count: 0, lastUpdated: undefined })
    await kernel.stop()
  })

  test('长活群组轮次总结经【记忆】工具智能体（experienceTurnEvery=1 → turn 条目）', async () => {
    const dir = tempDir('cb-exp-kernel-')
    const seenInstructions: string[] = []
    const { Kernel } = await import('../src/kernel.js')
    const kernel = new Kernel(dir, {
      experienceTurnEvery: 1,
      mockResponder: (req) => {
        const system = req.messages[0]?.content ?? ''
        // 【记忆】invoke（信息提取统一入口）
        if (system.includes('记忆工具智能体')) {
          seenInstructions.push(system)
          return '- 轮次经验：完成了欢迎语'
        }
        const last = req.messages[req.messages.length - 1]?.content ?? ''
        if (last.includes('欢迎语')) return '{"reply":"欢迎来到 CoBeing！"}'
        return '{"reply":"(mock) 已收到"}'
      },
      notifyUser: () => undefined,
    })
    await kernel.start()
    await kernel.requestCreateAgent({ name: 'writer', role: '写作者', createdAt: Date.now() })
    await kernel.confirmAgent('writer')
    const group = await kernel.createGroup('demo', ['user', 'butler', 'writer'])
    await kernel.speakToGroup('demo', 'user', '请 writer 写欢迎语', ['writer'], '写欢迎语')
    await waitFor(() => group.projection().publicMessages.some((m) => m.actor === 'writer'))
    // 轮次总结 fire-and-forget：等待 turn:demo 条目落盘
    await waitFor(() => {
      try {
        return readFileSync(join(dir, 'memory', 'writer.md'), 'utf8').includes('turn:demo')
      } catch {
        return false
      }
    }, 10_000)
    expect(seenInstructions.length).toBeGreaterThan(0)
    expect(seenInstructions[0]).toContain('写作者') // 自适 scope 进【记忆】上下文
    const info = await kernel.experienceInfo('writer')
    expect(info.count).toBeGreaterThan(0)
    await kernel.stop()
  }, 20_000)
})

// ---------- 工具智能体【记忆】（信息提取统一入口契约） ----------

describe('工具智能体【记忆】', () => {
  function fakeCtx(): ToolRunContext {
    return {
      agent: 'writer',
      group: 'demo',
      cwd: tempDir('cb-exp-mem-'),
      guard: new PathGuard(tempDir('cb-exp-mem-'), true, 'readwrite'),
      signal: new AbortController().signal,
      speak: async () => {},
      writePrivate: async () => {},
    }
  }

  test('invoke：完整方法论指令注入 + 写档案 + 超阈值触发合并检查', async () => {
    const dir = tempDir('cb-exp-mem-')
    const store = new ExperienceStore(join(dir, 'memory'))
    // 预填超阈值普通条目（51 条）→ invoke 写第 52 条后应触发 maybeConsolidate
    for (let i = 0; i < EXPERIENCE_MAX_ENTRIES + 1; i++) {
      await store.append('writer', { source: `s${i}`, content: `内容${i}` })
    }
    const seenInstructions: string[] = []
    let consolidated = false
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async (_text, instruction) => {
        seenInstructions.push(instruction)
        return '- 经验：用 write 创建文件'
      },
      memoryInstruction: async (name) => `【记忆上下文】为 ${name} 总结，方法论：条目化输出`,
      maybeConsolidate: async (name) => {
        consolidated = name === 'writer'
      },
    })
    const spec = registry.get('记忆')
    expect(spec).toBeTruthy()
    const result = await spec!.invoke({ target: 'writer', material: '素材', source: 'group:g1' }, fakeCtx())
    expect(result.ok).toBe(true)
    expect(result.content).toContain('writer')
    // 完整方法论指令注入【记忆】上下文
    expect(seenInstructions[0]).toContain('【记忆上下文】')
    expect(seenInstructions[0]).toContain('writer')
    // 写档案（source 透传）
    const entries = await store.loadAll('writer')
    expect(entries.at(-1)!.source).toBe('group:g1')
    expect(entries.at(-1)!.content).toContain('write 创建文件')
    // 超阈值 → 合并检查被调用
    expect(consolidated).toBe(true)
  })

  test('invoke：未接线 memoryInstruction 回退通用指令；合并检查失败不阻断', async () => {
    const dir = tempDir('cb-exp-mem-')
    const store = new ExperienceStore(join(dir, 'memory'))
    const seenInstructions: string[] = []
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async (_text, instruction) => {
        seenInstructions.push(instruction)
        return '- 通用经验'
      },
      maybeConsolidate: async () => {
        throw new Error('合并失败')
      },
    })
    const spec = registry.get('记忆')!
    const result = await spec.invoke({ target: 'ghost', material: '素材', source: 'x' }, fakeCtx())
    expect(result.ok).toBe(true)
    expect(seenInstructions[0]).toContain('严格围绕该智能体的职责范围') // 回退指令
    const entries = await store.loadAll('ghost')
    expect(entries).toHaveLength(1)
  })
})

// ---------- 工具智能体【诚实】（发言真实性审查：无长期上下文） ----------

describe('工具智能体【诚实】', () => {
  function fakeCtx(): ToolRunContext {
    return {
      agent: 'writer',
      group: 'demo',
      cwd: tempDir('cb-exp-hon-'),
      guard: new PathGuard(tempDir('cb-exp-hon-'), true, 'readwrite'),
      signal: new AbortController().signal,
      speak: async () => {},
      writePrivate: async () => {},
    }
  }

  test('注册存在：无长期上下文（不读写经验档案），输入 claim/evidence', async () => {
    const dir = tempDir('cb-exp-hon-')
    const store = new ExperienceStore(join(dir, 'memory'))
    const registry = new ToolAgentRegistry()
    const seen: string[] = []
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async (_text, instruction) => {
        seen.push(instruction)
        return '{"pass":true,"reason":"有写文件证据"}'
      },
    })
    const spec = registry.get('诚实')
    expect(spec).toBeTruthy()
    const result = await spec!.invoke(
      { target: 'writer', claim: '已完成 index.html 开发', evidence: 'tool:str-replace-editor [ok] write index.html' },
      fakeCtx(),
    )
    expect(result.ok).toBe(true)
    // 审查指令完整（真实性标准 + 不评价效果）
    expect(seen[0]).toContain('是否真实')
    expect(seen[0]).toContain('不评价工作质量')
    expect(result.content).toContain('pass=true')
    // 无长期上下文：不写任何档案
    expect(await store.loadAll('writer')).toEqual([])
  })

  test('判定不通过：声称完成但无工具证据 → pass=false', async () => {
    const store = new ExperienceStore(join(tempDir('cb-exp-hon-'), 'memory'))
    const registry = new ToolAgentRegistry()
    registerBuiltinToolAgents(registry, {
      memory: store,
      llmSummarize: async () => '{"pass":false,"reason":"声称完成但工具记录为空"}',
    })
    const spec = registry.get('诚实')!
    const result = await spec.invoke(
      { target: 'writer', claim: '全部完成了！', evidence: '（无）' },
      fakeCtx(),
    )
    expect(result.content).toContain('pass=false')
    expect(result.content).toContain('工具记录为空')
  })

  test('parseHonestyVerdict：容错解析（带前后缀文本/非 JSON 返回 null；kind 分类与缺省回退）', async () => {
    const { parseHonestyVerdict } = await import('../src/tools/builtin-tool-agents.js')
    expect(parseHonestyVerdict('好的，结论如下：{"pass":false,"reason":"无证据"} 完毕')).toEqual({ pass: false, kind: 'completion', reason: '无证据' })
    expect(parseHonestyVerdict('{"pass":true,"reason":"ok"}')).toEqual({ pass: true, kind: 'completion', reason: 'ok' })
    // kind 分类：process 保留；未知 kind 回退 completion（旧格式兼容）
    expect(parseHonestyVerdict('{"pass":true,"kind":"process","reason":"进展中"}')).toEqual({ pass: true, kind: 'process', reason: '进展中' })
    expect(parseHonestyVerdict('{"pass":true,"kind":"other","reason":"x"}')).toEqual({ pass: true, kind: 'other', reason: 'x' })
    expect(parseHonestyVerdict('{"pass":false,"kind":"weird","reason":"x"}')).toEqual({ pass: false, kind: 'completion', reason: 'x' })
    expect(parseHonestyVerdict('无法判断')).toBeNull()
    expect(parseHonestyVerdict('{"pass":"yes"}')).toBeNull()
  })
})

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}
