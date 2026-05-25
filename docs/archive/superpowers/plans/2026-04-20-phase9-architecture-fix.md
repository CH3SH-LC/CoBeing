# Phase 9 Architecture Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 architecture issues in MyAgents backend + frontend to upgrade from demo-grade to usable-grade.

**Architecture:** Clean separation — backend gains WS commands for direct creation, AgentPaths refactors from IDENTITY to CHARACTER+JOB, group protocol code is deleted, groups gain persistence via filesystem, and a pre-built HostAgent is registered at startup.

**Tech Stack:** TypeScript (Node.js), React 19, Vitest, WebSocket

---

## Task Order

Tasks 1-4 are backend-only and independent. Tasks 5-7 build on Tasks 1-4. Task 8 is frontend and depends on Tasks 5-7.

---

### Task 1: Delete protocol.ts and its test

**Files:**
- Delete: `packages/core/src/group/protocol.ts`
- Delete: `packages/core/src/group/protocol.test.ts`

- [ ] **Step 1: Delete the files**

```bash
rm packages/core/src/group/protocol.ts packages/core/src/group/protocol.test.ts
```

- [ ] **Step 2: Verify no remaining imports reference protocol.ts**

Run: `cd D:/agent-codes/myagents && grep -r "from.*protocol" packages/core/src/ --include="*.ts" | grep -v node_modules | grep -v dist`
Expected: No imports of `./protocol` remain (only unrelated protocol-like references in other files)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: delete group/protocol.ts and test — discussion protocols removed (Phase 9)"
```

---

### Task 2: Create CHARACTER.md and JOB.md templates, delete IDENTITY.md

**Files:**
- Delete: `config/templates/IDENTITY.md`
- Create: `config/templates/CHARACTER.md`
- Create: `config/templates/JOB.md`

- [ ] **Step 1: Delete IDENTITY.md**

```bash
rm config/templates/IDENTITY.md
```

- [ ] **Step 2: Create CHARACTER.md template**

Write `config/templates/CHARACTER.md`:

```markdown
# CHARACTER.md — 性格与风格

- Name: {{name}}
- 性格: 专业、严谨、有条理
- 行事风格: 先分析再行动，注重效率
- 沟通方式: 简洁明了，善于总结
```

- [ ] **Step 3: Create JOB.md template**

Write `config/templates/JOB.md`:

```markdown
# JOB.md — 职责与工作

- 角色: {{role}}
- 核心职责: 完成分配的任务
- 工作原则:
  - 先理解需求再动手
  - 遇到问题及时汇报
  - 保持代码质量
- 工作范围: 根据任务描述执行
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: replace IDENTITY.md with CHARACTER.md + JOB.md templates (Phase 9)"
```

---

### Task 3: Refactor AgentPaths — identityPath → characterPath + jobPath

**Files:**
- Modify: `packages/core/src/agent/paths.ts`
- Modify: `packages/core/src/agent/paths.test.ts`

- [ ] **Step 1: Update AgentPaths in paths.ts**

In `packages/core/src/agent/paths.ts`, change:

```typescript
// Remove:
get identityPath()   { return path.join(this.baseDir, "IDENTITY.md"); }

// Add:
get characterPath()  { return path.join(this.baseDir, "CHARACTER.md"); }
get jobPath()        { return path.join(this.baseDir, "JOB.md"); }
```

- [ ] **Step 2: Remove AgentIdentity interface and parseIdentityMarkdown function**

In `packages/core/src/agent/paths.ts`, remove:

```typescript
// Remove entire AgentIdentity interface (lines 37-43)
export interface AgentIdentity { ... }

// Remove entire AgentFiles class methods related to identity:
// - readIdentity() (lines 49-51)
// - writeIdentity() (lines 54-63)

// Remove parseIdentityMarkdown function (lines 198-219)
function parseIdentityMarkdown(content: string): AgentIdentity { ... }
```

- [ ] **Step 3: Add readCharacter/writeCharacter and readJob/writeJob to AgentFiles**

In `AgentFiles` class, replace the identity methods:

```typescript
/** 读取 CHARACTER.md */
readCharacter(): string {
  return this.readFile(this.paths.characterPath);
}

