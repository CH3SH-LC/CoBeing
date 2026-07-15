// packages/core/src/butler/butler-binding-store.ts
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import {
  DEFAULT_ALLOWED_EVENTS,
  DEFAULT_ESCALATION_POLICY,
  type GroupButlerBinding,
} from "@cobeing/shared";

const log = createLogger("butler-binding-store");

export class GroupButlerBindingStore {
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "butler-bindings.json");
  }

  /** 创建群组管家绑定（使用默认策略） */
  create(
    groupId: string,
    overrides?: Partial<Pick<GroupButlerBinding, "alias" | "enabled" | "allowedEvents" | "escalationPolicy">>,
  ): GroupButlerBinding {
    // 检查是否已存在
    const existing = this.get(groupId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const binding: GroupButlerBinding = {
      groupId,
      butlerId: "butler",
      alias: overrides?.alias ?? "管家",
      enabled: overrides?.enabled ?? true,
      allowedEvents: overrides?.allowedEvents ?? [...DEFAULT_ALLOWED_EVENTS],
      escalationPolicy: overrides?.escalationPolicy ?? { ...DEFAULT_ESCALATION_POLICY },
      createdAt: now,
      updatedAt: now,
    };

    const bindings = this.readAll();
    bindings.push(binding);
    this.writeAll(bindings);
    return binding;
  }

  /** 获取绑定 */
  get(groupId: string): GroupButlerBinding | undefined {
    return this.readAll().find(b => b.groupId === groupId);
  }

  /** 更新绑定 */
  update(groupId: string, patch: Partial<Omit<GroupButlerBinding, "groupId" | "butlerId" | "createdAt">>): GroupButlerBinding | undefined {
    const bindings = this.readAll();
    const idx = bindings.findIndex(b => b.groupId === groupId);
    if (idx < 0) return undefined;
    bindings[idx] = { ...bindings[idx], ...patch, updatedAt: new Date().toISOString() };
    this.writeAll(bindings);
    return bindings[idx];
  }

  /** 删除绑定 */
  delete(groupId: string): boolean {
    const bindings = this.readAll();
    const idx = bindings.findIndex(b => b.groupId === groupId);
    if (idx < 0) return false;
    bindings.splice(idx, 1);
    this.writeAll(bindings);
    return true;
  }

  /** 列出所有绑定 */
  list(): GroupButlerBinding[] {
    return this.readAll();
  }

  /** 列出已启用的绑定 */
  listEnabled(): GroupButlerBinding[] {
    return this.readAll().filter(b => b.enabled);
  }

  /** 绑定总数 */
  get count(): number {
    return this.readAll().length;
  }

  // ---- Private ----

  private readAll(): GroupButlerBinding[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const raw = fs.readFileSync(this.filePath, "utf-8").trim();
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      log.error("Failed to read butler-bindings file %s: %s", this.filePath, err.message);
      return [];
    }
  }

  private writeAll(bindings: GroupButlerBinding[]): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = this.filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(bindings, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
