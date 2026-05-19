/**
 * WakeSystem — 事件驱动唤醒队列（Phase 8.3 + 群组记忆系统）
 *
 * 当群组上下文写入新消息时：
 * 1. 扫描 @mentions → 加入唤醒队列
 * 2. 同步到 current.md
 * 3. 逐个唤醒目标 Agent（先滚动 current.md + 同步 SQLite）
 * 4. Agent 回复写回群组上下文 + current.md + 所有可见 Agent 的 SQLite
 */
import type { GroupContextV2, GroupMessageV2 } from "./group-context-v2.js";
import type { Agent } from "../agent/agent.js";
import type { CurrentMd } from "./current-md.js";
import type { GroupAgentMemory } from "./agent-memory.js";
import path from "node:path";
import { createLogger } from "@cobeing/shared";

const log = createLogger("wake-system");

export interface WakeSystemConfig {
  /** 两次唤醒之间的等待时间（毫秒），默认 5000 */
  wakeDelayMs?: number;
  /** 群主 agent ID（用于本地过滤层） */
  ownerId?: string;
  /** Agent 响应回调（用于广播到前端） */
  onAgentResponse?: (groupId: string, agentId: string, content: string, tag: string) => void;
  /** Agent 事件广播回调（agent_started / agent_completed / agent_error） */
  onAgentEvent?: (event: { type: "agent_started" | "agent_completed" | "agent_error"; agentId: string; agentName: string; groupId: string; mentions?: Array<{ text: string; channel: string }>; error?: string }) => void;
  /** 唤醒队列变更回调（含排队中和正在处理中的 Agent） */
  onQueueChange?: (groupId: string, queueData: { queue: Array<{ targetAgentId: string; triggerMsgId: string; triggerTag: string; triggerContents: string[] }>; processing: string | null; processingAgents: string[] }) => void;
}

interface WakeEntry {
  targetAgentId: string;
  triggerMsgId: string;
  triggerTag: string;
  /** 触发消息的内容列表（同一个 Agent 被 @多次时合并） */
  triggerContents: string[];
  /** 触发该 Agent 的 @mention 文本列表（用于前端显示，按 agent ID 去重） */
  triggerMentions: string[];
}

export class WakeSystem {
  private ctx: GroupContextV2;
  private getAgent: (id: string) => Agent | undefined;
  private resolveMention: (mention: string) => string | undefined;
  private config: { wakeDelayMs: number };
  private currentMd: CurrentMd | null;
  private getAgentMemory: ((agentId: string) => GroupAgentMemory | null) | null;
  private getGroupMembers: (() => string[]) | null;
  private maxCurrentMessages: number;
  private _paused = false;
  private wakeQueue: WakeEntry[] = [];
  private processedMsgIds = new Set<string>();
  private ownerId?: string;
  private localFilter?: import("./local-filter.js").LocalFilterEngine;
  /** 最近一次过滤结果的上下文（注入给群主） */
  private lastFilterContext?: string;
  private onAgentResponse?: (groupId: string, agentId: string, content: string, tag: string) => void;
  private onAgentEvent?: WakeSystemConfig["onAgentEvent"];
  private onQueueChange?: WakeSystemConfig["onQueueChange"];
  /** 当前正在处理（正在回答）的 Agent ID 集合（支持并发） */
  private _processingAgents = new Set<string>();
  /** 定时唤醒计时器（每 wakeDelayMs 触发 1 个 Agent） */
  private _wakeTimer: ReturnType<typeof setInterval> | null = null;

  private getGroup: (() => import("./group.js").Group | undefined) | null;

