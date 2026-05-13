import type { WsMessage } from "@/lib/types";

type MsgHandler = (msg: WsMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handler: MsgHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;
  /** 离线消息队列：连接断开期间暂存，重连后自动 flush（最多 100 条防内存泄漏） */
  private pendingQueue: WsMessage[] = [];
  private readonly MAX_PENDING = 100;

  constructor(url: string, handler: MsgHandler) {
    this.url = url;
    this.handler = handler;
  }

  connect() {
    this.disconnect();
    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.reconnectDelay = 3000;
      this.handler({ type: "_connected" });
      // flush 离线期间积压的消息
      this.flushPending();
    };

    ws.onclose = () => {
      this.handler({ type: "_disconnected" });
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (ev) => {
      try {
        const msg: WsMessage = JSON.parse(ev.data);
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
    if (this.ws) {
      this.ws.onclose = null; // 阻止触发重连
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      // 连接不可用时暂存到队列，重连后自动发送（上限防内存泄漏）
      if (this.pendingQueue.length < this.MAX_PENDING) {
        this.pendingQueue.push(msg);
      }
    }
  }

  /** 获取当前连接状态 */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private flushPending() {
    if (this.pendingQueue.length === 0) return;
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];
    for (const msg of queue) {
      this.send(msg);
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }
}
