import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ChannelRouter } from "./router.js";
import { GroupManager } from "./manager.js";
import { AgentRegistry } from "../agent/registry.js";
import type { InboundMessage } from "@cobeing/shared";

describe("ChannelRouter", () => {
  let tmpDir: string;
  let router: ChannelRouter;
  let groupManager: GroupManager;
  let registry: AgentRegistry;
  let butlerMessages: InboundMessage[];
  let agentMessages: Array<{ agentId: string; msg: InboundMessage }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    registry = new AgentRegistry();
    groupManager = new GroupManager(registry, tmpDir);
    butlerMessages = [];
    agentMessages = [];

    router = new ChannelRouter(groupManager, {
      onButlerMessage: async (msg) => { butlerMessages.push(msg); },
      onAgentMessage: async (agentId, msg) => { agentMessages.push({ agentId, msg }); },
    });

    // 创建一个群组
    groupManager.create({
      id: "debate",
      name: "Debate Group",
      members: ["agent-a"],
      owner: "owner-agent",
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

  describe("bind to group", () => {
    it("injects message to group main channel", async () => {
      router.bind("ch-qq", { type: "group", groupId: "debate" });

      await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "discuss React vs Vue" });

      const group = groupManager.get("debate")!;
      const msgs = group.ctxV2.getMessages().filter(m => m.tag === "main");
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0].fromAgentId).toBe("user");
      expect(msgs[0].content).toBe("discuss React vs Vue");
    });

    it("returns recent main history as response", async () => {
      router.bind("ch-qq", { type: "group", groupId: "debate" });

      // Pre-populate some messages
      const group = groupManager.get("debate")!;
      group.postMessage("agent-a", "previous message");

      const result = await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "new message" });
      expect(result).toContain("previous message");
    });

    it("falls back to butler when group not found", async () => {
      router.bind("ch-qq", { type: "group", groupId: "nonexistent" });

      await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(butlerMessages).toHaveLength(1);
    });
  });

  describe("bind to agent", () => {
    it("routes message to bound agent", async () => {
      router.bind("ch-qq", { type: "agent", agentId: "my-agent" });

      await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "hello agent" });
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].agentId).toBe("my-agent");
      expect(agentMessages[0].msg.content).toBe("hello agent");
    });

    it("does not route to butler when bound to agent", async () => {
      router.bind("ch-qq", { type: "agent", agentId: "my-agent" });

      await router.route("ch-qq", { channelId: "ch-qq", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(butlerMessages).toHaveLength(0);
    });
  });

  describe("dynamic binding", () => {
    it("unbind restores default butler routing", async () => {
      router.bind("ch-1", { type: "group", groupId: "debate" });
      router.unbind("ch-1");

      await router.route("ch-1", { channelId: "ch-1", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(butlerMessages).toHaveLength(1);
    });

    it("can rebind to different target", async () => {
      router.bind("ch-1", { type: "group", groupId: "debate" });
      router.bind("ch-1", { type: "agent", agentId: "my-agent" });

      await router.route("ch-1", { channelId: "ch-1", channelType: "qq", senderId: "u1", senderName: "User", content: "hello" });
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].agentId).toBe("my-agent");
    });
  });

  describe("static config loading", () => {
    it("loads bindings from config", () => {
      router.loadBindings({
        "ch-qq": { type: "group", groupId: "debate" },
        "ch-agent": { type: "agent", agentId: "my-agent" },
      });

      expect(router.getBinding("ch-qq")).toEqual({ type: "group", groupId: "debate" });
      expect(router.getBinding("ch-agent")).toEqual({ type: "agent", agentId: "my-agent" });
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
