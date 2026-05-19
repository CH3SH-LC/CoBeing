// packages/core/src/todo/group-scanner.ts
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { TodoStore } from "./store.js";
import { OVERDUE_THRESHOLD_MS } from "./types.js";

const log = createLogger("group-todo-scanner");

export interface GroupScannerCallbacks {
  onTrigger: (groupId: string, todo: TodoItem, message: string) => Promise<void>;
  onCompleteAction?: (groupId: string, todo: TodoItem) => Promise<void>;
  /** 依赖条件满足时通知下游 Agent（上游完成后，检查下游所有依赖是否完成） */
  onDependencyMet?: (groupId: string, todo: TodoItem) => Promise<void>;
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

  /** 扫描并触发到期 TODO + 0time TODO */
  async scanOnce(): Promise<void> {
    const dueTodos = this.store.getDueTodos();
    const zeroTimeTodos = this.store.getZeroTimeTodos();

    if (dueTodos.length === 0 && zeroTimeTodos.length === 0) return;

    // 逾期任务优先触发 + 0time 随后
    dueTodos.sort((a, b) => new Date(a.triggerAt).getTime() - new Date(b.triggerAt).getTime());
    const allTodos = [
      ...dueTodos,
      ...zeroTimeTodos.filter(t => !t.triggeredAt || t.status === 'pending'),
    ];

    // 按 targetAgentId 分组
    const grouped = new Map<string, TodoItem[]>();
    for (const todo of allTodos) {
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

    // 0time 未完成的重建逻辑
    for (const todo of zeroTimeTodos) {
      if (todo.triggeredAt && todo.status !== 'completed') {
        this.store.updateStatus(todo.id, 'expired');
        this.store.add({
          title: todo.title,
          description: todo.description,
          triggerMode: '0time',
          triggerAt: '',
          check: todo.check,
          recurrenceHint: '不重复',
          createdBy: 'TODOboard',
          targetAgentId: todo.targetAgentId,
          groupId: todo.groupId,
          dependsOn: todo.dependsOn,
        });
        log.info("Group %s: 0time TODO %s expired, recreated", this.groupId, todo.id);
      }
    }

    // Completion detection
    try {
      const allStoreItems = this.store.list();
      if (allStoreItems.length > 0 && allStoreItems.every(t => t.status === 'completed')) {
        const gm = (globalThis as any).__cobeingGroupManager;
        if (gm) {
          const group = gm.get(this.groupId);
          const lastMsgs = group?.groupDb?.getAllMessages({ limit: 1 });
          const lastMsgAge = lastMsgs?.length ? Date.now() - lastMsgs[0].timestamp : Infinity;
          if (lastMsgAge > 3600000) {
            gm.completeGroup?.(this.groupId);
          }
        }
      }
    } catch (err: any) {
      log.error("Completion check failed for %s: %s", this.groupId, err.message);
    }
  }

  /** 当 Agent 在群组中发言时调用 — 检查 condition TODO */
  async checkConditionTodos(speakerAgentId: string): Promise<void> {
    const conditionTodos = this.store.getConditionTodos()
      .filter(t => t.condition?.targetAgents?.includes(speakerAgentId));

    for (const todo of conditionTodos) {
      try {
        const message = this.formatConditionTriggerMessage(todo, speakerAgentId);
        log.info("Group %s: condition trigger for TODO %s (agent %s spoke)", this.groupId, todo.id, speakerAgentId);
        await this.callbacks.onTrigger(this.groupId, todo, message);
        this.store.markTriggered(todo.id);
      } catch (err: any) {
        log.error("Group %s: condition trigger failed for TODO %s: %s", this.groupId, todo.id, err.message);
      }
    }
  }

  private formatConditionTriggerMessage(todo: TodoItem, speakerId: string): string {
    return `【系统通知 — 条件触发 @ ${this.groupId}】
标题: ${todo.title}
触发原因: ${speakerId} 在群组中发言了
条件描述: ${todo.condition?.check || '检查接口是否就位'}
指派给: ${todo.targetAgentId || "未指定"}
条件不满足时的行为: ${todo.condition?.onFail || 'remind'}

请检查以上条件是否满足：
- 满足 → 调用 todo-complete 完成此 TODO
- 不满足 → ${todo.condition?.onFail === 'recreate' ? '此 TODO 将被重建' : '请 @mention 对方提醒补充'}
如需续期，先调用 todo-add 创建新 TODO，再调用 todo-complete。
`;
  }

  private async triggerTodosSequentially(todos: TodoItem[]): Promise<void> {
    for (const todo of todos) {
      try {
        const message = this.formatTriggerMessage(todo);
        log.info("Group %s: triggering TODO %s for %s", this.groupId, todo.id, todo.targetAgentId);
        await this.callbacks.onTrigger(this.groupId, todo, message);
        this.store.markTriggered(todo.id);
      } catch (err: any) {
        log.error("Group %s: failed to trigger TODO %s: %s", this.groupId, todo.id, err.message);
      }
    }
  }

  /** 完成 TODO 并执行 onComplete 动作链 + 检查下游依赖 */
  async complete(todoId: string): Promise<TodoItem | undefined> {
    const item = this.store.complete(todoId);
    if (!item) return undefined;

    // 1. 执行 onComplete 动作链
    if (item.onComplete && this.callbacks.onCompleteAction) {
      try {
        await this.callbacks.onCompleteAction(this.groupId, item);
      } catch (err: any) {
        log.error("Group %s: onComplete action failed for %s: %s", this.groupId, todoId, err.message);
      }
    }

    // 1.5 自动同步工作区文档
    try {
      const gm = (globalThis as any).__cobeingGroupManager;
      if (gm) {
        const group = gm.get(this.groupId);
        if (group) {
          group.workspace.appendProgress('System', `TODO "${item.title}" 已完成`);
        }
      }
    } catch (err: any) {
      log.error("Workspace sync failed for %s: %s", this.groupId, err.message);
    }

    // 2. 检查下游依赖：是否有其他 TODO 依赖当前这个
    if (this.callbacks.onDependencyMet) {
      const dependents = this.store.getDependents(todoId);
      for (const dep of dependents) {
        if (this.store.areDependenciesMet(dep.id)) {
          log.info("Group %s: all dependencies met for TODO %s (%s), notifying", this.groupId, dep.id, dep.title);
          try {
            await this.callbacks.onDependencyMet(this.groupId, dep);
          } catch (err: any) {
            log.error("Group %s: onDependencyMet failed for %s: %s", this.groupId, dep.id, err.message);
          }
        }
      }
    }

    return item;
  }

  private formatTriggerMessage(todo: TodoItem): string {
    const now = Date.now();
    const triggerTime = new Date(todo.triggerAt).getTime();
    const overdueMs = now - triggerTime;
    const isOverdue = overdueMs > OVERDUE_THRESHOLD_MS;
    const overdueHours = Math.floor(overdueMs / OVERDUE_THRESHOLD_MS);

    return `【系统通知 — 群组 TODO 触发 @ ${this.groupId}】
标题: ${todo.title}
内容: ${todo.description}
指派给: ${todo.targetAgentId || "未指定"}
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
