/**
 * 内核装配（架构 §1 分层：宿主面组合）
 *
 * - ensureDirs → 名录/记忆/日志 → LLM 网关 → 默认工具注册 → 管家主窗口 → 群组工厂
 * - 智能体创造需用户批准（规格 §3）：pendingApprovals 队列（GUI 确认后 confirmAgent）
 * - 工具智能体【记忆】【压缩】半硬编码注册（LLM 环节经网关）；【记忆】= 信息提取统一入口
 * - 主窗口管家：但丁 AgentInstance（人格 + 主窗口协议 + 只读 guard），mainWindowSpeak 路由
 * - 群组：label ≥ 3；归档死亡 + 复用建议；同名重建时旧日志归档隔离
 */

import { mkdirSync, existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentDef, GroupMeta, NotifyPayload, SessionEvent, ToolRunContext, UpdateScope } from '@cobeing/types'
import { WindowLog } from './event-log/window-log.js'
import { project, renderPublic, renderToolResults } from './event-log/projection.js'
import { DefaultToolRegistry } from './tools/registry.js'
import { ToolScheduler } from './scheduler/scheduler.js'
import { LLMGateway, MockProvider, type LLMProvider, type ChatRequest } from './llm/gateway.js'
import { ExperienceStore } from './memory/store.js'
import { RegistryStore } from './registry/store.js'
import { createEditorTool } from './tools/editor.js'
import { createBashTool, ShellManager } from './tools/bash.js'
import { createGlobTool } from './tools/glob.js'
import { createGrepTool } from './tools/grep.js'
import { createTodoTool, TodoStore } from './tools/todo.js'
import { createGroupSpeakTool } from './tools/group-speak.js'
import { createCallToolAgentTool, ToolAgentRegistry } from './tools/call-tool-agent.js'
import { createButlerRelayTool } from './tools/butler-relay.js'
import { createButlerTools } from './tools/butler-tools.js'
import { registerBuiltinToolAgents } from './tools/builtin-tool-agents.js'
import { AgentInstance, DEFAULT_PROTOCOL_TEXT } from './runtime/agent-loop.js'
import { GroupRuntime } from './runtime/group.js'
import { ButlerRuntime, BUTLER_ARCHIVE_THRESHOLD_TOKENS, estimateTokensFromEvents } from './runtime/butler.js'
import { ExperienceService, memberMaterial } from './runtime/experience.js'
import { BUTLER_PERSONA_PROMPT, BUTLER_MAIN_PROTOCOL_TEXT } from './runtime/butler-persona.js'
import { PathGuard } from './permission/guard.js'
import { RemoteControlService } from './remote-control.js'

export interface KernelOptions {
  providers?: LLMProvider[]
  /** 用户通知回调（GUI 占位：任务栏闪烁 + 一声滴；ask-user 确认请求经此推送结构化 payload） */
  notifyUser?: (payload: NotifyPayload) => void
  /** 但丁默认 provider/model（缺省 mock，DeepSeek 接入后传 deepseek/deepseek-chat） */
  butlerProvider?: string
  butlerModel?: string
  /** MockProvider 响应器（开发/测试；缺省固定回复） */
  mockResponder?: (req: ChatRequest) => string
  /** 主窗口管家归档阈值 token 数（D7：缺省 100_000；0 禁用自动归档） */
  butlerArchiveThresholdTokens?: number
  /** 长活群组轮次经验总结节流（每 N 轮且有活动才总结；0 = 关闭；方案 v0.1 默认 5） */
  experienceTurnEvery?: number
  /** 远程控制允许的额外文件根（默认仅 dataRoot；方案 v1） */
  remoteRoots?: string[]
}

/** 群组复用建议（G：归档时生成，用户点选复用或新建；不自动复用） */
export interface ReuseSuggestion {
  id: string
  fromGroup: string
  taskSummary?: string
  archivedAt: number
  suggestion: string
}

/** 主窗口会话摘要（当前会话 id='current'；历史会话 id='conv-<archivedAt>'） */
export interface ButlerConversationSummary {
  id: string
  createdAt: number
  archivedAt?: number
  messageCount: number
  firstUserMessage?: string
  current?: boolean
}

/** 历史会话完整元数据（落盘 conversations.json；current 动态合成不落盘） */
interface ButlerConversationMeta extends ButlerConversationSummary {
  file: string
}

interface ConversationsFile {
  conversations: ButlerConversationMeta[]
}

export class Kernel {
  readonly registry: RegistryStore
  readonly gateway: LLMGateway
  readonly scheduler: ToolScheduler
  readonly tools: DefaultToolRegistry
  readonly memory: ExperienceStore
  readonly experience: ExperienceService
  readonly toolAgents = new ToolAgentRegistry()
  readonly shells = new ShellManager()
  readonly todos: TodoStore
  /** 远程控制服务（方案 v1：面板 manifest + 截屏/剪贴板/媒体/电源/文件） */
  readonly remoteControl: RemoteControlService
  butlerLog: WindowLog
  butler: ButlerRuntime

