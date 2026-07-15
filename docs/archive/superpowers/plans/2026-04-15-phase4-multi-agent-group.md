# Phase 4: Multi-Agent + Groups + Butler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple Agents to cooperate through a central registry, group discussions with configurable protocols, agent-to-agent messaging, and a butler agent that can dynamically create agents and groups.

**Architecture:** AgentRegistry as single source of truth for all agents. GroupManager orchestrates group conversations using pluggable protocol strategies (round-robin, free-form, moderated). ButlerAgent extends Agent with management tools. MyAgentsRuntime ties everything together. agent-message tool uses registry to enable inter-agent calls with loop detection.

**Tech Stack:** TypeScript, Vitest, existing Agent/ToolExecutor infrastructure

---

## File Structure

### New files
- `packages/core/src/agent/registry.ts` — AgentRegistry
- `packages/core/src/agent/registry.test.ts` — tests
- `packages/core/src/group/protocol.ts` — GroupProtocol abstract + 3 implementations
- `packages/core/src/group/protocol.test.ts` — tests
- `packages/core/src/group/group.ts` — Group class
- `packages/core/src/group/group.test.ts` — tests
- `packages/core/src/group/manager.ts` — GroupManager
- `packages/core/src/group/manager.test.ts` — tests
- `packages/core/src/agent/butler.ts` — ButlerAgent + 6 butler tools
- `packages/core/src/agent/butler.test.ts` — tests
- `packages/core/src/runtime.ts` — MyAgentsRuntime

### Modified files
- `packages/shared/src/types.ts` — ToolContext.callDepth, GroupConfig.topic/maxRounds, AgentStatusInfo
- `packages/core/src/tools/agent-message.ts` — activate with AgentRegistry lookup
- `packages/core/src/tools/executor.ts` — pass callDepth through ToolContext
- `packages/core/src/config/schema.ts` — agents array + groups + backward compat
- `packages/core/src/agent/agent.ts` — accept optional AgentRegistry reference
- `packages/core/src/index.ts` — new exports
- `config/default.yaml` — multi-agent config
- `scripts/dev.ts` — use Runtime

---

### Task 1: Update shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add callDepth to ToolContext, extend GroupConfig, add AgentStatusInfo**

Find `ToolContext` interface and add `callDepth?`:
```typescript
export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
  callDepth?: number;      // inter-agent call depth for loop detection
}
```

Find `GroupConfig` and extend:
```typescript
export interface GroupConfig {
  id: string;
  name: string;
  members: string[];      // agent IDs
  protocol: GroupProtocol;
  moderator?: string;     // agent ID (moderated mode host)
  maxRounds?: number;     // max discussion rounds, default 10
  topic?: string;         // discussion topic
}
```

Add after `GroupMessage`:
```typescript
export interface AgentStatusInfo {
  id: string;
  name: string;
  status: string;
  model: string;
  provider: string;
}

export interface GroupStatusInfo {
  id: string;
  name: string;
  members: string[];
  protocol: string;
  messageCount: number;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd D:/agent-codes/myagents && npx tsc -p packages/shared/tsconfig.json`
Expected: PASS

---

### Task 2: AgentRegistry

**Files:**
- Create: `packages/core/src/agent/registry.ts`
- Create: `packages/core/src/agent/registry.test.ts`

- [ ] **Step 1: Write registry tests**

```typescript
import { describe, it, expect } from "vitest";
import { AgentRegistry } from "./registry.js";
import type { Agent } from "./agent.js";

// Minimal mock Agent
function mockAgent(id: string, name: string): Agent {
  return { id, name, getStatus: () => "idle" } as unknown as Agent;
}

describe("AgentRegistry", () => {
  it("registers and retrieves an agent", () => {
    const reg = new AgentRegistry();
    const a = mockAgent("a1", "coder");
    reg.register(a);
    expect(reg.get("a1")).toBe(a);
    expect(reg.get("nope")).toBeUndefined();
  });

  it("throws on duplicate ID", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    expect(() => reg.register(mockAgent("a1", "coder2"))).toThrow();
  });

  it("unregisters an agent", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    reg.unregister("a1");
    expect(reg.get("a1")).toBeUndefined();
    expect(reg.list()).toHaveLength(0);
  });

  it("lists all agents", () => {
    const reg = new AgentRegistry();
    reg.register(mockAgent("a1", "coder"));
    reg.register(mockAgent("a2", "reader"));
    expect(reg.list()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AgentRegistry**

```typescript
/**
 * AgentRegistry — global registry for all Agent instances
 */
