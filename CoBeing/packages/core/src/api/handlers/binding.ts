/**
 * binding 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * add_binding / remove_binding / list_bindings / bind_channel / unbind_channel
 */
import fs from "node:fs";
import path from "node:path";
import { setNestedValue } from "../security.js";
import type { HandlerRegistrar } from "./types.js";

export function registerBindingHandlers(register: HandlerRegistrar): void {
  register("add_binding", function (ws, msg) {
    const { agentId, workspacePath, mode, label } = msg.payload as {
      agentId: string;
      workspacePath: string;
      mode: "readonly" | "readwrite";
      label?: string;
    };
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }

    // 安全校验：符号链接解析
    let realPath: string;
    try { realPath = fs.realpathSync(workspacePath); } catch {
      this.sendToClient(ws, { type: "error", payload: { message: `路径不存在或无法解析: ${workspacePath}` } });
      return;
    }

    // 安全校验：禁止系统目录（含根目录）
    const FORBIDDEN = [
      /^\/etc(\/|$)/, /^\/proc(\/|$)/, /^\/sys(\/|$)/, /^\/dev(\/|$)/,
      /^\/$/,
      /^[A-Z]:\\$/i,
      /[\\/]Windows[\\/]/i, /[\\/]Program Files[\\/]/i, /[\\/]ProgramData[\\/]/i,
      /[\\/]\.ssh[\\/]/, /[\\/]\.gnupg[\\/]/, /[\\/]\.aws[\\/]/, /[\\/]\.config[\\/]/,
    ];
    let blocked = false;
    for (const re of FORBIDDEN) {
      if (re.test(realPath)) {
        this.sendToClient(ws, { type: "error", payload: { message: `禁止绑定系统/敏感目录: ${workspacePath}` } });
        blocked = true;
        break;
      }
    }
    if (blocked) return;

    // 安全校验：禁止绑定 CoBeing 其他 Agent 数据目录
    const agentsDir = path.join(this.dataRoot, "agents");
    if (realPath.startsWith(agentsDir)) {
      const rel = path.relative(agentsDir, realPath);
      const agentIdFromPath = rel.split(path.sep)[0];
      if (agentIdFromPath && agentIdFromPath !== agentId) {
        this.sendToClient(ws, { type: "error", payload: { message: "禁止绑定其他 Agent 的数据目录" } });
        return;
      }
    }

    agent.addBinding({ path: realPath, mode, label });
    this.sendToClient(ws, { type: "binding_added", payload: { agentId, bindings: agent.bindings } });
    this.logMessage("system", `Binding added for ${agent.name}: ${realPath} (${mode})`);
    this.broadcastState();
  });

  register("remove_binding", function (ws, msg) {
    const { agentId, workspacePath } = msg.payload as { agentId: string; workspacePath: string };
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }
    agent.removeBinding(workspacePath);
    this.sendToClient(ws, { type: "binding_removed", payload: { agentId, bindings: agent.bindings } });
    this.broadcastState();
  });

  register("list_bindings", function (ws, msg) {
    const { agentId } = msg.payload as { agentId: string };
    const agent = this.agentRegistry?.get(agentId);
    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }
    this.sendToClient(ws, { type: "bindings_list", payload: { agentId, bindings: agent.bindings } });
  });

  register("bind_channel", function (ws, msg) {
    const { channelName, targetType, targetId } = msg.payload as {
      channelName: string;
      targetType: "agent" | "group";
      targetId: string;
    };
    if (!channelName || !targetType || !targetId) {
      this.sendToClient(ws, { type: "error", payload: { message: "channelName, targetType, targetId are required" } });
      return;
    }
    if (!this.router) {
      this.sendToClient(ws, { type: "error", payload: { message: "Router not available" } });
      return;
    }
    if (targetType === "group" && this.groupManager && !this.groupManager.get(targetId)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${targetId}` } });
      return;
    }
    if (targetType === "agent" && this.agentRegistry && !this.agentRegistry.get(targetId)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${targetId}` } });
      return;
    }
    const entry = targetType === "agent"
      ? { type: "agent" as const, agentId: targetId }
      : { type: "group" as const, groupId: targetId };
    this.router.bind(channelName, entry);
    // 持久化到 config/default.json
    try {
      const cfgPath = this.configPath || path.resolve("config/default.json");
      const raw = fs.readFileSync(cfgPath, "utf-8");
      const config = JSON.parse(raw);
      setNestedValue(config, `channels.${channelName}.bindTo`, entry);
      fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch (err) {
      this.logMessage("system", `Failed to persist binding: ${err}`);
    }
    this.logMessage("system", `Channel ${channelName} bound to ${targetType} ${targetId}`);
    this.sendToClient(ws, { type: "channel_bound", payload: { channelName, targetType, targetId } });
  });

  register("unbind_channel", function (ws, msg) {
    const { channelName: unbindName } = msg.payload as { channelName: string };
    if (!unbindName) {
      this.sendToClient(ws, { type: "error", payload: { message: "channelName is required" } });
      return;
    }
    if (!this.router) {
      this.sendToClient(ws, { type: "error", payload: { message: "Router not available" } });
      return;
    }
    this.router.unbind(unbindName);
    // 持久化：移除 bindTo
    try {
      const cfgPath = this.configPath || path.resolve("config/default.json");
      const raw = fs.readFileSync(cfgPath, "utf-8");
      const config = JSON.parse(raw);
      setNestedValue(config, `channels.${unbindName}.bindTo`, null);
      fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch (err) {
      this.logMessage("system", `Failed to persist unbinding: ${err}`);
    }
    this.logMessage("system", `Channel ${unbindName} unbound`);
    this.sendToClient(ws, { type: "channel_unbound", payload: { channelName: unbindName } });
  });
}
