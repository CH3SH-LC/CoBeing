/**
 * Butler channel binding tools
 * (channel-bind, channel-unbind)
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { GroupManager } from "../../../group/manager.js";

export function makeChannelBindTool(router: import("../../../group/router.js").ChannelRouter, groupManager: GroupManager): Tool {
  return {
    name: "channel-bind",
    description: "将 Channel 绑定到 Agent 或 Group",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
        targetType: { type: "string", description: "绑定类型: agent 或 group" },
        targetId: { type: "string", description: "目标 Agent ID 或 Group ID" },
      },
      required: ["channelId", "targetType", "targetId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      const targetType = params.targetType as "agent" | "group";
      const targetId = params.targetId as string;

      if (targetType === "group" && !groupManager.get(targetId)) {
        return { toolCallId: "", content: `未找到群组: ${targetId}`, isError: true };
      }

      const entry: import("../../../config/schema.js").ChannelBindTo = targetType === "agent"
        ? { type: "agent", agentId: targetId }
        : { type: "group", groupId: targetId };

      router.bind(channelId, entry);
      return { toolCallId: "", content: `已将 Channel ${channelId} 绑定到 ${targetType} ${targetId}` };
    },
  };
}

export function makeChannelUnbindTool(router: import("../../../group/router.js").ChannelRouter): Tool {
  return {
    name: "channel-unbind",
    description: "解除 Channel 绑定",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
      },
      required: ["channelId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      router.unbind(channelId);
      return { toolCallId: "", content: `已解除 Channel ${channelId} 的绑定` };
    },
  };
}
