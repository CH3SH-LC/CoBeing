// packages/core/src/group/host-tools.ts
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { Group } from "./group.js";
import { createLogger, updateGroupMembers } from "@cobeing/shared";

const log = createLogger("host-tools");

type GroupGetter = (groupId: string) => Group | undefined;

// ---- host-guide-discussion ----

export function makeHostGuideDiscussionTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-guide-discussion",
    description: "主动发起或引导群组讨论（群主专用）。设定议题、@mention 相关成员、给出讨论框架。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
        goals: { type: "string", description: "讨论目标（可选）" },
        members: { type: "array", items: { type: "string" }, description: "邀请参与的成员（可选，默认全部）" },
        framework: { type: "string", description: "讨论框架/步骤（可选）" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const topic = params.topic as string;
      const goals = params.goals as string;
      const framework = params.framework as string;
      const members = (params.members as string[]) || group.config.members;

      const mentions = members.map(m => `@${m}`).join(" ");
      const parts = [`# 讨论: ${topic}`, ""];
      if (goals) parts.push(`目标: ${goals}`, "");
      if (framework) parts.push(`框架:\n${framework}`, "");
      parts.push(`${mentions} 请就以上主题发表观点。`);

      group.postMessage(context.agentId, parts.join("\n"));

      log.info("[%s] Discussion guide posted: %s", params.groupId, topic);
      return { toolCallId: "", content: `已发起讨论「${topic}」，已通知: ${members.join(", ")}` };
    },
  };
}

// ---- host-decompose-task ----

interface SubTask {
  title: string;
  assignee?: string;
  triggerAt: string;
  description?: string;
  /** 依赖的子任务索引（从 0 开始），如 [0] 表示依赖第一个子任务 */
  dependsOn?: number[];
}

export function makeHostDecomposeTaskTool(
  getGroup: GroupGetter,
  addTodo: (input: any) => any,
  setDependsOn?: (todoId: string, depIds: string[]) => void,
): Tool {
  return {
    name: "host-decompose-task",
    description: "拆解任务为子任务，创建 TODO 并分配给成员（群主专用）。支持依赖声明：使用 dependsOn 指定当前子任务依赖哪些子任务（按索引，从 0 开始）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        task: { type: "string", description: "总体任务描述" },
        subtasks: {
          type: "array",
          description: "子任务列表。用 dependsOn 指定依赖关系（索引从 0 开始），上游完成后当前任务自动触发。",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              assignee: { type: "string", description: "分配给哪个成员" },
              triggerAt: { type: "string", description: "触发时间 (ISO 8601)" },
              description: { type: "string" },
              dependsOn: {
                type: "array",
                items: { type: "number" },
                description: "依赖的子任务索引列表（从 0 开始），上游完成后当前任务才会触发",
              },
            },
            required: ["title", "triggerAt"],
          },
        },
      },
      required: ["groupId", "task", "subtasks"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const subtasks = params.subtasks as SubTask[];
      const todos: Array<{ id: string; title: string; assignee?: string }> = [];

      // Pass 1: 创建所有子任务，记录 ID
      for (const st of subtasks) {
        const todo = addTodo({
          title: st.title,
          description: st.description || `来自任务拆解: ${params.task}`,
          triggerAt: st.triggerAt,
          recurrenceHint: "不重复",
          scope: "group",
          groupId: params.groupId,
          targetAgentId: st.assignee,
          createdBy: context.agentId,
        });
        todos.push({ id: todo.id, title: st.title, assignee: st.assignee });
      }

      // Pass 2: 设置依赖关系 — 用 addTodo 返回的 ID 替换索引
      const results: string[] = [];
      for (let i = 0; i < subtasks.length; i++) {
        const st = subtasks[i];
        const todoId = todos[i].id;
        const depIds = st.dependsOn?.map(idx => todos[idx]?.id).filter(Boolean) ?? [];
        if (depIds.length > 0) {
          setDependsOn?.(todoId, depIds);
        }
        let line = `- ${st.title}${st.assignee ? ` → @${st.assignee}` : ""} (ID: ${todoId})`;
        if (depIds.length > 0) line += ` [依赖: ${st.dependsOn!.join(" → ")}]`;
        results.push(line);
      }

      const summary = `任务拆解: ${params.task}\n\n${results.join("\n")}`;
      group.postMessage(context.agentId, summary);

      log.info("[%s] Task decomposed: %d subtasks", params.groupId, subtasks.length);
      return { toolCallId: "", content: `已拆解为 ${subtasks.length} 个子任务:\n${results.join("\n")}` };
    },
  };
}

// ---- host-summarize-progress ----

export function makeHostSummarizeProgressTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-summarize-progress",
    description: "总结群组讨论进展，写入工作区 PROGRESS.md（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        summary: { type: "string", description: "进展总结内容" },
      },
      required: ["groupId", "summary"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const summary = params.summary as string;
      group.workspace.appendProgress(context.agentId, summary);
      group.postMessage(context.agentId, `## 进展总结\n\n${summary}`);

      log.info("[%s] Progress summarized", params.groupId);
      return { toolCallId: "", content: `已更新进展总结到群组工作区。` };
    },
  };
}

