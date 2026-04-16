/**
 * 类型安全的事件总线
 */
export type EventHandler<T = unknown> = (data: T) => void;

export class EventEmitter {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as EventHandler);

    // 返回取消订阅函数
    return () => {
      set.delete(handler as EventHandler);
      if (set.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  emit<T = unknown>(event: string, data: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch (err) {
        console.error(`Event handler error [${event}]:`, err);
      }
    }
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const unsub = this.on<T>(event, (data) => {
      unsub();
      handler(data);
    });
    return unsub;
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

// 全局事件类型
export interface CoreEvents {
  "agent:started": { agentId: string };
  "agent:stopped": { agentId: string };
  "agent:error": { agentId: string; error: Error };
  "agent:message": { agentId: string; content: string };
  "channel:message": { channelId: string; message: unknown };
  "channel:connected": { channelId: string };
  "channel:disconnected": { channelId: string };
  "group:message": { groupId: string; fromAgentId: string; content: string };
  "tool:executed": { agentId: string; tool: string; result: string };
  "tool:call": { agentId: string; toolName: string; params: unknown };
  "tool:result": { agentId: string; toolName: string; result: string; isError: boolean };
  "tool:denied": { agentId: string; toolName: string; reason: string };
  "system:ready": undefined;
  "system:shutdown": undefined;
}