  constructor(
    ctx: GroupContextV2,
    getAgent: (id: string) => Agent | undefined,
    config?: WakeSystemConfig,
    deps?: {
      currentMd?: CurrentMd;
      getAgentMemory?: (agentId: string) => GroupAgentMemory | null;
      getGroupMembers?: () => string[];
      maxCurrentMessages?: number;
      getGroup?: () => import("./group.js").Group | undefined;
      resolveMention?: (mention: string) => string | undefined;
    },
  ) {
    this.ctx = ctx;
    this.getAgent = getAgent;
    this.resolveMention = deps?.resolveMention ?? ((m) => getAgent(m) ? m : undefined);
    this.config = {
      wakeDelayMs: config?.wakeDelayMs ?? 10000,
    };
    this.ownerId = config?.ownerId;
    this.onAgentResponse = config?.onAgentResponse;
    this.onAgentEvent = config?.onAgentEvent;
    this.currentMd = deps?.currentMd ?? null;
    this.getAgentMemory = deps?.getAgentMemory ?? null;
    this.getGroupMembers = deps?.getGroupMembers ?? null;
    this.maxCurrentMessages = deps?.maxCurrentMessages ?? 200;
    this.getGroup = deps?.getGroup ?? null;

    // 订阅新消息
    ctx.onMessage((msg) => this.handleNewMessage(msg));
  }

