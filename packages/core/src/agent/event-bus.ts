/**
 * AgentEventBus — 智能体自发通信的事件总线
 *
 * 支持:
 * - group-message: 群组 @mention 消息路由到目标 Agent
 * - agent-direct: Agent 间直接通信
 * - task-complete: 任务完成通知（触发反思）
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("event-bus");

export interface BusMessage {
  groupId?: string;
  fromAgentId: string;
  content: string;
  mentionTarget?: string;
  targetAgentId?: string;
}

export interface TaskCompleteMessage {
  agentId: string;
  task: string;
  response: string;
}

type MessageHandler = (msg: BusMessage) => void;
type ReflectionHandler = (agentId: string, task: string) => void;

export class AgentEventBus {
  private subscribers = new Map<string, Set<MessageHandler>>();
  private reflectionHandlers: ReflectionHandler[] = [];
  private eventHistory = new Map<string, unknown[]>();

  /** Agent 订阅消息（监听发给自己或 @all 的消息） */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(handler);

    return () => {
      const set = this.subscribers.get(agentId);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.subscribers.delete(agentId);
      }
    };
  }

  /** 发射事件，路由到目标 Agent */
  emit(event: "group-message" | "agent-direct" | "task-complete", msg: BusMessage | TaskCompleteMessage): void {
    // 记录事件历史
    if (!this.eventHistory.has(event)) this.eventHistory.set(event, []);
    this.eventHistory.get(event)!.push(msg);

    if (event === "task-complete") {
      const tc = msg as TaskCompleteMessage;
      for (const handler of this.reflectionHandlers) {
        handler(tc.agentId, tc.task);
      }
      return;
    }

    const busMsg = msg as BusMessage;

    if (event === "group-message") {
      const target = busMsg.mentionTarget;
      if (target === "all") {
        for (const [agentId, handlers] of this.subscribers) {
          if (agentId !== busMsg.fromAgentId) {
            for (const handler of handlers) handler(busMsg);
          }
        }
      } else if (target) {
        const handlers = this.subscribers.get(target);
        if (handlers) {
          for (const handler of handlers) handler(busMsg);
        }
      }
    }

    if (event === "agent-direct") {
      const target = busMsg.targetAgentId;
      if (target) {
        const handlers = this.subscribers.get(target);
        if (handlers) {
          for (const handler of handlers) handler(busMsg);
        }
      }
    }

    log.info("Event [%s] → %s", event, busMsg.mentionTarget ?? busMsg.targetAgentId ?? "none");
  }

  /** 注册反思处理器 */
  onReflection(handler: ReflectionHandler): void {
    this.reflectionHandlers.push(handler);
  }

  /** 获取事件历史 */
  getHistory(event: string): unknown[] {
    return this.eventHistory.get(event) ?? [];
  }

  /** 清理所有订阅 */
  clear(): void {
    this.subscribers.clear();
    this.reflectionHandlers = [];
    this.eventHistory.clear();
  }
}
