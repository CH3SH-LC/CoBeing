/**
 * Group — 项目工作组（Phase 8.3 异步协作引擎）
 *
 * 核心变化：
 * - 使用 GroupContextV2 统一上下文 + WakeSystem 事件驱动
 * - 讨论完全事件驱动，无轮次概念
 * - 群主通过 @mention 唤起成员，或通过 Screener 主动介入
 * - Talk 机制支持私有讨论
 */
import type { GroupConfig, GroupMessage } from "@myagents/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";
import { GroupWorkspace } from "./workspace.js";
import { GroupContextV2, type GroupMessageV2 } from "./group-context-v2.js";
import { WakeSystem } from "./wake-system.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("group");

export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  readonly workspace: GroupWorkspace;
  readonly ctxV2: GroupContextV2;
  readonly wakeSystem: WakeSystem;

  private registry: AgentRegistry;
  private owner?: Agent;
  private dataRoot: string;

  constructor(config: GroupConfig, registry: AgentRegistry, dataRoot: string = "data") {
    this.id = config.id;
    this.config = config;
    this.registry = registry;
    this.dataRoot = dataRoot;

    // 创建 v2 上下文
    this.ctxV2 = new GroupContextV2(config.id);

    // 创建唤醒系统
    this.wakeSystem = new WakeSystem(
      this.ctxV2,
      (id) => this.registry.get(id),
    );

    // 创建工作空间
    const ownerName = config.owner ? this.resolveAgentName(config.owner) : "群主";
    const memberNames = config.members.map(id => this.resolveAgentName(id));
    this.workspace = new GroupWorkspace(config.id, config.name, dataRoot);
    this.workspace.initialize(memberNames, ownerName);

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

  // ---- 用户/群主入口 ----

  /**
   * 用户或群主发消息到 main 频道（触发唤醒起点）
   */
  postMessage(fromAgentId: string, content: string): GroupMessageV2 {
    return this.ctxV2.append(fromAgentId, content, "main");
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
    return this.ctxV2.append(fromAgentId, content, talkId);
  }

  /**
   * 将 talk 结论摘要发回 main
   */
  postTalkSummary(fromAgentId: string, talkId: string, summary: string): GroupMessageV2 {
    const talk = this.ctxV2.getTalk(talkId);
    const header = talk
      ? `[Talk ${talkId} 结论 (成员: ${talk.members.join(", ")}, 主题: ${talk.topic})]`
      : `[Talk ${talkId} 结论]`;
    return this.ctxV2.append(fromAgentId, `${header}\n\n${summary}`, "main");
  }

  /**
   * 手动唤醒某个 Agent（用于 Screener 触发或用户直接调用）
   */
  wakeAgent(agentId: string): void {
    this.wakeSystem.wakeAgent(agentId, "main");
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
    }
  }

  removeMember(agentId: string): void {
    this.config.members = this.config.members.filter(id => id !== agentId);
  }
}