  /** 处理新消息 */
  private handleNewMessage(msg: GroupMessageV2): void {
    // 跳过已处理的消息
    if (this.processedMsgIds.has(msg.id)) return;

    // 同步到 current.md
    if (this.currentMd) {
      this.currentMd.append({
        id: msg.id,
        tag: msg.tag,
        fromAgentId: msg.fromAgentId,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }

    // 处理 @all — 唤醒所有群组成员（除了发送者）
    if (msg.mentions.includes("all") && this.getGroupMembers) {
      const members = this.getGroupMembers();
      for (const memberId of members) {
        if (memberId === msg.fromAgentId) continue; // 不唤醒发送者自己
        this.enqueueMention(memberId, msg.id, msg.tag, msg.content);
      }
    }

    // 扫描其他 mentions，加入唤醒队列（支持 ID 和名称两种方式）
    for (const mention of msg.mentions) {
      if (mention === "all") continue; // @all 已在上面处理
      // 过滤掉明显不是 agent 名称的短字符串（如 "到了"、"你" 等误匹配）
      if (mention.length < 2) continue;
      const resolvedId = this.resolveMention(mention);
      if (!resolvedId) {
        log.debug("[%s] Mention '%s' — resolveMention failed (no agent with this ID or name)", this.ctx.groupId, mention);
        continue;
      }
      if (resolvedId === msg.fromAgentId) continue; // 不唤醒发送者自己
      this.enqueueMention(resolvedId, msg.id, msg.tag, msg.content, `@${mention}`);
    }

    // 本地过滤：判断是否唤醒群主
    if (this.localFilter?.isEnabled() && this.ownerId && msg.fromAgentId !== this.ownerId) {
      this.evaluateForOwner(msg).catch(err =>
        log.warn("[%s] Owner filter evaluation failed: %s", this.ctx.groupId, err.message),
      );
    }

    // 触发处理
    this.processQueue();
  }

  /**
   * 将 @mention 加入唤醒队列
   * 如果该 Agent 已在队列中，合并触发内容（不重复唤醒）
   */
  private enqueueMention(targetAgentId: string, triggerMsgId: string, triggerTag: string, triggerContent: string, mentionText?: string): void {
    const agent = this.getAgent(targetAgentId);
    if (!agent) {
      log.info("[%s] enqueueMention: agent '%s' not found", this.ctx.groupId, targetAgentId);
      return;
    }

    // 检查队列中是否已有该 Agent
    const existing = this.wakeQueue.find(e => e.targetAgentId === targetAgentId);
    if (existing) {
      // 已在队列中，合并触发内容（防止任务丢失）
      existing.triggerContents.push(triggerContent);
      if (mentionText) {
        const mentionKey = `@${targetAgentId}`;
        if (!existing.triggerMentions.includes(mentionKey)) {
          existing.triggerMentions.push(mentionKey);
        }
      }
      log.info("[%s] Agent '%s' already in queue, merging content (%d triggers)", this.ctx.groupId, targetAgentId, existing.triggerContents.length);
      this._broadcastQueue();
      return;
    }

    // 检查是否正在处理中（防止并发 run() 清空 history）
    if (this._processingAgents.has(targetAgentId)) {
      log.info("[%s] Agent '%s' is currently processing, skipping re-enqueue", this.ctx.groupId, targetAgentId);
      return;
    }

    // 新增到队列
    log.info("[%s] Enqueue mention: %s (trigger: %s)", this.ctx.groupId, targetAgentId, triggerMsgId);
    this.wakeQueue.push({
      targetAgentId,
      triggerMsgId,
      triggerTag,
      triggerContents: [triggerContent],
      triggerMentions: mentionText ? [`@${targetAgentId}`] : [],
    });
    this._broadcastQueue();
  }

  /** 手动触发唤醒（用户消息或 screener 建议） */
  wakeAgent(agentId: string, tag: string = "main", triggerContent?: string): void {
    const agent = this.getAgent(agentId);
    if (!agent) return;

    // 防并发：已在处理中或已在队列中则跳过
    if (this._processingAgents.has(agentId)) {
      log.info("[%s] wakeAgent: %s already processing, skipping", this.ctx.groupId, agentId);
      return;
    }
    if (this.wakeQueue.some(e => e.targetAgentId === agentId)) {
      log.info("[%s] wakeAgent: %s already in queue, skipping", this.ctx.groupId, agentId);
      return;
    }

    this.wakeQueue.push({
      targetAgentId: agentId,
      triggerMsgId: "manual",
      triggerTag: tag,
      triggerContents: triggerContent ? [triggerContent] : [],
      triggerMentions: [],
    });
    this._broadcastQueue();
    this.processQueue();
  }

  /** 注入本地过滤引擎 */
  setLocalFilter(filter: import("./local-filter.js").LocalFilterEngine): void {
    this.localFilter = filter;
  }

  /** 注入 Agent 响应回调 */
  setOnAgentResponse(cb: (groupId: string, agentId: string, content: string, tag: string) => void): void {
    this.onAgentResponse = cb;
  }

  /** 注入 Agent 事件广播回调 */
  setOnAgentEvent(cb: WakeSystemConfig["onAgentEvent"]): void {
    this.onAgentEvent = cb;
  }

  /** 注入唤醒队列变更回调 */
  setOnQueueChange(cb: WakeSystemConfig["onQueueChange"]): void {
    this.onQueueChange = cb;
  }

  /** 获取当前唤醒队列的快照（含正在处理中的 Agent） */
  getQueue(): { queue: Array<{ targetAgentId: string; triggerMsgId: string; triggerTag: string; triggerContents: string[] }>; processing: string | null; processingAgents: string[] } {
    return {
      queue: this.wakeQueue.map(e => ({
        targetAgentId: e.targetAgentId,
        triggerMsgId: e.triggerMsgId,
        triggerTag: e.triggerTag,
        triggerContents: [...e.triggerContents],
      })),
      processing: this._processingAgents.size > 0 ? [...this._processingAgents][0] : null,
      processingAgents: [...this._processingAgents],
    };
  }

  /** 暂停唤醒处理（restoreGroups 期间使用，避免恢复历史消息时触发 LLM 调用） */
  pause(): void {
    this._paused = true;
    if (this._wakeTimer) {
      clearInterval(this._wakeTimer);
      this._wakeTimer = null;
    }
  }

  /** 恢复唤醒处理 */
  resume(): void {
    this._paused = false;
    // 不清空队列，以防暂停期间有合法的新 mention 入队
    if (this.wakeQueue.length > 0) {
      this._ensureTimer();
    }
  }

  /** 清空唤醒队列（用于 restoreGroups 场景，丢弃恢复历史时误入的 @mention） */
  clearQueue(): void {
    if (this.wakeQueue.length > 0) {
      log.info("[%s] Clearing wake queue (%d entries)", this.ctx.groupId, this.wakeQueue.length);
      this.wakeQueue = [];
      this._broadcastQueue();
    }
  }

  /** 异步评估是否唤醒群主 */
  private async evaluateForOwner(msg: GroupMessageV2): Promise<void> {
    if (!this.localFilter || !this.ownerId) return;

    const recent = this.ctx.getMessages().slice(-20);
    const customPrompt = this.getGroup?.()?.screenerPrompt ?? undefined;
    const result = await this.localFilter.evaluate(this.ctx.groupId, recent, customPrompt);

    if (result.shouldWake) {
      log.info("[%s] Filter recommends waking owner: %s (priority: %s)",
        this.ctx.groupId, result.reason, result.priority);

      const filterContext = `[本地过滤层建议唤醒群主]
原因: ${result.reason}
优先级: ${result.priority}${result.summary ? `\n摘要: ${result.summary}` : ""}`;

      this.wakeQueue.push({
        targetAgentId: this.ownerId,
        triggerMsgId: msg.id,
        triggerTag: msg.tag,
        triggerContents: [msg.content],
        triggerMentions: [],
      });
      this._broadcastQueue();
      this.lastFilterContext = filterContext;
      this._ensureTimer();
    }
  }

  /** 广播当前队列状态 */
  private _broadcastQueue(): void {
    if (this.onQueueChange) {
      this.onQueueChange(this.ctx.groupId, this.getQueue());
    }
  }

  /** 确保定时器在运行（队列有项时自动启动） */
  private _ensureTimer(): void {
    if (this._wakeTimer) return;
    if (this._paused) return;
    this._wakeTimer = setInterval(() => {
      this._tickQueue();
    }, this.config.wakeDelayMs);
    log.info("[%s] Wake timer started (interval: %dms)", this.ctx.groupId, this.config.wakeDelayMs);
  }

  /** 队列为空时停止定时器 */
  private _stopTimerIfIdle(): void {
    if (this.wakeQueue.length === 0 && this._wakeTimer) {
      clearInterval(this._wakeTimer);
      this._wakeTimer = null;
      log.info("[%s] Wake timer stopped (queue empty)", this.ctx.groupId);
    }
  }

  /** 定时触发：每次从队列取 1 个 Agent 唤醒（不等待上一个完成，每 tick 触发 1 个） */
  private _tickQueue(): void {
    if (this._paused) return;
    if (this.wakeQueue.length === 0) {
      this._stopTimerIfIdle();
      return;
    }

    // 跳过正在处理中的 Agent（防止并发 run() 导致 history 被 clearHistory 截断）
    let entry = this.wakeQueue.shift()!;
    let skipped = 0;
    while (this._processingAgents.has(entry.targetAgentId) && skipped < this.wakeQueue.length + 1) {
      log.info("[%s] Tick: skipping %s (already processing)", this.ctx.groupId, entry.targetAgentId);
      this.wakeQueue.push(entry); // 放回队尾
      entry = this.wakeQueue.shift()!;
      skipped++;
    }
    if (this._processingAgents.has(entry.targetAgentId)) {
      // 所有排队 Agent 都在处理中，全部放回
      this.wakeQueue.push(entry);
      log.info("[%s] Tick: all queued agents are processing, waiting", this.ctx.groupId);
      return;
    }

    log.info("[%s] Tick: waking %s (%d remaining in queue)", this.ctx.groupId, entry.targetAgentId, this.wakeQueue.length);
    this._broadcastQueue();

    // Fire and forget — don't wait for completion, next tick handles next agent
    this.executeWake(entry).catch(err => {
      log.error("[%s] Wake error for %s: %s", this.ctx.groupId, entry.targetAgentId, (err as any)?.message || String(err));
    }).finally(() => {
      if (this.wakeQueue.length === 0) {
        this._stopTimerIfIdle();
      }
    });
  }

  /** 处理唤醒队列（兼容旧调用：enqueue 后启动定时器） */
  private processQueue(): void {
    if (this._paused) return;
    if (this.wakeQueue.length === 0) return;
    this._ensureTimer();
  }

  /** 执行单次唤醒 */
  private async executeWake(entry: WakeEntry): Promise<void> {
    const agent = this.getAgent(entry.targetAgentId);
    if (!agent) return;

    log.info("[%s] Waking agent: %s (tag: %s, %d trigger contents)", this.ctx.groupId, entry.targetAgentId, entry.triggerTag, entry.triggerContents.length);

    try {
      // 1. 滚动 current.md
      if (this.currentMd) {
        this.currentMd.roll(this.maxCurrentMessages);
      }

      // 2. 同步消息到目标 Agent 的 SQLite
      if (this.getAgentMemory) {
        const memory = this.getAgentMemory(entry.targetAgentId);
        if (memory) {
          const visible = this.ctx.getVisibleMessages(entry.targetAgentId);
          memory.syncMessages(visible.map(m => ({
            msgId: m.id,
            tag: m.tag,
            fromAgentId: m.fromAgentId,
            content: m.content,
            timestamp: m.timestamp,
          })));
        }
      }

      // 标记 Agent 为处理中
      this.ctx.setAgentStatus(entry.targetAgentId, "processing");

      // 3. Build three-layer context
      // Layer 1: Abstract (group workspace files)
      let abstractContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
          // 重新获取最新数据，确保上下文不过期
          const members = group.getMemberProfiles();
          const workspace = group.workspace.getSummary();
          const experienceSummary = group.workspace.readExperienceSummary();
          const activeStatuses = group.getActiveStatuses();

          let todos: import("../conversation/prompt-builder.js").GroupTodoSummary[] = [];
          const groupManager = (globalThis as any).__cobeingGroupManager;
          if (groupManager) {
            const scanner = groupManager.getScanner?.(this.ctx.groupId);
            if (scanner) {
              const store = scanner.getStore();
              const pendingTodos = store.list("pending");
              todos = pendingTodos.map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                assignee: t.targetAgentId,
              }));
            }
          }

          abstractContext = buildGroupCollaborationContext(
            entry.targetAgentId,
            members,
            {
              task: workspace.task,
              plan: workspace.plan,
              progress: workspace.progress,
              experienceSummary,
              interface: workspace.interface,
            },
            todos,
            this.ownerId,
            this.ctx.groupId,
            activeStatuses,
          );
        }
      }

      // Layer 2: Compressed history
      let compressedContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const memoryDir = path.join(
            (globalThis as any).__cobeingDataRoot ?? "data",
            "groups", this.ctx.groupId, "memory",
          );
          const { CompressedHistory } = await import("./compressed-history.js");
          const ch = new CompressedHistory(entry.targetAgentId, memoryDir);
          compressedContext = ch.read();
        }
      }

      // Layer 3: Uncompressed recent messages from GroupDB
      let recentContext = "";
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const compressedUntil = group.groupDb.getCompressionMark(entry.targetAgentId);
          const recentMessages = group.groupDb.getMessagesForAgent(
            entry.targetAgentId,
            { after: compressedUntil, limit: 200 },
          );
          if (recentMessages.length > 0) {
            recentContext = recentMessages.map(msg => {
              const speaker = msg.from_agent_id;
              if (msg.tag === "main") {
                return `[${speaker}]: ${msg.content}`;
              }
              const talk = this.ctx.getTalk(msg.tag);
              const memberStr = talk ? talk.members.join(", ") : "?";
              return `[Talk: ${msg.tag} 成员: ${memberStr}] [${speaker}]: ${msg.content}`;
            }).join("\n\n");
          }
        }
      }

      // Combine: abstract + compressed + recent + trigger
      const parts: string[] = [];
      if (abstractContext) parts.push(`# 群组协作上下文\n\n${abstractContext}`);
      if (compressedContext) parts.push(`# 历史摘要\n\n${compressedContext}`);
      if (recentContext) parts.push(`# 近期对话\n\n${recentContext}`);

      let enrichedContext = parts.join("\n\n---\n\n");

      // Append trigger messages
      if (entry.triggerContents.length > 0) {
        const triggerContext = entry.triggerContents
          .map((content, i) => `\n\n[触发消息 ${i + 1}]:\n${content}`)
          .join("");
        enrichedContext = `${enrichedContext}${triggerContext}`;
      }

      // Owner filter context
      if (entry.targetAgentId === this.ownerId && this.lastFilterContext) {
        enrichedContext = `${enrichedContext}\n\n${this.lastFilterContext}`;
        this.lastFilterContext = undefined;
      }

      // Broadcast agent_started
      if (this.onAgentEvent) {
        // 使用预提取的 triggerMentions（已按 agent ID 去重），不从完整历史中提取
        const mentions = entry.triggerMentions.length > 0
          ? entry.triggerMentions.map(m => ({ text: m, channel: this.ctx.groupId }))
          : undefined;
        this.onAgentEvent({
          type: "agent_started",
          agentId: entry.targetAgentId,
          agentName: agent.name || entry.targetAgentId,
          groupId: this.ctx.groupId,
          mentions,
        });
      }

      // 5. 唤醒 Agent（群组隔离：使用独立的 ConversationLoop，上下文已包含三层架构）
      this._processingAgents.add(entry.targetAgentId);
      this._broadcastQueue();
      const response = await agent.run(enrichedContext, {
        groupId: this.ctx.groupId,
        workingDir: this.getGroup?.()?.effectiveWorkspace,
      });

      // 5.5 清除正在处理标记
      this._processingAgents.delete(entry.targetAgentId);
      this.ctx.setAgentStatus(entry.targetAgentId, "idle");
      this._broadcastQueue();

      // 5.6 检查回复是否包含错误
      const isErrorResponse = response.content.startsWith("⚠️") || response.content.startsWith("[错误]") || response.content === "达到最大工具调用轮数限制";
      if (isErrorResponse && this.onAgentEvent) {
        this.onAgentEvent({
          type: "agent_error",
          agentId: entry.targetAgentId,
          agentName: agent.name || entry.targetAgentId,
          groupId: this.ctx.groupId,
          error: response.content,
        });
      } else if (this.onAgentEvent) {
        this.onAgentEvent({
          type: "agent_completed",
          agentId: entry.targetAgentId,
          agentName: agent.name || entry.targetAgentId,
          groupId: this.ctx.groupId,
        });
      }

      // 6. 回复写回 GroupContextV2（使用 appendSilent 避免触发 onMessage 导致循环唤醒）
      const replyMsg = this.ctx.appendSilent(entry.targetAgentId, response.content, entry.triggerTag);

      // 6.5 同步回复到 GroupDB
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          group.groupDb.insertMessage(
            replyMsg.id, replyMsg.tag, replyMsg.fromAgentId, replyMsg.content, replyMsg.timestamp,
            group.computeVisibility(replyMsg.tag),
          );
        }
      }

      // 7. 同步回复到 current.md
      if (this.currentMd) {
        this.currentMd.append({
          id: replyMsg.id,
          tag: replyMsg.tag,
          fromAgentId: replyMsg.fromAgentId,
          content: replyMsg.content,
          timestamp: replyMsg.timestamp,
        });
      }

      // 8. 同步回复到所有可见 Agent 的 SQLite
      if (this.getAgentMemory && this.getGroupMembers) {
        this.syncReplyToAll(replyMsg);
      }

      log.info("[%s] Agent %s responded (%d chars)", this.ctx.groupId, entry.targetAgentId, response.content.length);

      // 广播到前端
      if (this.onAgentResponse) {
        this.onAgentResponse(this.ctx.groupId, entry.targetAgentId, response.content, entry.triggerTag);
      }

    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const stack = err?.stack?.split("\n").slice(0, 5).join(" | ") || "";
      log.error("[%s] Wake failed for %s: %s (stack: %s)", this.ctx.groupId, entry.targetAgentId, errMsg, stack);

      // 清除正在处理标记
      if (this._processingAgents.has(entry.targetAgentId)) {
        this._processingAgents.delete(entry.targetAgentId);
        this.ctx.setAgentStatus(entry.targetAgentId, "idle");
        this._broadcastQueue();
      }

      // 广播 agent_error 事件
      if (this.onAgentEvent) {
        this.onAgentEvent({
          type: "agent_error",
          agentId: entry.targetAgentId,
          agentName: agent.name || entry.targetAgentId,
          groupId: this.ctx.groupId,
          error: `AI 服务异常: ${errMsg.slice(0, 200)}`,
        });
      }

      // 错误恢复：清除群组对话历史后重试一次
      try {
        log.info("[%s] Retrying %s after clearing group loop history", this.ctx.groupId, entry.targetAgentId);
        agent.clearGroupLoop(this.ctx.groupId);

        // 重新构建精简上下文（只用触发消息，不用完整历史）
        const retryContext = entry.triggerContents.join("\n\n");
        const response = await agent.run(retryContext, {
          groupId: this.ctx.groupId,
          workingDir: this.getGroup?.()?.effectiveWorkspace,
        });

        // 重试成功 — 写回上下文
        const replyMsg = this.ctx.appendSilent(entry.targetAgentId, response.content, entry.triggerTag);
        if (this.currentMd) {
          this.currentMd.append({
            id: replyMsg.id,
            tag: replyMsg.tag,
            fromAgentId: replyMsg.fromAgentId,
            content: replyMsg.content,
            timestamp: replyMsg.timestamp,
          });
        }
        // 同步重试回复到 GroupDB
        if (this.getGroup) {
          const group = this.getGroup();
          if (group) {
            group.groupDb.insertMessage(
              replyMsg.id, replyMsg.tag, replyMsg.fromAgentId, replyMsg.content, replyMsg.timestamp,
              group.computeVisibility(replyMsg.tag),
            );
          }
        }
        if (this.onAgentResponse) {
          this.onAgentResponse(this.ctx.groupId, entry.targetAgentId, response.content, entry.triggerTag);
        }
        log.info("[%s] Retry succeeded for %s (%d chars)", this.ctx.groupId, entry.targetAgentId, response.content.length);
      } catch (retryErr: any) {
        const retryErrMsg = retryErr?.message || String(retryErr);
        log.error("[%s] Retry also failed for %s: %s", this.ctx.groupId, entry.targetAgentId, retryErrMsg);
        // 广播错误到前端
        if (this.onAgentEvent) {
          this.onAgentEvent({
            type: "agent_error",
            agentId: entry.targetAgentId,
            agentName: agent.name || entry.targetAgentId,
            groupId: this.ctx.groupId,
            error: `AI 服务异常: ${retryErrMsg.slice(0, 200)}（重试后仍失败）`,
          });
        }
        if (this.onAgentResponse) {
          this.onAgentResponse(this.ctx.groupId, entry.targetAgentId, `[错误] ${agent.name || entry.targetAgentId} 执行失败: ${errMsg}（重试后仍失败）`, entry.triggerTag);
        }
      }
    }
  }

  /** 将回复同步到所有可见 Agent 的 SQLite */
  private syncReplyToAll(msg: GroupMessageV2): void {
    if (!this.getAgentMemory || !this.getGroupMembers) return;

    const members = this.getGroupMembers();
    for (const memberId of members) {
      // 检查该成员是否能看到这条消息
      const visible = this.ctx.getVisibleMessages(memberId);
      const canSee = visible.some(v => v.id === msg.id);
      if (!canSee) continue;

      const memory = this.getAgentMemory(memberId);
      if (memory) {
        memory.syncMessages([{
          msgId: msg.id,
          tag: msg.tag,
          fromAgentId: msg.fromAgentId,
          content: msg.content,
          timestamp: msg.timestamp,
        }]);
      }
    }
  }


  /** 获取队列状态 */
  get queueLength(): number {
    return this.wakeQueue.length;
  }

  /** 是否正在处理 */
  get isProcessing(): boolean {
    return this._processingAgents.size > 0 || this.wakeQueue.length > 0;
  }
}
