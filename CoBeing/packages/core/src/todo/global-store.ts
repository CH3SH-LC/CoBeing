// packages/core/src/todo/global-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { GlobalTodoItem, GlobalTodoStatus } from "@cobeing/shared";

const log = createLogger("global-todo-store");

export class GlobalTodoStore {
  private filePath: string;

  constructor(baseDir: string, filename = "global-todos.json") {
    this.filePath = path.join(baseDir, filename);
  }

  /** 列出所有 Global TODO，可选按状态筛选 */
  list(statusFilter?: GlobalTodoStatus): GlobalTodoItem[] {
    const items = this.readAll();
    if (statusFilter) return items.filter(i => i.status === statusFilter);
    return items;
  }

  /** 获取单条 */
  get(id: string): GlobalTodoItem | undefined {
    return this.readAll().find(i => i.id === id);
  }

  /** 新增 */
  add(input: Omit<GlobalTodoItem, "id" | "createdAt" | "updatedAt">): GlobalTodoItem {
    const now = new Date().toISOString();
    const item: GlobalTodoItem = {
      ...input,
      id: randomUUID(),
      progressSummary: input.progressSummary || "",
      nextAction: input.nextAction || "",
      executionRefs: input.executionRefs || [],
      automationPolicy: input.automationPolicy || {
        autoDispatch: true,
        autoMonitor: true,
        autoEscalate: true,
        autoArchive: true,
        autoContinue: true,
      },
      createdAt: now,
      updatedAt: now,
    };
    const items = this.readAll();
    items.push(item);
    this.writeAll(items);
    log.info("Global TODO added: %s (%s)", item.id, item.title);
    return item;
  }

  /** 更新（部分字段） */
  update(id: string, patch: Partial<GlobalTodoItem>): GlobalTodoItem | undefined {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return undefined;
    const merged = { ...items[idx], ...patch };
    if (!("updatedAt" in patch)) merged.updatedAt = new Date().toISOString();
    items[idx] = merged;
    this.writeAll(items);
    return items[idx];
  }

  /** 删除 */
  remove(id: string): boolean {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.writeAll(items);
    return true;
  }

  /** 按指派对象查找 */
  getByAssignee(assigneeId: string): GlobalTodoItem[] {
    return this.readAll().filter(i => i.assigneeId === assigneeId);
  }

  /** 按 ButlerTask ID 查找 */
  getByButlerTaskId(butlerTaskId: string): GlobalTodoItem | undefined {
    return this.readAll().find(i => i.butlerTaskId === butlerTaskId);
  }

  /** 按执行引用查找（反向：哪些 Global TODO 引用了某个 Group/Agent） */
  getByExecutionRef(scope: string, id: string): GlobalTodoItem[] {
    return this.readAll().filter(i =>
      i.executionRefs.some(ref => ref.scope === scope && ref.id === id)
    );
  }

  /** 获取所有等待用户的 TODO */
  getWaitingUser(): GlobalTodoItem[] {
    return this.readAll().filter(i => i.status === "waiting_user");
  }

  /** 获取停滞任务（updatedAt 超过指定小时数且状态为 running） */
  getStalled(hoursThreshold: number): GlobalTodoItem[] {
    const cutoff = Date.now() - hoursThreshold * 3600000;
    return this.readAll().filter(i =>
      i.status === "running" && new Date(i.updatedAt).getTime() < cutoff
    );
  }

  /** 设置状态 */
  setStatus(id: string, status: GlobalTodoStatus): boolean {
    return !!this.update(id, { status } as any);
  }

  /** 设置阻塞信息 */
  setBlocker(id: string, blocker: GlobalTodoItem["internalBlocker"]): boolean {
    return !!this.update(id, { internalBlocker: blocker } as any);
  }

  /** 清除阻塞 */
  clearBlocker(id: string): boolean {
    return !!this.update(id, { internalBlocker: undefined } as any);
  }

  /** 添加执行引用（合并已有的同 scope+id 引用） */
  addExecutionRef(id: string, ref: GlobalTodoItem["executionRefs"][0]): boolean {
    const item = this.get(id);
    if (!item) return false;
    const existing = item.executionRefs.findIndex(
      r => r.scope === ref.scope && r.id === ref.id
    );
    if (existing >= 0) {
      const merged = [...new Set([...(item.executionRefs[existing].todoIds || []), ...(ref.todoIds || [])])];
      item.executionRefs[existing] = { ...item.executionRefs[existing], todoIds: merged };
    } else {
      item.executionRefs.push(ref);
    }
    return !!this.update(id, { executionRefs: item.executionRefs } as any);
  }

  /** 条目总数 */
  get count(): number {
    return this.readAll().length;
  }

  // ---- Private ----

  private readAll(): GlobalTodoItem[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read global-todos file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(items: GlobalTodoItem[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
