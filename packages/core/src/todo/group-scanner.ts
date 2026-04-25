// packages/core/src/todo/group-scanner.ts
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { TodoStore } from "./store.js";

const log = createLogger("group-todo-scanner");

export interface GroupScannerCallbacks {
  onTrigger: (groupId: string, todo: TodoItem, message: string) => Promise<void>;
  onCompleteAction?: (groupId: string, todo: TodoItem) => Promise<void>;
}

export class GroupTodoScanner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: TodoStore;

  constructor(
    private groupId: string,
    groupDir: string,
    private callbacks: GroupScannerCallbacks,
  ) {
    this.store = new TodoStore(groupDir);
  }

  getStore(): TodoStore {
    return this.store;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.scanOnce().catch(err => log.error("Group %s initial scan error: %s", this.groupId, err));
    this.timer = setInterval(() => {
      this.scanOnce().catch(err => log.error("Group %s scan error: %s", this.groupId, err));
    }, intervalMs);
    log.info("GroupTodoScanner started for %s", this.groupId);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info("GroupTodoScanner stopped for %s", this.groupId);
  }

  /** 扫描并触发到期 TODO — 不同 targetAgent 并行，同一 targetAgent 依次 */
  async scanOnce(): Promise<void> {
    const dueTodos = this.store.getDueTodos();
    if (dueTodos.length === 0) return;

    // 按 targetAgentId 分组
    const grouped = new Map<string, TodoItem[]>();
    for (const todo of dueTodos) {
      const key = todo.targetAgentId || "__unassigned__";
      const arr = grouped.get(key) || [];
      arr.push(todo);
      grouped.set(key, arr);
    }

    // 不同 agent 并行，同一 agent 内依次
    const promises = Array.from(grouped.values()).map(todos =>
      this.triggerTodosSequentially(todos),
    );
    await Promise.allSettled(promises);
  }

  private async triggerTodosSequentially(todos: TodoItem[]): Promise<void> {
    for (const todo of todos) {
      try {
        const message = this.formatTriggerMessage(todo);
        this.store.markTriggered(todo.id);
        log.info("Group %s: triggering TODO %s for %s", this.groupId, todo.id, todo.targetAgentId);
        await this.callbacks.onTrigger(this.groupId, todo, message);
      } catch (err: any) {
        log.error("Group %s: failed to trigger TODO %s: %s", this.groupId, todo.id, err.message);
      }
    }
  }

  /** 完成 TODO 并执行 onComplete 动作链 */
  async complete(todoId: string): Promise<TodoItem | undefined> {
    const item = this.store.complete(todoId);
    if (item?.onComplete && this.callbacks.onCompleteAction) {
      try {
        await this.callbacks.onCompleteAction(this.groupId, item);
      } catch (err: any) {
        log.error("Group %s: onComplete action failed for %s: %s", this.groupId, todoId, err.message);
      }
    }
    return item;
  }

  private formatTriggerMessage(todo: TodoItem): string {
    return `【系统通知 — 群组 TODO 触发 @ ${this.groupId}】
标题: ${todo.title}
内容: ${todo.description}
指派给: ${todo.targetAgentId || "未指定"}
续期提示: ${todo.recurrenceHint}

请根据上述内容执行相应操作。
如需续期：
  1. 先调用 todo-add 创建新 TODO
  2. 再调用 todo-complete 完成当前 TODO
一次性任务直接调用 todo-complete 即可。`;
  }
}
