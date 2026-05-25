/**
 * Volcengine / Doubao Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-volcengine",
  name: "Volcengine / Doubao",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.VOLCENGINE_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "volcengine",
      name: "Volcengine / Doubao",
      apiKey,
      baseURL: "https://ark.cn-beijing.volces.com/api/v3",
      models: PROVIDER_CATALOGS.volcengine,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
