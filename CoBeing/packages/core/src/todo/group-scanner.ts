// packages/core/src/todo/group-scanner.ts
import { createLogger, DEFAULT_PROVIDER, DEFAULT_JUDGMENT_MODEL, hasDeleteMarker } from "@cobeing/shared";
import type { TodoItem } from "./types.js";
import { TodoStore } from "./store.js";
import { OVERDUE_THRESHOLD_MS } from "./types.js";
import { runMemoryAgent } from "../agent/tool-agent/memory.js";

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
    private groupDir: string,
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
    if (hasDeleteMarker(this.groupDir)) return;
    const dueTodos = this.store.getDueTodos();
    const zeroTimeTodos = this.store.getZeroTimeTodos();

    if (dueTodos.length === 0 && zeroTimeTodos.length === 0) return;

    // 已触发但长期未完成的 0time TODO：超过冷却期低频重新触发一次
    // （防刷屏的替代：10 分钟冷却而非每 2 分钟重建——保证任务不被遗忘也不淹没上下文）
    const RETRIGGER_COOLDOWN_MS = 10 * 60 * 1000;
    const now = Date.now();
    const staleZeroTime = zeroTimeTodos.filter(t =>
      t.triggeredAt && t.status === 'pending' &&
      (now - new Date(t.triggeredAt).getTime() > RETRIGGER_COOLDOWN_MS)
    );
    if (staleZeroTime.length > 0) {
      log.info("Group %s: %d 0time TODO(s) stale >10min, re-triggering", this.groupId, staleZeroTime.length);
    }

    // 逾期任务优先触发 + 0time 随后
    dueTodos.sort((a, b) => new Date(a.triggerAt).getTime() - new Date(b.triggerAt).getTime());
    const allTodos = [
      ...dueTodos,
      ...zeroTimeTodos.filter(t => !t.triggeredAt && t.status === 'pending'),
      ...staleZeroTime,
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

    // 已触发的 0time TODO 保持 pending 直到被完成，不再过期重建。
    // 历史 bug：这里每次扫描都把「已触发但未完成」的 0time TODO 标记 expired
    // 并新建一条同内容 TODO → 新条目下一扫描又被触发 → 无限循环，
    // 每扫描周期向群组上下文注入一条完整任务通知并膨胀 TODO.json
    // （真实事故：单一群组任务在数小时内堆积 300+ 重复条目）。
    // 0time 语义 = 创建即触发一次，是否续期由群主通过 todo-add/todo-complete 管理。

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

    // 2.5 通知 GlobalTodoStore：查找引用了此 Group 的 Global TODO 并更新进度
    try {
      const globalStore = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
      if (globalStore) {
        const refs = globalStore.getByExecutionRef("group", this.groupId);
        for (const ref of refs) {
          const executionRef = ref.executionRefs.find((r: any) =>
            r.scope === "group" &&
            r.id === this.groupId &&
            (!r.todoIds?.length || r.todoIds.includes(item.id))
          );
          if (!executionRef) continue;

          const allLinkedTodosComplete = !executionRef.todoIds?.length ||
            executionRef.todoIds.every((id: string) => this.store.get(id)?.status === "completed");
          globalStore.update(ref.id, {
            status: allLinkedTodosComplete ? "completed" : ref.status,
            lastEvent: {
              type: "completed" as any,
              summary: `群组 TODO "${item.title}" 已完成`,
              id: `evt-${Date.now()}`,
              butlerTaskId: ref.butlerTaskId || ref.id,
              groupId: this.groupId,
              fromAgentId: item.targetAgentId || "unknown",
              severity: "info" as const,
              createdAt: new Date().toISOString(),
            },
            progressSummary: `群组 ${this.groupId}: "${item.title}" 已完成`,
            nextAction: allLinkedTodosComplete ? "Group execution completed" : ref.nextAction,
          } as any);
          const butlerTaskStore = (globalThis as any).__cobeing?.runtime?.butlerTaskStore;
          if (allLinkedTodosComplete && ref.butlerTaskId && butlerTaskStore?.update) {
            butlerTaskStore.update(ref.butlerTaskId, {
              status: "completed",
              latestSummary: `Group TODO completed: ${item.title}`,
            });
          }
          const wsServer = (globalThis as any).__cobeing?.runtime?.wsServer;
          wsServer?.broadcastGlobalTodoUpdate?.();
          log.info("Global TODO %s updated from group %s completion", ref.id, this.groupId);
        }
      }
    } catch (err: any) {
      log.error("GlobalTodoStore notification failed for group %s: %s", this.groupId, err.message);
    }

    // 3. TODO 完成时触发群组记忆智能体（异步，不阻塞返回）
    setImmediate(async () => {
      try {
        const gm = (globalThis as any).__cobeingGroupManager;
        if (!gm) return;
        const group = gm.get(this.groupId);
        if (!group) return;

        const getProvider = (globalThis as any).__cobeingGetProvider as ((id: string) => import("@cobeing/providers").LLMProvider | undefined) | undefined;
        const provider = getProvider?.(DEFAULT_PROVIDER)
          ?? (() => {
            const providers: Map<string, import("@cobeing/providers").LLMProvider> | undefined =
              (globalThis as any).__cobeing?.runtime?.providersMap;
            if (providers && providers.size > 0) return providers.values().next().value;
            return undefined;
          })();
        if (!provider) return;

        const model = (globalThis as any).__cobeingConfig?.judgmentModel ?? DEFAULT_JUDGMENT_MODEL;
        const memoryResult = await runMemoryAgent(
          "group",
          {
            groupName: group.config.name,
            groupId: group.id,
            phasePlan: group.workspace.readPlan() ?? "",
            progressMd: group.workspace.readProgress() ?? "",
            interfaceMd: group.workspace.readInterface() ?? "",
            memberContributions: [],
          },
          provider,
          model,
          group.workspace.paths.root,
        );

        if (memoryResult.entries.length > 0) {
          for (const entry of memoryResult.entries) {
            const section = this.mapCategoryToSection(entry.category);
            group.workspace.appendExperience(section, `${entry.summary}${entry.detail ? ' — ' + entry.detail : ''}`);
          }
          log.info("Group %s: memory saved %d entries", this.groupId, memoryResult.entries.length);
        }

        // interfaceUpdates 因 GroupWorkspace.appendInterfaceSection 仅接受 agentName，
        // 将接口更新建议作为经验条目写入
        if (memoryResult.interfaceUpdates && memoryResult.interfaceUpdates.length > 0) {
          for (const update of memoryResult.interfaceUpdates) {
            group.workspace.appendExperience("协作教训", `接口更新建议 — ${update.agentId}/${update.section}: ${update.entry}`);
          }
        }
      } catch (err) {
        // Non-blocking — memory failure doesn't affect phase completion
        log.debug("Group %s memory agent error (non-blocking): %s", this.groupId, err);
      }
    });

    return item;
  }

  /** 将内存条目类别映射到群组经验区块 */
  private mapCategoryToSection(category: string): "关键决策" | "协作教训" | "有效模式" {
    switch (category) {
      case "架构决策": return "关键决策";
      case "用户偏好":
      case "协作模式":
      case "错误教训": return "协作教训";
      case "工具发现":
      case "最佳实践": return "有效模式";
      default: return "有效模式";
    }
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
