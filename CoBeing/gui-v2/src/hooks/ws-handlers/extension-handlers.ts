import type { PluginInfo } from "@/lib/types";
import { usePluginsStore } from "@/stores/plugins";
import { emitActivity } from "./helpers";
import type { WsHandlerContext, WsMessageHandler } from "./types";

export function buildExtensionHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler> {
  const { setConfig } = ctx;

  return {
    config: (msg) => {
      const p = msg.payload as {
        providers?: Record<string, unknown>;
        channels?: Record<string, unknown>;
        mcpServers?: Record<string, unknown>;
        version?: string;
      };
      window.dispatchEvent(new CustomEvent("ws-config-loaded", {
        detail: { ...p, version: (p as any).version },
      }));
      setConfig({
        providers: (p.providers || {}) as any,
        channels: (p.channels || {}) as any,
        mcpServers: (p.mcpServers || {}) as any,
      });
    },

    plugins: (msg) => {
      const p = msg.payload as PluginInfo[];
      usePluginsStore.getState().setPlugins(p);
    },

    plugin_toggled: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-plugin-toggled", { detail: msg.payload }));
    },

    plugin_config_updated: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-plugin-config-updated", { detail: msg.payload }));
    },

    config_updated: () => {
      // update_config 已经广播了完整的 config，不需要再请求
    },

    skill_list: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-skill-list", { detail: msg }));
    },

    skill_result: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-skill-result", { detail: msg }));
    },

    skill_doc: (msg) => {
      window.dispatchEvent(new CustomEvent("ws-skill-doc", { detail: msg }));
    },

    skill_created: (msg) => {
      const sc = msg.payload as { name: string };
      emitActivity("🛠️", `技能 "${sc.name}" 已创建`, "info", "system");
    },
  };
}
