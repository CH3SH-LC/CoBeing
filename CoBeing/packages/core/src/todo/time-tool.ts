// packages/core/src/todo/time-tool.ts
import type { Tool } from "@cobeing/shared";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const currentTimeTool: Tool = {
  name: "current-time",
  description: "获取当前系统时间。创建 TODO 时建议先调用此工具获取准确时间。",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(_params, _context): Promise<import("@cobeing/shared").ToolResult> {
    const now = new Date();
    const iso = now.toISOString();
    const weekday = WEEKDAYS[now.getDay()];
    return {
      toolCallId: "",
      content: `当前时间: ${iso} (星期${weekday})`,
    };
  },
};