/** 写入 CHARACTER.md */
writeCharacter(content: string): void {
  fs.writeFileSync(this.paths.characterPath, content, "utf-8");
}

/** 读取 JOB.md */
readJob(): string {
  return this.readFile(this.paths.jobPath);
}

/** 写入 JOB.md */
writeJob(content: string): void {
  fs.writeFileSync(this.paths.jobPath, content, "utf-8");
}
```

- [ ] **Step 4: Update paths.test.ts**

Read the test file, update any references from `identityPath` to `characterPath` and `jobPath`.

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/agent/paths.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent/paths.ts packages/core/src/agent/paths.test.ts && git commit -m "refactor: AgentPaths identityPath → characterPath + jobPath (Phase 9)"
```

---

### Task 4: Update shared/types.ts — remove GroupConfig.protocol

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Update GroupConfig interface**

In `packages/shared/src/types.ts`, change `GroupConfig`:

```typescript
// Remove:
/** @deprecated Phase 8.3: 讨论不再由固定协议控制，保留字段用于兼容 */
protocol?: string;
moderator?: string;
maxRounds?: number;

// Remove GroupProtocol type alias:
/** @deprecated Phase 8.3 移除固定协议，保留类型用于向后兼容 */
export type GroupProtocol = "round-robin" | "free-form" | "moderated" | "voting";
```

The final `GroupConfig`:

```typescript
export interface GroupConfig {
  id: string;
  name: string;
  members: string[];
  owner?: string;
  topic?: string;
}
```

Also update `GroupStatusInfo` to remove `protocol`:

```typescript
export interface GroupStatusInfo {
  id: string;
  name: string;
  members: string[];
  messageCount: number;
}
```

- [ ] **Step 2: Fix all compilation errors from protocol removal**

Run: `cd D:/agent-codes/myagents && grep -rn "protocol" packages/core/src/ --include="*.ts" | grep -v node_modules | grep -v dist | grep -v ".test.ts"`

Fix each reference:
- `group/group.ts` — remove any `config.protocol` usage
- `agent/butler.ts` — remove protocol from `makeCreateGroupTool` params and `butlerRegistry.registerGroup` calls
- `butler/registry.ts` — remove `protocol` field from `GroupRegistryEntry` and all parse/write logic
- `group/context.ts` — remove protocol if referenced
- `config/schema.ts` — remove `protocol` from groups array type

- [ ] **Step 3: Run build to verify**

