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
import { createLogger } from "@cobeing/shared";

const log = createLogger("wake-system");

export interface WakeSystemConfig {
  /** 两次唤醒之间的等待时间（毫秒），默认 5000 */
  wakeDelayMs?: number;
  /** 群主 agent ID（用于本地过滤层） */
  ownerId?: string;
  /** Agent 响应回调（用于广播到前端） */
  onAgentResponse?: (groupId: string, agentId: string, content: string, tag: string) => void;
}

interface WakeEntry {
  targetAgentId: string;
  triggerMsgId: string;
  triggerTag: string;
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
  private processing = false;
  private wakeQueue: WakeEntry[] = [];
  private processedMsgIds = new Set<string>();
  private ownerId?: string;
  private localFilter?: import("./local-filter.js").LocalFilterEngine;
  /** 最近一次过滤结果的上下文（注入给群主） */
  private lastFilterContext?: string;
  private onAgentResponse?: (groupId: string, agentId: string, content: string, tag: string) => void;

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
      wakeDelayMs: config?.wakeDelayMs ?? 5000,
    };
    this.ownerId = config?.ownerId;
    this.onAgentResponse = config?.onAgentResponse;
    this.currentMd = deps?.currentMd ?? null;
    this.getAgentMemory = deps?.getAgentMemory ?? null;
    this.getGroupMembers = deps?.getGroupMembers ?? null;
    this.maxCurrentMessages = deps?.maxCurrentMessages ?? 100;
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

    // 扫描 mentions，加入唤醒队列（支持 ID 和名称两种方式）
    for (const mention of msg.mentions) {
      if (mention === "all") continue; // "all" 由调用方处理
      const resolvedId = this.resolveMention(mention);
      if (!resolvedId) {
        log.info("[%s] Mention '%s' — resolveMention failed (no agent with this ID or name)", this.ctx.groupId, mention);
        continue;
      }
      const agent = this.getAgent(resolvedId);
      if (!agent) {
        log.info("[%s] Mention '%s' → resolved to '%s' but agent not in registry", this.ctx.groupId, mention, resolvedId);
        continue;
      }
      log.info("[%s] Mention '%s' → waking agent '%s'", this.ctx.groupId, mention, resolvedId);
      this.wakeQueue.push({
        targetAgentId: resolvedId,
        triggerMsgId: msg.id,
        triggerTag: msg.tag,
      });
    }

    // 处理 @all — 唤醒所有群组成员（除了发送者）
    if (msg.mentions.includes("all")) {
      // 不在这里处理 @all，由调用方决定
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

  /** 注入本地过滤引擎 */
  setLocalFilter(filter: import("./local-filter.js").LocalFilterEngine): void {
    this.localFilter = filter;
  }

  /** 注入 Agent 响应回调 */
  setOnAgentResponse(cb: (groupId: string, agentId: string, content: string, tag: string) => void): void {
    this.onAgentResponse = cb;
  }

  /** 异步评估是否唤醒群主 */
  private async evaluateForOwner(msg: GroupMessageV2): Promise<void> {
    if (!this.localFilter || !this.ownerId) return;

    const recent = this.ctx.getMessages().slice(-20);
    const result = await this.localFilter.evaluate(this.ctx.groupId, recent);

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
      });
      this.lastFilterContext = filterContext;
    }
  }

  /** 处理唤醒队列 */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      log.debug("[%s] processQueue skipped (already processing, queue: %d)", this.ctx.groupId, this.wakeQueue.length);
      return;
    }
    this.processing = true;
    log.info("[%s] processQueue starting, %d entries", this.ctx.groupId, this.wakeQueue.length);

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

      // 3. 读取 current.md 作为上下文（替代 buildContextFor）
      const context = this.currentMd
        ? this.currentMd.readAsContext()
        : this.ctx.buildContextFor(entry.targetAgentId);

      if (!context) {
        log.debug("[%s] No context for %s, skipping", this.ctx.groupId, entry.targetAgentId);
        return;
      }

      // 4. 如果是群主且有过滤上下文，追加到 context
      let enrichedContext = context;
      if (entry.targetAgentId === this.ownerId && this.lastFilterContext) {
        enrichedContext = `${context}\n\n${this.lastFilterContext}`;
        this.lastFilterContext = undefined;
      }

      // 4.5 构建并设置群组协作上下文
      if (this.getGroup) {
        const group = this.getGroup();
        if (group) {
          const { buildGroupCollaborationContext } = await import("../conversation/prompt-builder.js");
          const members = group.getMemberProfiles();
          const workspace = group.workspace.getSummary();
          const experienceSummary = group.workspace.readExperienceSummary();

          // 获取群组 TODO 列表
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

          const collabContext = buildGroupCollaborationContext(
            entry.targetAgentId,
            members,
            {
              task: workspace.task,
              plan: workspace.plan,
              progress: workspace.progress,
              experienceSummary,
            },
            todos,
            this.ownerId,
            this.ctx.groupId,
          );
          agent.setGroupContext(collabContext);
        }
      }

      // 5. 唤醒 Agent
      const response = await agent.run(enrichedContext);

      // 5.5 清理群组协作上下文
      agent.clearGroupContext();

      // 6. 回复写回 GroupContextV2
      const replyMsg = this.ctx.append(entry.targetAgentId, response.content, entry.triggerTag);
      this.processedMsgIds.add(replyMsg.id);

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

      // 等待
      await this.delay(this.config.wakeDelayMs);
    } catch (err) {
      log.error("[%s] Wake failed for %s: %s", this.ctx.groupId, entry.targetAgentId, err);
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
