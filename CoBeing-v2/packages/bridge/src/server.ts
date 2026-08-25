/**
 * 内核桥协议：JSON-RPC 2.0 over stdio（transport 无关）
 *
 * - BridgeServer 只依赖 BridgeTransport（收行/发行），不关心底层是 stdio、pty 或内存数组。
 * - 请求 `{ jsonrpc:'2.0', id, method, params? }` → 响应 { jsonrpc, id, result } 或 { jsonrpc, id, error }。
 * - 通知（无 id）不响应。
 * - 错误码：-32700 解析失败；-32601 方法不存在；-32602 参数错误；-32000 业务错误。
 */

import type { Kernel } from '@cobeing/core'

export interface BridgeTransport {
  send(line: string): void
  /** 订阅一行输入，返回取消订阅函数 */
  onLine(cb: (line: string) => void): () => void
}

/** 业务错误（kernel 方法 throw 的 Error）统一映射为 -32000 */
const ERR_PARSE = -32700
const ERR_METHOD = -32601
const ERR_PARAMS = -32602
const ERR_BUSINESS = -32000

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
}

interface JsonRpcError {
  code: number
  message: string
}

/** 投影中一条公共消息的桥序列化视图 */
export interface BridgePublicMessage {
  seq: number
  actor: string
  content: string
  mention?: string[]
  task?: string
  /** 事件时间戳（客户端时间分隔/时间显示用） */
  ts: number
}

/** 投影序列化后的纯数据视图（不含 methods） */
export interface BridgeProjection {
  publicMessages: BridgePublicMessage[]
  compactions: { start: number; end: number; summary: string; scope: 'public' | 'private' }[]
  /** 主窗口上下文占用（估算 token / 归档阈值；thresholdTokens=0 表示自动压缩禁用） */
  context?: { estimatedTokens: number; thresholdTokens: number }
}

/** createGroup 成功返回的群组摘要 */
export interface BridgeGroupInfo {
  name: string
  label: string[]
  space: string
  status: string
}

export class BridgeServer {
  private unsub: (() => void) | undefined
  private stopped = false
  private started = false

  constructor(
    private kernel: Kernel,
    private transport: BridgeTransport,
  ) {}

  /** 可选的 stop 完成回调（CLI 据此在 stop 方法后退出进程） */
  private onStop?: () => void

  /** 注册 stop 完成回调（stop 方法执行完成时触发一次） */
  setOnStop(cb: (() => void) | undefined): void {
    this.onStop = cb
  }

  /** CLI 侧已直接调用 kernel.start()；标记 started，避免后续 start RPC 重复启动 */
  noteKernelStarted(): void {
    this.started = true
  }

  /** 订阅 onLine 开始处理。幂等：重复调用仅保留一个订阅。 */
  start(): void {
    if (this.stopped) throw new Error('BridgeServer already stopped')
    if (this.unsub) return
    this.unsub = this.transport.onLine((line) => this.handleLine(line))
  }

  /** 取消订阅，不再处理任何输入 */
  stop(): void {
    this.unsub?.()
    this.unsub = undefined
    this.stopped = true
  }

