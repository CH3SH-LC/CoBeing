/**
 * GroupContextV2 — 统一上下文窗口（Phase 8.3）
 *
 * 整个群组共用一个 GroupMessageV2[] 数组。
 * 每条消息有一个 tag 标识：main 或 talk-xxx。
 * 为 Agent 构建上下文时，按 tag 过滤：Agent 只看到 main + 自己参与的 talk。
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("group-context-v2");

export interface GroupMessageV2 {
  id: string;
  tag: "main" | string;      // "main" 或 "talk-001", "talk-002" ...
  fromAgentId: string;
  content: string;
  timestamp: number;
  mentions: string[];         // 解析出的 @mention 目标列表
}

export interface TalkInfo {
  id: string;                 // "talk-001"
  members: string[];
  topic: string;
  createdAt: number;
}

let msgCounter = 0;

function nextMsgId(): string {
  return `msg-${(++msgCounter).toString().padStart(4, "0")}`;
}

/** 解析文本中的所有 @mention（支持中文，排除 Markdown 标记） */
function parseMentions(content: string): string[] {
  const regex = /@([\w一-鿿][\w一-鿿-]*)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const id = match[1];
    if (id && id !== "all") mentions.push(id);
  }
  // "all" 单独检查
  if (/@all\b/.test(content)) mentions.push("all");
  return [...new Set(mentions)];
}

export class GroupContextV2 {
  readonly groupId: string;
  private messages: GroupMessageV2[] = [];
  private talks = new Map<string, TalkInfo>();
  private talkCounter = 0;
  /** 消息写入后的回调（WakeSystem 使用） */
  private onMessageCallbacks: Array<(msg: GroupMessageV2) => void> = [];

  constructor(groupId: string) {
    this.groupId = groupId;
  }

  // ---- Main 频道 ----

  /** 在 main 频道追加消息 */
  append(fromAgentId: string, content: string, tag: string = "main"): GroupMessageV2 {
    const mentions = parseMentions(content);
    const msg: GroupMessageV2 = {
      id: nextMsgId(),
      tag,
      fromAgentId,
      content,
      timestamp: Date.now(),
      mentions,
    };
    this.messages.push(msg);

    // 通知回调
    for (const cb of this.onMessageCallbacks) {
      cb(msg);
    }

    return msg;
  }

  /** 订阅新消息回调 */
  onMessage(callback: (msg: GroupMessageV2) => void): void {
    this.onMessageCallbacks.push(callback);
  }

  /** 追加消息但不触发回调（用于外部写入响应，避免重复唤醒） */
  appendSilent(fromAgentId: string, content: string, tag: string = "main"): GroupMessageV2 {
    const mentions = parseMentions(content);
    const msg: GroupMessageV2 = {
      id: nextMsgId(),
      tag,
      fromAgentId,
      content,
      timestamp: Date.now(),
      mentions,
    };
    this.messages.push(msg);
    return msg;
  }

  // ---- Talk 机制 ----

  /** 创建 talk，返回 talk ID */
  createTalk(members: string[], topic: string): string {
    this.talkCounter++;
    const talkId = `talk-${this.talkCounter.toString().padStart(3, "0")}`;
    this.talks.set(talkId, {
      id: talkId,
      members,
      topic,
      createdAt: Date.now(),
    });
    log.info("[%s] Talk created: %s (members: %s, topic: %s)",
      this.groupId, talkId, members.join(","), topic);
    return talkId;
  }

  /** 获取 talk 信息 */
  getTalk(talkId: string): TalkInfo | undefined {
    return this.talks.get(talkId);
  }

  /** 列出所有 talk */
  listTalks(): TalkInfo[] {
    return [...this.talks.values()];
  }

  /** Agent 是否参与某个 talk */
  isTalkMember(talkId: string, agentId: string): boolean {
    const talk = this.talks.get(talkId);
    return talk ? talk.members.includes(agentId) : false;
  }

  /** 获取 Agent 参与的所有 talk ID */
  getAgentTalks(agentId: string): string[] {
    const result: string[] = [];
    for (const [id, talk] of this.talks) {
      if (talk.members.includes(agentId)) {
        result.push(id);
      }
    }
    return result;
  }

  // ---- 上下文构建 ----

  /**
   * 为指定 Agent 构建过滤后的上下文
   * 规则：
   *   - main 消息：全部可见
   *   - talk 消息：只有参与者可见
   *   - talk 消息前缀标注 [Talk: talk-001 成员: A, B]
   */
  buildContextFor(agentId: string, sinceIndex: number = 0): string {
    const agentTalks = new Set(this.getAgentTalks(agentId));
    const relevant = this.messages.slice(sinceIndex).filter(msg => {
      if (msg.tag === "main") return true;
      return agentTalks.has(msg.tag);
    });

    if (relevant.length === 0) return "";

    return relevant.map(msg => {
      const speaker = msg.fromAgentId;
      if (msg.tag === "main") {
        return `[${speaker}]: ${msg.content}`;
      }
      const talk = this.talks.get(msg.tag);
      const memberStr = talk ? talk.members.join(", ") : "?";
      return `[Talk: ${msg.tag} 成员: ${memberStr}] [${speaker}]: ${msg.content}`;
    }).join("\n\n");
  }

  /** 获取所有消息（原始） */
  getMessages(sinceIndex?: number): GroupMessageV2[] {
    return sinceIndex !== undefined
      ? this.messages.slice(sinceIndex)
      : [...this.messages];
  }

  /** 消息总数 */
  get messageCount(): number {
    return this.messages.length;
  }

  /** 获取未处理的 @mention 目标（指定 Agent 的） */
  getPendingMentions(agentId: string, sinceIndex: number = 0): GroupMessageV2[] {
    return this.messages.slice(sinceIndex).filter(msg =>
      msg.fromAgentId !== agentId &&
      (msg.mentions.includes(agentId) || msg.mentions.includes("all")),
    );
  }

  /** 获取最后一条消息的索引 */
  get lastIndex(): number {
    return this.messages.length;
  }

  /** 获取指定 Agent 可见的消息（main + 参与的 talk），用于 per-agent SQLite 同步 */
  getVisibleMessages(agentId: string, sinceIndex: number = 0): GroupMessageV2[] {
    const agentTalks = new Set(this.getAgentTalks(agentId));
    return this.messages.slice(sinceIndex).filter(msg => {
      if (msg.tag === "main") return true;
      return agentTalks.has(msg.tag);
    });
  }
}
