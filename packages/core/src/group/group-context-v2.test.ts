import { describe, it, expect } from "vitest";
import { GroupContextV2 } from "./group-context-v2.js";

describe("GroupContextV2", () => {
  describe("getVisibleMessages", () => {
    it("returns all main messages for any agent", () => {
      const ctx = new GroupContextV2("test-group");
      ctx.append("agent-1", "hello", "main");
      ctx.append("agent-2", "world", "main");

      const visible = ctx.getVisibleMessages("agent-3");
      expect(visible).toHaveLength(2);
      expect(visible[0].content).toBe("hello");
    });

    it("includes talk messages only for members", () => {
      const ctx = new GroupContextV2("test-group");
      ctx.append("agent-1", "main msg", "main");
      const talkId = ctx.createTalk(["agent-1", "agent-2"], "topic");
      ctx.append("agent-1", "talk msg", talkId);

      // agent-3 不在 talk 中，只能看到 main
      const visible3 = ctx.getVisibleMessages("agent-3");
      expect(visible3).toHaveLength(1);
      expect(visible3[0].tag).toBe("main");

      // agent-1 在 talk 中，能看到两条
      const visible1 = ctx.getVisibleMessages("agent-1");
      expect(visible1).toHaveLength(2);
    });

    it("supports sinceIndex for incremental sync", () => {
      const ctx = new GroupContextV2("test-group");
      ctx.append("agent-1", "msg1", "main");
      ctx.append("agent-1", "msg2", "main");
      ctx.append("agent-1", "msg3", "main");

      const visible = ctx.getVisibleMessages("agent-2", 1);
      expect(visible).toHaveLength(2);
      expect(visible[0].content).toBe("msg2");
    });
  });
});
