import { describe, it, expect } from "vitest";
import { RoundRobinProtocol, FreeFormProtocol, ModeratedProtocol } from "./protocol.js";
import type { GroupMessage } from "@myagents/shared";

function mockAgent(id: string) {
  return { id, name: id } as any;
}
function msg(from: string): GroupMessage {
  return { groupId: "g1", fromAgentId: from, content: "hi", timestamp: Date.now() };
}

describe("RoundRobinProtocol", () => {
  const proto = new RoundRobinProtocol();
  const members = [mockAgent("a"), mockAgent("b"), mockAgent("c")];

  it("picks members in order each round", () => {
    expect(proto.pickSpeaker(members, [], 0, 0)?.id).toBe("a");
    expect(proto.pickSpeaker(members, [msg("a")], 0, 1)?.id).toBe("b");
    expect(proto.pickSpeaker(members, [msg("a"), msg("b")], 0, 2)?.id).toBe("c");
  });

  it("wraps to next round", () => {
    expect(proto.pickSpeaker(members, [msg("a"), msg("b"), msg("c")], 1, 0)?.id).toBe("a");
  });

  it("shouldContinue respects maxRounds", () => {
    expect(proto.shouldContinue(3, 0, 2)).toBe(true);
    expect(proto.shouldContinue(3, 2, 2)).toBe(false);
  });
});

describe("FreeFormProtocol", () => {
  const proto = new FreeFormProtocol();
  const members = [mockAgent("a"), mockAgent("b")];

  it("picks next unspoken member", () => {
    expect(proto.pickSpeaker(members, [], 0, 0)?.id).toBe("a");
    expect(proto.pickSpeaker(members, [msg("a")], 0, 0)?.id).toBe("b");
  });

  it("wraps around when all have spoken", () => {
    expect(proto.pickSpeaker(members, [msg("a"), msg("b")], 1, 0)?.id).toBe("a");
  });
});

describe("ModeratedProtocol", () => {
  const proto = new ModeratedProtocol("mod");
  const members = [mockAgent("mod"), mockAgent("a"), mockAgent("b")];

  it("moderator speaks first", () => {
    expect(proto.pickSpeaker(members, [], 0, 0)?.id).toBe("mod");
  });

  it("other members speak in middle", () => {
    expect(proto.pickSpeaker(members, [msg("mod")], 0, 1)?.id).toBe("a");
  });
});
