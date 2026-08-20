/**
 * registerConfigChannels 测试 — 从 config.channels 构造并注册 QQBotChannel
 *
 * mock @cobeing/channels：捕获 QQBotChannel 构造参数 + 隔离的注册表
 * （vi.mock 工厂内自建状态，避免提升导致的外层变量 TDZ）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encrypt } from "../config/secret-store.js";
import { registerConfigChannels } from "./channels.js";
import { getChannel } from "@cobeing/channels";
import type { AppConfig } from "../config/schema.js";

const captured: Array<{ config: Record<string, unknown> }> = [];
const registry = new Map<string, unknown>();

vi.mock("@cobeing/channels", () => {
  class MockQQBotChannel {
    readonly id = "qqbot";
    readonly name = "QQ Bot (Official API v2)";
    constructor(config: Record<string, unknown>) {
      captured.push({ config });
    }
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async send(): Promise<void> {}
    onMessage(): void {}
    capabilities() {
      return {};
    }
    isConnected(): boolean {
      return false;
    }
  }
  return {
    registerChannel: (ch: { id: string }) => {
      registry.set(ch.id, ch);
    },
    getChannel: (id: string) => registry.get(id),
    getAllChannels: () => [...registry.values()],
    QQBotChannel: MockQQBotChannel,
  };
});

/** 构造最小 AppConfig（channels 之外的字段填默认值） */
function makeConfig(channels: unknown): AppConfig {
  return {
    core: { logLevel: "info", dataDir: "./data" },
    agents: [],
    providers: {},
    channels: channels as AppConfig["channels"],
  };
}

const QQ_CHANNEL = {
  enabled: true,
  type: "qqbot" as const,
  qqbotAppId: "app-1",
  qqbotAppSecret: "sec-1",
  qqbotIntents: 123,
};

describe("registerConfigChannels", () => {
  beforeEach(() => {
    captured.length = 0;
    registry.clear();
  });

  afterEach(() => {
    delete process.env.QQ_BOT_APP_ID;
    delete process.env.QQ_BOT_APP_SECRET;
  });

  it("type='qqbot' 且 enabled 时构造 QQBotChannel 并注册", () => {
    registerConfigChannels(makeConfig({ qqbot: QQ_CHANNEL }));

    const ch: any = getChannel("qqbot");
    expect(ch).toBeDefined();
    expect(ch.id).toBe("qqbot");
    expect(captured.length).toBe(1);
    expect(captured[0].config).toEqual({
      appId: "app-1",
      appSecret: "sec-1",
      intents: 123,
    });
  });

  it("enc: 前缀凭据先解密再传给 QQBotChannel", () => {
    registerConfigChannels(makeConfig({
      qqbot: {
        ...QQ_CHANNEL,
        qqbotAppId: encrypt("real-app-id"),
        qqbotAppSecret: encrypt("real-app-secret"),
      },
    }));

    expect(captured[0].config).toEqual({
      appId: "real-app-id",
      appSecret: "real-app-secret",
      intents: 123,
    });
  });

  it("凭据缺省时回退 process.env.QQ_BOT_APP_ID / QQ_BOT_APP_SECRET", () => {
    process.env.QQ_BOT_APP_ID = "env-app-id";
    process.env.QQ_BOT_APP_SECRET = "env-app-secret";

    registerConfigChannels(makeConfig({
      qqbot: { enabled: true, type: "qqbot" },
    }));

    expect(captured[0].config).toEqual({
      appId: "env-app-id",
      appSecret: "env-app-secret",
      intents: undefined,
    });
  });

  it("非 qqbot 类型条目跳过", () => {
    registerConfigChannels(makeConfig({
      other: { enabled: true, type: "other" as any },
    }));

    expect(getChannel("qqbot")).toBeUndefined();
    expect(captured.length).toBe(0);
  });

  it("enabled=false 条目跳过（不注册，避免被 startChannels 阶段 2 当插件 channel 启动）", () => {
    registerConfigChannels(makeConfig({
      qqbot: { ...QQ_CHANNEL, enabled: false },
    }));

    expect(getChannel("qqbot")).toBeUndefined();
    expect(captured.length).toBe(0);
  });

  it("重复调用幂等：已注册则跳过，不重复构造", () => {
    registerConfigChannels(makeConfig({ qqbot: QQ_CHANNEL }));
    const first: any = getChannel("qqbot");

    registerConfigChannels(makeConfig({ qqbot: QQ_CHANNEL }));
    const second: any = getChannel("qqbot");

    expect(second).toBe(first);
    expect(captured.length).toBe(1);
  });
});
