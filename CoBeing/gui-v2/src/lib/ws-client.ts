import type { WsMessage } from "@/lib/types";

type MsgHandler = (msg: WsMessage) => void;

/** 离线状态展示前的宽限期（ms）— 在此期间重连成功则不展示离线 */
const OFFLINE_GRACE_MS = 5000;
const INITIAL_RECONNECT_MS = 500;
const MAX_BACKOFF_MS = 10000;

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handler: MsgHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** 离线宽限计时器 — 超时后才广播 _disconnected */
  private offlineGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已向 UI 报告离线（防止重复广播） */
  // offlineReported removed — feature was never wired up
  /** 离线消息队列（不含心跳 ping，最多 100 条防内存泄漏） */
  private pendingQueue: WsMessage[] = [];
  private readonly MAX_PENDING = 100;
  /** 应用层心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 客户端 pong 超时检测 — 发 ping 后 5s 无 pong 则强制重连 */
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  /** 可见性变化解绑函数 */
  private visibilityUnbind: (() => void) | null = null;

  constructor(url: string, handler: MsgHandler) {
    this.url = url;
    this.handler = handler;
  }

  connect() {
    this.disconnect();
    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.clearOfflineGrace();
      // 首次连接（非重连）也需要通知 UI 加载状态
      this.handler({ type: "_connected" });
      this.reconnectAttempts = 0;
      this.flushPending();
      this.startHeartbeat();
      this.bindVisibility();
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.startOfflineGrace();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (ev) => {
      try {
        const msg: WsMessage = JSON.parse(ev.data);
        if (msg.type === "_pong") {
          if (this.pongTimeoutTimer) {
            clearTimeout(this.pongTimeoutTimer);
            this.pongTimeoutTimer = null;
          }
          return;
        }
        this.handler(msg);
      } catch {
        // ignore non-JSON
      }
    };

    this.ws = ws;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearOfflineGrace();
    this.stopHeartbeat();
    this.unbindVisibility();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (msg.type !== "_ping") {
      // 心跳 ping 不排队 — 离线时发送无意义且浪费重连后的速率预算
      if (this.pendingQueue.length < this.MAX_PENDING) {
        this.pendingQueue.push(msg);
      }
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  checkAndReconnect(): void {
    if (!this.connected) {
      this.reconnectAttempts = 0;
      this.connect();
    }
  }

  // ── private ──

  private flushPending() {
    if (this.pendingQueue.length === 0) return;
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];
    for (const msg of queue) {
      this.send(msg);
    }
  }

  private scheduleReconnect() {
    // 指数退避: 500ms → 1s → 2s → 4s → 8s → 10s (cap)
    const delay = Math.min(INITIAL_RECONNECT_MS * Math.pow(2, this.reconnectAttempts), MAX_BACKOFF_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /** 宽限期：连接断开后等待 OFFLINE_GRACE_MS 再通知 UI，期间若重连成功则取消 */
  private startOfflineGrace() {
    if (this.offlineGraceTimer) return; // 已经在宽限中
    this.offlineGraceTimer = setTimeout(() => {
      this.offlineGraceTimer = null;
      this.handler({ type: "_disconnected" });
    }, OFFLINE_GRACE_MS);
  }

  private clearOfflineGrace() {
    if (this.offlineGraceTimer) {
      clearTimeout(this.offlineGraceTimer);
      this.offlineGraceTimer = null;
    }
  }

  // ── heartbeat ──

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "_ping" }));
        // 客户端 pong 超时：15 秒内无 _pong 响应则视为断连
        // （后端工具执行可能阻塞事件循环，5s 太激进）
        if (this.pongTimeoutTimer) clearTimeout(this.pongTimeoutTimer);
        this.pongTimeoutTimer = setTimeout(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 15000);
      }
    }, 10000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
  }

  // ── visibility / focus ──

  private bindVisibility() {
    this.unbindVisibility();
    const handler = () => {
      if (!document.hidden && !this.connected) {
        this.checkAndReconnect();
      }
    };
    document.addEventListener("visibilitychange", handler);
    const tauriRef: { unbind: (() => void) | null } = { unbind: null };
    try {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused && !this.connected) {
            this.checkAndReconnect();
          }
        }).then((fn) => { tauriRef.unbind = fn; });
      }).catch(() => { /* 非 Tauri 环境 */ });
    } catch { /* 非 Tauri 环境 */ }
    this.visibilityUnbind = () => {
      document.removeEventListener("visibilitychange", handler);
      if (tauriRef.unbind) tauriRef.unbind();
    };
  }

  private unbindVisibility() {
    if (this.visibilityUnbind) {
      this.visibilityUnbind();
      this.visibilityUnbind = null;
    }
  }
}
