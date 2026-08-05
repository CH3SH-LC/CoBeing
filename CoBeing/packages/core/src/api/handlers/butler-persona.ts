/**
 * butler 人格域 WS 命令 handler — 管家人格模板查询 / 切换 / 风格更新
 *
 * butler_get_personas   → butler_personas { personas: [{id, name}], current }
 * butler_set_persona    → 校验模板 → 复制 CHARACTER.md/JOB.md 到 data/coreagents/butler/ → butler_persona_set { ok, persona }
 * butler_update_style   → apply=true 时写 CHARACTER.md「用户偏好」段 + config.json name → butler_style_updated { ok }
 *
 * 文件操作逻辑与管家工具共用（agent/butler/persona-utils.ts）。
 */
import type { HandlerRegistrar } from "./types.js";
import {
  listButlerPersonas,
  detectCurrentPersona,
  applyButlerPersona,
  applyButlerUserStyle,
} from "../../agent/butler/persona-utils.js";

export function registerButlerPersonaHandlers(register: HandlerRegistrar): void {
  register("butler_get_personas", function (ws, _msg) {
    const personas = listButlerPersonas();
    const current = detectCurrentPersona(this.dataRoot);
    this.sendToClient(ws, {
      type: "butler_personas",
      payload: { personas, current },
    });
  });

  register("butler_set_persona", function (ws, msg) {
    const payload = (msg.payload ?? {}) as { persona?: unknown };
    const persona = payload.persona;
    if (typeof persona !== "string") {
      this.sendToClient(ws, { type: "error", payload: { message: "无效的 persona：必须是非空字符串" } });
      return;
    }
    const result = applyButlerPersona(this.dataRoot, persona);
    if (!result.ok) {
      this.sendToClient(ws, { type: "error", payload: { message: result.error } });
      return;
    }
    this.sendToClient(ws, {
      type: "butler_persona_set",
      payload: { ok: true, persona },
    });
  });

  register("butler_update_style", function (ws, msg) {
    const payload = (msg.payload ?? {}) as { nickname?: unknown; greeting?: unknown; tone?: unknown; apply?: unknown };
    const apply = payload.apply === true;

    if (!apply) {
      // 只校验不写入（预览模式）：dry-run 校验字段类型
      const dry = applyButlerUserStyle(this.dataRoot, {
        nickname: payload.nickname,
        greeting: payload.greeting,
        tone: payload.tone,
      }, false);
      if (!dry.ok) {
        this.sendToClient(ws, { type: "error", payload: { message: dry.error } });
        return;
      }
      this.sendToClient(ws, { type: "butler_style_updated", payload: { ok: true, applied: false } });
      return;
    }

    const result = applyButlerUserStyle(this.dataRoot, {
      nickname: payload.nickname,
      greeting: payload.greeting,
      tone: payload.tone,
    });
    if (!result.ok) {
      this.sendToClient(ws, { type: "error", payload: { message: result.error } });
      return;
    }
    this.sendToClient(ws, {
      type: "butler_style_updated",
      payload: { ok: true, applied: true },
    });
  });
}
