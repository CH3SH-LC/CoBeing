/**
 * QQ Bot Channel — 内置插件
 */
import { QQBotChannel } from "@cobeing/channels";
import type { CoBeingPlugin, CoBeingPluginApi } from "../types.js";

const plugin: CoBeingPlugin = {
  id: "cobeing-plugin-qqbot",
  name: "QQ Bot Channel",
  kind: "channel",

  register(api: CoBeingPluginApi): void {
    const appId = process.env.QQBOT_APP_ID || "";
    const appSecret = process.env.QQBOT_APP_SECRET || "";
    const channel = new QQBotChannel({
      appId,
      appSecret,
      intents: 0,
    });
    api.registerChannel(channel);
  },
};

export default plugin;
