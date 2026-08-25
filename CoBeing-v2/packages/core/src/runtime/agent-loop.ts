/**
 * 原体循环（AgentInstance）——原体规格 §7 状态机 + 组装管线（§4）
 *
 * idle → (被 mention 唤醒) → busy → 组装 → 思考/工具循环（私密）→ 发言/报告完成 → idle
 *
 * - 模型协议（占位，提示词模板待设计）：模型返回 JSON { reply?, toolCalls? }
 * - 组装：冻结三段系统提示 + 公共上下文 + 私密上下文 + 工具结果 + 按需记忆
 * - 循环上限 maxToolRounds 防死循环（架构 §7.2）
 * - 忙碌排队：工作中被再次唤醒 → FIFO 排队，工作完全收敛后再处理
 */

import { randomUUID } from 'node:crypto'
import type { AgentDef, ToolRunContext, ToolResult, ToolRegistry } from '@cobeing/types'
import type { WindowLog } from '../event-log/window-log.js'
import { renderPrivate, renderPublic, renderToolResults, type WindowProjection } from '../event-log/projection.js'
import type { ToolScheduler, SchedulerHooks } from '../scheduler/scheduler.js'
import type { LLMGateway } from '../llm/gateway.js'
import type { ExperienceStore } from '../memory/store.js'
import type { PathGuard } from '../permission/guard.js'

export interface AgentInstanceOptions {
  def: AgentDef
  group: string
  cwd: string
  log: WindowLog
  /** 动态投影（群组提供；每次组装时读取） */
  projection: () => WindowProjection
  gateway: LLMGateway
  scheduler: ToolScheduler
  registry: ToolRegistry
  memory: ExperienceStore
  guard: PathGuard
  /** 冻结的群组协作协议段文本（原体规格 §6） */
  protocolText: string
  /** 附加工具（定义工具白名单之外的原体默认 4 个） */
  extraTools?: ToolDef[]
  /** 禁止使用的工具名（如主窗口管家禁用 bash/group-speak）；命中调用写 TOOL_DENIED 结果 */
  denyTools?: string[]
  /** 基座提示（原体规格 §2：dsh 形式固定 1 句） */
  basePrompt?: string
  maxToolRounds?: number
  /** 一轮工作完全结束后回调（busy→idle 之后；如主窗口管家轮后自动压缩检查） */
  onTurnComplete?: () => void | Promise<void>
  /** 经验档案注入块（方案 v0.1：画像 + 最近条目；返回 '' 表示无经验）。注入 user 动态区，不破坏 system 前缀 */
  experience?: () => Promise<string>
  /**
   * 发言真实性审查（【诚实】工具智能体接线）：reply 发言落群组日志前调用。
   * 返回 pass=false 时发言不发布，审查反馈注入下一轮（模型继续工作），
   * 连续被拒超过 maxHonestyRetries 次则放弃本次发言（不发布，防幻觉）。
   * kind='process'（过程性发言且已有成功工具证据）→ 发言发布（进展可见）后**继续回合**
   * （修复 5 goal 化：未完成自动续轮，对齐 dsh goal-round-driver；受 maxToolRounds 兜底）。
   * 未接线（如 butler/主窗口）不审查。
   */
  honesty?: (claim: string, evidence: string) => Promise<{ pass: boolean; reason: string; kind?: 'completion' | 'process' | 'other' }>
  /** 诚实审查连续失败上限（默认 3）：超过后放弃发言 */
  maxHonestyRetries?: number
}

type ToolDef = import('@cobeing/types').ToolDef

interface WakeMessage {
  content: string
  task?: string
  /** 系统状态注记（如群组列表摘要）：仅组装注入，不落公共日志 */
  systemNote?: string
}

export class AgentInstance {
  status: 'idle' | 'busy' = 'idle'
  private queue: WakeMessage[] = []
  private signal: AbortSignal | null = null
  /** 上次请求头（变化才追加 request/header 事件——dsh 对齐） */
  private lastHeader: { provider: string; model: string; maxTokens?: number; system?: string; tools?: string[] } | null = null

  constructor(private opts: AgentInstanceOptions) {}

  get name(): string {
    return this.opts.def.name
  }