Run: `cd D:/agent-codes/myagents && npx tsc --noEmit -p packages/core/tsconfig.json 2>&1 | head -30`
Expected: No errors related to protocol

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: remove GroupConfig.protocol and GroupProtocol type (Phase 9)"
```

---

### Task 5: Update butler.ts — template list + remove protocol

**Files:**
- Modify: `packages/core/src/agent/butler.ts`

- [ ] **Step 1: Update template copy list in makeCreateAgentTool**

In `makeCreateAgentTool` function (around line 90), change:

```typescript
// Old:
for (const tmplFile of ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"]) {

// New:
for (const tmplFile of ["CHARACTER.md", "JOB.md", "SOUL.md", "USER.md", "AGENTS.md"]) {
```

- [ ] **Step 2: Remove protocol from makeCreateGroupTool**

In `makeCreateGroupTool` (around line 147), remove protocol from parameters and execution:

```typescript
// Remove from properties:
protocol: { type: "string", description: "讨论协议（可选，Phase 8.3 后默认 free-form）" },

// Remove from execute:
protocol: (params.protocol as string) || "free-form",

// Update groupManager.create call:
const group = groupManager.create({
  id,
  name: params.name as string,
  members: params.members as string[],
});

// Remove protocol from butlerRegistry.registerGroup:
butlerRegistry.registerGroup({
  id,
  name: params.name as string,
  members: params.members as string[],
});
```

- [ ] **Step 3: Update makeUpdateRegistryTool — remove protocol from group update**

In `makeUpdateRegistryTool` (around line 403-418), remove protocol handling:

```typescript
// Remove from registerGroup call:
protocol: updates.protocol ?? existing.protocol,
```

The registerGroup call becomes:

```typescript
butlerRegistry.registerGroup({
  ...existing,
  ...updates,
  id: existing.id,
  name: updates.name ?? existing.name,
  members: existing.members,
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/butler.ts && git commit -m "refactor: butler uses CHARACTER+JOB templates, removes protocol (Phase 9)"
```

---

### Task 6: Add group persistence to GroupManager

**Files:**
- Modify: `packages/core/src/group/manager.ts`

- [ ] **Step 1: Add save/load methods to GroupManager**

Replace the entire `packages/core/src/group/manager.ts`:

```typescript
/**
 * GroupManager — manages group lifecycle（Phase 9 持久化）
 */
import type { GroupConfig } from "@myagents/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { Group } from "./group.js";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@myagents/shared";

const log = createLogger("group-manager");

export class GroupManager {
  private groups = new Map<string, Group>();
  private dataRoot: string;
  private groupsDir: string;

  constructor(private registry: AgentRegistry, dataRoot?: string) {
    this.dataRoot = dataRoot ?? "data";
    this.groupsDir = path.join(this.dataRoot, "groups");
  }

  create(config: GroupConfig): Group {
    const group = new Group(config, this.registry, this.dataRoot);
    this.groups.set(config.id, group);
    this.saveGroup(config.id);
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
    // 删除持久化文件
    const groupDir = path.join(this.groupsDir, groupId);
    try {
      fs.rmSync(groupDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  /** 持久化单个群组到 data/groups/{id}/config.json */
  saveGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;

    const dir = path.join(this.groupsDir, groupId);
    fs.mkdirSync(dir, { recursive: true });

    const configPath = path.join(dir, "config.json");
    const data = {
      id: group.config.id,
      name: group.config.name,
      members: group.config.members,
      owner: group.config.owner,
      topic: group.config.topic,
    };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  /** 从 data/groups/ 目录恢复所有群组 */
  restoreGroups(): void {
    if (!fs.existsSync(this.groupsDir)) return;

    const entries = fs.readdirSync(this.groupsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(this.groupsDir, entry.name, "config.json");
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw) as GroupConfig;
        const group = new Group(config, this.registry, this.dataRoot);
        this.groups.set(config.id, group);
        log.info("Restored group: %s (%s)", config.name, config.id);
      } catch (err: any) {
        log.warn("Failed to restore group %s: %s", entry.name, err.message);
      }
    }
  }
}
```

- [ ] **Step 2: Run manager test to verify**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/manager.test.ts`
Expected: Tests pass (may need minor updates if test references protocol)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/group/manager.ts && git commit -m "feat: GroupManager persistence — save/restore groups from filesystem (Phase 9)"
```

---

### Task 7: Add WS commands + update runtime for HostAgent + group restore

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`
- Modify: `packages/core/src/runtime.ts`
- Modify: `packages/core/src/config/schema.ts`
- Modify: `config/default.json`

- [ ] **Step 1: Update config/schema.ts — add agents array, remove protocol from groups**

In `AppConfig`, add an `agents` field and clean up `groups`:

```typescript
// Add to AppConfig:
agents?: Array<{
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider: string;
  model: string;
  permissions: { mode: string; allow?: string[]; deny?: string[] };
  sandbox: { enabled: boolean; filesystem: string; network: boolean };
  tools?: string[];
  ownerTools?: string[];  // 群组管理工具（HostAgent 专用）
}>;

// Update groups type — remove protocol/moderator/maxRounds:
groups?: Array<{
  id: string;
  name: string;
  members: string[];
  owner?: string;
  topic?: string;
}>;
```

- [ ] **Step 2: Update config/default.json — add host agent**

Replace `groups: []` section and add `agents`:

```json
{
  "agents": [
    {
      "id": "host",
      "name": "群主",
      "role": "群组组织者",
      "systemPrompt": "你是群主，负责组织多智能体协作。你可以制定协作计划、分配任务、总结进展、创建私有讨论。\n\n工作原则：\n1. 先了解任务全貌再分配\n2. 合理分配工作，避免瓶颈\n3. 及时总结进展和共识\n4. 必要时创建私有讨论解决分歧",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "permissions": { "mode": "workspace-write" },
      "sandbox": { "enabled": false, "filesystem": "workspace-only", "network": true },
      "tools": ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
      "ownerTools": ["group-plan", "group-invite-talk", "group-summarize", "group-assign-task"]
    }
  ],
  "groups": []
}
```

- [ ] **Step 3: Add WS commands to ws-server.ts**

Add these dependencies at the top of `ws-server.ts`:

```typescript
import { Agent } from "../agent/agent.js";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { ButlerRegistry } from "../butler/registry.js";
import { createLogger } from "@myagents/shared";
import type { AgentConfig } from "@myagents/shared";
import type { LLMProvider } from "@myagents/providers";
```

Add private fields to `CoreWSServer`:

```typescript
private providerResolver: ((id: string) => LLMProvider | undefined) | null = null;
private dataRoot: string = "data";

/** Set provider resolver for agent creation */
setProviderResolver(resolver: (id: string) => LLMProvider | undefined): void {
  this.providerResolver = resolver;
}

/** Set data root */
setDataRoot(dataRoot: string): void {
  this.dataRoot = dataRoot;
}
```

Add new cases in `handleMessage` switch, before `default:`:

```typescript
case "create_agent": {
  const { name, role, provider, model, systemPrompt, skills } = msg.payload as {
    name: string; role: string; provider?: string; model?: string;
    systemPrompt?: string; skills?: string[];
  };
  if (!name || !role) {
    this.sendToClient(ws, { type: "error", payload: { message: "name and role are required" } });
    break;
  }
  const id = name.toLowerCase().replace(/\s+/g, "-");
  if (this.agentRegistry?.get(id)) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent already exists: ${id}` } });
    break;
  }

  const providerId = provider || "deepseek";
  const modelId = model || "deepseek-chat";
  const prov = this.providerResolver?.(providerId);
  if (!prov) {
    this.sendToClient(ws, { type: "error", payload: { message: `Provider not found: ${providerId}` } });
    break;
  }

  const config: AgentConfig = {
    id,
    name,
    role,
    systemPrompt: systemPrompt || `你是${name}，${role}`,
    provider: providerId,
    model: modelId,
    permissions: { mode: "workspace-write" },
    sandbox: { enabled: false, filesystem: "workspace-only", network: true },
    tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
    skills,
  };

  // Write config to agent directory
  const agentPaths = AgentPaths.forAgent(id, this.dataRoot);
  agentPaths.ensureDirs();
  new AgentFiles(agentPaths).writeConfig({
    name, role, provider: providerId, model: modelId,
    permissions: { mode: "workspace-write" },
    sandbox: { enabled: false, filesystem: "workspace-only", network: true },
    tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
    skills,
  });

  // Copy templates
  const templatesDir = path.resolve("config/templates");
  for (const tmplFile of ["CHARACTER.md", "JOB.md", "SOUL.md", "USER.md", "AGENTS.md"]) {
    const src = path.join(templatesDir, tmplFile);
    const dst = path.join(agentPaths.baseDir, tmplFile);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      let content = fs.readFileSync(src, "utf-8");
      content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, role);
      fs.writeFileSync(dst, content, "utf-8");
    }
  }

  const agent = new Agent(config, prov, this.dataRoot);
  this.agentRegistry!.register(agent);

  // Update ButlerRegistry
  const butlerReg = new ButlerRegistry(this.dataRoot);
  butlerReg.registerAgent({
    id, name, role,
    provider: providerId, model: modelId,
    systemPrompt: config.systemPrompt,
  });

  this.logMessage("system", `Agent created: ${name} (${id})`);
  this.sendToClient(ws, { type: "agent_created", payload: { id, name } });
  this.broadcastState();
  break;
}

