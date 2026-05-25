import { describe, it, expect, beforeEach } from "vitest";
import { AgentEventBus } from "./event-bus.js";

describe("AgentEventBus", () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = new AgentEventBus();
  });

  it("agent 订阅并接收 @mention 消息", () => {
    const received: Array<{ from: string; message: string; groupId: string }> = [];
    bus.subscribe("react-expert", (msg) => {
      received.push({ from: msg.fromAgentId, message: msg.content, groupId: msg.groupId! });
    });

    bus.emit("group-message", {
      groupId: "team-1",
      fromAgentId: "moderator",
      content: "@react-expert 请分析这个组件",
      mentionTarget: "react-expert",
    });

    expect(received).toHaveLength(1);
    expect(received[0].groupId).toBe("team-1");
    expect(received[0].message).toContain("react-expert");
  });

  it("多个 agent 订阅同一事件", () => {
    const a1Messages: unknown[] = [];
    const a2Messages: unknown[] = [];

    bus.subscribe("agent-1", () => a1Messages.push("called"));
    bus.subscribe("agent-2", () => a2Messages.push("called"));

    bus.emit("group-message", {
      groupId: "g1",
      fromAgentId: "owner",
      content: "@all 紧急会议",
      mentionTarget: "all",
    });

    expect(a1Messages).toHaveLength(1);
    expect(a2Messages).toHaveLength(1);
  });

  it("取消订阅后不再接收消息", () => {
    const messages: unknown[] = [];
    const unsub = bus.subscribe("agent-1", () => messages.push("called"));

    unsub();
    bus.emit("group-message", {
      groupId: "g1",
      fromAgentId: "owner",
      content: "@agent-1 hello",
      mentionTarget: "agent-1",
    });

    expect(messages).toHaveLength(0);
  });

  it("task-complete 事件触发经验反思", () => {
    const reflected: Array<{ agentId: string; task: string }> = [];
    bus.onReflection((agentId, task) => {
      reflected.push({ agentId, task });
    });

    bus.emit("task-complete", {
      agentId: "dev-agent",
      task: "修复内存泄漏",
      response: "已修复",
    });

    expect(reflected).toHaveLength(1);
    expect(reflected[0].agentId).toBe("dev-agent");
  });

  it("自发消息：agent 主动发起通信", () => {
    const received: Array<{ from: string; to: string; message: string }> = [];
    bus.subscribe("target-agent", (msg) => {
      received.push({ from: msg.fromAgentId, to: "target-agent", message: msg.content });
    });

    bus.emit("agent-direct", {
      fromAgentId: "source-agent",
      targetAgentId: "target-agent",
      content: "我发现了这个问题需要你处理",
    });

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("source-agent");
    expect(received[0].message).toContain("需要你处理");
  });

  it("事件历史记录", () => {
    bus.emit("group-message", {
      groupId: "g1", fromAgentId: "a1", content: "test", mentionTarget: "a2",
    });

    const history = bus.getHistory("group-message");
    expect(history).toHaveLength(1);
  });
});