// ---- host-record-decision ----

export function makeHostRecordDecisionTool(
  getGroup: GroupGetter,
  appendDecision: (groupId: string, decision: string, reason: string) => void,
): Tool {
  return {
    name: "host-record-decision",
    description: "记录群组决策到群主 DECISIONS.md 和群组上下文（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        decision: { type: "string", description: "决策内容" },
        reason: { type: "string", description: "决策理由" },
      },
      required: ["groupId", "decision", "reason"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const decision = params.decision as string;
      const reason = params.reason as string;

      appendDecision(params.groupId as string, decision, reason);
      group.postMessage(context.agentId, `## 决策记录\n\n**决策**: ${decision}\n**理由**: ${reason}`);

      log.info("[%s] Decision recorded: %s", params.groupId, decision);
      return { toolCallId: "", content: `已记录决策: ${decision}` };
    },
  };
}

// ---- host-manage-todo ----

export function makeHostManageTodoTool(
  listTodos: (groupId: string, status?: string) => any[],
  updateTodo?: (todoId: string, updates: any) => any,
  removeTodo?: (todoId: string) => boolean,
): Tool {
  return {
    name: "host-manage-todo",
    description: "管理群组 TODO（群主专用）。支持 list/assign/complete/remove 操作。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "操作: list / assign / complete / remove", enum: ["list", "assign", "complete", "remove"] },
        groupId: { type: "string", description: "群组 ID" },
        todoId: { type: "string", description: "TODO ID（assign/complete/remove 时必填）" },
        assignee: { type: "string", description: "分配给谁（assign 时必填）" },
        status: { type: "string", description: "筛选状态（list 时可选）" },
      },
      required: ["action", "groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const action = params.action as string;
      const groupId = params.groupId as string;

      switch (action) {
        case "list": {
          const todos = listTodos(groupId, params.status as string);
          if (todos.length === 0) return { toolCallId: "", content: "没有 TODO" };
          const lines = todos.map(t =>
            `- [${t.status}] ${t.title} (ID: ${t.id}) → ${t.targetAgentId || "未分配"} | 触发: ${t.triggerAt}`
          );
          return { toolCallId: "", content: `群组 TODO (${todos.length}):\n${lines.join("\n")}` };
        }
        case "assign": {
          if (!updateTodo) return { toolCallId: "", content: "updateTodo 未配置", isError: true };
          const updated = updateTodo(params.todoId as string, { targetAgentId: params.assignee });
          return { toolCallId: "", content: updated ? `已分配 TODO ${params.todoId} 给 ${params.assignee}` : "未找到 TODO" };
        }
        case "complete": {
          if (!updateTodo) return { toolCallId: "", content: "updateTodo 未配置", isError: true };
          const completed = updateTodo(params.todoId as string, { status: "completed", completedAt: new Date().toISOString() });
          return { toolCallId: "", content: completed ? `已完成 TODO ${params.todoId}` : "未找到 TODO" };
        }
        case "remove": {
          if (!removeTodo) return { toolCallId: "", content: "removeTodo 未配置", isError: true };
          const removed = removeTodo(params.todoId as string);
          return { toolCallId: "", content: removed ? `已删除 TODO ${params.todoId}` : "未找到 TODO" };
        }
        default:
          return { toolCallId: "", content: `未知操作: ${action}`, isError: true };
      }
    },
  };
}

// ---- host-review-todo ----

export function makeHostReviewTodoTool(
  getDueTodos: (groupId: string) => any[],
): Tool {
  return {
    name: "host-review-todo",
    description: "检查到期/逾期 TODO，决定是否催促或重新分配（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const dueTodos = getDueTodos(groupId);

      if (dueTodos.length === 0) {
        return { toolCallId: "", content: "没有到期的 TODO。" };
      }

      const lines = dueTodos.map(t => {
        const overdueMs = Date.now() - new Date(t.triggerAt).getTime();
        const overdueHours = Math.floor(overdueMs / 3600000);
        return `- ${t.title} (ID: ${t.id}) → ${t.targetAgentId || "未分配"} | 逾期 ${overdueHours}h`;
      });

      return {
        toolCallId: "",
        content: `到期 TODO (${dueTodos.length}):\n${lines.join("\n")}\n\n建议：检查是否需要催促或重新分配。`,
      };
    },
  };
}

// ---- host-invite-member ----

