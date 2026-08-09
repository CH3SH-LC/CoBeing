// packages/core/src/todo/scanner.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger, hasDeleteMarker } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { TodoStore } from "./store.js";
import { SCAN_INTERVAL_MS, OVERDUE_THRESHOLD_MS } from "./types.js";
import type { AgentRegistry } from "../agent/registry.js";

const log = createLogger("todo-scanner");

export interface ScannerCallbacks {
  onTrigger: (agentId: string, todo: TodoItem, message: string) => Promise<void>;
}

export class AgentTodoScanner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private dataRoot: string,
    private registry: AgentRegistry,
    private callbacks: ScannerCallbacks,
  ) {}

  /** 启动定期扫描 */
  start(intervalMs = SCAN_INTERVAL_MS): void {
    if (this.timer) return;
    // 启动时先扫一次（处理重启后逾期的）
    this.scanOnce().catch(err => log.error("Initial scan error: %s", err));
    this.timer = setInterval(() => {
      this.scanOnce().catch(err => log.error("Scan error: %s", err));
    }, intervalMs);
    log.info("AgentTodoScanner started (interval=%dms)", intervalMs);
  }

  /** 停止扫描 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("AgentTodoScanner stopped");
  }

  /** 单次扫描 — 每个 agent 的 TODO 依次触发，不同 agent 之间并行 */
  async scanOnce(): Promise<void> {
    // 扫描 agents/ 和 coreagents/ 两个目录
    const scanDirs = [path.join(this.dataRoot, "agents"), path.join(this.dataRoot, "coreagents")];
    const agentLocations = new Map<string, string>(); // agentId → agentDir
    for (const scanDir of scanDirs) {
      if (!fs.existsSync(scanDir)) continue;
      for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const agentDir = path.join(scanDir, entry.name);
          if (!hasDeleteMarker(agentDir)) agentLocations.set(entry.name, agentDir);
        }
      }
    }
    if (agentLocations.size === 0) return;

    // 收集每个 agent 的到期 TODO（四类：time due / repeat due / 0time 未触发 / 已触发待完成 stale）
    const agentDueMap = new Map<string, { store: TodoStore; todos: TodoItem[]; stale: TodoItem[] }>();

    for (const [agentId, agentDir] of agentLocations) {
      try {
        const store = new TodoStore(agentDir);
        const dueTodos = store.getDueTodos();
        const repeatTodos = store.getRepeatDueTodos();
        const zeroTimeTodos = store.getZeroTimeTodos().filter(t => !t.triggeredAt); // 未触发的 0time
        const stale = store.getStalePendingTodos(); // 已触发待完成超冷却 → 低频重唤醒（goal 机制）
        const fresh = [...dueTodos, ...repeatTodos, ...zeroTimeTodos];
        if (fresh.length > 0 || stale.length > 0) {
          fresh.sort((a, b) => dueAt(a) - dueAt(b)); // 逾期的排前面，优先触发
          agentDueMap.set(agentId, { store, todos: fresh, stale });
        }
      } catch (err: any) {
        log.error("Error scanning agent %s: %s", agentId, err.message);
      }
    }

    if (agentDueMap.size === 0) return;

    // 不同 agent 并行，同一 agent 内依次触发
    const agentPromises = Array.from(agentDueMap.entries()).map(([agentId, { store, todos, stale }]) =>
      this.triggerAgentTodos(agentId, store, todos, stale),
    );

    await Promise.allSettled(agentPromises);
  }

  /** 单个 agent 的 TODO 依次触发：先首次触发（fresh），再低频重唤醒（stale） */
  private async triggerAgentTodos(agentId: string, store: TodoStore, todos: TodoItem[], stale: TodoItem[]): Promise<void> {
    for (const todo of todos) {
      try {
        const agent = this.registry.get(todo.agentId || agentId);
        if (!agent) {
          log.warn("Agent %s not found, skipping TODO %s", todo.agentId || agentId, todo.id);
          store.markTriggered(todo.id);
          if (todo.repeat && todo.nextTriggerAt) store.advanceRepeat(todo.id);
          continue;
        }

        const message = this.formatTriggerMessage(todo);
        log.info("Triggering TODO %s for agent %s: %s", todo.id, agentId, todo.title);

        await this.callbacks.onTrigger(agentId, todo, message);
        store.markTriggered(todo.id);
        // repeat 周期推进（保持 pending，仅推进 nextTriggerAt）
        if (todo.repeat && todo.nextTriggerAt) store.advanceRepeat(todo.id);
      } catch (err: any) {
        log.error("Failed to trigger TODO %s: %s", todo.id, err.message);
      }
    }

    // stale 重唤醒：只重触发提醒、不推进 repeat 周期、不重建条目
    for (const todo of stale) {
      try {
        const targetId = todo.overduePolicy?.action === "escalate-to-host" ? "host" : (todo.agentId || agentId);
        const agent = this.registry.get(targetId);
        if (!agent) {
          log.warn("Agent %s not found, skipping stale TODO %s", targetId, todo.id);
          store.markReTriggered(todo.id);
          continue;
        }
        const message = this.formatTriggerMessage(todo);
        log.info("Re-triggering stale TODO %s for agent %s (attempt %d)", todo.id, targetId, (todo.reTriggerCount ?? 0) + 1);
        await this.callbacks.onTrigger(targetId, todo, message);
        store.markReTriggered(todo.id);
      } catch (err: any) {
        log.error("Failed to re-trigger stale TODO %s: %s", todo.id, err.message);
      }
    }
  }

  /** 当 Agent 完成一次任务/发言时调用 — 检查 Agent 级 condition TODO（决策 #3 / spec #2） */
  async notifyAgentSpoke(speakerAgentId: string): Promise<void> {
    const scanDirs = [path.join(this.dataRoot, "agents"), path.join(this.dataRoot, "coreagents")];
    for (const scanDir of scanDirs) {
      if (!fs.existsSync(scanDir)) continue;
      for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const agentDir = path.join(scanDir, entry.name);
        if (hasDeleteMarker(agentDir)) continue;
        const store = new TodoStore(agentDir);
        const conditionTodos = store.getConditionTodos()
          .filter(t => t.condition?.targetAgents?.includes(speakerAgentId));
        for (const todo of conditionTodos) {
          try {
            const message = this.formatConditionTriggerMessage(todo, speakerAgentId);
            log.info("Condition trigger for TODO %s (agent %s spoke)", todo.id, speakerAgentId);
            await this.callbacks.onTrigger(entry.name, todo, message);
            store.markTriggered(todo.id);
          } catch (err: any) {
            log.error("Failed to trigger condition TODO %s: %s", todo.id, err.message);
          }
        }
      }
    }
  }

  private formatConditionTriggerMessage(todo: TodoItem, speakerId: string): string {
    return `【系统通知 — 条件触发】
标题: ${todo.title}
触发原因: ${speakerId} 完成了任务/发言
条件描述: ${todo.condition?.check || "检查接口是否就位"}
指派给: ${todo.agentId || "未指定"}
条件不满足时的行为: ${todo.condition?.onFail || "remind"}

请检查以上条件是否满足：
- 满足 → 调用 todo-complete 完成此 TODO
- 不满足 → ${todo.condition?.onFail === "recreate" ? "此 TODO 将被重建" : "请 @mention 对方提醒补充"}
如需续期，先调用 todo-add 创建新 TODO，再调用 todo-complete。
`;
  }

  private formatTriggerMessage(todo: TodoItem): string {
    const now = Date.now();
    const triggerTime = new Date(todo.triggerAt).getTime();
    const overdueMs = now - triggerTime;
    const isOverdue = overdueMs > OVERDUE_THRESHOLD_MS;
    const overdueHours = Math.floor(overdueMs / OVERDUE_THRESHOLD_MS);

    return `【系统通知 — TODO 触发】
标题: ${todo.title}
内容: ${todo.description}
触发时间: ${todo.triggerAt}
逾期: ${isOverdue ? `是，已逾期 ${overdueHours} 小时` : "否"}
续期提示: ${todo.recurrenceHint}

请根据上述内容执行相应操作。
如需续期：
  1. 先调用 todo-add 创建新 TODO
  2. 再调用 todo-complete 完成当前 TODO
一次性任务直接调用 todo-complete 即可。`;
  }
}

/** 触发排序基准：repeat 用 nextTriggerAt，其余用 triggerAt */
function dueAt(todo: TodoItem): number {
  return new Date(todo.nextTriggerAt || todo.triggerAt || 0).getTime();
}
