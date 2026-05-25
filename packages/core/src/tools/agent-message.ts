/**
 * Agent Message tool — send message to another Agent
 */
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { scanContent } from "../memory/security-scan.js";

export function makeAgentMessageTool(registry: AgentRegistry): Tool {
  return {
    name: "agent-message",
    description: "向其他 Agent 发送消息并获取回复",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "目标 agent ID" },
        message: { type: "string", description: "发送内容" },
        timeout: { type: "number", description: "超时秒数，默认 60" },
      },
      required: ["target", "message"],
    },
    async execute(params, context: ToolContext): Promise<ToolResult> {
      const maxLoopDepth = 2;
      const currentDepth = context.callDepth ?? 0;

      if (currentDepth >= maxLoopDepth) {
        return {
          toolCallId: "",
          content: `调用深度超限 (${currentDepth})，防止无限循环`,
          isError: true,
        };
      }

      // 安全扫描：检测消息中的注入/劫持/泄露威胁
      const msg = params.message as string;
      const scan = scanContent(msg);
      if (!scan.safe) {
        return { toolCallId: "", content: `消息被安全策略拦截（检测到: ${scan.threat}）`, isError: true };
      }

      const targetAgent = registry.get(params.target as string);
      if (!targetAgent) {
        return { toolCallId: "", content: `未找到 Agent: ${params.target}`, isError: true };
      }

      const timeout = ((params.timeout as number) ?? 60) * 1000;

      try {
        const result = await Promise.race([
          targetAgent.run(params.message as string),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("超时")), timeout),
          ),
        ]);
        return { toolCallId: "", content: result.content };
      } catch (err: any) {
        return { toolCallId: "", content: `Agent 通信失败: ${err.message}`, isError: true };
      }
    },
  };
}
