/**
 * Zhipu / GLM Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-zhipu",
  name: "Zhipu / GLM",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.ZHIPU_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "zhipu",
      name: "Zhipu / GLM",
      apiKey,
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
      models: PROVIDER_CATALOGS.zhipu,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
