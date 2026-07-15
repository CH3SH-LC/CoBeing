// packages/core/src/todo/store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { TodoItem } from "./types.js";

const log = createLogger("todo-store");

export class TodoStore {
  private filePath: string;

  constructor(baseDir: string, filename = "TODO.json") {
    this.filePath = path.join(baseDir, filename);
  }

  /** 读取所有 TODO（文件不存在或损坏返回空数组） */
  list(statusFilter?: TodoItem["status"]): TodoItem[] {
    const items = this.readAll();
    if (statusFilter) return items.filter(i => i.status === statusFilter);
    return items;
  }

  /** 获取单条 TODO */
  get(id: string): TodoItem | undefined {
    return this.readAll().find(i => i.id === id);
  }

  /** 添加新 TODO */
  add(input: Omit<TodoItem, "id" | "createdAt" | "status">): TodoItem {
    const item: TodoItem = {
      ...input,
      triggerMode: input.triggerMode || "time",
      recurrenceHint: input.recurrenceHint || "不重复",
      id: randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const items = this.readAll();
    items.push(item);
    this.writeAll(items);
    return item;
  }

  /** 标记为 triggered（记录触发时间，状态不变） */
  markTriggered(id: string): TodoItem | undefined {
    return this.updateItem(id, item => {
      item.triggeredAt = new Date().toISOString();
    });
  }

  /** 标记为 completed */
  complete(id: string): TodoItem | undefined {
    return this.updateItem(id, item => {
      item.status = "completed";
      item.completedAt = new Date().toISOString();
    });
  }

  /** 删除 TODO */
  remove(id: string): boolean {
    const items = this.readAll();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.writeAll(items);
    return true;
  }

  /** 获取所有到期 TODO（pending 且 triggerAt <= now 且尚未触发。默认 time 模式） */
  getDueTodos(): TodoItem[] {
    const now = Date.now();
    return this.readAll().filter(i => {
      const mode = i.triggerMode || "time";
      return i.status === "pending" &&
        mode === "time" &&
        !i.triggeredAt &&
        new Date(i.triggerAt).getTime() <= now;
    });
  }

  /** 获取 0time 模式的 pending TODO（扫描即触发） */
  getZeroTimeTodos(): TodoItem[] {
    return this.readAll().filter(i =>
      i.triggerMode === "0time" && i.status === "pending"
    );
  }

  /** 获取 condition 模式的 pending TODO */
  getConditionTodos(): TodoItem[] {
    return this.readAll().filter(i =>
      i.triggerMode === "condition" && i.status === "pending" && !i.triggeredAt
    );
  }

  /** 获取已逾期的 TODO（triggerAt 超过阈值仍未被触发） */
  getOverdueTodos(thresholdMs = 3600000): TodoItem[] {
    const now = Date.now();
    return this.readAll().filter(i => {
      if (i.status !== "pending") return false;
      if (i.triggeredAt) return false;
      const triggerTime = new Date(i.triggerAt).getTime();
      return (now - triggerTime) > thresholdMs;
    });
  }

  /** 按父任务 ID 列出子任务 */
  listByParent(parentId: string): TodoItem[] {
    return this.readAll().filter(i => i.parentId === parentId);
  }

  /** 获取依赖当前 TODO 的其他 TODO（下游任务） */
  getDependents(id: string): TodoItem[] {
    return this.readAll().filter(i =>
      i.dependsOn?.includes(id) && i.status === "pending",
    );
  }

  /** 检查 TODO 的所有上游依赖是否已完成 */
  areDependenciesMet(id: string): boolean {
    const item = this.get(id);
    if (!item?.dependsOn?.length) return true;
    const all = this.readAll();
    return item.dependsOn.every(depId => {
      const dep = all.find(i => i.id === depId);
      return dep && dep.status === "completed";
    });
  }

  /** 设置 TODO 的依赖列表 */
  setDependsOn(id: string, dependsOn: string[]): boolean {
    const item = this.updateItem(id, i => { i.dependsOn = dependsOn; });
    return !!item;
  }

  /** 更新 TODO 状态（含依赖检查） */
  updateStatus(id: string, status: TodoItem["status"]): { ok: boolean; error?: string } {
    if (status === "in-progress") {
      const met = this.areDependenciesMet(id);
      if (!met) return { ok: false, error: "上游依赖未完成，无法开始" };
    }
    const item = this.updateItem(id, i => { i.status = status; });
    if (!item) return { ok: false, error: "未找到 TODO" };
    return { ok: true };
  }

  /** 批量完成 */
  batchComplete(ids: string[]): { completed: number; failed: Array<{ id: string; reason: string }> } {
    let completed = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    const items = this.readAll();
    for (const id of ids) {
      const item = items.find(i => i.id === id);
      if (!item) { failed.push({ id, reason: "未找到" }); continue; }
      if (item.status === "completed") { failed.push({ id, reason: "已完成" }); continue; }
      item.status = "completed";
      item.completedAt = new Date().toISOString();
      completed++;
    }
    if (completed > 0) this.writeAll(items);
    return { completed, failed };
  }

  /** 批量删除 */
  batchRemove(ids: string[]): { removed: number; failed: Array<{ id: string; reason: string }> } {
    let removed = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    const items = this.readAll();
    const idSet = new Set(ids);
    const remaining: TodoItem[] = [];
    for (const item of items) {
      if (idSet.has(item.id)) { removed++; }
      else { remaining.push(item); }
    }
    for (const id of ids) {
      if (!items.some(i => i.id === id)) {
        failed.push({ id, reason: "未找到" });
      }
    }
    if (removed > 0) this.writeAll(remaining);
    return { removed, failed };
  }

  /** 批量更新（targetAgentId 或 status） */
  batchUpdate(ids: string[], updates: { targetAgentId?: string; status?: TodoItem["status"] }): { updated: number; failed: Array<{ id: string; reason: string }> } {
    let updated = 0;
    const failed: Array<{ id: string; reason: string }> = [];
    const items = this.readAll();
    for (const id of ids) {
      const item = items.find(i => i.id === id);
      if (!item) { failed.push({ id, reason: "未找到" }); continue; }
      if (updates.targetAgentId) item.targetAgentId = updates.targetAgentId;
      if (updates.status) item.status = updates.status;
      updated++;
    }
    if (updated > 0) this.writeAll(items);
    return { updated, failed };
  }

  // ---- Private ----

  private readAll(): TodoItem[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read TODO file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(items: TodoItem[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }

  private updateItem(id: string, mutator: (item: TodoItem) => void): TodoItem | undefined {
    const items = this.readAll();
    const item = items.find(i => i.id === id);
    if (!item) return undefined;
    mutator(item);
    this.writeAll(items);
    return item;
  }
}
