/**
 * WS JSON-RPC 客户端（cobeing-ws/1 协议，方案 v1）
 *
 * - 连接 → 首帧 auth → 服务端 hello + 响应 → 双向 JSON-RPC（请求/通知对发，不阻塞）
 * - 断线自动重连（指数退避 1s→30s）；鉴权失败不重试（token 错误）
 * - 可注入 WebSocket 实现（测试）；单例导出
 */

import type { NotifyPayload, RemoteHello } from './types'

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface AuthFailPayload {
  reason: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** 可替换的 WebSocket 构造器（测试注入） */
export type WsConstructor = new (url: string) => WebSocketLike

export interface WebSocketLike {
  readyState: number
  onopen: (() => void) | null
  onclose: ((e: { code?: number; reason?: string }) => void) | null
  onerror: (() => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  send(data: string): void
  close(): void
}

let WSImpl: WsConstructor = globalThis.WebSocket as unknown as WsConstructor

/** 测试注入假 WebSocket */
export function setWsImplForTest(impl: WsConstructor): void {
  WSImpl = impl
}

const REQUEST_TIMEOUT_MS = 30_000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

export class WsRpcClient {
  status: ConnStatus = 'idle'
  hello: RemoteHello | null = null

  private ws: WebSocketLike | null = null
  private url = ''
  private token = ''
  /** 候补地址（方案 v2：局域网 + 公网隧道交替尝试；重连时轮转） */
  private urls: string[] = []
  private urlIndex = 0
  private seq = 0
  private pending = new Map<number, PendingRequest>()
  private notifyCbs = new Set<(n: NotifyPayload) => void>()
  private helloCbs = new Set<(h: RemoteHello) => void>()
  private statusCbs = new Set<(s: ConnStatus, hello: RemoteHello | null) => void>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = RECONNECT_BASE_MS
  private closedByUser = true

  // ---------- 订阅 ----------

  onStatus(cb: (s: ConnStatus, hello: RemoteHello | null) => void): () => void {
    this.statusCbs.add(cb)
    cb(this.status, this.hello)
    return () => this.statusCbs.delete(cb)
  }

  onNotify(cb: (n: NotifyPayload) => void): () => void {
    this.notifyCbs.add(cb)
    return () => this.notifyCbs.delete(cb)
  }

  onHello(cb: (h: RemoteHello) => void): () => void {
    this.helloCbs.add(cb)
    return () => this.helloCbs.delete(cb)
  }

  // ---------- 连接 ----------

  /**
   * 连接服务器。
   * @param alts 候补地址（方案 v2：公网隧道地址；断线重连时与主地址交替尝试，
   * 使手机在局域网/公网之间自动切换，无需手动改配置）
   */
  connect(url: string, token: string, alts: string[] = []): void {
    if (this.ws && (this.status === 'connecting' || this.status === 'connected')) {
      this.close()
    }
    this.closedByUser = false
    this.url = url
    this.token = token
    this.urls = [url, ...alts.filter((u) => typeof u === 'string' && u && u !== url)]
    this.urlIndex = 0
    this.retryDelay = RECONNECT_BASE_MS
    this.openSocket()
  }

  close(): void {
    this.closedByUser = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.rejectAll(new Error('connection closed'))
    this.setStatus('idle', null)
  }

  private openSocket(): void {
    this.setStatus(this.retryDelay > RECONNECT_BASE_MS ? 'reconnecting' : 'connecting', this.hello)
    // 候补地址轮转：局域网连不上自动试公网隧道，公网失效回局域网（token 同一把）
    const target = this.urls.length > 0 ? this.urls[this.urlIndex % this.urls.length] : this.url
    let ws: WebSocketLike
    try {
      ws = new WSImpl(target)
    } catch (error) {
      this.scheduleReconnect(`连接失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'auth', params: { token: this.token } }))
    }
    ws.onmessage = (e) => this.handleMessage(e.data)
    ws.onclose = () => {
      if (this.closedByUser) return
      this.ws = null
      this.rejectAll(new Error('connection lost'))
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      // onclose 随后触发；这里只清理
    }
  }

  private scheduleReconnect(reason?: string): void {
    if (this.closedByUser || this.retryTimer) return
    const delay = this.retryDelay
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS)
    // 每次重连尝试下一个地址（LAN ↔ 公网交替）
    if (this.urls.length > 1) this.urlIndex += 1
    this.setStatus('reconnecting', this.hello)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.closedByUser) this.openSocket()
    }, delay)
    void reason
  }

  private handleMessage(data: unknown): void {
    let msg: { id?: number; method?: string; result?: unknown; error?: { code: number; message: string }; params?: unknown }
    try {
      msg = typeof data === 'string' ? (JSON.parse(data) as typeof msg) : (JSON.parse(String(data)) as typeof msg)
    } catch {
      return
    }
    if (msg.method === 'hello') {
      this.hello = msg.params as RemoteHello
      // hello 在鉴权成功后由服务端下发 → 连接就绪
      this.setStatus('connected', this.hello)
      this.helloCbs.forEach((cb) => cb(this.hello!))
      return
    }
    if (msg.method === 'notify') {
      this.notifyCbs.forEach((cb) => cb(msg.params as NotifyPayload))
      return
    }
    if (msg.id !== undefined && msg.id !== null) {
      // 鉴权响应（id:0, result:null）→ 连接就绪（hello 随后到达刷新服务器信息）
      if (msg.id === 0 && msg.error === undefined && this.status !== 'connected') {
        this.setStatus('connected', this.hello)
      }
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) {
        pending.reject(new Error(`[${msg.error.code}] ${msg.error.message}`))
      } else {
        pending.resolve(msg.result)
      }
    }
  }

  // ---------- 请求 ----------

  /** 通用请求；未连接抛错；30s 超时 */
  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.status !== 'connected') {
      return Promise.reject(new Error('未连接服务器'))
    }
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`请求超时：${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      try {
        this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private rejectAll(error: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    this.pending.clear()
  }

  private setStatus(s: ConnStatus, hello: RemoteHello | null): void {
    this.status = s
    this.statusCbs.forEach((cb) => cb(s, hello))
  }

  // ---------- 业务方法封装 ----------

  ping(): Promise<{ pong: boolean }> {
    return this.request('ping')
  }

  mainWindowSpeak(content: string, opts: { group?: string; mention?: string[]; task?: string } = {}): Promise<unknown> {
    return this.request('mainWindowSpeak', { content, ...opts })
  }

  butlerProjection(): Promise<import('./types').ProjectionDto> {
    return this.request('butlerProjection')
  }

  newButlerConversation(): Promise<{ id: string }> {
    return this.request('butler/newConversation')
  }

  /** 恢复历史会话为当前会话（2.0.8：历史可继续对话；当前会话先自动归档） */
  resumeButlerConversation(id: string): Promise<{ id: string }> {
    return this.request('butler/resumeConversation', { id })
  }

  listButlerConversations(): Promise<import('./types').ConversationInfo[]> {
    return this.request('butler/listConversations')
  }

  butlerConversationProjection(id: string): Promise<import('./types').ProjectionDto> {
    return this.request('butler/conversationProjection', { id })
  }

  listGroups(): Promise<import('./types').GroupMeta[]> {
    return this.request('listGroups')
  }

  createGroup(name: string, label: string[]): Promise<{ name: string; status: string }> {
    return this.request('createGroup', { name, label })
  }

  speakToGroup(
    group: string,
    actor: string,
    content: string,
    opts: { mention?: string[]; task?: string } = {},
  ): Promise<unknown> {
    return this.request('speakToGroup', { group, actor, content, ...opts })
  }

  groupProjection(group: string): Promise<import('./types').ProjectionDto> {
    return this.request('groupProjection', { group })
  }

  /** 群组工作状态（成员忙碌标记 + 任务摘要 + 最近活动） */
  groupStatus(group: string): Promise<import('./types').GroupStatus> {
    return this.request('group/status', { group })
  }

  archiveGroup(name: string): Promise<unknown> {
    return this.request('archiveGroup', { name })
  }

  listAgents(): Promise<import('./types').AgentDef[]> {
    return this.request('listAgents')
  }

  requestCreateAgent(def: import('./types').AgentDef): Promise<unknown> {
    return this.request('requestCreateAgent', { def })
  }

  listPendingApprovals(): Promise<import('./types').AgentDef[]> {
    return this.request('listPendingApprovals')
  }

  confirmAgent(name: string): Promise<unknown> {
    return this.request('confirmAgent', { name })
  }

  destroyAgent(name: string): Promise<unknown> {
    return this.request('destroyAgent', { name })
  }

  experienceInfo(agent: string): Promise<{ agent: string; count: number; lastUpdated?: number }> {
    return this.request('experience/info', { agent })
  }

  /** 经验条目（最新在前；记忆面板） */
  experienceEntries(agent: string, limit = 20): Promise<import('./types').ExperienceEntryDto[]> {
    return this.request('experience/entries', { agent, limit })
  }

  /** 经验关键词检索（content/source/tags） */
  experienceSearch(agent: string, keyword: string, limit = 20): Promise<import('./types').ExperienceEntryDto[]> {
    return this.request('experience/search', { agent, keyword, limit })
  }

  // ---------- 远程控制（方案 v1） ----------

  remoteInfo(): Promise<import('./types').RemoteInfo> {
    return this.request('remote/info')
  }

  remotePanels(): Promise<import('./types').PanelManifest[]> {
    return this.request('remote/panels')
  }

  remoteInvoke(panel: string, action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('remote/invoke', { panel, action, params })
  }

  remoteScreenshot(): Promise<import('./types').ScreenshotResult> {
    return this.request('remote/screenshot')
  }

  remoteClipboardGet(): Promise<{ text: string }> {
    return this.request('remote/clipboard', { op: 'get' })
  }

  remoteClipboardSet(text: string): Promise<unknown> {
    return this.request('remote/clipboard', { op: 'set', text })
  }

  remoteRoots(): Promise<string[]> {
    return this.request('remote/roots')
  }

  remoteListFiles(root: string, path: string): Promise<import('./types').ListFilesResult> {
    return this.request('remote/listFiles', { root, path })
  }

  remoteDownload(root: string, path: string): Promise<import('./types').DownloadResult> {
    return this.request('remote/download', { root, path })
  }

  remoteUpload(root: string, path: string, name: string, base64: string): Promise<{ path: string; size: number }> {
    return this.request('remote/upload', { root, path, name, base64 })
  }
}

/** 全局单例 */
export const client = new WsRpcClient()
