/**
 * message 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_wake_queue / send_message
 */
import { createLogger, MAX_MESSAGE_LENGTH } from "@cobeing/shared";
import { scanContent } from "../../memory/security-scan.js";
import { extractMentions } from "../parsing.js";
import type { HandlerRegistrar } from "./types.js";

const log = createLogger("ws-server");

export function registerMessageHandlers(register: HandlerRegistrar): void {
  register("get_wake_queue", function (ws, _msg) {
    const queues = this.groupManager?.getAllWakeQueues() ?? {};
    const formatted: Record<string, { groupId: string; groupName: string; queue: any[]; processing: string | null; processingAgents: string[] }> = {};
    for (const [gid, data] of Object.entries(queues)) {
      const group = this.groupManager?.get(gid);
      const groupName: string = (group as any)?.config?.name || gid;
      formatted[gid] = { groupId: gid, groupName, queue: data.queue, processing: data.processing, processingAgents: data.processingAgents ?? [] };
    }
    // 额外收集所有非空闲 Agent（含直接对话和 TODO 触发路径）
    const activeAgents: Array<{ agentId: string; agentName: string; status: string; groupId?: string }> = [];
    const allAgents = this.agentRegistry?.list() ?? [];
    for (const a of allAgents) {
      const st = a.getStatus();
      if (st !== "idle") {
        // 从活跃 session 中提取 groupId（"group:<id>" → "<id>"）
        const sessions = typeof a.getActiveSessions === "function" ? a.getActiveSessions() : [];
        const groupSession = sessions.find((s: string) => s.startsWith("group:"));
        activeAgents.push({
          agentId: a.id,
          agentName: a.name,
          status: st,
          groupId: groupSession ? groupSession.slice(6) : undefined,
        });
      }
    }
    this.sendToClient(ws, { type: "wake_queue_update", payload: { queues: formatted, activeAgents, timestamp: Date.now() } });
  });

  register("send_message", async function (ws, msg) {
    // Cooldown check: max 1 send_message every 2 seconds per connection
    const msgConnId = (ws as any).__connId as string;
    const cooldownNow = Date.now();
    const lastTime = this.sendMessageCooldowns.get(msgConnId) ?? 0;
    if (cooldownNow - lastTime < 2000) {
      this.sendToClient(ws, { type: "error", payload: { message: "消息发送过于频繁，请稍等 2 秒后再试" } });
      return;
    }
    this.sendMessageCooldowns.set(msgConnId, cooldownNow);

    const { agentId, content } = msg.payload as { agentId: string; content: string };
    // 消息长度限制
    if (content.length > MAX_MESSAGE_LENGTH) {
      this.sendToClient(ws, { type: "error", payload: { message: `消息内容不能超过 ${MAX_MESSAGE_LENGTH} 个字符` } });
      return;
    }
    // 安全扫描：检测用户消息中的注入/劫持威胁
    const scan = scanContent(content);
    if (!scan.safe) {
      log.warn("Security scan blocked message to %s: %s", agentId, scan.threat);
      this.sendToClient(ws, { type: "error", payload: { message: `消息被安全策略拦截（检测到: ${scan.threat}）` } });
      return;
    }
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }
    // Check if this is a group-context message (content starts with [群组 groupId])
    const groupMatch = content.match(/^\[群组 ([^\]]+)\]\s*(.*)/s);
    let collabContext: string | undefined;
    if (groupMatch) {
      const gId = groupMatch[1];
      const gContent = groupMatch[2];
      const group = this.groupManager?.get(gId);
      if (group) {
        // Post to group context
        group.postMessage("user", gContent);

        // 构建群组协作上下文（局部变量，通过 run() 参数传递，不设置 Agent 全局状态）
        const { buildGroupCollaborationContext } = await import("../../conversation/prompt-builder.js");
        const members = group.getMemberProfiles();
        const workspace = group.workspace.getSummary();
        const experienceSummary = group.workspace.readExperienceSummary();

        let todos: import("../../conversation/prompt-builder.js").GroupTodoSummary[] = [];
        const scanner = this.groupManager?.getScanner?.(gId);
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

        collabContext = buildGroupCollaborationContext(
          agentId,
          members,
          {
            task: workspace.task,
            plan: workspace.plan,
            progress: workspace.progress,
            experienceSummary,
            interface: workspace.interface,
          },
          todos,
          group.config.owner,
          gId,
        );
      }
    }

    this.logMessage("in", content);
    // 广播 agent 开始处理 — 前端用于显示触发链路
    const triggerContent = groupMatch ? groupMatch[2] : content;
    const channelId = groupMatch ? groupMatch[1] : agentId;
    // 提取 @mentions 并按 resolved agent ID 去重，附加通道信息
    const rawMentions = triggerContent.match(/@([\w一-鿿][\w一-鿿-]{2,})/g)?.map(m => m.slice(1)) || [];
    const seenIds = new Set<string>();
    const dedupedMentions: Array<{ text: string; channel: string }> = [];
    for (const m of rawMentions) {
      const resolved = this.agentRegistry?.get(m)?.id
        || this.agentRegistry?.list().find(a => a.name === m)?.id
        || m;
      if (!seenIds.has(resolved)) {
        seenIds.add(resolved);
        dedupedMentions.push({ text: `@${m}`, channel: channelId });
      }
    }
    this.broadcast({
      type: "agent_started",
      payload: {
        agentId,
        agentName: agent.config?.name || agentId,
        groupId: groupMatch ? groupMatch[1] : undefined,
        mentions: dedupedMentions.length > 0 ? dedupedMentions : undefined,
        timestamp: Date.now(),
      },
    });
    agent.run(content, {
      groupId: groupMatch ? groupMatch[1] : undefined,
      groupContext: collabContext,
      guideContent: groupMatch ? this.groupManager?.get(groupMatch[1])?.workspace.readGuide() ?? undefined : undefined,
      workingDir: groupMatch ? this.groupManager?.get(groupMatch[1])?.effectiveWorkspace : undefined,
      events: {
        onToken: (token) => {
          this.sendToClient(ws, { type: "stream_token", payload: { token, groupId: groupMatch?.[1], agentId } });
        },
        onToolCall: (tc) => {
          this.broadcast({
            type: "tool_event",
            payload: {
              agentId,
              groupId: groupMatch?.[1],
              toolName: tc.function.name,
              params: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })(),
              status: "start",
            },
          });
        },
        onToolResult: (tcId, result) => {
          this.broadcast({
            type: "tool_event",
            payload: {
              agentId,
              groupId: groupMatch?.[1],
              toolCallId: tcId,
              result: typeof result === "string" ? result.slice(0, 2000) : String(result),
              status: "complete",
            },
          });
        },
        onUsage: (usage) => {
          this.broadcast({
            type: "usage_stats",
            payload: {
              agentId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheHitTokens: usage.cacheHitTokens ?? 0,
              cacheMissTokens: usage.cacheMissTokens ?? 0,
              timestamp: Date.now(),
            },
          });
        },
      },
    }).then((response) => {

      this.logMessage("out", response.content);
      // Broadcast agent_response so reconnected clients also receive the final text.
      // Previously sendToClient(ws) — lost on WS disconnect during tool execution.
      this.broadcast({ type: "agent_response", payload: { content: response.content, groupId: groupMatch?.[1], agentId, agentName: agent.config?.name || agentId } });

      // 检查回复是否包含错误
      const isError = response.content.startsWith("⚠️") || response.content.startsWith("[错误]") || response.content === "达到最大工具调用轮数限制";

      // 广播 agent 完成/错误处理
      this.broadcast({
        type: isError ? "agent_error" : "agent_completed",
        payload: {
          agentId,
          agentName: agent.config?.name || agentId,
          groupId: groupMatch ? groupMatch[1] : undefined,
          error: isError ? response.content : undefined,
          timestamp: Date.now(),
        },
      });
      // Broadcast group_message if this was a group context
      if (groupMatch) {
        const gId = groupMatch[1];
        const group = this.groupManager?.get(gId);
        if (group) {
          // 写回 GroupContextV2（silent，不触发回调避免重复唤醒）
          const replyMsg = group.ctxV2.appendSilent(agentId, response.content, "main");

          // 同步到 current.md
          group.currentMd.append({
            id: replyMsg.id,
            tag: replyMsg.tag,
            fromAgentId: replyMsg.fromAgentId,
            content: replyMsg.content,
            timestamp: replyMsg.timestamp,
          });

          // 持久化到 context.jsonl
          this.groupManager?.appendContextMessage(gId, {
            fromAgentId: replyMsg.fromAgentId,
            content: replyMsg.content,
            tag: replyMsg.tag,
            timestamp: replyMsg.timestamp,
          });
        }

        this.broadcast({
          type: "group_message",
          payload: {
            groupId: gId,
            fromAgentId: agentId,
            content: response.content,
            mentions: extractMentions(response.content),
            timestamp: Date.now(),
            metadata: undefined,
          },
        });
      }
      this.broadcastState();
    }).catch((err) => {
      // 清理群组协作上下文
      if (groupMatch) agent.clearGroupContext();
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logMessage("system", `LLM Error: ${errMsg}`);
      this.sendToClient(ws, { type: "error", payload: { message: errMsg } });
      // 广播 agent_error
      this.broadcast({
        type: "agent_error",
        payload: {
          agentId,
          agentName: agent.config?.name || agentId,
          groupId: groupMatch ? groupMatch[1] : undefined,
          error: `AI 服务异常: ${errMsg.slice(0, 200)}`,
          timestamp: Date.now(),
        },
      });
      this.broadcastState();
    });
  });
}