  private groups = new Map<string, GroupRuntime>()
  private pendingApprovals: AgentDef[] = []
  private disposers: Array<() => void> = []
  private notifyUserCb?: (payload: NotifyPayload) => void
  private butlerGuard: PathGuard
  private butlerInstance!: AgentInstance
  private reuseSuggestions: ReuseSuggestion[] = []
  private butlerProvider: string
  private butlerModel: string
  private butlerArchiveThresholdTokens: number
  private butlerConversations: ButlerConversationMeta[] = []
  private conversationsFile: string
  /** 长活群组轮次总结节流（每 N 轮且有活动才总结；0 = 关闭） */
  private experienceTurnEvery: number
  /** 轮次总结水位（group:agent → 上次总结时的最后 seq） */
  private turnWatermarks = new Map<string, number>()
  /** 轮次总结计数器（group:agent → 已轮数） */
  private turnCounters = new Map<string, number>()

  constructor(readonly dataRoot: string, opts: KernelOptions = {}) {
    ensureDirs(dataRoot)
    this.notifyUserCb = opts.notifyUser
    this.registry = new RegistryStore(join(dataRoot, 'registry.json'))
    this.gateway = new LLMGateway()
    this.memory = new ExperienceStore(join(dataRoot, 'memory'))
    // 自适经验总结服务（方案 v0.1：范围 = 自身定义 + 既有画像）
    this.experience = new ExperienceService({
      memory: this.memory,
      llm: (text, instruction) => this.llmSummarize(text, instruction),
      defOf: (name) => this.registry.getAgent(name),
      butlerPersona: BUTLER_PERSONA_PROMPT,
    })
    this.tools = new DefaultToolRegistry()
    this.scheduler = new ToolScheduler(this.tools, 10)
    this.butlerLog = new WindowLog(join(dataRoot, 'butler', 'log.jsonl'))
    // todo 持久化：整表写入所属窗口日志（dsh todo/write 对齐；group=main → 主窗口日志）
    this.todos = new TodoStore(async (group, agent, todos) => {
      const log = group === 'main' ? this.butlerLog : this.groups.get(group)?.log
      if (!log) return
      await log.append({ type: 'todo/write', actor: agent, todos })
    })
    // 远程控制服务（文件根默认 dataRoot；--remote-root 可追加）
    this.remoteControl = new RemoteControlService({ dataRoot, roots: opts.remoteRoots })
    this.butlerProvider = opts.butlerProvider ?? 'mock'
    this.butlerModel = opts.butlerModel ?? 'mock-model'
    this.butlerArchiveThresholdTokens = opts.butlerArchiveThresholdTokens ?? BUTLER_ARCHIVE_THRESHOLD_TOKENS
    this.experienceTurnEvery = opts.experienceTurnEvery ?? 5
    this.conversationsFile = join(dataRoot, 'butler', 'conversations.json')

    // LLM 网关：默认 mock（可编程响应器供测试）；真实 provider（DeepSeek）由配置接入
    this.disposers.push(this.gateway.registerProvider(new MockProvider(opts.mockResponder)))
    for (const provider of opts.providers ?? []) {
      this.disposers.push(this.gateway.registerProvider(provider))
    }

    // 默认工具（原体规格 §3：4 个）
    this.disposers.push(
      this.tools.register(createEditorTool()),
      this.tools.register(createBashTool(this.shells)),
      this.tools.register(createGlobTool()),
      this.tools.register(createGrepTool()),
      this.tools.register(createTodoTool(this.todos)),
      this.tools.register(createGroupSpeakTool((group) => this.groupSpeakDeps(group))),
      this.tools.register(createCallToolAgentTool({
        registry: this.toolAgents,
        recall: async (agentName, keyword, limit) => {
          const entries = await this.memory.search(agentName, keyword ?? '', limit ?? 20)
          return entries.map((e) => `[${new Date(e.ts).toISOString()} ${e.source}] ${e.content}`).join('\n')
        },
        save: async (agentName, source, material) => {
          // 信息提取统一经工具智能体【记忆】（总结 + 写档案一体）
          await this.runMemoryAgent(agentName, material, source)
        },
      })),
      this.tools.register(createButlerRelayTool(this.butlerLog, (content) => this.notifyUserCb?.({ type: 'text', content }))),
    )

    // 管家主窗口专属工具（list-groups / create-group / ask-user；工具内校验仅主窗口但丁可调）
    for (const tool of createButlerTools({
      listGroups: () =>
        [...this.groups.values()].map((g) => ({
          name: g.meta.name,
          label: g.meta.label,
          status: g.meta.status,
          taskSummary: g.meta.taskSummary,
        })),
      createGroup: (name, label) => this.createGroup(name, label).then((g) => ({ name: g.meta.name, status: g.meta.status })),
      notifyUser: (payload) => this.notifyUserCb?.(payload),
    })) {
      this.disposers.push(this.tools.register(tool))
    }

    // 内置工具智能体（半硬编码）：【记忆】= 唯一信息提取入口（上下文 = 完整方法论 + 自适 scope）；【压缩】分段摘要
    this.disposers.push(registerBuiltinToolAgents(this.toolAgents, {
      memory: this.memory,
      llmSummarize: (text, instruction) => this.llmSummarize(text, instruction),
      // 【记忆】上下文：优化内容全量注入（自适 scope + 提炼要点 + 条目格式；思考2.0 #24）
      memoryInstruction: (name) => this.experience.memoryAgentInstruction(name),
      // 写档案后画像合并检查（超阈值合并为长期画像）
      maybeConsolidate: (name) => this.experience.maybeConsolidate(name),
    }))

    // 管家主窗口（但丁）：对所有文件只读（unrestricted 读 + readonly 写拒绝）
    this.butlerGuard = new PathGuard(dataRoot, true, 'readonly')
    this.butler = this.createButlerRuntime(this.butlerLog)
  }

