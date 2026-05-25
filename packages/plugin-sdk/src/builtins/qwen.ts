/**
 * Qwen Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-qwen",
  name: "Qwen",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.QWEN_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "qwen",
      name: "Qwen",
      apiKey,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      models: PROVIDER_CATALOGS.qwen,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