  /** 被唤醒（mention 命中）。busy → 排队（规格：等完全工作完再处理第二次唤醒） */
  wake(message: WakeMessage): void {
    if (this.status === 'busy') {
      this.queue.push(message)
      return
    }
    void this.run(message)
  }

  /** 取消当前工作（abort 收敛由调度器承担） */
  cancel(): void {
    // TODO: AbortController 接线（当前信号由内核持有）
  }

  /** request/header 变化才追加（system/tools/provider/model 全同则跳过） */
  private async appendHeaderIfChanged(header: { provider: string; model: string; maxTokens?: number; system?: string; tools?: string[] }): Promise<void> {
    const prev = this.lastHeader
    const same = prev !== null
      && prev.provider === header.provider
      && prev.model === header.model
      && (prev.maxTokens ?? null) === (header.maxTokens ?? null)
      && prev.system === header.system
      && arraysEqual(prev.tools, header.tools)
    if (same) return
    this.lastHeader = header
    await this.opts.log.append({
      type: 'request/header',
      actor: this.name,
      provider: header.provider,
      model: header.model,
      maxTokens: header.maxTokens,
      system: header.system,
      tools: header.tools,
      reason: prev === null ? 'initial' : 'change',
    })
  }

  private async run(initial: WakeMessage): Promise<void> {
    this.status = 'busy'
    await this.opts.log.append({ type: 'agent/status', agent: this.name, status: 'busy' })
    const controller = new AbortController()
    this.signal = controller.signal
    // 诚实审查连续失败计数（超过上限放弃发言，防幻觉刷屏）
    let honestyFails = 0
    const maxHonestyFails = this.opts.maxHonestyRetries ?? 3
    try {
      let message = initial
      const rounds = this.opts.maxToolRounds ?? 10
      // 任务锚点（修复 2，对齐 dsh 全量历史在场）：本次唤醒的任务说明跨轮保留，
      // 每轮组装都带 [任务说明]——模型不需要从高噪声公共上下文里考古任务目标
      const anchorTask = initial.task
      // 本次唤醒起点 seq：诚实审查证据只取本次工作期间的工具记录
      // （修复 3：跨唤醒的旧工具记录不算"本次工作证据"，防"上次干过活"被当成"这次干过活"）
      const wakeStartSeq = this.opts.log.readCached().at(-1)?.seq ?? 0
      for (let round = 0; round < rounds; round++) {
        // 任何反馈消息（诚实拒绝/截断/工具失败）都补回任务锚点
        if (message.task === undefined && anchorTask !== undefined) {
          message = { ...message, task: anchorTask }
        }
        const outcome = await this.step(message, controller.signal, wakeStartSeq)
        if (outcome.done || controller.signal.aborted) break
        // 诚实审查拒绝：计数 + 反馈下一轮继续真实工作；超过上限放弃发言（防幻觉刷屏）
        if (outcome.honestyRejected) {
          honestyFails++
          if (honestyFails >= maxHonestyFails) break
          message = outcome.feedback ?? {
            content: '',
            task: undefined,
            systemNote: '【诚实审查】你的上一条发言被判定为疑似幻觉（声称完成但无真实工作证据），未发布。请继续真实工作（调用工具生成产物）后再次汇报。',
          }
          continue
        }
        // 其他反馈（如工具失败要求修正）
        if (outcome.feedback) {
          message = outcome.feedback
          continue
        }
        // 任务锚点保留：内容清空（公共上下文已带用户消息），任务说明继续在场
        message = { content: '', task: anchorTask }
      }
    } catch (error) {
      await this.opts.log.append({
        type: 'speak',
        actor: this.name,
        content: `[工作失败] ${error instanceof Error ? error.message : String(error)}（已通知用户/管家）`,
        mention: ['butler'],
      })
    } finally {
      this.status = 'idle'
      this.signal = null
      await this.opts.log.append({ type: 'agent/status', agent: this.name, status: 'idle' })
      // 轮次完成钩子（如主窗口轮后自动压缩）：失败不阻塞主流程与排队唤醒
      try {
        await this.opts.onTurnComplete?.()
      } catch {
        // 忽略钩子错误
      }
      const next = this.queue.shift()
      if (next) this.wake(next)
    }
  }

