/**
 * 自动配对客户端（方案 v2：局域网发现 → 手机确认 → 密钥交换）
 *
 * - 手机确认后对发现到的电脑 WS 连接发 `pair/request {deviceId, deviceName}`（未鉴权阶段允许），
 *   电脑返回 token + 服务器信息（LAN 地址）；此后手机用 token 走标准 auth 连接。
 * - deviceId 持久化（同一手机重配/重连保持稳定身份）；deviceName 取自系统型号。
 * - 可注入 WebSocket 实现（测试）。
 */

export interface PairServerInfo {
  name: string
  version: string
  dataRoot: string
  lanUrl: string
  protocol: 'cobeing-ws/1'
}

export interface PairResult {
  token: string
  server: PairServerInfo
}

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
export function setPairWsImplForTest(impl: WsConstructor): void {
  WSImpl = impl
}

const PAIR_TIMEOUT_MS = 30_000

/** 向指定电脑发起配对（手机确认后调用；返回 token 与连接信息） */
export function pairRequest(url: string, params: { deviceId: string; deviceName: string }): Promise<PairResult> {
  return new Promise((resolve, reject) => {
    let ws: WebSocketLike | undefined
    const timer = setTimeout(() => {
      reject(new Error('配对超时（30s）'))
      try {
        ws?.close()
      } catch {
        // 已关闭
      }
    }, PAIR_TIMEOUT_MS)
    try {
      ws = new WSImpl(url)
    } catch (error) {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    ws.onopen = () => {
      ws?.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pair/request', params }))
    }
    ws.onmessage = (e) => {
      let msg: { id?: number; result?: PairResult; error?: { code: number; message: string } }
      try {
        msg = JSON.parse(String(e.data)) as typeof msg
      } catch {
        return
      }
      if (msg.id !== 1) return
      clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        // 已关闭
      }
      if (msg.error) {
        reject(new Error(`[${msg.error.code}] ${msg.error.message}`))
      } else if (msg.result && msg.result.token) {
        resolve(msg.result)
      } else {
        reject(new Error('配对响应格式错误'))
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error('连接电脑失败（请确认在同一 WiFi）'))
      try {
        ws?.close()
      } catch {
        // 已关闭
      }
    }
  })
}

const DEVICE_ID_KEY = 'cobeing.device.id'

/** 本机设备 id（持久化；首次生成） */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = `dev-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/** 本机设备名（系统型号；无则「我的手机」） */
export function getDeviceName(): string {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const match = ua.match(/\(([^)]+)\)/)
    const parts = (match ? match[1] : '').split(';').map((s) => s.trim())
    const model = parts.filter((s) => s && !/android|linux|wv|mobile safari|like mac/i.test(s)).pop()
    if (model && model.length > 0 && model.length <= 64) return model
  } catch {
    // 环境异常 → 默认名
  }
  return '我的手机'
}
