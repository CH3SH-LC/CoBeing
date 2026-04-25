/**
 * GroupManager — manages group lifecycle（Phase 9 持久化）
 *
 * 持久化两类文件到 data/groups/{id}/:
 * - config.json: 群组配置
 * - context.jsonl: 群组上下文消息（每行一条 JSON）
 */
import type { GroupConfig } from "@cobeing/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";
import fs from "node:fs";
import path from "node:path";
import { createLogger, rmDirRecursive } from "@cobeing/shared";
import { GroupTodoScanner } from "../todo/group-scanner.js";
import type { TodoStore } from "../todo/store.js";

const log = createLogger("group-manager");

export class GroupManager {
  private groups = new Map<string, Group>();
  private groupScanners = new Map<string, GroupTodoScanner>();
  private dataRoot: string;
  private groupsDir: string;
  /** Agent 响应回调（自动应用到所有群组） */
  private _onAgentResponse?: (groupId: string, agentId: string, content: string, tag: string) => void;

  constructor(private registry: AgentRegistry, dataRoot?: string) {
    this.dataRoot = dataRoot ?? "data";
    this.groupsDir = path.join(this.dataRoot, "groups");
    (globalThis as any).__cobeingGroupManager = this;
  }

  create(config: GroupConfig): Group {
    const group = new Group(config, this.registry, this.dataRoot);
    group.setGroupManager(this);
    if (this._onAgentResponse) {
      group.setOnAgentResponse(this._onAgentResponse);
    }
    this.groups.set(config.id, group);
    this.saveGroup(config.id);

    // 启动群组 TODO 扫描器
    const groupDir = path.join(this.groupsDir, config.id);
    const scanner = new GroupTodoScanner(config.id, groupDir, {
      onTrigger: async (groupId, todo, message) => {
        const g = this.groups.get(groupId);
        if (g) {
          const targetAgent = this.registry.get(todo.targetAgentId || "");
          if (targetAgent) {
            await targetAgent.run(message);
          }
        }
      },
      onCompleteAction: async (groupId, todo) => {
        const g = this.groups.get(groupId);
        if (g && todo.onComplete?.mentionAgentId) {
          const mentionId = todo.onComplete.mentionAgentId;
          const message = todo.onComplete.message || `@${mentionId} ${todo.title} 已完成，请开始你的部分。`;
          g.postMessage("system", message);
        }
      },
    });
    scanner.start();
    this.groupScanners.set(config.id, scanner);
    return group;
  }

  get(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  /** 设置 Agent 响应回调（自动应用到所有群组） */
  setOnAgentResponse(cb: (groupId: string, agentId: string, content: string, tag: string) => void): void {
    this._onAgentResponse = cb;
    // 应用到已有的群组
    for (const group of this.groups.values()) {
      group.setOnAgentResponse(cb);
    }
  }

  list(): Group[] {
    return [...this.groups.values()];
  }

  delete(groupId: string): void {
    this.groupScanners.get(groupId)?.stop();
    this.groupScanners.delete(groupId);
    this.groups.delete(groupId);
    const groupDir = path.join(this.groupsDir, groupId);
    try {
      rmDirRecursive(groupDir);
      log.info("Deleted group data: %s", groupDir);
    } catch (e: any) {
      log.error("Failed to delete group data %s: %s", groupDir, e.message);
    }
  }

  /** 持久化单个群组配置到 data/groups/{id}/config.json */
  saveGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    const dir = path.join(this.groupsDir, groupId);
    fs.mkdirSync(dir, { recursive: true });

    const configPath = path.join(dir, "config.json");
    const data = {
      id: group.config.id,
      name: group.config.name,
      members: group.config.members,
      owner: group.config.owner,
      topic: group.config.topic,
    };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  /** 追加一条上下文消息到 data/groups/{id}/context.jsonl */
  appendContextMessage(groupId: string, message: { fromAgentId: string; content: string; tag: string; timestamp: number }): void {
    const dir = path.join(this.groupsDir, groupId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const contextPath = path.join(dir, "context.jsonl");
    const line = JSON.stringify(message) + "\n";
    fs.appendFileSync(contextPath, line, "utf-8");
  }

  /** 读取群组上下文历史从 context.jsonl */
  loadContext(groupId: string): Array<{ fromAgentId: string; content: string; tag: string; timestamp: number }> {
    const contextPath = path.join(this.groupsDir, groupId, "context.jsonl");
    if (!fs.existsSync(contextPath)) return [];

    const raw = fs.readFileSync(contextPath, "utf-8");
    return raw.trim().split("\n").filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  /** 从 data/groups/ 目录恢复所有群组 */
  restoreGroups(): void {
    if (!fs.existsSync(this.groupsDir)) return;

    const entries = fs.readdirSync(this.groupsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(this.groupsDir, entry.name, "config.json");

      let config: GroupConfig;
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as GroupConfig;
        } catch (err: any) {
          log.warn("Failed to parse group config %s: %s", entry.name, err.message);
          continue;
        }
      } else {
        // Auto-create config.json from directory name for legacy groups
        config = {
          id: entry.name,
          name: entry.name,
          members: [],
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        log.info("Auto-created config.json for legacy group: %s", entry.name);
      }

      try {
        const group = new Group(config, this.registry, this.dataRoot);
        group.setGroupManager(this);
        if (this._onAgentResponse) {
          group.setOnAgentResponse(this._onAgentResponse);
        }
        this.groups.set(config.id, group);

        // Restore context history into GroupContextV2
        const history = this.loadContext(config.id);
        for (const msg of history) {
          group.ctxV2.append(msg.fromAgentId, msg.content, msg.tag);
        }

        // Rebuild current.md from recent history
        const memoryDir = path.join(this.groupsDir, config.id, "memory");
        fs.mkdirSync(memoryDir, { recursive: true });
        const recentHistory = history.slice(-100);
        for (const msg of recentHistory) {
          group.currentMd.append({
            id: `restored-${msg.timestamp}-${msg.fromAgentId}`,
            tag: msg.tag,
            fromAgentId: msg.fromAgentId,
            content: msg.content,
            timestamp: msg.timestamp,
          });
        }

        // 启动群组 TODO 扫描器
        const groupDir = path.join(this.groupsDir, config.id);
        const scanner = new GroupTodoScanner(config.id, groupDir, {
          onTrigger: async (groupId, todo, message) => {
            const g = this.groups.get(groupId);
            if (g) {
              const targetAgent = this.registry.get(todo.targetAgentId || "");
              if (targetAgent) {
                await targetAgent.run(message);
              }
            }
          },
          onCompleteAction: async (groupId, todo) => {
            const g = this.groups.get(groupId);
            if (g && todo.onComplete?.mentionAgentId) {
              const mentionId = todo.onComplete.mentionAgentId;
              const message = todo.onComplete.message || `@${mentionId} ${todo.title} 已完成，请开始你的部分。`;
              g.postMessage("system", message);
            }
          },
        });
        scanner.start();
        this.groupScanners.set(config.id, scanner);

        log.info("Restored group: %s (%s, %d members, %d messages)",
          config.name, config.id, config.members.length, history.length);
      } catch (err: any) {
        log.warn("Failed to restore group %s: %s", entry.name, err.message);
      }
    }
  }

  /** 获取群组的 TodoStore（供工具使用） */
  getGroupTodoStore(groupId: string): TodoStore | undefined {
    return this.groupScanners.get(groupId)?.getStore();
  }

  /** 获取群组 TODO 扫描器 */
  getScanner(groupId: string): GroupTodoScanner | undefined {
    return this.groupScanners.get(groupId);
  }
}
