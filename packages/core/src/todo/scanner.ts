// packages/core/src/todo/scanner.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
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
    const agentsDir = path.join(this.dataRoot, "agents");
    if (!fs.existsSync(agentsDir)) return;

    const agentDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // 收集每个 agent 的到期 TODO
    const agentDueMap = new Map<string, { store: TodoStore; todos: TodoItem[] }>();

    for (const agentId of agentDirs) {
      try {
        const agentDir = path.join(agentsDir, agentId);
        const store = new TodoStore(agentDir);
        const dueTodos = store.getDueTodos();
        if (dueTodos.length > 0) {
          agentDueMap.set(agentId, { store, todos: dueTodos });
        }
      } catch (err: any) {
        log.error("Error scanning agent %s: %s", agentId, err.message);
      }
    }

    if (agentDueMap.size === 0) return;

    // 不同 agent 并行，同一 agent 内依次触发
    const agentPromises = Array.from(agentDueMap.entries()).map(([agentId, { store, todos }]) =>
      this.triggerAgentTodos(agentId, store, todos),
    );

    await Promise.allSettled(agentPromises);
  }

  /** 单个 agent 的 TODO 依次触发 */
  private async triggerAgentTodos(agentId: string, store: TodoStore, todos: TodoItem[]): Promise<void> {
    for (const todo of todos) {
      try {
        const agent = this.registry.get(todo.agentId || agentId);
        if (!agent) {
          log.warn("Agent %s not found, skipping TODO %s", todo.agentId || agentId, todo.id);
          store.markTriggered(todo.id);
          continue;
        }

        const message = this.formatTriggerMessage(todo);
        store.markTriggered(todo.id);
        log.info("Triggering TODO %s for agent %s: %s", todo.id, agentId, todo.title);

        await this.callbacks.onTrigger(agentId, todo, message);
      } catch (err: any) {
        log.error("Failed to trigger TODO %s: %s", todo.id, err.message);
      }
    }
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
