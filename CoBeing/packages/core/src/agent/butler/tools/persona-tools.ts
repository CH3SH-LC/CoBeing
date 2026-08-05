/**
 * 管家 persona 工具 — 让管家在对话中自主切换人格 / 记录用户对管家的偏好
 *
 * butler-set-persona   → 按用户喜好切换人格模板（亲密朋友/专业秘书/学习陪伴/家庭助理）
 * butler-list-personas → 列出可用人格模板
 * butler-update-style  → 记录用户偏好（称呼/欢迎语/语气 → CHARACTER.md「用户偏好」段 + config.json name）
 *
 * 文件操作与 WS 命令（api/handlers/butler-persona.ts）共用 persona-utils。
 */
import type { Tool, ToolResult } from "@cobeing/shared";
import {
  applyButlerPersona,
  applyButlerUserStyle,
  listButlerPersonas,
} from "../persona-utils.js";

export function makeSetPersonaTool(dataRoot: string): Tool {
  return {
    name: "butler-set-persona",
    description:
      "切换管家的人格模板（亲密朋友/专业秘书/学习陪伴/家庭助理）。用户明确表达对管家风格/称呼方式/相处方式的喜好时，调用本工具把人格切换到对应模板，立即生效。使用前可用 butler-list-personas 查看可用模板。",
    parameters: {
      type: "object",
      properties: {
        persona: {
          type: "string",
          description: "人格模板名称：亲密朋友 / 专业秘书 / 学习陪伴 / 家庭助理",
        },
      },
      required: ["persona"],
    },
    async execute(args): Promise<ToolResult> {
      const persona = typeof args.persona === "string" ? args.persona : "";
      const result = applyButlerPersona(dataRoot, persona);
      if (!result.ok) {
        return { toolCallId: "", content: `切换人格失败: ${result.error}`, isError: true };
      }
      return { toolCallId: "", content: `已切换管家人格为「${persona}」。` };
    },
  };
}

export function makeListPersonasTool(): Tool {
  return {
    name: "butler-list-personas",
    description: "列出所有可用的管家人格模板（如：亲密朋友/专业秘书/学习陪伴/家庭助理）及其当前人格。",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(): Promise<ToolResult> {
      const personas = listButlerPersonas();
      if (personas.length === 0) return { toolCallId: "", content: "暂无可用的人格模板" };
      const lines = personas.map(p => `- ${p.id}（${p.name}）`);
      return { toolCallId: "", content: `可用管家人格模板：\n${lines.join("\n")}` };
    },
  };
}

export function makeUpdateStyleTool(dataRoot: string): Tool {
  return {
    name: "butler-update-style",
    description:
      "记录用户对管家的偏好：称呼（用户希望你怎么叫TA）、欢迎语、语气偏好。写入管家的 CHARACTER.md「用户偏好」区，长期生效。用户聊天中表达「怎么称呼我/就这么叫/说话别太正式」等偏好的第一时间调用。",
    parameters: {
      type: "object",
      properties: {
        nickname: { type: "string", description: "用户希望管家怎么称呼TA（如：小林 / 主人 / 老板）" },
        greeting: { type: "string", description: "欢迎语（可选）" },
        tone: { type: "string", description: "语气偏好（如：轻松随意 / 简洁干练 / 温暖亲切）" },
      },
      required: [],
    },
    async execute(args): Promise<ToolResult> {
      const result = applyButlerUserStyle(dataRoot, {
        nickname: args.nickname,
        greeting: args.greeting,
        tone: args.tone,
      });
      if (!result.ok) {
        return { toolCallId: "", content: `记录偏好失败: ${result.error}`, isError: true };
      }
      return { toolCallId: "", content: "已记录你对管家的偏好。" };
    },
  };
}