  /** 一步：组装 → 模型调用 → 工具执行 / 发言 */
  private async step(message: WakeMessage, signal: AbortSignal, wakeStartSeq: number): Promise<{ done: boolean; feedback?: WakeMessage; honestyRejected?: boolean }> {
    const { def, log, gateway, scheduler } = this.opts
    const projection = this.opts.projection()

    // 可用工具清单（过滤 denyTools；模型据此决定 toolCalls 调用——原体循环工具协议）
    // 每个工具附带参数 schema 摘要（dsh 工具契约面：模型必须知道精确参数键名，不能靠猜）
    // 按名称字典序渲染（跨实例一致，与 dsh orderTools 对齐——请求头前缀稳定的前提）
    const denyTools = this.opts.denyTools ?? []
    const availableTools = this.opts.registry
      .list()
      .filter((t) => !denyTools.includes(t.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((t) => {
        const params = schemaParamsSummary(t.schema)
        return `- ${t.name}：${t.description}${params ? `\n  参数：${params}` : ''}`
      })

    // 冻结系统提示（前缀稳定）：基座 + 协作协议 + 定义 + 输出协议 + 工具清单。
    // 输出协议与工具面移入 system——这是请求前缀，字节级稳定 → KV 缓存命中；
    // user 文本只保留动态内容（唤醒/公共/私密/工具结果），append-only 不干扰前缀。
    const system = [
      this.opts.basePrompt ?? 'You are a helpful working agent.',
      this.opts.protocolText,
      def.basePrompt ?? def.role,
      '[输出协议] 输出严格 JSON：需要工作时输出 {"toolCalls":[{"name":"工具名","args":{...}}]}——工具结果会在下一轮回填，可连续多轮调用直到工作完成；只有确认任务已全部完成（或遇到无法解决的阻塞）时才输出 {"reply":"最终回复"}。不要输出 JSON 以外的格式。',
      '[可用工具]',
      ...availableTools,
    ].filter(Boolean).join('\n\n')

    // 组装（原体规格 §4.1）
    const compactionSummaries = projection.compactions
      .slice(-2)
      .map((c) => `[压缩摘要（遮蔽 seq ${c.start}..${c.end}）] ${c.summary}`)
    // 经验档案（宿主面文件；注入 user 动态区，system 前缀冻结不变；失败降级为空）
    let experienceBlock = ''
    try {
      experienceBlock = this.opts.experience ? await this.opts.experience() : ''
    } catch {
      experienceBlock = ''
    }
    const userText = [
      message.systemNote ? `[系统状态] ${message.systemNote}` : '',
      `[群组：${this.opts.group}]`,
      `[唤醒内容] ${message.content}`,
      message.task ? `[任务说明] ${message.task}` : '',
      '[公共上下文]',
      ...compactionSummaries,
      ...renderPublic(projection.publicMessages, 200),
      '[我的私密内容（最新在前）]',
      ...renderPrivate(projection.privateOf(this.name), 100),
      '[我的最近工具结果]',
      ...renderToolResults(projection.toolsOf(this.name), 20),
      experienceBlock ? '[我的经验档案]\n' + experienceBlock : '',
    ].filter((line) => line !== '').join('\n')

    // request/header：模型面完整头（system + tools + 配置），变化才追加（dsh 对齐）
    const toolNames = availableTools.map((line) => line.split('：')[0]!.replace(/^- /, ''))
    await this.appendHeaderIfChanged({
      provider: def.provider ?? 'mock',
      model: def.model ?? 'mock-model',
      maxTokens: def.maxTokens,
      system,
      tools: toolNames,
    })

    let response
    try {
      response = await gateway.chat({
        provider: def.provider ?? 'mock',
        model: def.model ?? 'mock-model',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        maxTokens: def.maxTokens,
        signal,
      })
    } catch (error) {
      // 模型调用失败：网关重试耗尽后落盘结构化错误（request/error），再向上抛
      await log.append({
        type: 'request/error',
        actor: this.name,
        provider: def.provider ?? 'mock',
        model: def.model ?? 'mock-model',
        attempt: this.opts.maxToolRounds ?? 10,
        errors: errorChain(error),
      })
      throw error
    }

    await log.append({
      type: 'assistant/complete',
      actor: this.name,
      content: response.content,
      usage: response.usage,
    })

    const parsed = parseModelOutput(response.content)

    // 工具调用 → 调度器执行（denyTools 过滤：被拒调用写 TOOL_DENIED 结果，不进入调度）
    if (parsed.toolCalls && parsed.toolCalls.length > 0) {
      const denyTools = this.opts.denyTools
      const planned = parsed.toolCalls.map((call) => ({
        callId: randomUUID(),
        name: call.name,
        args: call.args ?? {},
      }))
      if (denyTools && denyTools.length > 0) {
        const denied = planned.filter((call) => denyTools.includes(call.name))
        for (const call of denied) {
          await log.append({
            type: 'tool/result',
            actor: this.name,
            callId: call.callId,
            ok: false,
            content: `[TOOL_DENIED] 工具 ${call.name} 不在本实例白名单`,
            error: { message: `tool denied: ${call.name}`, code: 'TOOL_DENIED' },
          })
        }
        planned.splice(0, planned.length, ...planned.filter((call) => !denyTools.includes(call.name)))
      }
      if (planned.length === 0) return { done: true }
      const ctx: ToolRunContext = {
        agent: this.name,
        group: this.opts.group,
        cwd: this.opts.cwd,
        guard: this.opts.guard,
        signal,
        speak: async (content, mention, task) => {
          await log.append({ type: 'speak', actor: this.name, content, mention, task })
        },
        writePrivate: async (content) => {
          await log.append({ type: 'think', actor: this.name, content })
        },
      }
      const hooks: SchedulerHooks = {
        onCall: async (call) => {
          await log.append({ type: 'tool/call', actor: this.name, callId: call.callId, name: call.name, arguments: call.args })
        },
        onResult: async (call, result: ToolResult) => {
          await log.append({ type: 'tool/result', actor: this.name, callId: call.callId, ok: result.ok, content: result.content, error: result.error })
        },
        onSynthetic: async (call) => {
          await log.append({
            type: 'tool/result',
            actor: this.name,
            callId: call.callId,
            ok: false,
            content: 'Error: tool call aborted before dispatch',
            error: { message: 'tool call aborted before dispatch', code: 'ABORTED_BEFORE_DISPATCH' },
            synthetic: true,
          })
        },
      }
      const outcome = await scheduler.execute(planned, ctx, hooks, signal)
      if (outcome.aborted) return { done: true }
      // 工具执行后继续循环（模型可再发言/再调工具）
      return { done: false }
    }

    // 发言 → 公共上下文（先经【诚实】审查：声称完成的工作是否真实）
    if (parsed.reply) {
      const honesty = this.opts.honesty
      if (honesty) {
        // 证据：本次唤醒期间（wakeStartSeq 之后）该智能体的工具记录——只认"这次干过的活"，
        // 跨唤醒的旧工具记录不算（修复 3：诚实规则 2 依据"本轮 ≥1 次成功工具调用"放行过程性发言）
        const evidence = renderToolResults(
          projection.toolsOf(this.name).filter((t) => t.seq > wakeStartSeq),
          20,
        ).join('\n')
        let verdict: { pass: boolean; reason: string; kind?: 'completion' | 'process' | 'other' }
        try {
          verdict = await honesty(parsed.reply, evidence)
        } catch {
          // 审查失败（LLM 异常）→ 放行（不阻塞正常交流）
          verdict = { pass: true, reason: '审查调用失败，放行' }
        }
        if (!verdict.pass) {
          // 疑似幻觉：不发布发言，反馈给模型继续真实工作（上限由 run() 计数）
          return { done: false, honestyRejected: true, feedback: {
            content: '',
            task: undefined,
            systemNote: `【诚实审查未通过】${verdict.reason}`,
          } }
        }
        // 过程性发言（有真实工具证据）→ 进展发布 + 继续回合（修复 5 goal 化：未完成自动续轮）。
        // 结构性修正：进展汇报不再是"结束回合"的合法出口——任务未完成时回合继续，
        // 模型看到进展已发布后继续工具调用；回合总数仍受 maxToolRounds 兜底（非惩罚硬闸）。
        if (verdict.kind === 'process') {
          await log.append({ type: 'speak', actor: this.name, content: parsed.reply })
          return { done: false, feedback: {
            content: '',
            task: undefined,
            systemNote:
              '【继续工作】你的进展汇报已发布到群组。当前任务尚未完成，请继续调用工具完成剩余工作；' +
              '全部完成（或遇到无法解决的阻塞）后再输出最终完成汇报。',
          } }
        }
      }
      await log.append({ type: 'speak', actor: this.name, content: parsed.reply })
      return { done: true }
    }

    // 截断的工具调用 JSON（maxTokens 截断）：不发布、不静默，反馈模型分块写入后继续
    if (parsed.truncated) {
      return { done: false, feedback: {
        content: '',
        task: undefined,
        systemNote:
          '【输出截断】你上一条输出是未完成的工具调用 JSON（可能因单次输出过长被截断），未执行。' +
          '请分块完成：先用 str-replace-editor 的 create/write 写入文件骨架，再用 str_replace/insert 分多次追加内容；每次输出保持在限额内。',
      } }
    }
    return { done: true }
  }

  dispose(): void {
    this.queue = []
    this.signal = null
  }
}

/** 解析模型输出（协议：JSON { reply?, toolCalls? }；解析失败视为纯文本发言） */
export function parseModelOutput(content: string): {
  reply?: string
  toolCalls?: Array<{ name: string; args: unknown }>
  /** 疑似被截断的工具调用 JSON（maxTokens 截断/未闭合）——不得当发言发布，应反馈模型分块写入 */
  truncated?: boolean
} {
  const trimmed = content.trim()
  // 优先：提取第一个完整 JSON 对象（平衡括号扫描，容忍前后/夹杂文本与多段 JSON）
  const first = extractFirstJsonObject(trimmed)
  if (first) {
    try {
      const parsed = JSON.parse(first) as {
        reply?: string
        toolCalls?: Array<{ name: string; args: unknown }>
        pendingMessage?: unknown
      }
      // 兼容模型把 toolCalls 嵌套在字符串字段（如 pendingMessage）里的输出形态
      if (!parsed.reply && !parsed.toolCalls && parsed.pendingMessage) {
        const nested = typeof parsed.pendingMessage === 'string' ? parseModelOutput(parsed.pendingMessage) : null
        if (nested && (nested.reply || nested.toolCalls)) return nested
      }
      // 空对象/无有效字段（如模型输出 {"todoList":{...}} 包裹失误）：回退纯文本发言，
      // 杜绝"静默结束"——至少把内容作为回复说出，循环不无疾而终
      if (!parsed.reply && !parsed.toolCalls) return { reply: trimmed }
      return parsed
    } catch {
      // fallthrough：尝试旧逻辑
    }
  }
  // 截断检测：文本明显是工具调用 JSON（含 "toolCalls" 键）但无法解析出完整对象
  // （maxTokens 截断/未闭合）→ 返回 truncated 标记，绝不当作发言发布（防脏数据进公共上下文）
  if (looksLikeTruncatedToolJson(trimmed)) {
    return { truncated: true }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
        reply?: string
        toolCalls?: Array<{ name: string; args: unknown }>
        pendingMessage?: unknown
      }
      // 兼容嵌套 pendingMessage
      if (!parsed.reply && !parsed.toolCalls && parsed.pendingMessage) {
        const nested = typeof parsed.pendingMessage === 'string' ? parseModelOutput(parsed.pendingMessage) : null
        if (nested && (nested.reply || nested.toolCalls)) return nested
      }
      if (!parsed.reply && !parsed.toolCalls) return { reply: trimmed }
      return parsed
    } catch {
      // fallthrough：视为纯文本
    }
  }
  if (looksLikeTruncatedToolJson(trimmed)) {
    return { truncated: true }
  }
  return { reply: trimmed }
}

