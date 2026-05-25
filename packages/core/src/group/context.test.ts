import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GroupContext, Talk } from "./context.js";

describe("GroupContext", () => {
  let tmpDir: string;
  let ctx: GroupContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "group-ctx-test-"));
    ctx = new GroupContext("test-group", tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Main channel", () => {
    it("allows speaking to main channel", () => {
      const msg = ctx.speakToMain("agent-1", "Hello everyone!");
      expect(msg.fromAgentId).toBe("agent-1");
      expect(msg.content).toBe("Hello everyone!");
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it("parses @mention from message", () => {
      const msg = ctx.speakToMain("agent-1", "@agent-2 what do you think?");
      expect(msg.mentionTarget).toBe("agent-2");
    });

    it("detects @all mention", () => {
      ctx.speakToMain("agent-1", "@all please respond");
      const mentions = ctx.getPendingMentions("agent-2", 0);
      expect(mentions).toHaveLength(1);
      expect(mentions[0].mentionTarget).toBe("all");
    });

    it("getPendingMentions filters by agentId", () => {
      ctx.speakToMain("agent-1", "@agent-2 respond please");
      ctx.speakToMain("agent-1", "@agent-3 also respond");

      expect(ctx.getPendingMentions("agent-2", 0)).toHaveLength(1);
      expect(ctx.getPendingMentions("agent-3", 0)).toHaveLength(1);
      expect(ctx.getPendingMentions("agent-1", 0)).toHaveLength(0);
    });

    it("getPendingMentions respects sinceIndex", () => {
      ctx.speakToMain("agent-1", "@agent-2 msg 1");
      ctx.speakToMain("agent-1", "@agent-2 msg 2");

      expect(ctx.getPendingMentions("agent-2", 1)).toHaveLength(1);
      expect(ctx.getPendingMentions("agent-2", 0)).toHaveLength(2);
    });

    it("persists main channel to file", () => {
      ctx.speakToMain("agent-1", "Hello");
      ctx.speakToMain("agent-2", "World");
      ctx.saveMain();

      const mainFile = path.join(tmpDir, "groups", "test-group", "main.md");
      expect(fs.existsSync(mainFile)).toBe(true);
      const content = fs.readFileSync(mainFile, "utf-8");
      expect(content).toContain("agent-1");
      expect(content).toContain("World");
    });

    it("notifies listeners on main channel messages", () => {
      const received: ChannelMessage[] = [];
      ctx.onMainMessage((msg) => received.push(msg));

      ctx.speakToMain("agent-1", "Hello");
      ctx.speakToMain("agent-2", "World");

      expect(received).toHaveLength(2);
      expect(received[0].content).toBe("Hello");
      expect(received[1].content).toBe("World");
    });

    it("supports multiple listeners", () => {
      const received1: ChannelMessage[] = [];
      const received2: ChannelMessage[] = [];
      ctx.onMainMessage((msg) => received1.push(msg));
      ctx.onMainMessage((msg) => received2.push(msg));

      ctx.speakToMain("agent-1", "test");

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });
  });

  describe("Talk channels", () => {
    it("creates a talk", () => {
      const talk = ctx.createTalk(["agent-1", "agent-2"], "Interface design");
      expect(talk.id).toBe("talk-001");
      expect(talk.members).toEqual(["agent-1", "agent-2"]);
      expect(talk.topic).toBe("Interface design");
    });

    it("increments talk IDs", () => {
      ctx.createTalk(["a", "b"], "topic 1");
      const talk2 = ctx.createTalk(["c", "d"], "topic 2");
      expect(talk2.id).toBe("talk-002");
    });

    it("lists talks", () => {
      ctx.createTalk(["a", "b"], "t1");
      ctx.createTalk(["c", "d"], "t2");
      expect(ctx.listTalks()).toHaveLength(2);
    });

    it("saves talk to file", () => {
      const talk = ctx.createTalk(["a", "b"], "test topic");
      talk.speak("a", "Hello");
      ctx.saveTalk(talk.id);

      const talkFile = path.join(tmpDir, "groups", "test-group", "talks", `${talk.id}.md`);
      expect(fs.existsSync(talkFile)).toBe(true);
      const content = fs.readFileSync(talkFile, "utf-8");
      expect(content).toContain("test topic");
      expect(content).toContain("Hello");
    });
  });

  describe("Talk class", () => {
    let talk: Talk;

    beforeEach(() => {
      talk = new Talk({
        id: "talk-001",
        groupId: "test-group",
        members: ["agent-1", "agent-2"],
        topic: "Design review",
        createdAt: Date.now(),
      });
    });

    it("allows members to speak", () => {
      const msg = talk.speak("agent-1", "I think we should use hooks");
      expect(msg.fromAgentId).toBe("agent-1");
      expect(msg.content).toBe("I think we should use hooks");
    });

    it("returns history", () => {
      talk.speak("agent-1", "msg1");
      talk.speak("agent-2", "msg2");
      expect(talk.getHistory()).toHaveLength(2);
    });

    it("checks membership", () => {
      expect(talk.isMember("agent-1")).toBe(true);
      expect(talk.isMember("agent-3")).toBe(false);
    });
  });

  describe("Config persistence", () => {
    it("saves group config", () => {
      ctx.saveConfig(["a", "b", "c"]);

      const configFile = path.join(tmpDir, "groups", "test-group", "config.json");
      expect(fs.existsSync(configFile)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      expect(config.members).toEqual(["a", "b", "c"]);
    });
  });
});