  private handleLine(line: string): void {
    // 解析失败：响应 -32700（id 无法得知，置 null）
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      this.send({ id: null, error: { code: ERR_PARSE, message: 'parse error' } })
      return
    }
    if (typeof request.method !== 'string' || request.method.length === 0) {
      this.send({ id: request.id ?? null, error: { code: ERR_PARSE, message: 'missing method' } })
      return
    }
    const isNotification = request.id === undefined
    void this.dispatch(request.method, request.params, request.id, isNotification)
  }

  private send(response: { id: number | string | null; result?: unknown; error?: JsonRpcError }): void {
    this.transport.send(JSON.stringify({ jsonrpc: '2.0', ...response }))
  }

  private async dispatch(
    method: string,
    params: unknown,
    id: number | string | undefined,
    isNotification: boolean,
  ): Promise<void> {
    // 注：route() 会同步校验参数（可抛 ParamsError）；整体包进 try，统一映射错误码
    try {
      const handler = this.route(method, params)
      if (!handler) {
        if (!isNotification) {
          this.send({ id: id ?? null, error: { code: ERR_METHOD, message: `method not found: ${method}` } })
        }
        return
      }
      if (isNotification) {
        // 通知仍执行副作用，但不回响应；失败静默
        await handler(params)
        return
      }
      const result = await handler(params)
      this.send({ id: id!, result: result === undefined ? null : result })
      // stop 完成回调（CLI 据此退出进程）必须在响应发送之后触发
      if (method === 'stop') this.onStop?.()
    } catch (error) {
      if (isNotification) return
      // 参数校验错误 → -32602；其余（含 kernel throw）→ -32000
      const code = error instanceof ParamsError ? ERR_PARAMS : ERR_BUSINESS
      const message = error instanceof Error ? error.message : String(error)
      this.send({ id: id ?? null, error: { code, message } })
    }
  }

  /** 方法路由：返回处理函数；未知方法返回 undefined（→ -32601） */
  private route(method: string, params: unknown): ((p: unknown) => Promise<unknown> | unknown) | undefined {
    switch (method) {
      case 'ping':
        return () => ({ pong: true, ts: Date.now() })
      case 'start':
        return async () => {
          if (!this.started) {
            this.started = true
            await this.kernel.start()
          }
          return null
        }
      case 'stop':
        return async () => {
          await this.kernel.stop()
          this.stop()
          return null
        }
      case 'mainWindowSpeak': {
        this.require(object(params) && str(params, 'content'), 'content is required')
        const o = params as { content: string; group?: string; mention?: string[]; task?: string }
        return () =>
          this.kernel.mainWindowSpeak(o.content, {
            group: o.group,
            mention: o.mention,
            task: o.task,
          })
      }
      case 'butlerProjection':
        return () => this.serializeProjection(this.kernel.butlerProjection(), this.kernel.butlerContextInfo())
      case 'butler/newConversation':
        return () => this.kernel.newButlerConversation()
      case 'butler/listConversations':
        return () => this.kernel.listButlerConversations()
      case 'butler/conversationProjection': {
        this.require(object(params) && str(params, 'id'), 'id is required')
        const id = (params as { id: string }).id
        return async () =>
          this.serializeProjection(
            await this.kernel.butlerConversationProjection(id),
            id === 'current' ? this.kernel.butlerContextInfo() : undefined,
          )
      }
      case 'groupProjection': {
        this.require(object(params) && str(params, 'group'), 'group is required')
        const group = (params as { group: string }).group
        return () => {
          const runtime = this.kernel.getGroup(group)
          if (!runtime) throw new Error(`group not found: ${group}`)
          return this.serializeProjection(runtime.projection())
        }
      }
      case 'group/status': {
        this.require(object(params) && str(params, 'group'), 'group is required')
        const group = (params as { group: string }).group
        return () => this.kernel.groupStatus(group)
      }
      case 'speakToGroup':
      case 'speakAs': {
        this.require(
          object(params) && str(params, 'group') && str(params, 'actor') && str(params, 'content'),
          'group, actor, content are required',
        )
        const o = params as { group: string; actor: string; content: string; mention?: string[]; task?: string }
        return () => this.kernel.speakToGroup(o.group, o.actor, o.content, o.mention, o.task)
      }
      case 'createGroup': {
        this.require(object(params) && str(params, 'name') && Array.isArray(params.label), 'name and label are required')
        const o = params as {
          name: string
          label: string[]
          spaceMode?: 'default' | 'custom' | 'unrestricted'
          space?: string
        }
        return async (): Promise<BridgeGroupInfo> => {
          const runtime = await this.kernel.createGroup(o.name, o.label, {
            spaceMode: o.spaceMode,
            space: o.space,
          })
          const meta = runtime.meta
          return { name: meta.name, label: meta.label, space: meta.space, status: meta.status }
        }
      }
      case 'archiveGroup': {
        this.require(object(params) && str(params, 'name'), 'name is required')
        return () => this.kernel.archiveGroup((params as { name: string }).name)
      }
      case 'listGroups':
        return () => this.kernel.listGroups()
      case 'listArchivedGroups': {
        this.require(nil(params) || object(params), 'invalid params')
        const o = params as { since?: number; until?: number; keyword?: string } | undefined
        return () => this.kernel.listArchivedGroups(o)
      }
      case 'listReuseSuggestions':
        return () => this.kernel.listReuseSuggestions()
      case 'dismissReuseSuggestion': {
        this.require(object(params) && str(params, 'id'), 'id is required')
        return () => this.kernel.dismissReuseSuggestion((params as { id: string }).id)
      }
      case 'requestCreateAgent': {
        this.require(object(params) && object(params.def), 'def is required')
        return () => this.kernel.requestCreateAgent((params as { def: Parameters<Kernel['requestCreateAgent']>[0] }).def)
      }
      case 'listPendingApprovals':
        return () => this.kernel.listPendingApprovals()
      case 'confirmAgent': {
        this.require(object(params) && str(params, 'name'), 'name is required')
        return () => this.kernel.confirmAgent((params as { name: string }).name)
      }
      case 'destroyAgent': {
        this.require(object(params) && str(params, 'name'), 'name is required')
        return () => this.kernel.destroyAgent((params as { name: string }).name)
      }
      case 'listAgents':
        return () => this.kernel.registry.listAgents()
      case 'experience/info': {
        this.require(object(params) && str(params, 'agent'), 'agent is required')
        const agent = (params as { agent: string }).agent
        return () => this.kernel.experienceInfo(agent)
      }
      case 'experience/entries': {
        this.require(object(params) && str(params, 'agent'), 'agent is required')
        const o = params as { agent: string; limit?: number }
        return () => this.kernel.experienceEntries(o.agent, o.limit ?? 20)
      }
      case 'experience/search': {
        this.require(object(params) && str(params, 'agent'), 'agent is required')
        const o = params as { agent: string; keyword: string; limit?: number }
        return () => this.kernel.experienceSearch(o.agent, o.keyword ?? '', o.limit ?? 20)
      }
      // ---------- 远程控制（方案 v1：手机端/远程控制面；同 stdio 可见，鉴权在 WS 层） ----------
      case 'remote/info':
        return () => this.kernel.remoteControl.info()
      case 'remote/panels':
        return () => this.kernel.remoteControl.listPanels()
      case 'remote/invoke': {
        this.require(
          object(params) && str(params, 'panel') && str(params, 'action'),
          'panel and action are required',
        )
        const o = params as { panel: string; action: string; params?: unknown }
        return () => this.kernel.remoteControl.invoke(o.panel, o.action, o.params)
      }
      case 'remote/screenshot':
        return () => this.kernel.remoteControl.screenshot()
      case 'remote/clipboard': {
        this.require(object(params) && str(params, 'op'), 'op is required')
        const o = params as { op: 'get' | 'set'; text?: string }
        return () => this.kernel.remoteControl.clipboard(o.op, o.text)
      }
      case 'remote/media': {
        this.require(object(params) && str(params, 'op'), 'op is required')
        return () => this.kernel.remoteControl.media((params as { op: 'volumeUp' | 'volumeDown' | 'mute' | 'playPause' }).op)
      }
      case 'remote/power': {
        this.require(object(params) && str(params, 'op'), 'op is required')
        return () => this.kernel.remoteControl.power((params as { op: 'lock' | 'sleep' }).op)
      }
      case 'remote/roots':
        return () => this.kernel.remoteControl.listRoots()
      case 'remote/listFiles': {
        this.require(object(params) && str(params, 'root') && str(params, 'path'), 'root and path are required')
        const o = params as { root: string; path: string }
        return () => this.kernel.remoteControl.listFiles(o.root, o.path)
      }
      case 'remote/download': {
        this.require(object(params) && str(params, 'root') && str(params, 'path'), 'root and path are required')
        const o = params as { root: string; path: string }
        return () => this.kernel.remoteControl.download(o.root, o.path)
      }
      case 'remote/upload': {
        this.require(
          object(params) && str(params, 'root') && str(params, 'path') && str(params, 'name') && str(params, 'base64'),
          'root, path, name and base64 are required',
        )
        const o = params as { root: string; path: string; name: string; base64: string }
        return () => this.kernel.remoteControl.upload(o.root, o.path, o.name, o.base64)
      }
      default:
        return undefined
    }
  }

  // ---------- 投影序列化（纯数据，不含 methods） ----------

  private require(cond: boolean, message: string): void {
    if (!cond) throw new ParamsError(`invalid params: ${message}`)
  }

  private serializeProjection(
    projection: ReturnType<Kernel['butlerProjection']>,
    context?: { estimatedTokens: number; thresholdTokens: number },
  ): BridgeProjection {
    const publicMessages: BridgePublicMessage[] = projection.publicMessages.map((m) => ({
      seq: m.seq,
      actor: m.actor,
      content: m.content,
      mention: m.mention,
      task: m.task,
      ts: m.ts,
    }))
    const compactions = projection.compactions.map((c) => ({
      start: c.start,
      end: c.end,
      summary: c.summary,
      scope: c.scope,
    }))
    return { publicMessages, compactions, context }
  }
}

// ---------- params 校验辅助 ----------

/** 参数校验错误（映射 -32602，与 kernel 业务错误 -32000 区分） */
class ParamsError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(params: Record<string, unknown>, key: string): boolean {
  return typeof params[key] === 'string'
}

function nil(value: unknown): boolean {
  return value === undefined || value === null
}
