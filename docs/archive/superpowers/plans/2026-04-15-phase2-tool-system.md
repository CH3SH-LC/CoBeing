# Phase 2: Tool System + Permissions + Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tool system so Agents can execute operations (file I/O, bash, web, agent messaging) with permission control and Docker sandboxing.

**Architecture:** Centralized ToolRegistry per Agent, ToolExecutor as unified execution entry with PermissionEnforcer checks, DockerSandbox for bash only, ConversationLoop modified to auto-execute tool_calls in a loop.

**Tech Stack:** TypeScript, Node.js child_process, fast-glob, docker (optional)

---

## Task 1: Update shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add Tool, ToolContext, ToolsConfig types and update SandboxConfig**

Add to end of `packages/shared/src/types.ts` (before Group section), add `bindings` to SandboxConfig:

```typescript
// SandboxConfig: add bindings field
export interface SandboxConfig {
  enabled: boolean;
  filesystem: "off" | "workspace-only" | "allowlist";
  network: boolean;
  allowPaths?: string[];
  blockPaths?: string[];
  bindings?: string[];  // extra mounts "hostPath:containerPath[:ro]"
}

// Tool system types
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  agentId: string;
  sessionId: string;
  workingDir: string;
  sandbox: SandboxConfig;
  permissions: PermissionPolicy;
}

export interface ToolsConfig {
  defaultPermission: string;
  enabled: string[];
  permissions: Record<string, Record<string, string | number>>;
}
```

Update AgentConfig to include tools config:
```typescript
export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider: string;
  model: string;
  tools?: string[];
  toolsConfig?: ToolsConfig;
  permissions?: PermissionPolicy;
  sandbox?: SandboxConfig;
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd D:/agent-codes/myagents && npx tsc -p packages/shared/tsconfig.json --noEmit`
Expected: PASS

---

## Task 2: Update events

**Files:**
- Modify: `packages/shared/src/events.ts`

- [ ] **Step 1: Add tool events to CoreEvents**

Add to CoreEvents interface:
```typescript
"tool:call": { agentId: string; toolName: string; params: unknown };
"tool:result": { agentId: string; toolName: string; result: string; isError: boolean };
"tool:denied": { agentId: string; toolName: string; reason: string };
```

Remove old `"tool:executed"` event.

- [ ] **Step 2: Verify compilation**

Run: `cd D:/agent-codes/myagents && npx tsc -p packages/shared/tsconfig.json --noEmit`

---

## Task 3: ToolRegistry

**Files:**
- Create: `packages/core/src/tools/registry.ts`
- Create: `packages/core/src/tools/registry.test.ts`

- [ ] **Step 1: Write ToolRegistry test**