  /** 主窗口管家运行时（log 绑定；新对话换日志时重建） */
  private createButlerRuntime(log: WindowLog): ButlerRuntime {
    return new ButlerRuntime({
      log,
      estimateTokens: () => estimateTokensFromEvents(log.readCached()),
      thresholdTokens: this.butlerArchiveThresholdTokens,
      summarize: (text, instruction) => this.llmSummarize(text, instruction),
      // 归档记忆总结：经工具智能体【记忆】执行（总结 + 写档案一体，自适 scope 在【记忆】上下文）
      summarizeArchive: (text) => this.runMemoryAgent('butler', text, 'main-window-archive'),
      notifyUser: this.notifyUserCb,
    })
  }

  private groupSpeakDeps(group: string): { members: () => string[]; log: WindowLog; honesty?: (agent: string, claim: string, evidence: string) => Promise<{ pass: boolean; reason: string }>; evidenceOf?: (agent: string) => string } | undefined {
    const runtime = this.groups.get(group)
    if (!runtime) return undefined
    return {
      members: () => runtime.meta.label,
      log: runtime.log,
      // 【诚实】审查接线：工作智能体经 group-speak 向群组发言前验证（butler 在工具内跳过）
      honesty: (agent, claim, evidence) => this.runHonestyAgent(agent, claim, evidence),
      evidenceOf: (agent) => renderToolResults(runtime.projection().toolsOf(agent), 20).join('\n'),
    }
  }