/**
 * 疑似截断的工具调用 JSON 检测：
 * 以 toolCalls 开头/包含 toolCalls 键、无法完整解析、且结尾明显未闭合（不完整 JSON 形态）。
 * 误判容忍：宁可标记 truncated（反馈模型分块），也不要把半截 JSON 当发言发布。
 */
function looksLikeTruncatedToolJson(text: string): boolean {
  if (!/["']toolCalls["']/.test(text)) return false
  const trimmed = text.trim()
  // 完整 JSON 解析失败 + 结构像是对象（以 { 开头 或 大量 { } 混杂）
  if (!trimmed.startsWith('{') && !trimmed.includes('{')) return false
  let open = 0
  let close = 0
  for (const ch of trimmed) {
    if (ch === '{') open++
    else if (ch === '}') close++
  }
  // 未闭合（{ 多于 }）或 即便数量相等也无法解析 → 视为截断
  const balanced = open === close && open > 0
  if (balanced) {
    // 数量平衡但整体解析失败：取 {..} 段再试一次
    const s = trimmed.indexOf('{')
    const e = trimmed.lastIndexOf('}')
    if (s >= 0 && e > s) {
      try {
        JSON.parse(trimmed.slice(s, e + 1))
        return false // 能解析 → 不是截断
      } catch {
        return true
      }
    }
    return true
  }
  return open > close
}

/** 从文本中提取第一个完整 JSON 对象（平衡括号；跳过字符串字面量中的括号） */
export function extractFirstJsonObject(text: string): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 从工具 JSON Schema 提取参数摘要（dsh 契约面：键名 + 必填 + 枚举，供模型精确调用） */
export function schemaParamsSummary(schema: Record<string, unknown>): string {
  const properties = schema.properties as Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }> | undefined
  if (!properties) return ''
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const parts = Object.entries(properties).map(([key, spec]) => {
    let type: string
    if (spec?.enum) {
      type = `enum[${spec.enum.join('|')}]`
    } else if (spec?.type === 'array') {
      type = `array<${spec.items?.type ?? 'any'}>`
    } else {
      type = spec?.type ?? 'any'
    }
    return `${key}${required.has(key) ? '（必填）' : ''}:${type}`
  })
  return parts.join('，')
}

/** 按序比较两数组（undefined/null 视为空） */
function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? []
  const bb = b ?? []
  return aa.length === bb.length && aa.every((v, i) => v === bb[i])
}