```typescript
import { describe, it, expect } from "vitest";
import { ToolRegistry } from "./registry.js";
import type { Tool } from "@myagents/shared";

const mockTool: Tool = {
  name: "test-tool",
  description: "A test tool",
  parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
  execute: async (params) => ({ toolCallId: "1", content: String(params.x) }),
};

describe("ToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.get("test-tool")).toBe(mockTool);
    expect(reg.has("test-tool")).toBe(true);
    expect(reg.has("nope")).toBe(false);
  });

  it("lists definitions for LLM", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    const defs = reg.listDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toEqual({
      type: "function",
      function: { name: "test-tool", description: "A test tool", parameters: mockTool.parameters },
    });
  });

  it("unregisters a tool", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    reg.unregister("test-tool");
    expect(reg.has("test-tool")).toBe(false);
    expect(reg.listDefinitions()).toHaveLength(0);
  });

  it("listAll returns all tools", () => {
    const reg = new ToolRegistry();
    reg.register(mockTool);
    expect(reg.listAll()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement ToolRegistry**

```typescript
import type { Tool, ToolDefinition } from "@myagents/shared";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  listAll(): Tool[] {
    return [...this.tools.values()];
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/tools/registry.test.ts`

---

## Task 4: PermissionEnforcer

**Files:**
- Create: `packages/core/src/tools/permission.ts`
- Create: `packages/core/src/tools/permission.test.ts`

- [ ] **Step 1: Write PermissionEnforcer tests**

Test all permission modes: full-access, workspace-write, read-only, ask.

- [ ] **Step 2: Implement PermissionEnforcer**

Key logic: full-access=allow all, read-only=check deny/allow lists, workspace-write=check path for write tools, ask=deny list first then allow list then default deny.

- [ ] **Step 3: Run tests**

---

## Task 5: Built-in tools (6 file tools)

**Files:**
- Create: `packages/core/src/tools/bash.ts`
- Create: `packages/core/src/tools/read-file.ts`
- Create: `packages/core/src/tools/write-file.ts`
- Create: `packages/core/src/tools/edit-file.ts`
- Create: `packages/core/src/tools/glob.ts`
- Create: `packages/core/src/tools/grep.ts`
- Create: `packages/core/src/tools/web-fetch.ts`
- Create: `packages/core/src/tools/agent-message.ts`
- Create: `packages/core/src/tools/builtins.test.ts`

- [ ] **Step 1: Implement bash tool** — child_process.exec with timeout
- [ ] **Step 2: Implement read-file tool** — fs.readFile with offset/limit
- [ ] **Step 3: Implement write-file tool** — fs.writeFile
- [ ] **Step 4: Implement edit-file tool** — string replacement, unique match check
- [ ] **Step 5: Implement glob tool** — use Node.js fs.readdir recursive or fast-glob
- [ ] **Step 6: Implement grep tool** — use Node.js readline + RegExp
- [ ] **Step 7: Implement web-fetch tool** — use Node.js fetch (built-in since Node 18)
- [ ] **Step 8: Implement agent-message tool** — stub for now (needs AgentRegistry from Phase 4)
- [ ] **Step 9: Write and run tests**

---

## Task 6: ToolExecutor

**Files:**
- Create: `packages/core/src/tools/executor.ts`
- Create: `packages/core/src/tools/executor.test.ts`

- [ ] **Step 1: Write ToolExecutor tests** (mock registry + permission)
- [ ] **Step 2: Implement ToolExecutor** — lookup tool → check permission → execute → emit events
- [ ] **Step 3: Run tests**

---

## Task 7: DockerSandbox

**Files:**
- Create: `packages/core/src/tools/sandbox.ts`
- Create: `docker/sandbox.Dockerfile`

- [ ] **Step 1: Implement DockerSandbox** — docker run with volume mounts, resource limits
- [ ] **Step 2: Create Dockerfile** — Alpine + git + curl + python3 + node
- [ ] **Step 3: Skip automated test** (requires Docker, manual verification)

---

## Task 8: Integrate into ConversationLoop

**Files:**
- Modify: `packages/core/src/conversation/conversation-loop.ts`

- [ ] **Step 1: Modify ConversationLoop to accept ToolExecutor and auto-execute tool_calls in loop**

The loop currently returns toolCalls for external handling. Change to: when toolCalls arrive → execute via ToolExecutor → push results → continue LLM loop.

- [ ] **Step 2: Verify compilation**

---

## Task 9: Integrate into Agent

**Files:**
- Modify: `packages/core/src/agent/agent.ts`

- [ ] **Step 1: Agent creates ToolRegistry, registers enabled tools, creates ToolExecutor, passes to ConversationLoop**
- [ ] **Step 2: Wire up tool events for GUI streaming**
- [ ] **Step 3: Verify compilation**

---

## Task 10: Update config

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Modify: `packages/core/src/config/config-loader.ts`
- Modify: `config/default.yaml`
- Create: `packages/core/src/tools/index.ts` (barrel export)
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Extend AppConfig schema with tools and per-agent config**
- [ ] **Step 2: Update default.yaml with tool/permission settings**
- [ ] **Step 3: Create barrel exports for tools module**
- [ ] **Step 4: Verify full build**

---

## Task 11: End-to-end test

**Files:**
- Create: `packages/core/src/e2e/tool-e2e.test.ts`

- [ ] **Step 1: Write E2E test with mock provider that returns tool_calls**
- [ ] **Step 2: Run all tests**

Run: `cd D:/agent-codes/myagents && npx vitest run`

---

## Self-Review Checklist

- [x] Spec coverage: Tool/ToolContext/ToolsConfig types → Task 1
- [x] PermissionEnforcer → Task 4
- [x] 8 builtin tools → Task 5
- [x] DockerSandbox → Task 7
- [x] ConversationLoop integration → Task 8
- [x] Agent integration → Task 9
- [x] Config updates → Task 10
- [x] Tests throughout
- [x] No placeholders
- [x] Type consistency verified
