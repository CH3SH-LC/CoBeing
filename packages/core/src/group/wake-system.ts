/**
 * WakeSystem — 事件驱动唤醒队列（Phase 8.3）
 *
 * 当群组上下文写入新消息时：
 * 1. 扫描 @mentions → 加入唤醒队列
 * 2. 逐个唤醒目标 Agent
 * 3. Agent 回复写回群组上下文（tag 继承来源消息的 tag）
 * 4. 检查新 mentions → 有则继续，无则休眠
 */
import type { GroupContextV2, GroupMessageV2 } from "./group-context-v2.js";
import type { Agent } from "../agent/agent.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("wake-system");

export interface WakeSystemConfig {
  /** 两次唤醒之间的等待时间（毫秒），默认 5000 */
  wakeDelayMs?: number;
}

interface WakeEntry {
  targetAgentId: string;
  triggerMsgId: string;
  triggerTag: string;
}

export class WakeSystem {
  private ctx: GroupContextV2;
  private getAgent: (id: string) => Agent | undefined;
  private config: Required<WakeSystemConfig>;
  private processing = false;
  private wakeQueue: WakeEntry[] = [];
  private processedMsgIds = new Set<string>();

  constructor(
    ctx: GroupContextV2,
    getAgent: (id: string) => Agent | undefined,
    config?: WakeSystemConfig,
  ) {
    this.ctx = ctx;
    this.getAgent = getAgent;
    this.config = {
      wakeDelayMs: config?.wakeDelayMs ?? 5000,
    };

    // 订阅新消息
    ctx.onMessage((msg) => this.handleNewMessage(msg));
  }

  /** 处理新消息 */
  private handleNewMessage(msg: GroupMessageV2): void {
    // 跳过已处理的消息
    if (this.processedMsgIds.has(msg.id)) return;

    // 扫描 mentions，加入唤醒队列
    for (const targetId of msg.mentions) {
      if (targetId === "all") continue; // "all" 由调用方处理
      const agent = this.getAgent(targetId);
      if (!agent) {
        log.debug("[%s] Mention target not found: %s", this.ctx.groupId, targetId);
        continue;
      }
      this.wakeQueue.push({
        targetAgentId: targetId,
        triggerMsgId: msg.id,
        triggerTag: msg.tag,
      });
    }

    // 处理 @all — 唤醒所有群组成员（除了发送者）
    if (msg.mentions.includes("all")) {
      // 不在这里处理 @all，由调用方决定
    }

    // 触发处理
    this.processQueue();
  }

  /** 手动触发唤醒（用户消息或 screener 建议） */
  wakeAgent(agentId: string, tag: string = "main"): void {
    const agent = this.getAgent(agentId);
    if (!agent) return;

    this.wakeQueue.push({
      targetAgentId: agentId,
      triggerMsgId: "manual",
      triggerTag: tag,
    });
    this.processQueue();
  }

  /** 处理唤醒队列 */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.wakeQueue.length > 0) {
      const entry = this.wakeQueue.shift()!;
      await this.executeWake(entry);
    }

    this.processing = false;
  }

  /** 执行单次唤醒 */
  private async executeWake(entry: WakeEntry): Promise<void> {
    const agent = this.getAgent(entry.targetAgentId);
    if (!agent) return;

    log.info("[%s] Waking agent: %s (tag: %s)", this.ctx.groupId, entry.targetAgentId, entry.triggerTag);

    try {
      // 为目标 Agent 构建过滤后的上下文
      const context = this.ctx.buildContextFor(entry.targetAgentId);

      if (!context) {
        log.debug("[%s] No context for %s, skipping", this.ctx.groupId, entry.targetAgentId);
        return;
      }

      // 调用目标 Agent
      const response = await agent.run(context);

      // 将回复写回群组上下文（tag 继承）
      const replyMsg = this.ctx.append(entry.targetAgentId, response.content, entry.triggerTag);
      this.processedMsgIds.add(replyMsg.id);

      log.info("[%s] Agent %s responded (%d chars)", this.ctx.groupId, entry.targetAgentId, response.content.length);

      // 等待
      await this.delay(this.config.wakeDelayMs);
    } catch (err) {
      log.error("[%s] Wake failed for %s: %s", this.ctx.groupId, entry.targetAgentId, err);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 获取队列状态 */
  get queueLength(): number {
    return this.wakeQueue.length;
  }

  /** 是否正在处理 */
  get isProcessing(): boolean {
    return this.processing;
  }
}
