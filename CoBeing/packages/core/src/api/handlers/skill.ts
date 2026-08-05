/**
 * skill 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_skills / get_skill_doc / execute_skill / skill_create
 */
import { DEFAULT_PROVIDER } from "@cobeing/shared";
import type { HandlerRegistrar } from "./types.js";

export function registerSkillHandlers(register: HandlerRegistrar): void {
  register("get_skills", function (ws, msg) {
    if (!this.skillRepo) {
      this.sendToClient(ws, { type: "skill_list", payload: { skills: [] } });
      return;
    }
    const skills = this.skillRepo.list().map(s => ({
      name: s.name,
      description: s.description,
      tools: [] as string[],
    }));
    this.sendToClient(ws, { type: "skill_list", payload: { skills } });
  });

  register("get_skill_doc", function (ws, msg) {
    const { name } = msg.payload as { name: string };
    if (!name) {
      this.sendToClient(ws, { type: "error", payload: { message: "name is required" } });
      return;
    }
    if (!this.skillRepo) {
      this.sendToClient(ws, { type: "skill_doc", payload: { name, content: null } });
      return;
    }
    const skill = this.skillRepo.get(name);
    if (!skill) {
      this.sendToClient(ws, { type: "skill_doc", payload: { name, content: null } });
      return;
    }
    this.sendToClient(ws, { type: "skill_doc", payload: { name, content: skill.body } });
  });

  register("execute_skill", function (ws, msg) {
    const { name, task, params } = msg.payload as { name: string; task: string; params?: Record<string, unknown> };
    if (!name || !task) {
      this.sendToClient(ws, { type: "error", payload: { message: "name and task are required" } });
      return;
    }
    if (!this.skillRepo || !this.providerResolver) {
      this.sendToClient(ws, { type: "error", payload: { message: "Skill system not available" } });
      return;
    }
    const defaultProvider = this.providerResolver(DEFAULT_PROVIDER);
    if (!defaultProvider) {
      this.sendToClient(ws, { type: "error", payload: { message: "No default provider available" } });
      return;
    }
    this.skillRepo.execute(name, task, params || {}, () => defaultProvider)
      .then((result) => {
        this.sendToClient(ws, { type: "skill_result", payload: { name, result } });
      })
      .catch((err) => {
        this.sendToClient(ws, { type: "error", payload: { message: `Skill execution failed: ${err.message}` } });
      });
  });

  register("skill_create", function (ws, msg) {
    const { name: sName, description: sDesc, prompt: sPrompt } = msg.payload as {
      name: string; description: string; prompt: string;
    };
    if (!sName || !sDesc || !sPrompt) {
      this.sendToClient(ws, { type: "error", payload: { message: "name, description and prompt are required" } });
      return;
    }
    if (!this.skillRepo) {
      this.sendToClient(ws, { type: "error", payload: { message: "Skill system not available" } });
      return;
    }
    this.skillRepo.create(sName, sDesc, sPrompt);
    this.sendToClient(ws, { type: "skill_created", payload: { name: sName } });
  });
}
