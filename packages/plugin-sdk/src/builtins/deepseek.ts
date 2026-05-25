/**
 * DeepSeek Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-deepseek",
  name: "DeepSeek Provider",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.DEEPSEEK_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "deepseek",
      name: "DeepSeek",
      apiKey,
      baseURL: "https://api.deepseek.com",
      models: PROVIDER_CATALOGS.deepseek,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