  /** 半硬编码中唯一 LLM 环节（mock/真实 provider 由网关路由） */
  private async llmSummarize(text: string, instruction: string): Promise<string> {
    const response = await this.gateway.chat({
      provider: this.butlerProvider,
      model: this.butlerModel,
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: text.slice(0, 120_000) },
      ],
      maxTokens: 1024,
    })
    return response.content.trim() || '（无总结内容）'
  }

  /**
   * 信息提取统一入口：经工具智能体【记忆】总结并写档案（方案 v0.1.1）。
   * 所有自动总结路径（轮次/成员/归档/会话归档/save）都走这里，优化内容只存在于【记忆】上下文。
   * 未注册/失败静默（调用方已容错）。
   */
  private async runMemoryAgent(target: string, material: string, source: string): Promise<void> {
    const spec = this.toolAgents.get('记忆')
    if (!spec) return
    const ctx: ToolRunContext = {
      agent: target,
      group: 'kernel',
      cwd: this.dataRoot,
      guard: this.butlerGuard,
      signal: new AbortController().signal,
      speak: async () => {},
      writePrivate: async () => {},
    }
    await spec.invoke({ target, material, source }, ctx)
  }

  /**
   * 发言真实性审查统一入口：经工具智能体【诚实】（无长期上下文，每次独立审查）。
   * 判断发言声称完成的工作是否真实（是否真的调用工具生成产物），不评价效果。
   * 返回 kind（completion/process/other）供 agent-loop 区分"完成汇报"与"过程性汇报"
   * （修复 5 goal 化：过程性发言发布进展后继续回合）。
   * 审查失败（LLM 异常/未注册）→ 放行（不阻塞正常交流）。
   */
  private async runHonestyAgent(agent: string, claim: string, evidence: string): Promise<{ pass: boolean; reason: string; kind?: 'completion' | 'process' | 'other' }> {
    const spec = this.toolAgents.get('诚实')
    if (!spec) return { pass: true, reason: '【诚实】未注册，放行' }
    try {
      const ctx: ToolRunContext = {
        agent,
        group: 'kernel',
        cwd: this.dataRoot,
        guard: this.butlerGuard,
        signal: new AbortController().signal,
        speak: async () => {},
        writePrivate: async () => {},
      }
      const result = await spec.invoke({ target: agent, claim, evidence }, ctx)
      if (!result.ok) return { pass: true, reason: result.content }
      // 新格式：pass=true kind=process：reason；旧格式（无 kind）兼容回退 other
      const m = result.content.match(/pass=(true|false)(?: kind=(\w+))?[：:]\s*(.*)/)
      if (!m) return { pass: true, reason: result.content.slice(0, 200) }
      const kind = (m[2] === 'process' || m[2] === 'other' ? m[2] : 'completion') as 'completion' | 'process' | 'other'
      return { pass: m[1] === 'true', kind, reason: m[3] ?? '' }
    } catch {
      return { pass: true, reason: '审查调用异常，放行' }
    }
  }

  // ---------- 启动 ----------

  async start(): Promise<void> {
    await this.registry.load()
    await this.loadButlerConversations()
    const butlerEvents = await this.butlerLog.load()
    // 从主窗口日志重建 todo（last-write-wins；模型可见 ⟺ 已记录）
    this.todos.replay('main', this.butlerLog.readCached())
    // 主窗口但丁实例（组装同工作智能体；无 bash/group-speak；只读；轮后自动压缩检查）
    this.butlerInstance = this.createButlerInstance(this.butlerLog)
    await this.butlerLog.append({ type: 'group/lifecycle', phase: 'created', detail: 'butler main window' })
    // 恢复 working 群组（重启后群组继续显示/工作；归档群组不恢复）
    await this.restoreWorkingGroups()
    void butlerEvents
  }

  /** 重启恢复：从名录重建所有 working 群组运行时（日志加载 + 成员实例 + todo replay） */
  private async restoreWorkingGroups(): Promise<void> {
    const working = this.registry.listGroups().filter((g) => g.status === 'working')
    for (const meta of working) {
      try {
        const logFile = join(meta.space, 'log.jsonl')
        if (!existsSync(logFile)) continue // 空间缺失：跳过（数据已清理）
        const log = new WindowLog(logFile) // 日志加载由 runtime.start() 完成（load 幂等只允许一次）
        const runtime = this.buildGroupRuntime(meta, log)
        this.groups.set(meta.name, runtime)
        await runtime.start()
        this.todos.replay(meta.name, runtime.log.readCached())
      } catch (error) {
        // 单群组恢复失败不阻塞内核启动；日志中可见
        this.notifyUserCb?.({ type: 'text', content: `[内核] 群组 ${meta.name} 恢复失败：${error instanceof Error ? error.message : String(error)}` })
      }
    }
  }

  /** 群组运行时构建（createGroup 与重启恢复共用；makeAgent 闭包引用 runtime 延迟赋值） */
  private buildGroupRuntime(meta: GroupMeta, log: WindowLog): GroupRuntime {
    let runtime: GroupRuntime
    runtime = new GroupRuntime({
      meta,
      log,
      makeAgent: (def: { name: string; role: string; basePrompt?: string }): AgentInstance | null =>
        this.makeAgentFor(meta, log, runtime, def),
      notifyUser: (group, content, task) => {
        this.notifyUserCb?.({ type: 'text', content: `[${group} mention user] ${task ? `${task}：` : ''}${content}` })
      },
    })
    return runtime
  }

  /** 主窗口但丁实例（log 绑定；新对话换日志时重建） */
  private createButlerInstance(log: WindowLog): AgentInstance {
    return new AgentInstance({
      def: {
        name: 'butler',
        role: '主窗口管家',
        provider: this.butlerProvider,
        model: this.butlerModel,
        maxTokens: 2048,
        createdAt: Date.now(),
      },
      group: 'main',
      cwd: join(this.dataRoot, 'butler'),
      log,
      projection: () => project(log.readCached()),
      gateway: this.gateway,
      scheduler: this.scheduler,
      registry: this.tools,
      memory: this.memory,
      guard: this.butlerGuard,
      protocolText: BUTLER_MAIN_PROTOCOL_TEXT,
      basePrompt: BUTLER_PERSONA_PROMPT,
      denyTools: ['persistent-bash', 'group-speak'],
      maxToolRounds: 6,
      // 经验档案自动注入（画像 + 最近条目；宿主面文件失败降级为空）
      experience: () => this.experience.contextBlock('butler').catch(() => ''),
      // 轮次完成后立即检查压缩阈值：长轮（多工具调用）结束后下一轮组装前保持干净
      onTurnComplete: async () => {
        await this.butler.maybeArchive()
        this.emitUpdate('butler', undefined, 'reply')
      },
    })
  }

  /** 主窗口发言入口（D11 路由）：显式指定群 → 转发；否则主窗口但丁处理 */
  async mainWindowSpeak(
    content: string,
    opts: { group?: string; mention?: string[]; task?: string } = {},
  ): Promise<void> {
    if (opts.group) {
      return this.speakToGroup(opts.group, 'user', content, opts.mention, opts.task)
    }
    await this.butlerLog.append({
      type: 'speak',
      actor: 'user',
      content,
      mention: opts.mention,
      task: opts.task,
    })
    await this.butler.maybeArchive()
    this.butlerInstance.wake({
      content,
      task: opts.task,
      // 系统状态注记（不进公共日志，仅组装注入）：让管家始终感知当前群组（思考2.0 #9/#31）
      systemNote: this.groupStateNote(),
    })
    this.emitUpdate('butler', undefined, 'speak')
  }

  /** 当前群组状态摘要（供主窗口管家组装注入） */
  private groupStateNote(): string {
    const groups = [...this.groups.values()]
    if (groups.length === 0) return '当前没有正在工作的群组；如用户提出新任务，可建议新建群组（create-group）。'
    const lines = groups.map((g) => {
      const members = g.meta.label.join('/')
      const task = g.meta.taskSummary ? `；任务：${g.meta.taskSummary}` : ''
      return `- ${g.meta.name}（${g.meta.status}，成员 ${members}${task}）`
    })
    return `当前存在的群组：\n${lines.join('\n')}`
  }

  /**
   * 数据变更广播（实时同步协议）：客户端（GUI/手机端）收到后立即刷新对应数据，
   * 不依赖轮询延迟。scope=变更域；group=群组名（scope='group' 时）。
   */
  private emitUpdate(scope: UpdateScope, group?: string, kind?: string): void {
    this.notifyUserCb?.({ type: 'update', scope, group, kind })
  }

  /** 主窗口投影（桥协议读主窗口消息用） */
  butlerProjection() {
    return project(this.butlerLog.readCached())
  }

  /** 主窗口上下文占用（GUI 进度显示：估算 token / 归档阈值；threshold 0 = 自动压缩禁用） */
  butlerContextInfo(): { estimatedTokens: number; thresholdTokens: number } {
    return {
      estimatedTokens: estimateTokensFromEvents(this.butlerLog.readCached()),
      thresholdTokens: this.butlerArchiveThresholdTokens,
    }
  }

  /** 但丁是否正在工作（新对话需等收敛） */
  isButlerBusy(): boolean {
    return this.butlerInstance?.status === 'busy'
  }

  // ---------- 主窗口会话（新对话窗口：当前日志归档 + 空会话重建） ----------

  /**
   * 开启新对话：当前主窗口日志完整归档为历史会话（可回看），重建空会话。
   * - 归档前尝试记忆总结写经验档案（失败不阻塞）
   * - 主窗口 todo 清空（落空表到新日志）
   * - 但丁实例/归档运行时随新日志重建（组装上下文归零）
   */
  async newButlerConversation(): Promise<{ id: string; archived?: ButlerConversationSummary }> {
    if (this.butlerInstance?.status === 'busy') {
      throw new Error('但丁正在工作中，请等待当前工作完成后再开启新对话')
    }
    const events = this.butlerLog.readCached()
    if (events.length === 0) return { id: 'current' } // 空会话：幂等

    const archivedAt = Date.now()
    const id = `conv-${archivedAt}`
    const convDir = join(this.dataRoot, 'butler', 'conversations')
    mkdirSync(convDir, { recursive: true })
    const file = join(convDir, `${id}.jsonl`)

    // 0) 记忆归档总结（纯HI：归档记忆；容错，失败不阻塞新对话）
    await this.archiveConversationMemory(events)

    // 1) 当前日志 → 历史文件（完整事件保留：历史可回看，非压缩遮蔽）
    await rename(join(this.dataRoot, 'butler', 'log.jsonl'), file)

    // 2) 会话元数据落盘
    const meta: ButlerConversationMeta = {
      id,
      file,
      createdAt: events[0]!.ts,
      archivedAt,
      messageCount: events.length,
      firstUserMessage: firstUserSpeak(events),
    }
    this.butlerConversations.push(meta)
    await this.persistButlerConversations()

    // 3) 重建空会话（日志 + 归档运行时 + 但丁实例）
    this.butlerLog = new WindowLog(join(this.dataRoot, 'butler', 'log.jsonl'))
    this.butler = this.createButlerRuntime(this.butlerLog)
    this.butlerInstance.dispose()
    this.butlerInstance = this.createButlerInstance(this.butlerLog)
    await this.butlerLog.append({ type: 'group/lifecycle', phase: 'created', detail: 'butler main window (new conversation)' })

    // 4) 主窗口 todo 清空（空表落新日志；重启 replay 干净）
    await this.todos.reset('main', 'butler')

    this.notifyUserCb?.({ type: 'text', content: `[管家] 已开启新对话：上一会话 ${id} 已归档（${meta.messageCount} 条事件，可回看）` })
    this.emitUpdate('butler', undefined, 'new-conversation')
    return { id, archived: meta }
  }

  /** 会话列表：当前会话（id='current'，动态合成）+ 历史会话（最新在前） */
  listButlerConversations(): ButlerConversationSummary[] {
    const events = this.butlerLog.readCached()
    const current: ButlerConversationSummary = {
      id: 'current',
      createdAt: events[0]?.ts ?? Date.now(),
      messageCount: events.length,
      firstUserMessage: firstUserSpeak(events),
      current: true,
    }
    const history = this.butlerConversations
      .slice()
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      .map((c) => ({ id: c.id, createdAt: c.createdAt, archivedAt: c.archivedAt, messageCount: c.messageCount, firstUserMessage: c.firstUserMessage }))
    return [current, ...history]
  }

  /** 历史会话只读投影（'current' → 当前会话投影；历史按 id 加载归档日志） */
  async butlerConversationProjection(id: string) {
    if (id === 'current') return this.butlerProjection()
    const meta = this.butlerConversations.find((c) => c.id === id)
    if (!meta) throw new Error(`conversation not found: ${id}`)
    const log = new WindowLog(meta.file)
    const events = await log.load()
    return project(events)
  }

  /** 会话归档前的记忆总结（经工具智能体【记忆】写管家经验档案；失败静默——归档不依赖 LLM） */
  private async archiveConversationMemory(events: SessionEvent[]): Promise<void> {
    try {
      const text = renderPublic(project(events).publicMessages, 200).join('\n').trim()
      if (!text) return
      await this.runMemoryAgent('butler', text.slice(0, 100_000), 'main-window-conversation')
    } catch {
      // 归档总结失败不阻塞新对话
    }
  }

  private async loadButlerConversations(): Promise<void> {
    try {
      const text = await readFile(this.conversationsFile, 'utf8')
      const parsed = JSON.parse(text) as Partial<ConversationsFile>
      this.butlerConversations = parsed.conversations ?? []
    } catch {
      this.butlerConversations = []
    }
  }

  private async persistButlerConversations(): Promise<void> {
    mkdirSync(dirname(this.conversationsFile), { recursive: true })
    const tmp = `${this.conversationsFile}.tmp`
    await writeFile(tmp, JSON.stringify({ conversations: this.butlerConversations }, null, 2), 'utf8')
    await rename(tmp, this.conversationsFile)
  }

  /** 主窗口收到 relay 后调用（更新估算 + 归档检查） */
  async notifyButlerRelay(): Promise<void> {
    await this.butler.maybeArchive()
  }

  // ---------- 智能体名录（创造需用户批准） ----------

  /** 请求创造（进入待批准队列，GUI 确认后调用 confirmAgent） */
  async requestCreateAgent(def: AgentDef): Promise<void> {
    if (this.pendingApprovals.some((a) => a.name === def.name)) {
      throw new Error(`pending approval already exists: ${def.name}`)
    }
    this.pendingApprovals.push(def)
    this.emitUpdate('agents', undefined, 'pending')
  }

  listPendingApprovals(): AgentDef[] {
    return [...this.pendingApprovals]
  }

  /** 用户批准后登记 */
  async confirmAgent(name: string): Promise<void> {
    const index = this.pendingApprovals.findIndex((a) => a.name === name)
    if (index === -1) throw new Error(`no pending approval: ${name}`)
    const [def] = this.pendingApprovals.splice(index, 1)
    await this.registry.createAgent(def!)
    this.emitUpdate('agents', undefined, 'confirm')
  }

  /** 销毁（规格 §3：清人格经验 + 注销名录 + 保留历史记录） */
  async destroyAgent(name: string): Promise<void> {
    await this.memory.clear(name)
    await this.registry.destroyAgent(name)
    this.emitUpdate('agents', undefined, 'destroy')
  }

  // ---------- 群组 ----------

  /** 创建群组（label ≥ 3；成员必须已在名录中——规格：智能体是组织形式；同名重建时旧日志归档隔离） */
  async createGroup(
    name: string,
    label: string[],
    opts: { spaceMode?: GroupMeta['spaceMode']; space?: string } = {},
  ): Promise<GroupRuntime> {
    if (this.groups.has(name)) throw new Error(`group already exists: ${name}`)
    const uniqueLabel = [...new Set(label)]
    if (uniqueLabel.length < 3) throw new Error(`group label must be >= 3: ${uniqueLabel.join(',')}`)
    if (!uniqueLabel.includes('user') || !uniqueLabel.includes('butler')) {
      throw new Error(`group label must include user and butler`)
    }
    // 名录校验：label 中的工作智能体必须已在名录（未注册成员 → 群组无法工作，明确报错）
    const missing = uniqueLabel.filter((m) => m !== 'user' && m !== 'butler' && !this.registry.getAgent(m))
    if (missing.length > 0) {
      throw new Error(`group members not in registry: ${missing.join(',')}（请先在智能体页创建并批准）`)
    }
    const space = opts.space ?? RegistryStore.groupSpaceOf(this.dataRoot, name)
    const logFile = join(space, 'log.jsonl')
    if (existsSync(logFile)) {
      // 同名重建（上一代已归档）：旧日志归档隔离，保留历史记录
      await rename(logFile, join(space, `log.archived-${Date.now()}.jsonl`))
    }
    const meta: GroupMeta = {
      name,
      label: uniqueLabel,
      space,
      spaceMode: opts.spaceMode ?? 'default',
      status: 'working',
      createdAt: Date.now(),
    }
    await this.registry.upsertGroup(meta)
    mkdirSync(space, { recursive: true })
    const log = new WindowLog(logFile)
    const runtime = this.buildGroupRuntime(meta, log)
    this.groups.set(name, runtime)
    await runtime.start()
    // 从群组日志重建 todo（last-write-wins；同名重建时旧代日志已归档隔离）
    this.todos.replay(name, runtime.log.readCached())
    this.emitUpdate('groups', undefined, 'create')
    return runtime
  }

  /** 归档群组（用户验收成功 → 归档死亡）+ 生成复用建议（G：不自动复用）+ 成员经验总结 */
  async archiveGroup(name: string): Promise<void> {
    const runtime = this.groups.get(name)
    if (!runtime) throw new Error(`group not found: ${name}`)
    // 成员经验总结（任务边界，方案 v0.1）：容错，失败不阻塞归档
    await this.summarizeGroupMembers(name, runtime)
    await runtime.archive()
    const meta = { ...runtime.meta, status: 'archived' as const, archivedAt: Date.now() }
    await this.registry.upsertGroup(meta)
    this.groups.delete(name)
    // 复用建议：给用户选择（新建 or 复用历史经验）；有历史归档时提示相似任务
    const archived = this.registry.listArchivedGroups()
    const similar = archived.filter((g) => g.name !== name).length
    this.reuseSuggestions.push({
      id: `${name}-${Date.now()}`,
      fromGroup: name,
      taskSummary: meta.taskSummary,
      archivedAt: meta.archivedAt!,
      suggestion: similar > 0
        ? `群组 ${name} 已归档。历史还有 ${similar} 个已归档群组；新任务默认新建群组，如需复用历史经验可让管家总结。`
        : `群组 ${name} 已归档。新任务默认新建群组；需要时可由管家总结旧群经验。`,
    })
    if (this.reuseSuggestions.length > 20) this.reuseSuggestions.splice(0, this.reuseSuggestions.length - 20)
    this.emitUpdate('groups', undefined, 'archive')
  }

  getGroup(name: string): GroupRuntime | undefined {
    return this.groups.get(name)
  }

  /** 当前工作群组列表（桥协议/GUI/测试查询面） */
  listGroups(): GroupMeta[] {
    return [...this.groups.values()].map((g) => g.meta)
  }

  /** 群组工作状态（GUI/手机端展示：成员忙碌标记 + 任务摘要 + 最近活动） */
  groupStatus(name: string): {
    name: string
    label: string[]
    status: string
    taskSummary?: string
    members: Array<{ name: string; busy: boolean }>
    lastActivity?: number
  } {
    const runtime = this.groups.get(name)
    if (!runtime) throw new Error(`group not found: ${name}`)
    const members = runtime.meta.label.map((m) => {
      const instance = runtime.instance(m)
      return { name: m, busy: instance?.status === 'busy' }
    })
    const events = runtime.projection().events
    return {
      name: runtime.meta.name,
      label: runtime.meta.label,
      status: runtime.meta.status,
      taskSummary: runtime.meta.taskSummary,
      members,
      lastActivity: events.at(-1)?.ts,
    }
  }

  /** 用户/内核向群组发言入口 */
  async speakToGroup(group: string, actor: string, content: string, mention?: string[], task?: string): Promise<void> {
    const runtime = this.groups.get(group)
    if (!runtime) throw new Error(`group not found: ${group}`)
    // 任务摘要自动更新（群列表可见当前任务；持久化随 registry）
    if (task) {
      runtime.meta.taskSummary = task
      await this.registry.upsertGroup(runtime.meta)
      this.emitUpdate('groups', undefined, 'task')
    }
    await runtime.speak(actor, content, mention, task)
    this.emitUpdate('group', group, 'speak')
  }

  // ---------- 归档索引 / 复用建议（桥协议查询面） ----------

  listArchivedGroups(filter?: { since?: number; until?: number; keyword?: string }) {
    return this.registry.listArchivedGroups(filter)
  }

  listReuseSuggestions(): ReuseSuggestion[] {
    return [...this.reuseSuggestions]
  }

  dismissReuseSuggestion(id: string): void {
    this.reuseSuggestions = this.reuseSuggestions.filter((s) => s.id !== id)
  }

  // ---------- 实例工厂 ----------

  private makeAgentFor(
    meta: GroupMeta,
    log: WindowLog,
    group: GroupRuntime,
    def: { name: string; role: string; basePrompt?: string },
  ): AgentInstance | null {
    const full = this.registry.getAgent(def.name)
    // 名录校验兜底（创建时已校验；恢复旧群组时成员可能已销毁/从未注册）：
    // 非 butler 成员不在名录 → 跳过实例（mention 会给出 [mention 失败] 反馈），避免 mock 空转
    if (def.name !== 'butler' && !full) return null
    const agentDef: AgentDef = {
      name: def.name,
      role: def.role,
      basePrompt: full?.basePrompt ?? def.basePrompt,
      tools: full?.tools,
      provider: full?.provider,
      model: full?.model,
      maxTokens: full?.maxTokens,
      createdAt: full?.createdAt ?? Date.now(),
    }
    // 管家只读（规格 §3：对所有文件只读）；工作智能体默认可写
    const guard = new PathGuard(meta.space, meta.spaceMode === 'unrestricted', def.name === 'butler' ? 'readonly' : 'readwrite')
    return new AgentInstance({
      def: agentDef,
      group: meta.name,
      cwd: meta.space,
      log,
      projection: () => group.projection(),
      gateway: this.gateway,
      scheduler: this.scheduler,
      registry: this.tools,
      memory: this.memory,
      guard,
      protocolText: DEFAULT_PROTOCOL_TEXT,
      basePrompt: def.name === 'butler'
        ? 'You are the butler instance inside a group. Your job: analyze and relay via butler-relay tool to the main window butler. Do not do concrete work.'
        : undefined,
      // 修复 4：工作智能体工具面收敛——管家协调/元工具（butler-relay/list-groups/create-group/ask-user）
      // 的 guard 仅主窗口但丁可调，对 worker 调用必失败；与其作为"必失败诱饵"留在工具面
      // 诱惑模型空转，不如直接从 worker 可见工具清单移除（不给偷懒盖章的机会）
      denyTools: def.name === 'butler'
        ? undefined
        : ['butler-relay', 'list-groups', 'create-group', 'ask-user'],
      // 经验档案自动注入（画像 + 最近条目；宿主面文件失败降级为空）
      experience: () => this.experience.contextBlock(agentDef.name).catch(() => ''),
      // 发言真实性审查（【诚实】）：工作智能体 reply 发言前验证（butler 不审查——管家不做具体工作）
      honesty: def.name === 'butler'
        ? undefined
        : (claim, evidence) => this.runHonestyAgent(agentDef.name, claim, evidence),
      // 长活群组轮次总结（复用不归档的群组也能沉淀；管家实例跳过；fire-and-forget 不阻塞排队唤醒）
      onTurnComplete: async () => {
        await this.maybeSummarizeTurn(meta, agentDef.name)
        // 群组投影变化 → 实时同步（手机端/电脑端群组页即时刷新）
        this.emitUpdate('group', meta.name, 'reply')
      },
    })
  }

  /** 群组归档时成员经验总结（任务边界）：只总结工作智能体（排除 user/butler），经【记忆】工具智能体，失败静默 */
  private async summarizeGroupMembers(name: string, runtime: GroupRuntime): Promise<void> {
    const projection = runtime.projection()
    const members = runtime.meta.label.filter((m) => m !== 'user' && m !== 'butler')
    for (const member of members) {
      try {
        const material = memberMaterial(member, projection, 0)
        if (material) await this.runMemoryAgent(member, material, `group:${name}`)
      } catch {
        // 成员总结失败不阻塞归档
      }
    }
  }

  /** 长活群组轮次总结（节流 + 有活动才总结 + fire-and-forget；经【记忆】工具智能体） */
  private async maybeSummarizeTurn(meta: GroupMeta, name: string): Promise<void> {
    if (name === 'butler' || this.experienceTurnEvery <= 0) return
    const runtime = this.groups.get(meta.name)
    if (!runtime) return
    const key = `${meta.name}:${name}`
    const count = (this.turnCounters.get(key) ?? 0) + 1
    this.turnCounters.set(key, count)
    if (count % this.experienceTurnEvery !== 0) return
    const sinceSeq = this.turnWatermarks.get(key) ?? 0
    const projection = runtime.projection()
    const lastSeq = projection.events.at(-1)?.seq ?? 0
    this.turnWatermarks.set(key, lastSeq)
    // fire-and-forget：不阻塞排队唤醒；失败静默
    const material = memberMaterial(name, projection, sinceSeq)
    if (!material) return
    this.runMemoryAgent(name, material, `turn:${meta.name}`).catch(() => undefined)
  }

  /** 经验档案信息（桥协议查询面：count / lastUpdated） */
  async experienceInfo(agent: string): Promise<{ agent: string; count: number; lastUpdated?: number }> {
    const info = await this.experience.info(agent)
    return { agent, ...info }
  }

  /** 经验条目（桥协议查询面：最新在前，limit 条；GUI/手机端记忆面板） */
  async experienceEntries(agent: string, limit = 20): Promise<Array<{ ts: number; source: string; content: string; tags?: string[] }>> {
    const entries = await this.memory.search(agent, '', limit)
    return entries.map((e) => ({ ts: e.ts, source: e.source, content: e.content, tags: e.tags }))
  }

  /** 经验关键词检索（桥协议查询面；content/source/tags 子串匹配，最新在前） */
  async experienceSearch(agent: string, keyword: string, limit = 20): Promise<Array<{ ts: number; source: string; content: string; tags?: string[] }>> {
    const entries = await this.memory.search(agent, keyword, limit)
    return entries.map((e) => ({ ts: e.ts, source: e.source, content: e.content, tags: e.tags }))
  }

  // ---------- 停止 ----------

  async stop(): Promise<void> {
    this.butlerInstance?.dispose()
    for (const group of this.groups.values()) await group.archive()
    this.groups.clear()
    this.shells.disposeAll()
    this.todos.disposeAll()
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
  }
}

function ensureDirs(dataRoot: string): void {
  mkdirSync(join(dataRoot, 'memory'), { recursive: true })
  mkdirSync(join(dataRoot, 'group'), { recursive: true })
  mkdirSync(join(dataRoot, 'butler'), { recursive: true })
}

/** 会话首条用户消息（会话摘要用；截断 80 字符） */
function firstUserSpeak(events: SessionEvent[]): string | undefined {
  const msg = events.find((e) => e.type === 'speak' && e.actor === 'user')
  if (!msg || msg.type !== 'speak') return undefined
  return msg.content.slice(0, 80)
}

export type { SessionEvent }
