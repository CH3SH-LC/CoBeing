/**
 * Group — 项目工作组（Phase 8.3 异步协作引擎）
 *
 * 核心变化：
 * - 使用 GroupContextV2 统一上下文 + WakeSystem 事件驱动
 * - 讨论完全事件驱动，无轮次概念
 * - 群主通过 @mention 唤起成员，或通过 Screener 主动介入
 * - Talk 机制支持私有讨论
 */
import type { GroupConfig, GroupMessage } from "@cobeing/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { GroupWorkspace } from "./workspace.js";
import { GroupContextV2, type GroupMessageV2 } from "./group-context-v2.js";
import { ContainerPool } from "../tools/sandbox/container-pool.js";
import { WakeSystem } from "./wake-system.js";
import { CurrentMd } from "./current-md.js";
import { GroupAgentMemory } from "./agent-memory.js";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group");

export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  readonly workspace: GroupWorkspace;
  readonly ctxV2: GroupContextV2;
  readonly wakeSystem: WakeSystem;
  readonly currentMd: CurrentMd;

  private registry: AgentRegistry;
  private owner?: Agent;
  private _dataRoot: string;
  private agentMemories = new Map<string, GroupAgentMemory>();
  private maxCurrentMessages: number;
  /** Optional GroupManager reference for context persistence */
  private _groupManager?: import("./manager.js").GroupManager;

  constructor(config: GroupConfig, registry: AgentRegistry, dataRoot: string = "data") {
    this.id = config.id;
    this.config = config;
    this.registry = registry;
    this._dataRoot = dataRoot;

    // 创建 v2 上下文
    this.ctxV2 = new GroupContextV2(config.id);

    // 创建记忆系统
    const memoryDir = path.join(dataRoot, "groups", config.id, "memory");
    this.currentMd = new CurrentMd(memoryDir);
    this.maxCurrentMessages = (globalThis as any).__cobeingConfig?.core?.groupMemory?.maxCurrentMessages ?? 100;

    // 创建唤醒系统（注入记忆依赖 + 群主 ID）
    this.wakeSystem = new WakeSystem(
      this.ctxV2,
      (id) => this.registry.get(id),
      { ownerId: config.owner },
      {
        currentMd: this.currentMd,
        getAgentMemory: (agentId) => this.getAgentMemory(agentId),
        getGroupMembers: () => this.config.members,
        maxCurrentMessages: this.maxCurrentMessages,
        getGroup: () => this,
        resolveMention: (mention) => this.resolveMention(mention),
      },
    );

    // 创建工作空间
    const ownerName = config.owner ? this.resolveAgentName(config.owner) : "群主";
    const memberNames = config.members.map(id => this.resolveAgentName(id));
    this.workspace = new GroupWorkspace(config.id, config.name, dataRoot);
    this.workspace.initialize(memberNames, ownerName);

    // 为初始成员挂载群组目录
    for (const memberId of config.members) {
      this.mountGroupForAgent(memberId);
    }

    // 解析群主
    if (config.owner) {
      this.owner = this.registry.get(config.owner);
    }

    log.info("[%s] Group initialized (v2 async engine)", this.id);
  }

  private resolveAgentName(agentId: string): string {
    const agent = this.registry.get(agentId);
    return agent?.name || agentId;
  }

  /** 解析 @mention：先按 ID 匹配，再按名称匹配（不区分大小写） */
  private resolveMention(mention: string): string | undefined {
    // 1. 精确 ID 匹配
    if (this.registry.get(mention)) return mention;

    // 2. 按名称匹配（不区分大小写，支持空格转连字符）
    const normalized = mention.toLowerCase().replace(/\s+/g, "-");
    for (const agent of this.registry.list()) {
      const nameNorm = agent.name.toLowerCase().replace(/\s+/g, "-");
      if (nameNorm === normalized || agent.name.toLowerCase() === mention.toLowerCase()) {
        return agent.id;
      }
    }

    // 诊断：列出所有注册的 agent
    const allAgents = this.registry.list().map(a => `${a.name}(id=${a.id})`).join(", ");
    log.info("[%s] resolveMention('%s') failed. Registered agents: [%s]", this.id, mention, allAgents);
    return undefined;
  }

  // ---- 用户/群主入口 ----

  /**
   * 用户或群主发消息到 main 频道（触发唤醒起点）
   */
  postMessage(fromAgentId: string, content: string): GroupMessageV2 {
    const msg = this.ctxV2.append(fromAgentId, content, "main");
    this.persistMessage(msg, "main");
    return msg;
  }

  /**
   * 创建 talk 私有讨论
   */
  createTalk(members: string[], topic: string): string {
    return this.ctxV2.createTalk(members, topic);
  }

  /**
   * 向 talk 发消息
   */
  postToTalk(talkId: string, fromAgentId: string, content: string): GroupMessageV2 {
    const msg = this.ctxV2.append(fromAgentId, content, talkId);
    this.persistMessage(msg, talkId);
    return msg;
  }

  /**
   * 将 talk 结论摘要发回 main
   */
  postTalkSummary(fromAgentId: string, talkId: string, summary: string): GroupMessageV2 {
    const talk = this.ctxV2.getTalk(talkId);
    const header = talk
      ? `[Talk ${talkId} 结论 (成员: ${talk.members.join(", ")}, 主题: ${talk.topic})]`
      : `[Talk ${talkId} 结论]`;
    const msg = this.ctxV2.append(fromAgentId, `${header}\n\n${summary}`, "main");
    this.persistMessage(msg, "main");
    return msg;
  }

  /**
   * 手动唤醒某个 Agent（用于 Screener 触发或用户直接调用）
   */
  wakeAgent(agentId: string): void {
    this.wakeSystem.wakeAgent(agentId, "main");
  }

  /** 注入本地过滤引擎到 WakeSystem */
  setLocalFilter(filter: import("./local-filter.js").LocalFilterEngine): void {
    this.wakeSystem.setLocalFilter(filter);
  }

  /** 注入 Agent 响应回调到 WakeSystem（用于广播到前端） */
  setOnAgentResponse(cb: (groupId: string, agentId: string, content: string, tag: string) => void): void {
    this.wakeSystem.setOnAgentResponse(cb);
  }

  // ---- 兼容旧 API ----

  /**
   * @deprecated 使用 postMessage + wakeSystem 替代
   */
  async summonMember(agentId: string, message: string): Promise<GroupMessage> {
    // 发送 @mention 消息
    this.ctxV2.append("user", `@${agentId} ${message}`, "main");

    // WakeSystem 会自动处理

    return {
      groupId: this.id,
      fromAgentId: agentId,
      content: "(异步处理中)",
      timestamp: Date.now(),
    };
  }

  /**
   * @deprecated 使用 postMessage 替代
   */
  async startDiscussion(topic: string, _participants?: string[]): Promise<GroupMessage[]> {
    // 群主发消息启动讨论
    const members = this.config.members.map(id => {
      const agent = this.registry.get(id);
      return agent ? `@${id}` : id;
    }).join(" ");

    this.ctxV2.append(
      this.config.owner ?? "user",
      `# 讨论: ${topic}\n\n${members} 请就以上主题发表观点。`,
      "main",
    );

    return [];
  }

  // ---- 状态 ----

  updateTask(newTask: string): void {
    this.workspace.updateTask(newTask);
  }

  updatePlan(newPlan: string): void {
    this.workspace.updatePlan(newPlan);
  }

  recordProgress(agentName: string, update: string): void {
    this.workspace.appendProgress(agentName, update);
  }

  getStatus(): {
    id: string;
    name: string;
    members: number;
    workspace: ReturnType<GroupWorkspace["getSummary"]>;
    messageCount: number;
    queueLength: number;
  } {
    return {
      id: this.id,
      name: this.config.name,
      members: this.config.members.length,
      workspace: this.workspace.getSummary(),
      messageCount: this.ctxV2.messageCount,
      queueLength: this.wakeSystem.queueLength,
    };
  }

  getHistory(): GroupMessage[] {
    // 转换 v2 消息为旧格式
    return this.ctxV2.getMessages().map(msg => ({
      groupId: this.id,
      fromAgentId: msg.fromAgentId,
      content: msg.content,
      timestamp: msg.timestamp,
    }));
  }

  injectMessage(fromAgentId: string, content: string): void {
    this.ctxV2.append(fromAgentId, content, "main");
  }

  getOwner(): Agent | undefined {
    return this.owner;
  }

  addMember(agentId: string): void {
    if (!this.config.members.includes(agentId)) {
      this.config.members.push(agentId);

      // 挂载群组 workspace 到 agent 的沙箱
      this.mountGroupForAgent(agentId);

      // 硬编码激发 BOOTSTRAP：在群组上下文中注入 BOOTSTRAP 内容
      const agentPaths = AgentPaths.forAgent(agentId, this._dataRoot);
      const agentFiles = new AgentFiles(agentPaths);
      const bootstrap = agentFiles.readBootstrap();
      if (bootstrap) {
        const agent = this.registry.get(agentId);
        const agentName = agent?.name || agentId;
        this.ctxV2.append(
          "system",
          `[BOOTSTRAP 注入 — ${agentName}]\n\n${bootstrap}`,
          "main",
        );
        log.info("[%s] BOOTSTRAP injected for %s in group context", this.id, agentId);
      }
    }
  }

  removeMember(agentId: string): void {
    this.unmountGroupForAgent(agentId);
    this.config.members = this.config.members.filter(id => id !== agentId);
  }

  /** 将群组 workspace 挂载到 agent 的沙箱容器 */
  private async mountGroupForAgent(agentId: string): Promise<void> {
    try {
      // Docker 不可用时跳过挂载
      const dockerOk = await ContainerPool.checkDockerAvailable();
      if (!dockerOk) return;

      const agent = this.registry.get(agentId);
      const sandboxRunner = (agent as any)?.sandboxRunner;
      if (sandboxRunner) {
        const groupDir = path.join(this._dataRoot, "groups", this.id);
        await sandboxRunner.addMount(groupDir, `/workspace/groups/${this.id}`);
        log.info("[%s] Mounted group dir for agent %s", this.id, agentId);
      }
    } catch (err: any) {
      log.warn("[%s] Failed to mount group for agent %s: %s", this.id, agentId, err.message);
    }
  }

  /** 从 agent 的沙箱容器卸载群组 workspace */
  private async unmountGroupForAgent(agentId: string): Promise<void> {
    try {
      // Docker 不可用时跳过卸载
      const dockerOk = await ContainerPool.checkDockerAvailable();
      if (!dockerOk) return;

      const agent = this.registry.get(agentId);
      const sandboxRunner = (agent as any)?.sandboxRunner;
      if (sandboxRunner) {
        await sandboxRunner.removeMount(`/workspace/groups/${this.id}`);
        log.info("[%s] Unmounted group dir for agent %s", this.id, agentId);
      }
    } catch (err: any) {
      log.warn("[%s] Failed to unmount group for agent %s: %s", this.id, agentId, err.message);
    }
  }

  /** 获取或创建 Agent 在本群组的 SQLite 记忆 */
  getAgentMemory(agentId: string): GroupAgentMemory {
    let mem = this.agentMemories.get(agentId);
    if (!mem) {
      const memoryDir = path.join(this._dataRoot, "groups", this.id, "memory");
      mem = new GroupAgentMemory(agentId, memoryDir);
      this.agentMemories.set(agentId, mem);
    }
    return mem;
  }

  /** 获取所有成员的画像摘要（姓名 + JOB + SOUL） */
  getMemberProfiles(): import("../conversation/prompt-builder.js").MemberProfile[] {
    const profiles: import("../conversation/prompt-builder.js").MemberProfile[] = [];
    for (const memberId of this.config.members) {
      const agent = this.registry.get(memberId);
      const agentPaths = AgentPaths.forAgent(memberId, this._dataRoot);
      const agentFiles = new AgentFiles(agentPaths);

      // 从 CHARACTER.md 提取姓名
      const character = agentFiles.readCharacter();
      let name = agent?.name || memberId;
      if (character) {
        const nameMatch = character.match(/-\s*Name:\s*(.+)/);
        if (nameMatch) name = nameMatch[1].trim();
      }

      // 从 JOB.md 提取专注领域 + 能力
      const job = agentFiles.readJob();
      let role = "成员";
      let capabilities = "";
      if (job) {
        const roleMatch = job.match(/##\s*专注领域\s*\n+([^\n#]+)/);
        if (roleMatch) role = roleMatch[1].trim();
        const capMatch = job.match(/##\s*(?:核心能力|技能|擅长|能力)\s*\n+([\s\S]*?)(?=\n##|$)/);
        if (capMatch) capabilities = capMatch[1].trim().slice(0, 200);
      }

      // 从 SOUL.md 提取性格摘要
      const soul = agentFiles.readSoul();
      let personality = "";
      if (soul) {
        // 取前 200 字符作为性格摘要
        personality = soul.replace(/^#[^\n]*\n*/gm, "").trim().slice(0, 200);
      }

      profiles.push({ id: memberId, name, role, capabilities: capabilities || undefined, personality: personality || undefined });
    }
    return profiles;
  }

  /** Set GroupManager reference for context persistence */
  setGroupManager(mgr: import("./manager.js").GroupManager): void {
    this._groupManager = mgr;
  }

  /** Persist a message to context.jsonl */
  private persistMessage(msg: GroupMessageV2, tag: string): void {
    if (!this._groupManager) return;
    this._groupManager.appendContextMessage(this.id, {
      fromAgentId: msg.fromAgentId,
      content: msg.content,
      tag,
      timestamp: msg.timestamp,
    });
  }
}