import type { Agent } from "./agent.js";

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/registry.test.ts`
Expected: 4 PASS

---

### Task 3: GroupProtocol strategies

**Files:**
- Create: `packages/core/src/group/protocol.ts`
- Create: `packages/core/src/group/protocol.test.ts`

- [ ] **Step 1: Write protocol tests**

```typescript
import { describe, it, expect } from "vitest";
import { RoundRobinProtocol, FreeFormProtocol, ModeratedProtocol } from "./protocol.js";
import type { Agent } from "../agent/agent.js";
import type { GroupMessage } from "@myagents/shared";

function mockAgent(id: string): Agent {
  return { id, name: id } as unknown as Agent;
}

function msg(from: string): GroupMessage {
  return { groupId: "g1", fromAgentId: from, content: "hi", timestamp: Date.now() };
}

describe("RoundRobinProtocol", () => {
  const proto = new RoundRobinProtocol();
  const members = [mockAgent("a"), mockAgent("b"), mockAgent("c")];

  it("picks members in order each round", () => {
    // Round 0: a, b, c
    expect(proto.pickSpeaker(members, [], 0, 0)?.id).toBe("a");
    expect(proto.pickSpeaker(members, [msg("a")], 0, 0)?.id).toBe("b");
    expect(proto.pickSpeaker(members, [msg("a"), msg("b")], 0, 0)?.id).toBe("c");
    // Round 1: a again
    expect(proto.pickSpeaker(members, [msg("a"), msg("b"), msg("c")], 1, 0)?.id).toBe("a");
  });

  it("shouldContinue respects maxRounds", () => {
    expect(proto.shouldContinue(3, 0, 2)).toBe(true);
    expect(proto.shouldContinue(3, 1, 2)).toBe(true);
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

  it("always picks moderator to speak first", () => {
    expect(proto.pickSpeaker(members, [], 0, 0)?.id).toBe("mod");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/protocol.test.ts`

- [ ] **Step 3: Implement protocols**

```typescript
/**
 * GroupProtocol — strategy pattern for group discussion flow
 */
import type { Agent } from "../agent/agent.js";
import type { GroupMessage } from "@myagents/shared";

export abstract class GroupProtocolStrategy {
  abstract pickSpeaker(members: Agent[], history: GroupMessage[], round: number, step: number): Agent | null;
  abstract shouldContinue(totalMessages: number, round: number, maxRounds: number): boolean;
}

export class RoundRobinProtocol extends GroupProtocolStrategy {
  pickSpeaker(members: Agent[], _history: GroupMessage[], _round: number, step: number): Agent | null {
    return members[step % members.length] ?? null;
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export class FreeFormProtocol extends GroupProtocolStrategy {
  pickSpeaker(members: Agent[], history: GroupMessage[], _round: number, _step: number): Agent | null {
    // Find who hasn't spoken yet in this round
    const lastRoundStart = history.length - (history.length % members.length);
    const spokenThisRound = new Set(history.slice(lastRoundStart).map(m => m.fromAgentId));
    const unspoken = members.filter(m => !spokenThisRound.has(m.id));
    if (unspoken.length > 0) return unspoken[0];
    // All spoke, pick first
    return members[0];
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export class ModeratedProtocol extends GroupProtocolStrategy {
  constructor(private moderatorId: string) {
    super();
  }

  pickSpeaker(members: Agent[], history: GroupMessage[], _round: number, step: number): Agent | null {
    // Step 0: moderator speaks first and last
    if (step === 0 || step === members.length - 1) {
      return members.find(m => m.id === this.moderatorId) ?? members[0];
    }
    // Other steps: non-moderator members in order
    const nonMods = members.filter(m => m.id !== this.moderatorId);
    const modStep = step - 1;
    return nonMods[modStep % nonMods.length] ?? null;
  }

  shouldContinue(_totalMessages: number, round: number, maxRounds: number): boolean {
    return round < maxRounds;
  }
}

export function createProtocol(type: string, moderator?: string): GroupProtocolStrategy {
  switch (type) {
    case "round-robin": return new RoundRobinProtocol();
    case "free-form": return new FreeFormProtocol();
    case "moderated": return new ModeratedProtocol(moderator ?? "");
    default: return new RoundRobinProtocol();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/protocol.test.ts`
Expected: ALL PASS

---

### Task 4: Group class

**Files:**
- Create: `packages/core/src/group/group.ts`

- [ ] **Step 1: Implement Group class**

```typescript
/**
 * Group — a multi-agent discussion group
 */
import type { GroupConfig, GroupMessage } from "@myagents/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { GroupProtocolStrategy } from "./protocol.js";
import { createProtocol } from "./protocol.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("group");

export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  private history: GroupMessage[] = [];
  private protocol: GroupProtocolStrategy;
  private registry: AgentRegistry;

  constructor(config: GroupConfig, registry: AgentRegistry) {
    this.id = config.id;
    this.config = config;
    this.registry = registry;
    this.protocol = createProtocol(config.protocol, config.moderator);
  }

  /** Run a group discussion on a topic */
  async run(topic: string): Promise<GroupMessage[]> {
    const members = this.resolveMembers();
    if (members.length === 0) {
      log.warn("[%s] No members", this.id);
      return [];
    }

    const maxRounds = this.config.maxRounds ?? 10;

    for (let round = 0; round < maxRounds; round++) {
      let step = 0;
      while (step < members.length) {
        const speaker = this.protocol.pickSpeaker(members, this.history, round, step);
        if (!speaker) break;

        // Build context: topic + recent history
        const context = this.buildContext(topic);
        const prefix = round === 0 && step === 0
          ? `群组讨论主题: ${topic}\n\n你是 ${speaker.name}。请基于上下文发表你的观点。`
          : `你是 ${speaker.name}。请基于上下文继续讨论。`;

        try {
          const response = await speaker.run(`${prefix}\n\n${context}`);
          this.history.push({
            groupId: this.id,
            fromAgentId: speaker.id,
            content: response.content,
            timestamp: Date.now(),
          });
          log.info("[%s] Round %d Step %d: %s said (%d chars)", this.id, round, step, speaker.name, response.content.length);
        } catch (err) {
          log.warn("[%s] %s failed: %s", this.id, speaker.name, err);
        }

        step++;
      }

      if (!this.protocol.shouldContinue(this.history.length, round + 1, maxRounds)) {
        break;
      }
    }

    return [...this.history];
  }

  /** Add a message from external source */
  injectMessage(fromAgentId: string, content: string): void {
    this.history.push({
      groupId: this.id,
      fromAgentId,
      content,
      timestamp: Date.now(),
    });
  }

  getHistory(): GroupMessage[] {
    return [...this.history];
  }

  addMember(agentId: string): void {
    if (!this.config.members.includes(agentId)) {
      this.config.members.push(agentId);
    }
  }

  removeMember(agentId: string): void {
    this.config.members = this.config.members.filter(id => id !== agentId);
  }

  private resolveMembers(): Agent[] {
    return this.config.members
      .map(id => this.registry.get(id))
      .filter((a): a is Agent => a !== null && a !== undefined);
  }

  private buildContext(topic: string): string {
    if (this.history.length === 0) return topic;
    const recent = this.history.slice(-10);
    return recent.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");
  }
}
```

---

### Task 5: GroupManager

**Files:**
- Create: `packages/core/src/group/manager.ts`
- Create: `packages/core/src/group/manager.test.ts`

- [ ] **Step 1: Write GroupManager tests**

```typescript
import { describe, it, expect } from "vitest";
import { GroupManager } from "./manager.js";
import { AgentRegistry } from "../agent/registry.js";

describe("GroupManager", () => {
  it("creates and retrieves a group", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    const g = mgr.create({ id: "g1", name: "test", members: [], protocol: "round-robin" });
    expect(mgr.get("g1")).toBe(g);
  });

  it("lists groups", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    mgr.create({ id: "g1", name: "a", members: [], protocol: "round-robin" });
    mgr.create({ id: "g2", name: "b", members: [], protocol: "free-form" });
    expect(mgr.list()).toHaveLength(2);
  });

  it("deletes a group", () => {
    const reg = new AgentRegistry();
    const mgr = new GroupManager(reg);
    mgr.create({ id: "g1", name: "a", members: [], protocol: "round-robin" });
    mgr.delete("g1");
    expect(mgr.get("g1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement GroupManager**

```typescript
/**
 * GroupManager — manages group lifecycle
 */
import type { GroupConfig } from "@myagents/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";

export class GroupManager {
  private groups = new Map<string, Group>();

  constructor(private registry: AgentRegistry) {}

  create(config: GroupConfig): Group {
    const group = new Group(config, this.registry);
    this.groups.set(config.id, group);
    return group;
  }

  get(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  list(): Group[] {
    return [...this.groups.values()];
  }

  delete(groupId: string): void {
    this.groups.delete(groupId);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/manager.test.ts`

---

### Task 6: Activate agent-message tool

**Files:**
- Modify: `packages/core/src/tools/agent-message.ts`
- Modify: `packages/core/src/tools/executor.ts`

- [ ] **Step 1: Rewrite agent-message to use registry**

The tool needs an AgentRegistry reference. We pass it via a module-level setter (to avoid changing the Tool interface).

```typescript
/**
 * Agent Message tool — send message to another Agent
 */
import type { Tool, ToolContext, ToolResult } from "@myagents/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";

let _registry: AgentRegistry | null = null;

export function setAgentRegistry(registry: AgentRegistry): void {
  _registry = registry;
}

export const agentMessageTool: Tool = {
  name: "agent-message",
  description: "向其他 Agent 发送消息并获取回复",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "目标 agent ID" },
      message: { type: "string", description: "发送内容" },
      timeout: { type: "number", description: "超时秒数，默认 60" },
    },
    required: ["target", "message"],
  },
  async execute(params, context: ToolContext): Promise<ToolResult> {
    const maxLoopDepth = 2;
    const currentDepth = context.callDepth ?? 0;

    if (currentDepth >= maxLoopDepth) {
      return {
        toolCallId: "",
        content: `调用深度超限 (${currentDepth})，防止无限循环`,
        isError: true,
      };
    }

    if (!_registry) {
      return {
        toolCallId: "",
        content: "AgentRegistry 未初始化",
        isError: true,
      };
    }

    const targetAgent = _registry.get(params.target as string);
    if (!targetAgent) {
      return {
        toolCallId: "",
        content: `未找到 Agent: ${params.target}`,
        isError: true,
      };
    }

    const timeout = ((params.timeout as number) ?? 60) * 1000;

    try {
      const result = await Promise.race([
        targetAgent.run(params.message as string),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("超时")), timeout),
        ),
      ]);
      return {
        toolCallId: "",
        content: result.content,
      };
    } catch (err: any) {
      return {
        toolCallId: "",
        content: `Agent 通信失败: ${err.message}`,
        isError: true,
      };
    }
  },
};
```

- [ ] **Step 2: Update ToolExecutor to pass callDepth**

In `packages/core/src/tools/executor.ts`, modify the `tool.execute()` call to include `callDepth`:

Change the ToolContext construction inside `execute()`:
```typescript
    const result = await tool.execute(params, {
      agentId,
      sessionId,
      workingDir,
      sandbox: { enabled: false, filesystem: "workspace-only", network: true },
      permissions: { mode: "full-access" },
      callDepth: 0,
    });
```

We also need to add `callDepth` parameter to `ToolExecutor.execute()` signature so the conversation loop can pass it through. Change signature to:

```typescript
  async execute(toolCall: ToolCall, agentId: string, sessionId: string, workingDir: string, callDepth = 0): Promise<ToolResult> {
```

And pass `callDepth: callDepth` in the ToolContext.

---

### Task 7: ButlerAgent + butler tools

**Files:**
- Create: `packages/core/src/agent/butler.ts`
- Create: `packages/core/src/agent/butler.test.ts`

- [ ] **Step 1: Implement ButlerAgent with 6 butler tools**

```typescript
/**
 * ButlerAgent — privileged agent that manages other agents and groups
 */
import type { AgentConfig, Tool, ToolContext, ToolResult, GroupProtocol } from "@myagents/shared";
import type { LLMProvider } from "@myagents/providers";
import { Agent } from "./agent.js";
import { AgentRegistry } from "./registry.js";
import { GroupManager } from "../group/manager.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("butler");

// ---- Butler Tools ----

function makeCreateAgentTool(registry: AgentRegistry, providerGetter: () => LLMProvider): Tool {
  return {
    name: "butler-create-agent",
    description: "创建一个新 Agent",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Agent 名称" },
        role: { type: "string", description: "Agent 角色" },
        systemPrompt: { type: "string", description: "系统提示词" },
      },
      required: ["name", "role"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const name = params.name as string;
      const id = `${name}-${Date.now()}`;
      const config: AgentConfig = {
        id,
        name,
        role: params.role as string,
        systemPrompt: (params.systemPrompt as string) || `你是${name}，${params.role}`,
        provider: "deepseek",
        model: "deepseek-chat",
        permissions: { mode: "workspace-write" },
        sandbox: { enabled: false, filesystem: "workspace-only", network: true },
        tools: ["bash", "read-file", "write-file", "glob", "grep"],
      };
      const provider = providerGetter();
      const agent = new Agent(config, provider);
      registry.register(agent);
      log.info("Created agent: %s (%s)", name, id);
      return { toolCallId: "", content: `已创建 Agent ${name} (ID: ${id})` };
    },
  };
}

function makeDestroyAgentTool(registry: AgentRegistry): Tool {
  return {
    name: "butler-destroy-agent",
    description: "销毁一个 Agent",
    parameters: {
      type: "object",
      properties: { agentId: { type: "string", description: "Agent ID" } },
      required: ["agentId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.agentId as string;
      const agent = registry.get(id);
      if (!agent) return { toolCallId: "", content: `未找到 Agent: ${id}`, isError: true };
      registry.unregister(id);
      log.info("Destroyed agent: %s", id);
      return { toolCallId: "", content: `已销毁 Agent ${agent.name} (${id})` };
    },
  };
}

function makeCreateGroupTool(groupManager: GroupManager): Tool {
  return {
    name: "butler-create-group",
    description: "创建一个 Agent 群组",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "群组名称" },
        members: { type: "array", items: { type: "string" }, description: "成员 Agent ID 列表" },
        protocol: { type: "string", enum: ["round-robin", "free-form", "moderated"], description: "讨论协议" },
      },
      required: ["name", "members", "protocol"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = `group-${Date.now()}`;
      const group = groupManager.create({
        id,
        name: params.name as string,
        members: params.members as string[],
        protocol: params.protocol as GroupProtocol,
      });
      return { toolCallId: "", content: `已创建群组 ${group.config.name} (ID: ${id})` };
    },
  };
}

function makeDestroyGroupTool(groupManager: GroupManager): Tool {
  return {
    name: "butler-destroy-group",
    description: "销毁一个群组",
    parameters: {
      type: "object",
      properties: { groupId: { type: "string", description: "群组 ID" } },
      required: ["groupId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const id = params.groupId as string;
      const group = groupManager.get(id);
      if (!group) return { toolCallId: "", content: `未找到群组: ${id}`, isError: true };
      groupManager.delete(id);
      return { toolCallId: "", content: `已销毁群组 ${group.config.name}` };
    },
  };
}

function makeListTool(registry: AgentRegistry, groupManager: GroupManager): Tool {
  return {
    name: "butler-list",
    description: "列出所有 Agent 和群组",
    parameters: { type: "object", properties: {} },
    async execute(_params, _context: ToolContext): Promise<ToolResult> {
      const agents = registry.list().map(a => `  - ${a.name} (${a.id}) [${a.getStatus()}]`).join("\n");
      const groups = groupManager.list().map(g => `  - ${g.config.name} (${g.id}) [${g.config.members.length} members, ${g.config.protocol}]`).join("\n");
      return {
        toolCallId: "",
        content: `Agents:\n${agents || "  (none)"}\n\nGroups:\n${groups || "  (none)"}`,
      };
    },
  };
}

function makeRunGroupTool(groupManager: GroupManager): Tool {
  return {
    name: "butler-run-group",
    description: "启动群组讨论",
    parameters: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "群组 ID" },
        topic: { type: "string", description: "讨论主题" },
      },
      required: ["groupId", "topic"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const group = groupManager.get(params.groupId as string);
      if (!group) return { toolCallId: "", content: `未找到群组: ${params.groupId}`, isError: true };
      const history = await group.run(params.topic as string);
      const summary = history.map(m => `[${m.fromAgentId}]: ${m.content.slice(0, 200)}`).join("\n\n");
      return { toolCallId: "", content: `讨论完成 (${history.length} 条消息):\n\n${summary}` };
    },
  };
}

// ---- ButlerAgent ----

export class ButlerAgent extends Agent {
  constructor(
    config: AgentConfig,
    provider: LLMProvider,
    private registry: AgentRegistry,
    private groupManager: GroupManager,
  ) {
    super(config, provider);

    // Register butler tools
    this.toolRegistry.register(makeCreateAgentTool(registry, () => provider));
    this.toolRegistry.register(makeDestroyAgentTool(registry));
    this.toolRegistry.register(makeCreateGroupTool(groupManager));
    this.toolRegistry.register(makeDestroyGroupTool(groupManager));
    this.toolRegistry.register(makeListTool(registry, groupManager));
    this.toolRegistry.register(makeRunGroupTool(groupManager));

    // Re-create the conversation loop with updated tool list
    const { ConversationLoop } = require("../conversation/conversation-loop.js");
    const { PermissionEnforcer } = require("../tools/permission.js");
    const { ToolExecutor } = require("../tools/executor.js");

    const perm = new PermissionEnforcer({ mode: "full-access" }, undefined, process.cwd());
    const executor = new ToolExecutor(this.toolRegistry, perm);
    this.conversationLoop = new ConversationLoop({
      agentConfig: {
        name: config.name,
        role: config.role,
        systemPrompt: config.systemPrompt,
        model: config.model,
      },
      provider,
      tools: this.toolRegistry.listDefinitions(),
      toolExecutor: executor,
      agentId: config.id,
      sessionId: "butler",
      workingDir: process.cwd(),
    });

    // Register self
    if (!registry.get(config.id)) {
      registry.register(this);
    }
  }
}
```

**Note:** `toolRegistry` and `conversationLoop` need to be accessible from ButlerAgent. Change them from `private` to `protected` in Agent class:

In `packages/core/src/agent/agent.ts`:
- `private toolRegistry` → `protected toolRegistry`
- `private conversationLoop` → `protected conversationLoop`

- [ ] **Step 2: Write butler test**

```typescript
import { describe, it, expect } from "vitest";
import { AgentRegistry } from "./registry.js";
import { GroupManager } from "../group/manager.js";
import { ButlerAgent } from "./butler.js";
import type { LLMProvider } from "@myagents/providers";

// Mock provider
const mockProvider: LLMProvider = {
  id: "mock",
  name: "mock",
  chat: async function* () { yield { type: "content", content: "ok" }; },
  chatComplete: async () => "ok",
  listModels: async () => [],
  capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
};

describe("ButlerAgent", () => {
  it("registers self in registry", () => {
    const reg = new AgentRegistry();
    const gm = new GroupManager(reg);
    const butler = new ButlerAgent({
      id: "butler", name: "管家", role: "管家",
      systemPrompt: "test", provider: "mock", model: "mock",
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "workspace-only", network: true },
    }, mockProvider, reg, gm);

    expect(reg.get("butler")).toBe(butler);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/butler.test.ts`

---

### Task 8: Update Agent class for registry access

**Files:**
- Modify: `packages/core/src/agent/agent.ts` — change `private toolRegistry` and `private conversationLoop` to `protected`

- [ ] **Step 1: Change access modifiers**

In `packages/core/src/agent/agent.ts`:
- `private toolRegistry: ToolRegistry;` → `protected toolRegistry: ToolRegistry;`
- `private conversationLoop: ConversationLoop;` → `protected conversationLoop: ConversationLoop;`

- [ ] **Step 2: Verify compilation**

Run: `cd D:/agent-codes/myagents && npx tsc -p packages/core/tsconfig.json --noEmit`

---

### Task 9: MyAgentsRuntime

**Files:**
- Create: `packages/core/src/runtime.ts`

- [ ] **Step 1: Implement MyAgentsRuntime**

```typescript
/**
 * MyAgentsRuntime — top-level orchestrator
 */
import type { AppConfig } from "./config/schema.js";
import { AgentRegistry } from "./agent/registry.js";
import { GroupManager } from "./group/manager.js";
import { ButlerAgent } from "./agent/butler.js";
import { CoreWSServer } from "./api/ws-server.js";
import { setAgentRegistry } from "./tools/agent-message.js";
import { OpenAICompatProvider } from "@myagents/providers";
import { createLogger, setGlobalLogLevel } from "@myagents/shared";

const log = createLogger("runtime");

export class MyAgentsRuntime {
  readonly registry: AgentRegistry;
  readonly groupManager: GroupManager;
  readonly wsServer: CoreWSServer;
  private butler: ButlerAgent;
  private provider: OpenAICompatProvider;

  constructor(private config: AppConfig) {
    this.registry = new AgentRegistry();
    this.groupManager = new GroupManager(this.registry);
    this.wsServer = new CoreWSServer(config.gui?.wsPort ?? 18765);

    // Set registry for agent-message tool
    setAgentRegistry(this.registry);

    // Create provider
    const providerCfg = config.providers[config.agent.provider];
    const apiKey = providerCfg?.apiKey ?? process.env[providerCfg?.apiKeyEnv ?? ""] ?? "";
    this.provider = new OpenAICompatProvider({
      id: config.agent.provider,
      name: config.agent.provider,
      apiKey,
      baseURL: providerCfg?.baseURL ?? "https://api.openai.com/v1",
    });

    // Create butler
    this.butler = new ButlerAgent({
      id: "butler",
      name: config.agent.name || "管家",
      role: config.agent.role || "MyAgents 管家",
      systemPrompt: config.agent.systemPrompt || "你是 MyAgents 管家。你可以创建 Agent、创建群组、启动讨论。用户会通过自然语言告诉你需要什么。",
      provider: config.agent.provider,
      model: config.agent.model,
      permissions: { mode: "full-access" },
      sandbox: { enabled: false, filesystem: "workspace-only", network: true },
      tools: [
        "bash", "read-file", "write-file", "glob", "grep",
        "butler-create-agent", "butler-destroy-agent",
        "butler-create-group", "butler-destroy-group",
        "butler-list", "butler-run-group",
      ],
    }, this.provider, this.registry, this.groupManager);
  }

  async start(): Promise<void> {
    setGlobalLogLevel(this.config.core.logLevel as "debug" | "info" | "warn" | "error");

    this.wsServer.registerAgent(this.butler);
    await this.wsServer.start();

    log.info("MyAgents runtime started. Butler: %s, WS: ws://localhost:%d",
      this.butler.name, this.config.gui?.wsPort ?? 18765);
  }

  async stop(): Promise<void> {
    this.wsServer.stop();
    log.info("Runtime stopped");
  }

  async handleUserInput(input: string): Promise<string> {
    const response = await this.butler.run(input);
    return response.content;
  }
}
```

---

### Task 10: Update config and exports

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `config/default.yaml`
- Modify: `scripts/dev.ts`

- [ ] **Step 1: Update config schema** — add `groups` array

In `packages/core/src/config/schema.ts`, add to `AppConfig`:
```typescript
  groups?: Array<{
    id: string;
    name: string;
    members: string[];
    protocol: string;
    moderator?: string;
    maxRounds?: number;
    topic?: string;
  }>;
```

- [ ] **Step 2: Update core exports**

In `packages/core/src/index.ts`, add:
```typescript
export { AgentRegistry } from "./agent/registry.js";
export { ButlerAgent } from "./butler.js";
export { Group } from "./group/group.js";
export { GroupManager } from "./group/manager.js";
export { RoundRobinProtocol, FreeFormProtocol, ModeratedProtocol, createProtocol } from "./group/protocol.js";
export { MyAgentsRuntime } from "./runtime.js";
export { setAgentRegistry } from "./tools/agent-message.js";
```

- [ ] **Step 3: Update default.yaml**

```yaml
# MyAgents 默认配置（Phase 4 — 多 Agent + 管家）

core:
  logLevel: info
  dataDir: ./data

agent:
  name: "管家"
  role: "MyAgents 管家"
  systemPrompt: "你是 MyAgents 管家。你可以创建 Agent、创建群组、启动讨论。用户会通过自然语言告诉你需要什么。"
  provider: deepseek
  model: deepseek-chat
  permissions:
    mode: full-access
  sandbox:
    enabled: false
    filesystem: workspace-only
    network: true
  tools:
    - bash
    - read-file
    - write-file
    - glob
    - grep
    - butler-create-agent
    - butler-destroy-agent
    - butler-create-group
    - butler-destroy-group
    - butler-list
    - butler-run-group

providers:
  deepseek:
    apiKeyEnv: DEEPSEEK_API_KEY
    baseURL: https://api.deepseek.com/v1

groups: []
```

- [ ] **Step 4: Update dev.ts to use Runtime**

```typescript
#!/usr/bin/env node
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { MyAgentsRuntime } from "../packages/core/dist/index.js";
import { createLogger } from "../packages/core/dist/index.js";

dotenvConfig({ path: resolve(".env") });
const log = createLogger("main");

async function main() {
  const { loadConfig } = await import("../packages/core/dist/index.js");
  const config = loadConfig();

  const runtime = new MyAgentsRuntime(config);
  await runtime.start();

  log.info("Press Ctrl+C to stop");

  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(console.error);
```

- [ ] **Step 5: Build all and run all tests**

Run: `cd D:/agent-codes/myagents && npx tsc -p packages/shared/tsconfig.json && npx tsc -p packages/providers/tsconfig.json && npx tsc -p packages/channels/tsconfig.json && npx tsc -p packages/core/tsconfig.json && npx vitest run`

Expected: ALL PASS

---

## Self-Review

**1. Spec coverage:**
- AgentRegistry → Task 2 ✅
- GroupProtocol (3 strategies) → Task 3 ✅
- Group class → Task 4 ✅
- GroupManager → Task 5 ✅
- agent-message activation → Task 6 ✅
- ButlerAgent + 6 tools → Task 7 ✅
- MyAgentsRuntime → Task 9 ✅
- Config migration → Task 10 ✅
- ToolContext.callDepth → Task 1 ✅

**2. Placeholder scan:** No TBD/TODO found. All code shown inline.

**3. Type consistency:**
- `GroupConfig.protocol` is `GroupProtocol` type, `createProtocol()` accepts `string` — OK since GroupManager passes `config.protocol`
- `Agent.toolRegistry` changed to `protected` in Task 8, ButlerAgent in Task 7 uses it — correct order
- `setAgentRegistry()` called in Runtime constructor before any agent runs — correct
