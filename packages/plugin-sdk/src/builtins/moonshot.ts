/**
 * Moonshot / Kimi Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-moonshot",
  name: "Moonshot / Kimi",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.MOONSHOT_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "moonshot",
      name: "Moonshot / Kimi",
      apiKey,
      baseURL: "https://api.moonshot.cn/v1",
      models: PROVIDER_CATALOGS.moonshot,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
