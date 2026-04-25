/**
 * memory 工具定义 — Agent 通过此工具自主管理记忆
 */
import type { MemoryStore, MemoryTarget } from "./memory-store.js";
import type { Tool, ToolContext, ToolResult } from "@cobeing/shared";

export function makeMemoryTool(store: MemoryStore): Tool {
  return {
    name: "memory",
    description: `管理你的持久化记忆。记忆会在未来会话中加载，保持简洁聚焦。

四个目标：
- memory: 你的个人笔记（环境事实、项目约定、工具经验）
- experience: 工作经验（领域+协作经验、教训总结）
- user: 用户画像（偏好、习惯、沟通风格）
- tools: 工具策略（场景→工具映射）

操作：add（新增）、replace（替换，用 old_text 定位）、remove（删除）、read（查看）。

写入前会检查安全性和容量。超限时需要合并旧条目或删除过时信息。`,
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "replace", "remove", "read"],
          description: "操作类型",
        },
        target: {
          type: "string",
          enum: ["memory", "experience", "user", "tools"],
          description: "目标存储",
        },
        content: {
          type: "string",
          description: "条目内容（add 和 replace 必填）",
        },
        old_text: {
          type: "string",
          description: "定位已有条目的短子串（replace 和 remove 必填）",
        },
      },
      required: ["action", "target"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const action = params.action as string;
      const target = params.target as MemoryTarget;

      switch (action) {
        case "add": {
          if (!params.content) return { toolCallId: "", content: "错误: add 操作需要 content 参数。" };
          const result = store.add(target, params.content as string);
          return { toolCallId: "", content: result.success ? result.content! : `错误: ${result.error}` };
        }
        case "replace": {
          if (!params.old_text || !params.content) return { toolCallId: "", content: "错误: replace 操作需要 old_text 和 content 参数。" };
          const result = store.replace(target, params.old_text as string, params.content as string);
          return { toolCallId: "", content: result.success ? result.content! : `错误: ${result.error}` };
        }
        case "remove": {
          if (!params.old_text) return { toolCallId: "", content: "错误: remove 操作需要 old_text 参数。" };
          const result = store.remove(target, params.old_text as string);
          return { toolCallId: "", content: result.success ? result.content! : `错误: ${result.error}` };
        }
        case "read": {
          const result = store.read(target);
          return { toolCallId: "", content: result.content! };
        }
        default:
          return { toolCallId: "", content: `错误: 未知操作 "${action}"。支持: add, replace, remove, read` };
      }
    },
  };
}
