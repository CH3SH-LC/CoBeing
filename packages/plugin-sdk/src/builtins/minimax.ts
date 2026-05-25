/**
 * MiniMax Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-minimax",
  name: "MiniMax",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.MINIMAX_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "minimax",
      name: "MiniMax",
      apiKey,
      baseURL: "https://api.minimaxi.com/v1",
      models: PROVIDER_CATALOGS.minimax,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
