import type { WsMessage } from "@/lib/types";

type MsgHandler = (msg: WsMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handler: MsgHandler;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;

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
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }
}
