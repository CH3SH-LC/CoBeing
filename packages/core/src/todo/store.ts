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

  /** 获取所有到期 TODO（pending 且 triggerAt <= now 且尚未触发） */
  getDueTodos(): TodoItem[] {
    const now = Date.now();
    return this.readAll().filter(i =>
      i.status === "pending" &&
      !i.triggeredAt &&
      new Date(i.triggerAt).getTime() <= now,
    );
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
