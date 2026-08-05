/**
 * Butler group lifecycle tools
 * (butler-create-group, butler-destroy-group, butler-add-to-group, butler-run-group, butler-check-group)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupManager } from "../../../group/manager.js";
import { AgentRegistry } from "../../registry.js";
import { ButlerRegistry } from "../../butler-registry.js";
import { updateGroupMembers } from "@cobeing/shared";

export function makeCreateGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry, registry: AgentRegistry): Tool {
  return {
    name: "butler-create-group",
    description: "创建一个 Agent 群组",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "群组名称" },
        members: { type: "array", items: { type: "string" }, description: "成员 Agent ID 列表" },
      },
      required: ["name", "members"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = (params.name as string).toLowerCase().replace(/\s+/g, "-");
      const members = (params.members as string[]).filter(m => m !== "host");
      members.unshift("host");

      const group = groupManager.create({
        id,
        name: params.name as string,
        members,
        owner: "host",
      });

      // 为初始成员注入群组通信工具
      for (const memberId of members) {
        const agent = registry.get(memberId);
        if (agent) {
          agent.injectGroupTools((gid) => groupManager.get(gid));
        }
      }

      butlerRegistry.registerGroup({
        id,
        name: params.name as string,
        members,
      });

      // 唤醒群主启动工作回合（不唤醒组员）
      const memberNames = members.map((m: string) => {
        const a = registry.get(m);
        return a?.name ?? m;
      }).join("、");
      group.postMessage("system", `@host 新群组"${params.name}"已创建，成员包括：${memberNames}。

作为群主，请启动首次工作回合：
1. 向用户自我介绍并确认群组定位和场景
2. 说明各成员的能力和职责范围
3. 询问用户当前是否有具体需求需要推进，还是先设置群组规则`);

      return { toolCallId: "", content: `已创建群组 ${group.config.name} (ID: ${id})` };
    },
  };
}

export function makeDestroyGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-destroy-group",
    description: "解散一个群组：通知所有成员、释放资源、删除群组数据。",
    parameters: {
      type: "object",
      properties: { groupId: { type: "string", description: "群组 ID" } },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.groupId as string;
      const group = groupManager.get(id);
      if (!group) return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };

      const groupName = group.config.name;
      const memberCount = group.config.members.length;
      const memberNames = group.config.members.map(m => {
        const agent = (globalThis as any).__cobeingAgentRegistry?.get?.(m);
        return agent?.name ?? m;
      }).join("、");

      // 1. 发送解散通知
      try {
        group.postMessage("system", `[系统] 群组 "${groupName}" 已被管家解散。成员: ${memberNames}。相关文件已清理。`);
      } catch {}

      // 2. 释放资源（关闭 GroupDB 等）
      groupManager.delete(id);
      butlerRegistry.unregisterGroup(id);

      // 3. 广播事件
      const ws = (globalThis as any).__cobeingWSServer;
      if (ws) {
        ws.broadcast({ type: "group_destroyed", payload: { groupId: id } });
        ws.broadcastState();
      }

      return {
        toolCallId: "",
        content: `已解散群组 "${groupName}" (${id})。\n前成员 (${memberCount} 人): ${memberNames}\n群组数据已清理。`,
      };
    },
  };
}

export function makeAddToGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry, registry: AgentRegistry): Tool {
  return {
    name: "butler-add-to-group",
    description: "将已有 Agent 加入群组",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        agentId: { type: "string", description: "Agent ID" },
      },
      required: ["groupId", "agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = groupManager.get(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };
      group.addMember(params.agentId as string);

      // 为新成员注入群组通信工具
      const agent = registry.get(params.agentId as string);
      if (agent) {
        agent.injectGroupTools((gid) => groupManager.get(gid));
      }

      // 更新 master registry + 持久化
      updateGroupMembers((globalThis as any).__cobeingDataRoot || "data", params.groupId as string, group.config.members);
      groupManager.saveGroup(params.groupId as string);

      // 更新注册表
      const gEntry = butlerRegistry.parseGroupsRegistry().find(g => g.id === params.groupId);
      if (gEntry) {
        const members = [...gEntry.members, params.agentId as string];
        butlerRegistry.registerGroup({ ...gEntry, members });
      }

      return { toolCallId: "", content: `已将 ${params.agentId} 加入群组 ${params.groupId}` };
    },
  };
}

export function makeRunGroupTool(groupManager: GroupManager, butlerRegistry: ButlerRegistry): Tool {
  return {
    name: "butler-run-group",
    description: "启动群组讨论",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = groupManager.get(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };
      const history = await group.startDiscussion(params.topic as string);
      const summary = history.map((m: any) => `[${m.fromAgentId}]: ${m.content.slice(0, 200)}`).join("\n\n");

      // 写入 v2 上下文
      for (const msg of history) {
        group.ctxV2.append(msg.fromAgentId, msg.content, "main");
      }

      // 记录任务日志
      butlerRegistry.appendTaskLog({
        timestamp: new Date().toISOString(),
        task: `群组讨论: ${params.topic}`,
        action: `butler-run-group (${params.groupId})`,
        result: `${history.length} 条消息`,
      });

      return { toolCallId: "", content: `讨论完成 (${history.length} 条消息):\n\n${summary}` };
    },
  };
}

export function makeCheckGroupTool(groupManager: GroupManager): Tool {
  return {
    name: "butler-check-group",
    description: "检查群组进展：读取 PROGRESS.md 和 TODO 状态，返回结构化报告。当用户询问群组进展时调用。",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
      },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const groupId = params.groupId as string;
      const group = groupManager.get(groupId);
      if (!group) return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };

      const parts: string[] = [];
      parts.push(`## 群组进展报告: ${group.config.name}`);

      // 1. PROGRESS.md
      const progressContent = group.workspace.readProgress() ?? "";
      if (progressContent) {
        const preview = progressContent.slice(0, 1500);
        parts.push(`### PROGRESS.md\n${preview}${progressContent.length > 1500 ? "\n...(已截断)" : ""}`);
      } else {
        parts.push("### PROGRESS.md\n暂无进展记录");
      }

      // 2. TODO 状态
      const scanner = groupManager.getScanner?.(groupId);
      if (scanner) {
        const store = scanner.getStore();
        const pending = store.list("pending");
        const inProgress = store.list("in-progress");
        const completed = store.list("completed");
        parts.push("### TODO 状态");
        parts.push(`- 待处理: ${pending.length} 项`);
        if (inProgress.length > 0) parts.push(`- 进行中: ${inProgress.length} 项`);
        parts.push(`- 已完成: ${completed.length} 项`);
        const total = pending.length + inProgress.length + completed.length;
        if (total > 0) parts.push(`- 完成率: ${Math.round((completed.length / total) * 100)}%`);
        if (pending.length > 0) {
          parts.push("待处理任务:");
          for (const t of pending.slice(0, 10)) {
            parts.push(`  - [${t.id}] ${t.title}`);
          }
          if (pending.length > 10) parts.push(`  ... 还有 ${pending.length - 10} 项`);
        }
      } else {
        parts.push("### TODO 状态\n无法获取");
      }

      // 3. 成员
      const profiles = group.getMemberProfiles();
      if (profiles.length > 0) {
        parts.push(`### 成员 (${profiles.length})`);
        for (const m of profiles) parts.push(`  - ${m.name || m.id}`);
      }

      return { toolCallId: "", content: parts.join("\n\n") };
    },
  };
}
