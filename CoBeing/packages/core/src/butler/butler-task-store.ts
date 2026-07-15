// packages/core/src/butler/butler-task-store.ts
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "@cobeing/shared";
import type { ButlerTask, ButlerTaskStatus } from "@cobeing/shared";

const log = createLogger("butler-task-store");

/** 状态迁移合法性映射 */
const VALID_TRANSITIONS: Record<ButlerTaskStatus, ButlerTaskStatus[]> = {
  routing: ["dispatched", "cancelled"],
  dispatched: ["running", "cancelled"],
  running: ["waiting_user", "completed", "failed", "cancelled"],
  waiting_user: ["running", "completed", "cancelled"],
  completed: ["running"], // 返工
  failed: ["running", "cancelled"], // 重试或取消
  cancelled: [], // 终态
};

export class ButlerTaskStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "butler-tasks.json");
  }

  /** 创建 ButlerTask */
  create(input: Omit<ButlerTask, "id" | "createdAt" | "updatedAt">): ButlerTask {
    const now = new Date().toISOString();
    const task: ButlerTask = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const tasks = this.readAll();
    tasks.push(task);
    this.writeAll(tasks);
    return task;
  }

  /** 获取单个任务 */
  get(id: string): ButlerTask | undefined {
    return this.readAll().find(t => t.id === id);
  }

  /** 更新任务字段 */
  update(id: string, patch: Partial<Omit<ButlerTask, "id" | "createdAt">>): ButlerTask | undefined {
    const tasks = this.readAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return undefined;
    tasks[idx] = { ...tasks[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(tasks);
    return tasks[idx];
  }

  /** 状态迁移（含校验） */
  transition(id: string, to: ButlerTaskStatus): ButlerTask | undefined {
    const task = this.get(id);
    if (!task) return undefined;

    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(to)) {
      log.warn("Invalid transition: %s -> %s (task %s)", task.status, to, id);
      return undefined;
    }

    return this.update(id, { status: to });
  }

  /** 删除任务 */
  delete(id: string): boolean {
    const tasks = this.readAll();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return false;
    tasks.splice(idx, 1);
    this.writeAll(tasks);
    return true;
  }

  /** 列出任务，支持过滤 */
  list(filter?: { status?: ButlerTaskStatus; targetType?: string; targetId?: string }): ButlerTask[] {
    let tasks = this.readAll();
    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter?.targetType) tasks = tasks.filter(t => t.targetType === filter.targetType);
    if (filter?.targetId) tasks = tasks.filter(t => t.targetId === filter.targetId);
    return tasks;
  }

  /** 按 GlobalTodo ID 查找 */
  getByGlobalTodoId(globalTodoId: string): ButlerTask | undefined {
    return this.readAll().find(t => t.globalTodoId === globalTodoId);
  }

  /** 按目标（Agent/Group）查找 */
  getByTarget(targetId: string): ButlerTask[] {
    return this.readAll().filter(t => t.targetId === targetId);
  }

  /** 条目总数 */
  get count(): number {
    return this.readAll().length;
  }

  // ---- Private ----

  private readAll(): ButlerTask[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read butler-tasks file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(tasks: ButlerTask[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
