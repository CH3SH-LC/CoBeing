import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ChannelRouter } from "./router.js";
import { GroupManager } from "./manager.js";
import { AgentRegistry } from "../agent/registry.js";
import type { InboundMessage } from "@myagents/shared";

describe("ChannelRouter", () => {
  let tmpDir: string;
  let router: ChannelRouter;
  let groupManager: GroupManager;
  let registry: AgentRegistry;
  let butlerMessages: InboundMessage[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    registry = new AgentRegistry();
    groupManager = new GroupManager(registry, tmpDir);
    butlerMessages = [];

    router = new ChannelRouter(groupManager, {
      onButlerMessage: async (msg) => { butlerMessages.push(msg); },
    });

    // 创建一个群组
    groupManager.create({
      id: "debate",
      name: "Debate Group",
      members: ["agent-a"],
      owner: "owner-agent",
      protocol: "round-robin",
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("no binding", () => {
    it("routes to butler when no bindTo configured", async () => {
      await router.route("ch-1", { channelId: "ch-1", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(butlerMessages).toHaveLength(1);
      expect(butlerMessages[0].content).toBe("hello");
    });
  });

  describe("bind to group as user", () => {
    it("injects message to group main channel", async () => {
      router.bind("ch-qq", "debate", "user");

      const received: string[] = [];
      const ctx = groupManager.getContext("debate")!;
      ctx.onMainMessage((msg) => received.push(msg.content));

      await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "discuss React vs Vue" });

      const history = ctx.getMainHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].fromAgentId).toBe("user");
      expect(history[0].content).toBe("discuss React vs Vue");
    });

    it("returns recent main history as response", async () => {
      router.bind("ch-qq", "debate", "user");

      // Pre-populate some messages
      const ctx = groupManager.getContext("debate")!;
      ctx.speakToMain("agent-a", "previous message");

      const result = await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "new message" });
      expect(result).toContain("previous message");
    });
  });

  describe("bind to group as owner", () => {
    it("creates persistent talk and injects message", async () => {
      router.bind("ch-discord", "debate", "owner");

      await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "让 agent-a 先发言" });

      const ctx = groupManager.getContext("debate")!;
      const talks = ctx.listTalks();
      expect(talks.length).toBeGreaterThanOrEqual(1);

      // Talk 的 topic 格式: "talk:channel:{channelId}"
      const ownerTalk = talks.find(t => t.topic === "talk:channel:ch-discord");
      expect(ownerTalk).toBeDefined();
      expect(ownerTalk!.getHistory()).toHaveLength(1);
      expect(ownerTalk!.getHistory()[0].content).toBe("让 agent-a 先发言");
    });

    it("reuses same talk on subsequent messages", async () => {
      router.bind("ch-discord", "debate", "owner");

      await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "message 1" });
      await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "message 2" });

      const ctx = groupManager.getContext("debate")!;
      const ownerTalk = ctx.listTalks().find(t => t.topic === "talk:channel:ch-discord");
      expect(ownerTalk!.getHistory()).toHaveLength(2);
    });
  });

  describe("dynamic binding", () => {
    it("unbind restores default butler routing", async () => {
      router.bind("ch-1", "debate", "user");
      router.unbind("ch-1");

      await router.route("ch-1", { channelId: "ch-1", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(butlerMessages).toHaveLength(1);
    });

    it("unbind owner mode cleans up talk reference", async () => {
      router.bind("ch-discord", "debate", "owner");
      await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "msg" });

      const ctx = groupManager.getContext("debate")!;
      expect(ctx.listTalks().find(t => t.topic === "talk:channel:ch-discord")).toBeDefined();

      router.unbind("ch-discord");
      // Talk data remains in GroupContext, but router reference is cleared
    });
  });

  describe("static config loading", () => {
    it("loads bindings from config", () => {
      router.loadBindings({
        "ch-qq": { type: "group", groupId: "debate", role: "user" },
        "ch-discord": { type: "group", groupId: "debate", role: "owner" },
      });

      expect(router.getBinding("ch-qq")).toEqual({ type: "group", groupId: "debate", role: "user" });
      expect(router.getBinding("ch-discord")).toEqual({ type: "group", groupId: "debate", role: "owner" });
    });
  });

  describe("setButlerCallback", () => {
    it("allows updating butler callback", async () => {
      const newMessages: InboundMessage[] = [];
      router.setButlerCallback(async (msg) => { newMessages.push(msg); });

      await router.route("ch-1", { channelId: "ch-1", channelType: "qq", senderId: "u1", senderName: "User", content: "new callback" });
      expect(newMessages).toHaveLength(1);
      expect(butlerMessages).toHaveLength(0);
    });
  });
});