export function makeHostInviteMemberTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-invite-member",
    description: "邀请 Agent 加入群组（群主专用）。被邀请的 Agent 会获得群组上下文和通信能力。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        agentId: { type: "string", description: "要邀请的 Agent ID" },
        role: { type: "string", description: "该成员在本次协作中的角色或职责（可选）" },
      },
      required: ["groupId", "agentId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const agentId = params.agentId as string;
      if (group.config.members.includes(agentId)) {
        return { toolCallId: "", content: `${agentId} 已在群组中`, isError: true };
      }

      group.addMember(agentId);
      // 更新 master registry + 持久化
      const dataRoot = (globalThis as any).__cobeingDataRoot || "data";
      updateGroupMembers(dataRoot, params.groupId as string, group.config.members);
      const gm = (globalThis as any).__cobeingGroupManager;
      gm?.saveGroup(params.groupId as string);
      const role = params.role as string | undefined;
      const welcomeMsg = role
        ? `@${agentId} 已加入群组（角色: ${role}），欢迎！请各位成员知悉。`
        : `@${agentId} 已加入群组，欢迎！请各位成员知悉。`;
      group.postMessage(context.agentId, welcomeMsg);

      log.info("[%s] Host invited member: %s", params.groupId, agentId);
      return { toolCallId: "", content: `已将 ${agentId} 加入群组 ${params.groupId}` };
    },
  };
}

// ---- host-remove-member ----

export function makeHostRemoveMemberTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-remove-member",
    description: "将成员移出群组（群主专用）。群主（host）不可被移除。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        agentId: { type: "string", description: "要移出的 Agent ID" },
        reason: { type: "string", description: "移除原因（可选）" },
      },
      required: ["groupId", "agentId"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const agentId = params.agentId as string;
      if (agentId === "host") {
        return { toolCallId: "", content: "群主不可被移除", isError: true };
      }
      if (!group.config.members.includes(agentId)) {
        return { toolCallId: "", content: `${agentId} 不在群组中`, isError: true };
      }

      group.removeMember(agentId);
      // 更新 master registry + 持久化
      const dataRoot = (globalThis as any).__cobeingDataRoot || "data";
      updateGroupMembers(dataRoot, params.groupId as string, group.config.members);
      const gm = (globalThis as any).__cobeingGroupManager;
      gm?.saveGroup(params.groupId as string);
      const reason = params.reason as string | undefined;
      const msg = reason
        ? `@${agentId} 已被移出群组（原因: ${reason}）`
        : `@${agentId} 已被移出群组`;
      group.postMessage(context.agentId, msg);

      log.info("[%s] Host removed member: %s", params.groupId, agentId);
      return { toolCallId: "", content: `已将 ${agentId} 移出群组 ${params.groupId}` };
    },
  };
}

// ---- host-set-screener-prompt ----

export function makeHostSetScreenerPromptTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-set-screener-prompt",
    description:
      "设置群组级初筛策略（Screener Prompt）。用于定制群主唤醒的触发条件。传入空字符串或 null 恢复默认策略。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        prompt: {
          type: "string",
          description:
            "自定义筛选 prompt（定义何时需要唤醒群主）。传入空字符串或 null 恢复默认。需包含判断准则和 JSON 输出格式要求。",
        },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const prompt = params.prompt as string | undefined;
      if (prompt) {
        group.setScreenerPrompt(prompt);
        log.info("[%s] Host set custom screener prompt (%d chars)", params.groupId, prompt.length);
        return { toolCallId: "", content: `已为群组 ${params.groupId} 设置自定义筛选策略。` };
      } else {
        group.setScreenerPrompt(null);
        log.info("[%s] Host reset screener prompt to default", params.groupId);
        return { toolCallId: "", content: `已恢复群组 ${params.groupId} 的默认筛选策略。` };
      }
    },
  };
}

// ---- host-manage-workspace ----

export function makeHostManageWorkspaceTool(getGroup: GroupGetter): Tool {
  return {
    name: "host-manage-workspace",
    description:
      "管理群组工作空间文件（STRUCTURE.md / PLAN.md / TASK.md）。支持读取和写入（群主专用）。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        action: { type: "string", description: "操作类型", enum: ["read", "write"] },
        file: { type: "string", description: "目标文件", enum: ["structure", "plan", "task"] },
        content: { type: "string", description: "写入内容（action=write 时必填）" },
      },
      required: ["groupId", "action", "file"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = getGroup(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };

      const action = params.action as string;
      const file = params.file as string;

      try {
        if (action === "read") {
          const content = group.workspace.readFile(file);
          if (content === null) {
            return { toolCallId: "", content: `${file}.md 不存在于群组 ${params.groupId}` };
          }
          return { toolCallId: "", content: `=== ${file}.md ===\n\n${content}` };
        } else {
          const content = params.content as string;
          if (!content) {
            return { toolCallId: "", content: "写入模式下 content 参数为必填", isError: true };
          }
          group.workspace.writeFile(file, content);
          log.info("[%s] Host updated workspace file: %s", params.groupId, file);
          return { toolCallId: "", content: `已更新群组 ${params.groupId} 的 ${file}.md` };
        }
      } catch (err: any) {
        return { toolCallId: "", content: `操作失败: ${err.message}`, isError: true };
      }
    },
  };
}