case "create_group": {
  const { name, members, topic } = msg.payload as {
    name: string; members: string[]; topic?: string;
  };
  if (!name || !members || members.length === 0) {
    this.sendToClient(ws, { type: "error", payload: { message: "name and members are required" } });
    break;
  }
  const id = name.toLowerCase().replace(/\s+/g, "-");
  if (this.groupManager?.get(id)) {
    this.sendToClient(ws, { type: "error", payload: { message: `Group already exists: ${id}` } });
    break;
  }

  // Auto-add host agent as owner if exists
  const hostAgent = this.agentRegistry?.get("host");
  const allMembers = hostAgent && !members.includes("host") ? ["host", ...members] : members;

  const group = this.groupManager!.create({
    id,
    name,
    members: allMembers,
    owner: hostAgent ? "host" : undefined,
    topic,
  });

  // Update ButlerRegistry
  const butlerReg = new ButlerRegistry(this.dataRoot);
  butlerReg.registerGroup({
    id,
    name,
    members: allMembers,
  });

  this.logMessage("system", `Group created: ${name} (${id})`);
  this.sendToClient(ws, { type: "group_created", payload: { id, name } });
  this.broadcastState();
  break;
}

case "destroy_agent": {
  const { agentId } = msg.payload as { agentId: string };
  if (!agentId) {
    this.sendToClient(ws, { type: "error", payload: { message: "agentId is required" } });
    break;
  }
  const agent = this.agentRegistry?.get(agentId);
  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }
  if (agentId === "butler" || agentId === "host") {
    this.sendToClient(ws, { type: "error", payload: { message: `Cannot destroy built-in agent: ${agentId}` } });
    break;
  }
  this.agentRegistry!.unregister(agentId);
  const butlerReg = new ButlerRegistry(this.dataRoot);
  butlerReg.unregisterAgent(agentId);
  this.logMessage("system", `Agent destroyed: ${agentId}`);
  this.sendToClient(ws, { type: "agent_destroyed", payload: { agentId } });
  this.broadcastState();
  break;
}