/** 展平错误链为结构化数组（最内层 → 外层；未知错误归 UNKNOWN） */
export function errorChain(error: unknown): Array<{ message: string; code?: string }> {
  const out: Array<{ message: string; code?: string }> = []
  let current: unknown = error
  let guard = 0
  while (current !== undefined && current !== null && guard < 10) {
    if (current instanceof Error) {
      const code = (current as Error & { code?: string }).code
      out.push({ message: current.message, code: code ?? 'ERROR' })
      current = current.cause
    } else {
      out.push({ message: String(current), code: 'UNKNOWN' })
      break
    }
    guard++
  }
  return out.length > 0 ? out : [{ message: String(error), code: 'UNKNOWN' }]
}

/** 默认群组协作协议段（原体规格 §6 冻结注入） */
export const DEFAULT_PROTOCOL_TEXT = [
  '【角色意识】考虑你的角色、你适合完成的工作部分、是否需要别的智能体协助；涉及协助时明确：你产出什么、预留什么接口、别人需要完成什么。',
  '【唤醒纪律】唤醒他人必须附带任务说明（要对方做什么）；被唤醒后按任务说明工作；允许 @all。',
  '【发言纪律】思考与过程保持私密（不写入公共发言）；落盘即共享（群组空间文件可被其他成员 read）；发言要简洁、有信息量。',
  '【完成报告】工作完成后在群组发言报告完成；任务完成后调用【记忆】工具智能体总结本次工作（call-tool-agent invoke 记忆，输入 target=自己、material=本次工作要点、source=任务名）。',
  '【回合纪律】一个任务可能需要多轮工具调用：只要任务尚未完成，就必须继续输出 toolCalls，不要提前输出 reply。只有确认任务已全部完成（或遇到无法解决的阻塞）时才输出 reply 作最终汇报。收到工具错误时先修复重试（如换用正确的命令/重新读取文件/调整参数），不要因一次失败就放弃。',
  '【分块写入】单次工具调用输出有大小限额：写大文件时不要一次性 write 全部内容（会超限截断），应先用 create/write 写入骨架，再用 str_replace/insert 分多次追加，每次内容精简。',
  '【提问纪律】需要用户输入时 mention user（用户未直接参与时通常不建议）或 mention butler（由管家转述给用户）。',
  '【失败纪律】任务失败需找原因；多次重试仍无解则通知用户（可管家转发）。',
  '【忙碌纪律】工作中被再次唤醒会排队，完成当前工作后再处理。',
].join('\n')
