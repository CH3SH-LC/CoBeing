/**
 * GroupContext — 管理 main 频道 + talk 私有讨论频道
 *
 * Session Key 格式:
 *   main                          — Agent 自己的主窗口
 *   group:{groupId}:main          — 群组公共频道
 *   group:{groupId}:talk:{talkId} — 群组内私有讨论
 */
import fs from "node:fs";
import path from "node:path";
import type { AgentEventBus } from "../agent/event-bus.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-context");

export interface ChannelMessage {
  fromAgentId: string;
  content: string;
  timestamp: number;
  mentionTarget?: string; // @react-expert / @all
}

export interface TalkConfig {
  id: string;
  groupId: string;
  members: string[];
  topic: string;
  createdAt: number;
}

export class Talk {
  readonly id: string;
  readonly groupId: string;
  readonly members: string[];
  readonly topic: string;
  readonly createdAt: number;
  private history: ChannelMessage[] = [];

  constructor(config: TalkConfig) {
    this.id = config.id;
    this.groupId = config.groupId;
    this.members = config.members;
    this.topic = config.topic;
    this.createdAt = config.createdAt;
  }

  /** 发言（仅参与者） */
  speak(fromAgentId: string, content: string): ChannelMessage {
    const msg: ChannelMessage = {
      fromAgentId,
      content,
      timestamp: Date.now(),
    };
    this.history.push(msg);
    return msg;
  }

  /** 读取历史 */
  getHistory(): ChannelMessage[] {
    return [...this.history];
  }

  /** 是否是参与者 */
  isMember(agentId: string): boolean {
    return this.members.includes(agentId);
  }
}

export class GroupContext {
  readonly groupId: string;
  private mainHistory: ChannelMessage[] = [];
  private mainListeners: ((msg: ChannelMessage) => void)[] = [];
  private talks = new Map<string, Talk>();
  private dataDir: string;
  private talkCounter = 0;

  constructor(groupId: string, dataRoot?: string, private eventBus?: AgentEventBus) {
    this.groupId = groupId;
    this.dataDir = dataRoot
      ? path.join(dataRoot, "groups", groupId)
      : path.resolve("data", "groups", groupId);
    fs.mkdirSync(path.join(this.dataDir, "talks"), { recursive: true });
  }

  // ---- Main 频道 ----

  /** 在 main 频道发言 */
  speakToMain(fromAgentId: string, content: string): ChannelMessage {
    // 解析 @mention
    const mentionMatch = content.match(/@(\S+)/);
    const msg: ChannelMessage = {
      fromAgentId,
      content,
      timestamp: Date.now(),
      mentionTarget: mentionMatch ? mentionMatch[1] : undefined,
    };
    this.mainHistory.push(msg);
    for (const listener of this.mainListeners) listener(msg);

    // 事件总线通知（自发通信核心）
    if (this.eventBus && msg.mentionTarget) {
      this.eventBus.emit("group-message", {
        groupId: this.groupId,
        fromAgentId,
        content,
        mentionTarget: msg.mentionTarget,
      });
    }

    return msg;
  }

  /** 订阅 main 频道新消息 */
  onMainMessage(listener: (msg: ChannelMessage) => void): void {
    this.mainListeners.push(listener);
  }

  /** 读取 main 频道历史 */
  getMainHistory(): ChannelMessage[] {
    return [...this.mainHistory];
  }

  /** 检查消息是否提及某 Agent */
  isMentioned(msg: ChannelMessage, agentId: string): boolean {
    if (msg.mentionTarget === "all") return true;
    if (msg.mentionTarget === agentId) return true;
    return false;
  }

  /** 获取需要响应的消息（@mention 或 @all） */
  getPendingMentions(agentId: string, sinceIndex?: number): ChannelMessage[] {
    const start = sinceIndex ?? 0;
    return this.mainHistory.slice(start).filter(
      msg => msg.fromAgentId !== agentId && this.isMentioned(msg, agentId),
    );
  }

  // ---- Talk 频道 ----

  /** 创建私有讨论 */
  createTalk(members: string[], topic: string): Talk {
    this.talkCounter++;
    const talkId = `talk-${this.talkCounter.toString().padStart(3, "0")}`;
    const talk = new Talk({
      id: talkId,
      groupId: this.groupId,
      members,
      topic,
      createdAt: Date.now(),
    });
    this.talks.set(talkId, talk);
    log.info("[%s] Talk created: %s (members: %s, topic: %s)", this.groupId, talkId, members.join(","), topic);
    return talk;
  }

  /** 获取 talk */
  getTalk(talkId: string): Talk | undefined {
    return this.talks.get(talkId);
  }

  /** 列出所有 talk */
  listTalks(): Talk[] {
    return [...this.talks.values()];
  }

  // ---- 持久化 ----

  /** 保存 main 频道到文件 */
  saveMain(): void {
    const filePath = path.join(this.dataDir, "main.md");
    const lines = [`# ${this.groupId} — Main Channel\n`];
    for (const msg of this.mainHistory) {
      const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      lines.push(`[${time}] **${msg.fromAgentId}**: ${msg.content}\n`);
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  }

  /** 保存 talk 到文件 */
  saveTalk(talkId: string): void {
    const talk = this.talks.get(talkId);
    if (!talk) return;
    const filePath = path.join(this.dataDir, "talks", `${talkId}.md`);
    const lines = [`# Talk: ${talk.topic}\n`, `Members: ${talk.members.join(", ")}\n`];
    for (const msg of talk.getHistory()) {
      const time = new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      lines.push(`[${time}] **${msg.fromAgentId}**: ${msg.content}\n`);
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  }

  /** 保存群组配置 */
  saveConfig(members: string[]): void {
    const config = {
      id: this.groupId,
      members,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(this.dataDir, "config.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }
}
