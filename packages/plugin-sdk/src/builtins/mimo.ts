/**
 * MiMo Provider — 内置插件
 */
import { OpenAICompatProvider, PROVIDER_CATALOGS } from "@cobeing/providers";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-mimo",
  name: "MiMo",
  kind: "model-provider",

  register(api: CoBeingPluginApi): void {
    const apiKey = process.env.MIMO_API_KEY || "";
    const provider = new OpenAICompatProvider({
      id: "mimo",
      name: "MiMo",
      apiKey,
      baseURL: "https://api.xiaomimimo.com/v1",
      models: PROVIDER_CATALOGS.mimo,
    });
    api.registerModelProvider(provider);
  },
};

export default plugin;