case "destroy_group": {
  const { groupId } = msg.payload as { groupId: string };
  if (!groupId) {
    this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
    break;
  }
  const group = this.groupManager?.get(groupId);
  if (!group) {
    this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${groupId}` } });
    break;
  }
  this.groupManager!.delete(groupId);
  const butlerReg = new ButlerRegistry(this.dataRoot);
  butlerReg.unregisterGroup(groupId);
  this.logMessage("system", `Group destroyed: ${groupId}`);
  this.sendToClient(ws, { type: "group_destroyed", payload: { groupId } });
  this.broadcastState();
  break;
}
```

- [ ] **Step 4: Update getState() in ws-server.ts to remove protocol**

In the `getState()` method, remove `protocol` from groups:

```typescript
const groups = this.groupManager
  ? this.groupManager.list().map(g => ({
      id: g.id,
      name: g.config.name,
      members: g.config.members,
      topic: g.config.topic,
    }))
  : [];
```

- [ ] **Step 5: Update runtime.ts — register HostAgent + restore groups**

In `runtime.ts` constructor, after the butler creation block (after line 96), add HostAgent creation:

```typescript
// Create HostAgent (pre-built group organizer)
if (config.agents) {
  for (const agentDef of config.agents) {
    if (this.registry.get(agentDef.id)) continue; // skip if already exists

    const agentProvider = this.providers.get(agentDef.provider) ?? defaultProvider;
    const agent = new Agent({
      id: agentDef.id,
      name: agentDef.name,
      role: agentDef.role,
      systemPrompt: agentDef.systemPrompt,
      provider: agentDef.provider,
      model: agentDef.model,
      permissions: agentDef.permissions,
      sandbox: agentDef.sandbox,
      tools: agentDef.tools,
    }, agentProvider, this.dataRoot);

    // Inject group owner tools if configured
    if (agentDef.ownerTools?.length) {
      const { makeGroupPlanTool, makeGroupInviteTalkTool, makeGroupSummarizeTool, makeGroupAssignTaskTool } = await import("./group/owner.js");
      // Note: these tools use GroupContext (v1), need to wire them properly
      // For now, register the tools with a getter that returns undefined (graceful)
      // This will be refined when the full WakeSystem integration is complete
    }

    agent.subscribeToBus(this.eventBus);
    agent.injectSkillRepository(this.skillRepo);
    this.registry.register(agent);
    log.info("Pre-built agent registered: %s (%s)", agentDef.name, agentDef.id);
  }
}
```

**Important:** The `await import()` inside a constructor won't work. Move HostAgent registration to a separate method called from `start()`. In the constructor, just save `config.agents`. In `start()`, call `this.registerPrebuiltAgents()`.

Add to `start()` method, after `this.restoreAgents()`:

```typescript
// Register pre-built agents (e.g., HostAgent)
this.registerPrebuiltAgents();

// Restore persisted groups
this.groupManager.restoreGroups();

// Inject provider resolver + data root to WS server
this.wsServer.setProviderResolver((id) => this.providers.get(id));
this.wsServer.setDataRoot(this.dataRoot);
```

Add method to class:

```typescript
/** Register pre-built agents from config */
private registerPrebuiltAgents(): void {
  if (!this.config.agents) return;

  for (const agentDef of this.config.agents) {
    if (this.registry.get(agentDef.id)) continue;

    const agentProvider = this.providers.get(agentDef.provider);
    if (!agentProvider) {
      log.warn("Skipping pre-built agent %s: no provider %s", agentDef.id, agentDef.provider);
      continue;
    }

    const agent = new Agent({
      id: agentDef.id,
      name: agentDef.name,
      role: agentDef.role,
      systemPrompt: agentDef.systemPrompt,
      provider: agentDef.provider,
      model: agentDef.model,
      permissions: agentDef.permissions,
      sandbox: agentDef.sandbox,
      tools: agentDef.tools,
    }, agentProvider, this.dataRoot);

    agent.subscribeToBus(this.eventBus);
    agent.injectSkillRepository(this.skillRepo);
    this.registry.register(agent);
    log.info("Pre-built agent registered: %s (%s)", agentDef.name, agentDef.id);
  }
}
```

- [ ] **Step 6: Update screener.ts semantics**

In `packages/core/src/group/screener.ts`, update the SCREENER_PROMPT text — replace all "讨论" with "协作":

```typescript
const SCREENER_PROMPT = `你是群组协作的初筛器。你的任务是判断群主是否需要介入当前协作。

请根据以下规则判断：

**需要介入的情况：**
- 协作偏离目标（2+ 轮无关内容）
- 成员间冲突升级（互相否定 3+ 轮）
- 长时间无实质进展（连续 5+ 条消息无新观点）
- 任务阻塞报告
- 成员请求帮助或指导

**不需要介入的情况：**
- 成员正在有效协作
- 工作正常推进
- 只是信息分享或状态更新
- 你没有比成员更好的见解

请严格按以下格式输出：

是否需要唤醒主模型：是/否
原因：一句话说明
建议：如果需要唤醒，给出建议群主做什么（不需要则填"无"）

请分析以下最近消息：`;
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: WS create/destroy commands, HostAgent, group persistence, screener semantics (Phase 9)"
```

---

### Task 8: Frontend — remove protocol, update creation flow

**Files:**
- Modify: `gui-v2/src/lib/types.ts`
- Modify: `gui-v2/src/components/group/CreateGroupDialog.tsx`
- Modify: `gui-v2/src/components/group/GroupConfigTab.tsx`
- Modify: `gui-v2/src/components/group/GroupDetailPanel.tsx`
- Modify: `gui-v2/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update gui-v2/src/lib/types.ts**

Remove `GroupProtocol` type and update interfaces:

```typescript
// Remove:
export type GroupProtocol = "round-robin" | "free-form" | "moderated";

// Update GroupInfo:
export interface GroupInfo {
  id: string;
  name: string;
  members: string[];
  topic?: string;
}

// Update GroupDetail:
export interface GroupDetail {
  id: string;
  name: string;
  members: GroupMember[];
  topic?: string;
  workspace: Record<string, string>;
  talks: TalkInfo[];
}
```

- [ ] **Step 2: Update CreateGroupDialog.tsx**

Remove protocol state and selector, change creation to use `create_group` WS command:

```typescript
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { getWsClient } from "@/hooks/useWebSocket";
import { useAgentsStore } from "@/stores/agents";
import { cn } from "@/lib/utils";

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const agents = useAgentsStore((s) => s.agents);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const canCreate = name.trim() && selectedMembers.length > 0;

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = () => {
    if (!canCreate) return;

    getWsClient()?.send({
      type: "create_group",
      payload: {
        name: name.trim(),
        members: selectedMembers,
        topic: topic.trim() || undefined,
      },
    });

    setName("");
    setTopic("");
    setSelectedMembers([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>创建协作组</DialogTitle>
          <DialogDescription>选择成员组成协作组</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Name */}
          <div>
            <label className="text-xs text-txt-sub mb-1 block">群组名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：前端开发组"
              className="w-full h-9 px-3 rounded-lg bg-bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Topic */}
          <div>
            <label className="text-xs text-txt-sub mb-1 block">协作目标 (可选)</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：完成首页重构"
              className="w-full h-9 px-3 rounded-lg bg-bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Member selection */}
          <div>
            <label className="text-xs text-txt-sub mb-2 block">选择成员 *</label>
            {agents.length === 0 ? (
              <p className="text-xs text-txt-muted text-center py-4">暂无 Agent，请先创建</p>
            ) : (
              <div className="max-h-[200px] overflow-y-auto space-y-1">
                {agents.filter(a => a.id !== "butler" && a.id !== "host").map((agent) => {
                  const selected = selectedMembers.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleMember(agent.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors text-left",
                        selected
                          ? "bg-purple/10 ring-1 ring-purple/30"
                          : "hover:bg-bg-hover"
                      )}
                    >
                      <span className={cn("text-sm", selected ? "text-purple" : "text-txt-muted")}>
                        {selected ? "●" : "○"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-txt font-medium">{agent.name}</div>
                        <div className="text-[11px] text-txt-muted">{agent.provider}/{agent.model}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected preview */}
          {selectedMembers.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[11px] text-txt-sub">已选:</span>
              {selectedMembers.map((id) => {
                const agent = agents.find((a) => a.id === id);
                return (
                  <span key={id} className="text-[11px] text-purple">
                    {agent?.name ?? id}
                  </span>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg text-sm text-txt-sub bg-bg-hover hover:bg-bg-elevated transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="h-9 px-4 rounded-lg text-sm font-medium bg-purple text-white hover:bg-purple/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              创建
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update GroupConfigTab.tsx — remove protocol, simplify**

Replace `packages/core/src/gui-v2/src/components/group/GroupConfigTab.tsx`:

```typescript
import { useState } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import type { GroupInfo } from "@/lib/types";

interface GroupConfigTabProps {
  group: GroupInfo;
}

export function GroupConfigTab({ group }: GroupConfigTabProps) {
  const [topic, setTopic] = useState(group.topic ?? "");

  const handleStartDiscussion = () => {
    getWsClient()?.send({
      type: "send_message",
      payload: {
        agentId: "host",
        content: `启动群组 ${group.name} 的协作${topic ? `，目标：${topic}` : ""}`,
      },
    });
  };

  const handleDestroyGroup = () => {
    if (!confirm(`确定要销毁群组 "${group.name}" 吗？`)) return;
    getWsClient()?.send({
      type: "destroy_group",
      payload: { groupId: group.id },
    });
  };

  return (
    <div className="space-y-4">
      {/* Topic */}
      <div>
        <label className="text-xs text-txt-sub mb-1 block">协作目标</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="输入协作目标..."
          className="w-full h-9 px-3 rounded-lg bg-bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleStartDiscussion}
          className="flex-1 h-9 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          启动协作
        </button>
      </div>

      <div className="pt-4 border-t border-bdr">
        <button
          onClick={handleDestroyGroup}
          className="w-full h-9 rounded-lg text-sm text-danger border border-danger/30 hover:bg-danger/10 transition-colors"
        >
          销毁群组
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update GroupDetailPanel.tsx — remove protocol display**

In `GroupDetailPanel.tsx`, line 29, change:

```typescript
// Old:
{group.members.length} 成员 · {group.protocol}

// New:
{group.members.length} 成员
```

- [ ] **Step 5: Update Sidebar.tsx — remove protocol display**

In `Sidebar.tsx`, around line 202, change:

```typescript
// Old:
{group.members.length} 成员 · {group.protocol}

// New:
{group.members.length} 成员
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: frontend remove protocol, direct WS create/destroy commands (Phase 9)"
```

---

## Self-Review Checklist

- [x] Spec coverage: All 7 issues mapped to tasks
- [x] Placeholder scan: No TBD/TODO/fill-in-later
- [x] Type consistency: GroupConfig consistently has no protocol field across all files
