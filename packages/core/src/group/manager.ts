/**
 * GroupManager — manages group lifecycle（Phase 9 持久化）
 *
 * 持久化两类文件到 data/groups/{id}/:
 * - config.json: 群组配置
 * - context.jsonl: 群组上下文消息（每行一条 JSON）
 */
import type { GroupConfig, AgentConfig } from "@cobeing/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";
import { Agent } from "../agent/agent.js";
import type { LLMProvider } from "@cobeing/providers";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createLogger, rmDirRecursive, readMasterRegistry, addGroupToRegistry, removeGroupFromRegistry, updateGroupMembers, updateGroupStatus } from "@cobeing/shared";
import type { MasterGroupEntry } from "@cobeing/shared";
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
  private _onAgentEvent?: import("./wake-system.js").WakeSystemConfig["onAgentEvent"];
  private _onQueueChange?: import("./wake-system.js").WakeSystemConfig["onQueueChange"];
  private _onMessageBroadcast?: (groupId: string, msg: import("./group-context-v2.js").GroupMessageV2) => void;

  constructor(
    private registry: AgentRegistry,
    dataRoot?: string,
    private getProvider?: (providerId?: string) => LLMProvider | undefined,
  ) {
    this.dataRoot = dataRoot ?? "data";
    this.groupsDir = path.join(this.dataRoot, "groups");
    (globalThis as any).__cobeingGroupManager = this;
  }

  create(config: GroupConfig): Group {
    // 先更新 master registry（单一真相源）
    addGroupToRegistry(this.dataRoot, {
      id: config.id,
      name: config.name,
      owner: config.owner || "host",
      members: config.members,
      topic: config.topic,
      status: config.status || "active",
      createdAt: new Date().toISOString(),
    });

    const group = new Group(config, this.registry, this.dataRoot);
    group.setGroupManager(this);
    if (this._onAgentResponse) {
      group.setOnAgentResponse(this._onAgentResponse);
    }
    if (this._onAgentEvent) {
      group.setOnAgentEvent(this._onAgentEvent);
    }
    if (this._onQueueChange) {
      group.setOnQueueChange(this._onQueueChange);
    }
    if (this._onMessageBroadcast) {
      group.setOnMessageBroadcast(this._onMessageBroadcast);
    }

    // 创建 Reviewer Agent（如果启用）
    const reviewerCfg = config.reviewer ?? { enabled: true, maxRounds: 3 };
    if (reviewerCfg.enabled !== false && reviewerCfg.maxRounds !== 0) {
      try {
        group.reviewerAgent = this.createReviewerAgent(group);
      } catch (err: any) {
        log.warn("[%s] Failed to create reviewer agent: %s", config.id, err.message);
      }
    }

    this.groups.set(config.id, group);
    this.saveGroup(config.id);

    // 启动群组 TODO 扫描器
    const groupDir = path.join(this.groupsDir, config.id);
    const scanner = new GroupTodoScanner(config.id, groupDir, {
      onTrigger: async (groupId, todo, message) => {
        const g = this.groups.get(groupId);
        if (!g) return;
        const targetId = todo.targetAgentId;
        if (targetId) {
          // 通过 postMessage 触发 WakeSystem 自然唤醒（@mention → 队列 → 三层上下文 → 回复写回群组）
          g.postMessage("TODOboard", `@${targetId} ${message}`);
        } else {
          // 未指定目标时 @all
          g.postMessage("TODOboard", `@all ${message}`);
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
      onDependencyMet: async (groupId, todo) => {
        const g = this.groups.get(groupId);
        if (g && todo.targetAgentId) {
          const targetId = todo.targetAgentId;
          g.postMessage("TODOboard", `@${targetId} 【依赖完成通知】你的任务 "${todo.title}" 的所有上游依赖已全部完成，可以开始执行了。`);
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

  /** 查询某个 Agent 所属的所有群组 */
  getGroupsForAgent(agentId: string): Group[] {
    const result: Group[] = [];
    for (const g of this.groups.values()) {
      if (g.config.members.includes(agentId)) {
        result.push(g);
      }
    }
    return result;
  }

  /** 设置 Agent 响应回调（自动应用到所有群组） */
  setOnAgentResponse(cb: (groupId: string, agentId: string, content: string, tag: string) => void): void {
    this._onAgentResponse = cb;
    // 应用到已有的群组
    for (const group of this.groups.values()) {
      group.setOnAgentResponse(cb);
    }
  }

  /** 设置 Agent 事件广播回调（自动应用到所有群组） */
  setOnAgentEvent(cb: import("./wake-system.js").WakeSystemConfig["onAgentEvent"]): void {
    this._onAgentEvent = cb;
    for (const group of this.groups.values()) {
      group.setOnAgentEvent(cb);
    }
  }

  /** 设置唤醒队列变更回调（自动应用到所有群组） */
  setOnQueueChange(cb: import("./wake-system.js").WakeSystemConfig["onQueueChange"]): void {
    this._onQueueChange = cb;
    for (const group of this.groups.values()) {
      group.setOnQueueChange(cb);
    }
  }

  /** 设置消息广播回调（自动应用到所有群组） */
  setOnMessageBroadcast(cb: (groupId: string, msg: import("./group-context-v2.js").GroupMessageV2) => void): void {
    this._onMessageBroadcast = cb;
    for (const group of this.groups.values()) {
      group.setOnMessageBroadcast(cb);
    }
  }

  /** 设置消息回调（condition TODO 扫描用） */
  setOnMessage(cb: (groupId: string, fromAgentId: string) => void): void {
    for (const group of this.groups.values()) {
      group.setOnMessage(cb);
    }
  }

  /**
   * 创建群组的 Reviewer Agent
   * 在群组创建时自动调用，群组销毁时自动清理
   */
  private createReviewerAgent(group: Group): Agent {
    const reviewerId = `${group.id}-reviewer`;

    // 如果已注册则直接返回（幂等）
    const existing = this.registry.get(reviewerId);
    if (existing) return existing;

    // 解析 Provider
    const reviewerCfg = group.config.reviewer;
    const providerId = reviewerCfg?.provider;
    const provider = this.getProvider?.(providerId);
    if (!provider) {
      throw new Error(`No provider available for reviewer agent of group ${group.id}`);
    }

    const model = reviewerCfg?.model || "deepseek-v4-flash";

    const config: AgentConfig = {
      id: reviewerId,
      name: `${group.config.name}-审核员`,
      role: "消息审核员",
      systemPrompt: `你是群组"${group.config.name}"的消息审核员。你的职责是审查群组成员的工作成果，确保其进行了实质性工作而非偷懒。`,
      provider: providerId || "deepseek",
      model,
      tools: [],
      permissions: { mode: "read-only" },
      sandbox: { enabled: false, filesystem: "isolated", network: { enabled: false, mode: "none" } },
      isReviewer: true,
    };

    const agent = new Agent(config, provider, this.dataRoot);

    // 写入审核员 JOB.md 画像文件
    agent.files.writeJob(`# ${group.config.name} 审核员

## 专注领域
消息审核、工作质量评估

## 核心能力
- 审查群组成员是否进行了实质性工作（调用了工具、产生了具体输出）
- 检测成员是否在偷懒（仅声明意图而未展示实际工作成果）
- 确保工作方法符合任务要求
`);
    agent.files.writeCharacter(`- Name: ${group.config.name}-审核员
- Role: 消息审核员

群组"${group.config.name}"的专属审核员，负责审查成员消息质量。`);

    this.registry.register(agent);
    log.info("[%s] Reviewer agent created: %s", group.id, reviewerId);
    return agent;
  }

  /** 获取所有群组的唤醒队列 */
  getAllWakeQueues(): Record<string, { queue: Array<{ targetAgentId: string; triggerMsgId: string; triggerTag: string; triggerContents: string[] }>; processing: string | null; processingAgents: string[] }> {
    const result: Record<string, any> = {};
    for (const [id, group] of this.groups) {
      const data = group.getWakeQueue();
      if (data.queue.length > 0 || data.processing || data.processingAgents?.length > 0) {
        result[id] = data;
      }
    }
    return result;
  }

  list(): Group[] {
    return [...this.groups.values()];
  }

  delete(groupId: string): void {
    // 先从 master registry 移除
    removeGroupFromRegistry(this.dataRoot, groupId);

    this.groupScanners.get(groupId)?.stop();
    this.groupScanners.delete(groupId);
    const group = this.groups.get(groupId);
    if (group) {
      // 销毁 Reviewer Agent
      if (group.reviewerAgent) {
        try {
          this.registry.unregister(group.reviewerAgent.id);
          log.info("[%s] Reviewer agent destroyed", groupId);
        } catch { /* ignore */ }
      }
      group.dispose();
      this.groups.delete(groupId);
    }
    const groupDir = path.join(this.groupsDir, groupId);
    try {
      rmDirRecursive(groupDir);
      log.info("Deleted group data: %s", groupDir);
    } catch (e: any) {
      log.error("Failed to delete group data %s: %s", groupDir, e.message);
      // Fallback: at least delete/rename config.json to prevent resurrection on restart
      const configPath = path.join(groupDir, "config.json");
      try {
        if (fs.existsSync(configPath)) {
          try {
            fs.unlinkSync(configPath);
            log.info("Deleted config.json to prevent group resurrection: %s", configPath);
          } catch (unlinkErr: any) {
            // On Windows, rename often works when unlink fails (e.g. AV scanning)
            const renamedPath = configPath + ".deleted." + Date.now();
            fs.renameSync(configPath, renamedPath);
            log.info("Renamed config.json to prevent group resurrection: %s", renamedPath);
          }
        }
      } catch (e2: any) {
        log.error("Failed to delete/rename config.json %s: %s", configPath, e2.message);
      }
    }
  }

  /** Mark group as completed */
  completeGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.config.status === 'completed') return false;
    group.setStatus('completed');
    updateGroupStatus(this.dataRoot, groupId, 'completed');
    group.workspace.appendProgress('System', `群组自动标记为已完成 — 所有 TODO 已关闭`);
    this.saveGroup(groupId);
    const ws = (globalThis as any).__cobeingWSServer;
    ws?.broadcastState();
    log.info("Group completed: %s", groupId);
    return true;
  }

  /** Archive group: pack to zip, delete data, remove from memory */
  archiveGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.config.status === 'archived') return false;

    const groupDir = path.join(this.groupsDir, groupId);
    const archiveDir = path.join(this.dataRoot, 'archives');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, `${groupId}.zip`);

    // Pack FIRST, then clean up on success
    try {
      execSync(`powershell -Command "Compress-Archive -Path '${groupDir}' -DestinationPath '${archivePath}' -Force"`, { stdio: 'ignore' });
    } catch (err: any) {
      log.error("Failed to archive group %s: %s", groupId, err.message);
      return false;
    }

    updateGroupStatus(this.dataRoot, groupId, 'archived');
    group.setStatus('archived');

    // 销毁 Reviewer Agent
    if (group.reviewerAgent) {
      try {
        this.registry.unregister(group.reviewerAgent.id);
      } catch { /* ignore */ }
    }

    group.dispose();
    this.groupScanners.get(groupId)?.stop();
    this.groupScanners.delete(groupId);
    this.groups.delete(groupId);
    rmDirRecursive(groupDir);
    const ws = (globalThis as any).__cobeingWSServer;
    ws?.broadcastState();
    log.info("Group archived: %s -> %s", groupId, archivePath);
    return true;
  }

  /** Restore group from archive zip */
  restoreGroup(groupId: string): Group | undefined {
    const archivePath = path.join(this.dataRoot, 'archives', `${groupId}.zip`);
    if (!fs.existsSync(archivePath)) {
      log.warn("Archive not found for group: %s", groupId);
      return undefined;
    }

    const groupDir = path.join(this.groupsDir, groupId);
    try {
      fs.mkdirSync(groupDir, { recursive: true });
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${groupDir}' -Force"`, { stdio: 'ignore' });
      fs.unlinkSync(archivePath);
    } catch (err: any) {
      log.error("Failed to restore group %s: %s", groupId, err.message);
      return undefined;
    }

    const configPath = path.join(groupDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      log.error("Group config not found after restore: %s", groupId);
      return undefined;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.status = 'active';

    const group = new Group(config, this.registry, this.dataRoot);
    group.setGroupManager(this);
    if (this._onAgentResponse) group.setOnAgentResponse(this._onAgentResponse);
    if (this._onAgentEvent) group.setOnAgentEvent(this._onAgentEvent);
    if (this._onQueueChange) group.setOnQueueChange(this._onQueueChange);

    // 恢复 Reviewer Agent（如果启用）
    const rCfg = config.reviewer ?? { enabled: true, maxRounds: 3 };
    if (rCfg.enabled !== false && rCfg.maxRounds !== 0) {
      try {
        group.reviewerAgent = this.createReviewerAgent(group);
      } catch (err: any) {
        log.warn("[%s] Failed to restore reviewer agent: %s", groupId, err.message);
      }
    }

    this.groups.set(groupId, group);
    this.saveGroup(groupId);

    // 重新注册到 master registry
    addGroupToRegistry(this.dataRoot, {
      id: config.id,
      name: config.name,
      owner: config.owner || "host",
      members: config.members || [],
      topic: config.topic,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    // Restart scanner
    const scanner = new GroupTodoScanner(groupId, groupDir, {
      onTrigger: async (gid, todo, msg) => {
        const g = this.groups.get(gid);
        if (g) g.postMessage('TODOboard', msg);
      },
      onCompleteAction: async (gid, todo) => {
        const g = this.groups.get(gid);
        if (g && todo.onComplete?.mentionAgentId) {
          g.postMessage('system', todo.onComplete.message || `@${todo.onComplete.mentionAgentId} ${todo.title} 已完成`);
        }
      },
      onDependencyMet: async (gid, todo) => {
        const g = this.groups.get(gid);
        if (g && todo.targetAgentId) {
          g.postMessage('TODOboard', `@${todo.targetAgentId} 【依赖完成通知】上游任务已完成`);
        }
      },
    });
    scanner.start();
    this.groupScanners.set(groupId, scanner);
    log.info("Group restored: %s", groupId);
    return group;
  }

  /** 释放所有群组的 SQLite 连接（测试清理时使用） */
  disposeAll(): void {
    for (const group of this.groups.values()) {
      this.groupScanners.get(group.id)?.stop();
      group.dispose();
    }
    this.groupScanners.clear();
    this.groups.clear();
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
      status: group.config.status || 'active',
      reviewer: group.config.reviewer,
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

  /** 从 Master Registry 恢复所有群组（registry.json 为单一真相源） */
  restoreGroups(): void {
    const registry = readMasterRegistry(this.dataRoot);
    const groupEntries = Object.values(registry.groups);

    if (groupEntries.length === 0) {
      log.info("No groups in registry — skipping restore");
      return;
    }

    for (const entry of groupEntries) {
      // 跳过已归档的群组
      if (entry.status === "archived") continue;
      // 跳过幽灵群组（空成员 + 无对话历史 — registry 残留数据）
      if (entry.members.length === 0) {
        const contextFile = path.join(this.groupsDir, entry.id, "context.jsonl");
        if (!fs.existsSync(contextFile)) {
          log.warn("Skipping ghost group from registry: %s (%s)", entry.id, entry.name);
          continue;
        }
      }

      const groupDir = path.join(this.groupsDir, entry.id);

      // 确保目录和 config.json 存在（文件系统落后于 registry 时补齐）
      fs.mkdirSync(groupDir, { recursive: true });
      const configPath = path.join(groupDir, "config.json");
      if (!fs.existsSync(configPath)) {
        // 从 registry 生成 config.json
        const groupConfig: GroupConfig = {
          id: entry.id,
          name: entry.name,
          members: entry.members,
          owner: entry.owner,
          topic: entry.topic,
          status: entry.status,
        };
        fs.writeFileSync(configPath, JSON.stringify(groupConfig, null, 2) + "\n", "utf-8");
        log.info("Created config.json from registry for group: %s", entry.id);
      }

      let config: GroupConfig;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as GroupConfig;
        // registry 优先：覆盖 members 和 status
        config.members = entry.members;
        config.status = entry.status;
      } catch (err: any) {
        log.warn("Failed to parse group config %s: %s — reconstructing from registry", entry.id, err.message);
        config = {
          id: entry.id,
          name: entry.name,
          members: entry.members,
          owner: entry.owner,
          topic: entry.topic,
          status: entry.status,
        };
      }

      try {
        const group = new Group(config, this.registry, this.dataRoot);
        group.setGroupManager(this);
        if (this._onAgentResponse) {
          group.setOnAgentResponse(this._onAgentResponse);
        }
        if (this._onAgentEvent) {
          group.setOnAgentEvent(this._onAgentEvent);
        }
        if (this._onQueueChange) {
          group.setOnQueueChange(this._onQueueChange);
        }
        if (this._onMessageBroadcast) {
          group.setOnMessageBroadcast(this._onMessageBroadcast);
        }

        // 恢复 Reviewer Agent（如果启用）
        const rCfg = config.reviewer ?? { enabled: true, maxRounds: 3 };
        if (rCfg.enabled !== false && rCfg.maxRounds !== 0) {
          try {
            group.reviewerAgent = this.createReviewerAgent(group);
          } catch (err: any) {
            log.warn("[%s] Failed to restore reviewer agent: %s", entry.id, err.message);
          }
        }

        this.groups.set(config.id, group);
        group.pauseWakeSystem();

        // Restore context history into GroupContextV2（使用 appendSilent 避免触发 onMessage → @mention 入队）
        const history = this.loadContext(config.id);
        for (const msg of history) {
          group.ctxV2.appendSilent(msg.fromAgentId, msg.content, msg.tag);
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

        // Write historical messages to GroupDB (with content hash for dedup)
        function simpleHash(s: string): string {
          let h = 0;
          for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
          }
          return Math.abs(h).toString(36);
        }
        for (const msg of history) {
          const visibleTo = group.computeVisibility(msg.tag);
          group.groupDb.insertMessage(
            `restored-${msg.timestamp}-${msg.fromAgentId}-${simpleHash(msg.content).slice(0, 8)}`,
            msg.tag,
            msg.fromAgentId,
            msg.content,
            msg.timestamp,
            visibleTo,
          );
        }

        // 启动群组 TODO 扫描器
        const scanner = new GroupTodoScanner(config.id, groupDir, {
          onTrigger: async (groupId, todo, message) => {
            const g = this.groups.get(groupId);
            if (g) {
              const targetId = todo.targetAgentId;
              if (targetId) {
                g.postMessage("TODOboard", `@${targetId} ${message}`);
              } else {
                g.postMessage("TODOboard", `@all ${message}`);
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
          onDependencyMet: async (groupId, todo) => {
            const g = this.groups.get(groupId);
            if (g && todo.targetAgentId) {
              const targetId = todo.targetAgentId;
              g.postMessage("TODOboard", `@${targetId} 【依赖完成通知】你的任务 "${todo.title}" 的所有上游依赖已全部完成，可以开始执行了。`);
            }
          },
        });
        scanner.start();
        this.groupScanners.set(config.id, scanner);

        log.info("Restored group: %s (%s, %d members, %d messages)",
          config.name, config.id, config.members.length, history.length);
      } catch (err: any) {
        log.warn("Failed to restore group %s: %s", entry.id, err.message);
      }
    }
  }

  /** 恢复所有群组的 WakeSystem（在 WS server 启动后调用） */
  resumeAllWakeSystems(): void {
    for (const group of this.groups.values()) {
      group.resumeWakeSystem();
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
