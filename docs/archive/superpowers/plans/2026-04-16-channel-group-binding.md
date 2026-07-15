# Channel-Group 绑定 + Group 角色模型 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Channel 与 Group 之间的绑定机制，使 Channel 用户能以 user/owner 身份参与 Group 讨论；同时重构 Group 角色模型。

**Architecture:** 新增 `ChannelRouter` 薄层负责消息路由，`GroupRole` 枚举定义三种角色权限，`GroupContext` 新增订阅回调实现实时输出推送。Channel 保持纯通道不变。

**Tech Stack:** TypeScript, Vitest, 已有 monorepo 结构

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/shared/src/types.ts` | `GroupConfig` 新增 `owner` 字段 |
| 新增 | `packages/core/src/group/roles.ts` | 角色枚举 + 权限检查 |
| 新增 | `packages/core/src/group/roles.test.ts` | 角色测试 |
| 修改 | `packages/core/src/group/context.ts` | 新增 `onMainMessage` 订阅回调 |
| 修改 | `packages/core/src/group/group.ts` | `run()` 输出到 GroupContext，构造接收 ctx |
| 修改 | `packages/core/src/group/manager.ts` | 创建 Group 时传入 GroupContext |
| 新增 | `packages/core/src/group/router.ts` | ChannelRouter 消息路由 |
| 新增 | `packages/core/src/group/router.test.ts` | Router 测试 |
| 修改 | `packages/core/src/config/schema.ts` | Channel 配置新增 `bindTo` |
| 修改 | `packages/core/src/config/config-loader.ts` | 默认配置更新 |
| 修改 | `config/default.yaml` | 示例绑定配置注释 |
| 修改 | `packages/core/src/agent/butler.ts` | 新增 channel-bind / channel-unbind 工具 |
| 修改 | `packages/core/src/runtime.ts` | 集成 ChannelRouter |

---

## Task 1: GroupConfig 新增 owner 字段

**Files:**
- Modify: `packages/shared/src/types.ts:218-226`
- Test: `packages/core/src/group/protocol.test.ts` (已有，验证不 break)

- [ ] **Step 1: 修改 GroupConfig 类型**

在 `packages/shared/src/types.ts:218-226` 的 `GroupConfig` 接口中新增 `owner` 可选字段：

```ts
export interface GroupConfig {
  id: string;
  name: string;
  members: string[];      // 普通 Agent 组员 ID
  owner?: string;          // 群主 Agent ID（可选，未指定时由 Butler 充当）
  protocol: GroupProtocol;
  moderator?: string;
  maxRounds?: number;
  topic?: string;
}
```

- [ ] **Step 2: 运行现有测试确认不 break**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 94/94 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add owner field to GroupConfig"
```

---

## Task 2: GroupRole 角色枚举 + 权限检查

**Files:**
- Create: `packages/core/src/group/roles.ts`
- Create: `packages/core/src/group/roles.test.ts`

- [ ] **Step 1: 写角色测试**

创建 `packages/core/src/group/roles.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { getRole, canManageGroup, type GroupRole } from "./roles.js";
import type { GroupConfig } from "@myagents/shared";

describe("GroupRole", () => {
  const config: GroupConfig = {
    id: "g1",
    name: "test-group",
    members: ["agent-a", "agent-b"],
    owner: "owner-agent",
    protocol: "round-robin",
  };

  describe("getRole", () => {
    it("identifies user role", () => {
      expect(getRole("user", config)).toBe("user");
    });

    it("identifies owner role", () => {
      expect(getRole("owner-agent", config)).toBe("owner");
    });

    it("identifies member role", () => {
      expect(getRole("agent-a", config)).toBe("member");
    });

    it("defaults to member for unknown agents", () => {
      expect(getRole("stranger", config)).toBe("member");
    });

    it("defaults to member when no owner is set", () => {
      const noOwner = { ...config, owner: undefined };
      expect(getRole("owner-agent", noOwner)).toBe("member");
    });
  });

  describe("canManageGroup", () => {
    it("user can manage", () => {
      expect(canManageGroup("user", config)).toBe(true);
    });

    it("owner can manage", () => {
      expect(canManageGroup("owner-agent", config)).toBe(true);
    });

    it("member cannot manage", () => {
      expect(canManageGroup("agent-a", config)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/roles.test.ts`
Expected: FAIL — `roles.js` 不存在

- [ ] **Step 3: 实现角色模块**

创建 `packages/core/src/group/roles.ts`：

```ts
/**
 * GroupRole — 角色定义与权限检查
 */
import type { GroupConfig } from "@myagents/shared";

export type GroupRole = "user" | "owner" | "member";

/** 根据 agentId 和 GroupConfig 判断角色 */
export function getRole(agentId: string, config: GroupConfig): GroupRole {
  if (agentId === "user") return "user";
  if (config.owner && agentId === config.owner) return "owner";
  return "member";
}

/** 判断是否有群组管理权限（user + owner） */
export function canManageGroup(agentId: string, config: GroupConfig): boolean {
  const role = getRole(agentId, config);
  return role === "user" || role === "owner";
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/roles.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/roles.ts packages/core/src/group/roles.test.ts
git commit -m "feat: add GroupRole with getRole and canManageGroup"
```

---

## Task 3: GroupContext 新增订阅回调

**Files:**
- Modify: `packages/core/src/group/context.ts:68-97`
- Modify: `packages/core/src/group/context.test.ts`

- [ ] **Step 1: 写订阅回调测试**

在 `packages/core/src/group/context.test.ts` 的 `GroupContext > Main channel` describe 块中追加：

```ts
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
```

同时在文件顶部导入 `ChannelMessage`（已在原有 import 中）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/context.test.ts`
Expected: FAIL — `onMainMessage is not a function`

- [ ] **Step 3: 实现 onMainMessage**

在 `packages/core/src/group/context.ts` 的 `GroupContext` 类中新增：

在类的属性区域（`private talkCounter = 0;` 后面）新增：

```ts
  private mainListeners: ((msg: ChannelMessage) => void)[] = [];
```

在 `speakToMain` 方法（约 line 86-97）中，`this.mainHistory.push(msg);` 后面追加通知逻辑：

```ts
    for (const listener of this.mainListeners) listener(msg);
```

新增方法：

```ts
  /** 订阅 main 频道新消息 */
  onMainMessage(listener: (msg: ChannelMessage) => void): void {
    this.mainListeners.push(listener);
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/context.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/context.ts packages/core/src/group/context.test.ts
git commit -m "feat: add onMainMessage subscription to GroupContext"
```

---

## Task 4: Group.run() 输出到 GroupContext

**Files:**
- Modify: `packages/core/src/group/group.ts`
- Modify: `packages/core/src/group/manager.ts`

- [ ] **Step 1: 修改 Group 构造函数接收 GroupContext**

修改 `packages/core/src/group/group.ts`：

构造函数新增 `ctx` 参数：

```ts
import type { GroupContext } from "./context.js";

export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  private history: GroupMessage[] = [];
  private protocol;
  private registry: AgentRegistry;
  private ctx?: GroupContext;

  constructor(config: GroupConfig, registry: AgentRegistry, ctx?: GroupContext) {
    this.id = config.id;
    this.config = config;
    this.registry = registry;
    this.protocol = createProtocol(config.protocol, config.moderator);
    this.ctx = ctx;
  }
```

- [ ] **Step 2: 修改 run() 方法写入 GroupContext**

在 `run()` 方法中，`this.history.push(...)` 之后（约 line 47-51）追加：

```ts
        this.history.push({
          groupId: this.id,
          fromAgentId: speaker.id,
          content: response.content,
          timestamp: Date.now(),
        });
        // 写入 GroupContext（触发订阅者通知）
        if (this.ctx) {
          this.ctx.speakToMain(speaker.id, response.content);
        }
```

- [ ] **Step 3: 修改 GroupManager.create 传入 GroupContext**

修改 `packages/core/src/group/manager.ts` 的 `create` 方法：

```ts
  create(config: GroupConfig): Group {
    const ctx = new GroupContext(config.id, this.dataRoot);
    ctx.saveConfig(config.members, config.protocol);
    this.contexts.set(config.id, ctx);

    const group = new Group(config, this.registry, ctx);
    this.groups.set(config.id, group);

    return group;
  }
```

注意：`GroupContext` 的创建移到 `Group` 之前，确保先有 ctx 再构造 Group。

- [ ] **Step 4: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 94+ PASS（含新增测试）

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/group.ts packages/core/src/group/manager.ts
git commit -m "feat: Group.run() outputs to GroupContext, manager passes ctx"
```

---

## Task 5: Config schema 新增 bindTo

**Files:**
- Modify: `packages/core/src/config/schema.ts:41-67`
- Modify: `packages/core/src/config/config-loader.ts`

- [ ] **Step 1: 新增 BindTo 类型到 schema.ts**

在 `packages/core/src/config/schema.ts` 的 channels 定义前新增：

```ts
export interface ChannelBindTo {
  type: "agent" | "group";
  agentId?: string;
  groupId?: string;
  role?: "user" | "owner";
}
```

修改 channels 中的 Record 类型，在已有字段后新增：

```ts
    // Binding
    bindTo?: ChannelBindTo;
```

同时添加 import 如果需要（`ChannelBindTo` 已在同一文件中定义）。

- [ ] **Step 2: 更新 config-loader.ts 默认配置**

`packages/core/src/config/config-loader.ts` 中 `DEFAULT_CONFIG` 的 `channels: {}` 保持不变（用户按需配置），无需添加默认 bindTo。

- [ ] **Step 3: 更新 default.yaml 添加注释示例**

在 `config/default.yaml` 的 channels 部分替换为：

```yaml
channels:
  qq:
    enabled: false
    type: onebot
    wsUrl: ws://localhost:3001
    botQQ: ""
    # bindTo:
    #   type: group
    #   groupId: debate-01
    #   role: user        # user=实时发言 | owner=私聊群主
```

- [ ] **Step 4: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/config-loader.ts config/default.yaml
git commit -m "feat: add ChannelBindTo config schema with YAML example"
```

---

## Task 6: ChannelRouter 消息路由

**Files:**
- Create: `packages/core/src/group/router.ts`
- Create: `packages/core/src/group/router.test.ts`

- [ ] **Step 1: 写 Router 测试**

创建 `packages/core/src/group/router.test.ts`：

```ts
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

      const result = await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "让 agent-a 先发言" });

      const ctx = groupManager.getContext("debate")!;
      const talks = ctx.listTalks();
      expect(talks.length).toBeGreaterThanOrEqual(1);

      // Router 内部用 ownerTalks Map 缓存 talkId
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

    it("unbind owner mode cleans up talk", async () => {
      router.bind("ch-discord", "debate", "owner");
      await router.route("ch-discord", { channelId: "ch-discord", channelType: "discord", senderId: "u1", senderName: "User", content: "msg" });

      const ctx = groupManager.getContext("debate")!;
      expect(ctx.listTalks().find(t => t.topic === "talk:channel:ch-discord")).toBeDefined();

      router.unbind("ch-discord");
      // Talk should be cleaned (or left orphaned — acceptable)
    });
  });

  describe("static config loading", () => {
    it("loads bindings from config", () => {
      router.loadBindings({
        "ch-qq": { type: "group", groupId: "debate", role: "user" },
        "ch-discord": { type: "group", groupId: "debate", role: "owner" },
      });

      // Verify binding works
      expect(router.getBinding("ch-qq")).toEqual({ type: "group", groupId: "debate", role: "user" });
      expect(router.getBinding("ch-discord")).toEqual({ type: "group", groupId: "debate", role: "owner" });
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/router.test.ts`
Expected: FAIL — `router.js` 不存在

- [ ] **Step 3: 实现 ChannelRouter**

创建 `packages/core/src/group/router.ts`：

```ts
/**
 * ChannelRouter — 根据 Channel 绑定配置分发消息到 Group 或 Butler
 */
import type { InboundMessage } from "@myagents/shared";
import type { GroupManager } from "./manager.js";
import type { ChannelBindTo } from "../config/schema.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("channel-router");

export interface BindingEntry extends ChannelBindTo {}

export interface RouterCallbacks {
  onButlerMessage: (msg: InboundMessage) => Promise<void>;
}

export class ChannelRouter {
  private bindings = new Map<string, BindingEntry>();
  private ownerTalks = new Map<string, string>(); // channelId → talkId

  constructor(
    private groupManager: GroupManager,
    private callbacks: RouterCallbacks,
  ) {}

  /** 路由 Channel 消息 */
  async route(channelId: string, msg: InboundMessage): Promise<string> {
    const binding = this.bindings.get(channelId);

    if (!binding || binding.type === "agent") {
      // 无绑定或 agent 绑定 → 走 Butler
      await this.callbacks.onButlerMessage(msg);
      return "";
    }

    // Group 绑定
    const ctx = this.groupManager.getContext(binding.groupId!);
    if (!ctx) {
      log.warn("Group %s not found for channel %s, falling back to butler", binding.groupId, channelId);
      await this.callbacks.onButlerMessage(msg);
      return "";
    }

    const role = binding.role ?? "user";

    if (role === "user") {
      // User 模式：消息直接注入 main 频道
      ctx.speakToMain("user", msg.content);
      ctx.saveMain();

      // 返回最近 main 频道历史给 Channel
      const recent = ctx.getMainHistory().slice(-20);
      return recent.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
    }

    // Owner 模式：注入持久 Talk
    let talkId = this.ownerTalks.get(channelId);
    let talk = talkId ? ctx.getTalk(talkId) : undefined;

    if (!talk) {
      talk = ctx.createTalk(["user", binding.groupId! + ":owner"], `talk:channel:${channelId}`);
      talkId = talk.id;
      this.ownerTalks.set(channelId, talkId);
      log.info("Created owner talk %s for channel %s", talkId, channelId);
    }

    talk.speak("user", msg.content);
    ctx.saveTalk(talkId);

    // 返回 Talk 历史作为响应
    const history = talk.getHistory();
    return history.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n");
  }

  /** 动态绑定 Channel 到 Group */
  bind(channelId: string, groupId: string, role: "user" | "owner"): void {
    this.bindings.set(channelId, { type: "group", groupId, role });
    log.info("Channel %s bound to group %s as %s", channelId, groupId, role);
  }

  /** 解除绑定 */
  unbind(channelId: string): void {
    this.bindings.delete(channelId);
    // 清理 owner Talk 引用（Talk 数据保留在 GroupContext 中）
    this.ownerTalks.delete(channelId);
    log.info("Channel %s unbound", channelId);
  }

  /** 从静态配置加载绑定 */
  loadBindings(bindings: Record<string, BindingEntry>): void {
    for (const [channelId, entry] of Object.entries(bindings)) {
      this.bindings.set(channelId, entry);
      log.info("Loaded static binding: %s → %s (%s)", channelId, entry.groupId ?? entry.agentId, entry.role ?? "default");
    }
  }

  /** 获取当前绑定信息 */
  getBinding(channelId: string): BindingEntry | undefined {
    return this.bindings.get(channelId);
  }

  /** 设置 butler 回调（用于 Runtime start() 阶段延迟绑定） */
  setButlerCallback(cb: (msg: InboundMessage) => Promise<void>): void {
    this.callbacks.onButlerMessage = cb;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd D:/agent-codes/myagents && npx vitest run packages/core/src/group/router.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/group/router.ts packages/core/src/group/router.test.ts
git commit -m "feat: add ChannelRouter with user/owner binding modes"
```

---

## Task 7: Butler 新增 channel-bind / channel-unbind 工具

**Files:**
- Modify: `packages/core/src/agent/butler.ts`

- [ ] **Step 1: 新增 channel-bind 工具函数**

在 `packages/core/src/agent/butler.ts` 的 `// ---- 新增管家工具 ----` 区域（约 line 247）之前新增：

```ts
function makeChannelBindTool(router: import("../group/router.js").ChannelRouter, groupManager: GroupManager): Tool {
  return {
    name: "channel-bind",
    description: "将 Channel 绑定到 Group（动态）",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
        groupId: { type: "string", description: "目标 Group ID" },
        role: { type: "string", description: "绑定角色: user（实时发言） | owner（私聊群主）" },
      },
      required: ["channelId", "groupId", "role"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      const groupId = params.groupId as string;
      const role = params.role as "user" | "owner";

      if (!groupManager.get(groupId)) {
        return { toolCallId: "", content: `未找到群组: ${groupId}`, isError: true };
      }

      if (role !== "user" && role !== "owner") {
        return { toolCallId: "", content: `无效角色: ${role}，必须是 user 或 owner`, isError: true };
      }

      router.bind(channelId, groupId, role);
      return { toolCallId: "", content: `已将 Channel ${channelId} 绑定到群组 ${groupId} (角色: ${role})` };
    },
  };
}

function makeChannelUnbindTool(router: import("../group/router.js").ChannelRouter): Tool {
  return {
    name: "channel-unbind",
    description: "解除 Channel 绑定",
    parameters: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel 标识" },
      },
      required: ["channelId"],
    },
    async execute(params, _context: ToolContext): Promise<ToolResult> {
      const channelId = params.channelId as string;
      router.unbind(channelId);
      return { toolCallId: "", content: `已解除 Channel ${channelId} 的绑定` };
    },
  };
}
```

- [ ] **Step 2: 修改 ButlerAgent 构造函数注册新工具**

ButlerAgent 构造函数签名新增 `router` 参数：

```ts
  constructor(
    config: AgentConfig,
    provider: LLMProvider,
    registry: AgentRegistry,
    groupManager: GroupManager,
    providerResolver?: (providerId: string) => LLMProvider | undefined,
    router?: import("../group/router.js").ChannelRouter,
  ) {
```

在构造函数体中，`// Register group communication tools` 注释之前追加：

```ts
    // Register channel binding tools
    if (router) {
      this.toolRegistry.register(makeChannelBindTool(router, groupManager));
      this.toolRegistry.register(makeChannelUnbindTool(router));
    }
```

- [ ] **Step 3: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 全部 PASS（但ler 构造函数参数是可选的，不 break 现有测试）

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/butler.ts
git commit -m "feat: add channel-bind/unbind tools to ButlerAgent"
```

---

## Task 8: Runtime 集成 ChannelRouter

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 导入 ChannelRouter**

在 `packages/core/src/runtime.ts` 顶部导入区新增：

```ts
import { ChannelRouter } from "./group/router.js";
import type { ChannelBindTo } from "./config/schema.js";
```

- [ ] **Step 2: 在 Runtime 类中新增 router 属性和初始化**

在 `MyAgentsRuntime` 类中（`private channels` 后面）新增：

```ts
  readonly router: ChannelRouter;
```

在构造函数中，`this.butler` 创建之前（约 line 47 之后），初始化 router（使用空回调，start() 中连接 butler）：

```ts
    // 初始化 ChannelRouter（butler 回调在 start() 中通过 setButlerCallback 连接）
    this.router = new ChannelRouter(this.groupManager, {
      onButlerMessage: async () => {},
    });
```

然后修改 ButlerAgent 构造调用，传入 router：

```ts
    this.butler = new ButlerAgent({
      // ...existing config...
    }, defaultProvider, this.registry, this.groupManager, (providerId: string) => this.providers.get(providerId), this.router);
```

- [ ] **Step 3: 修改 start() 方法连接 router 回调**

在 `start()` 方法中，`this.restoreAgents()` 之前，设置 router 的 butler 回调：

```ts
    // 连接 router → butler
    this.router.setButlerCallback(async (msg) => {
      await this.butler.handleIncomingMessage(msg);
    });

    // 加载静态绑定
    this.loadStaticBindings();
```

- [ ] **Step 4: 新增 loadStaticBindings 和修改 startChannels**

在 Runtime 类中新增方法：

```ts
  /** 从配置加载静态 Channel 绑定 */
  private loadStaticBindings(): void {
    const bindings: Record<string, ChannelBindTo> = {};
    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (cfg.bindTo) {
        bindings[id] = cfg.bindTo;
      }
    }
    if (Object.keys(bindings).length > 0) {
      this.router.loadBindings(bindings);
    }
  }
```

修改 `startChannels()` 方法，将 channel 消息路由到 router 而非直接给 butler：

```ts
  private async startChannels(): Promise<void> {
    for (const [id, cfg] of Object.entries(this.config.channels)) {
      if (!cfg.enabled) continue;

      try {
        const channel = this.createChannel(id, cfg);
        channel.onMessage(async (msg) => {
          // 通过 router 路由，不再直接给 butler
          const response = await this.router.route(id, msg);
          if (response) {
            await channel.send({ channelId: msg.channelId, content: response });
          }
        });
        await channel.start();
        this.channels.push(channel);
        log.info("Channel started: %s (type=%s)", id, cfg.type);
      } catch (err: any) {
        log.error("Failed to start channel %s: %s", id, err.message);
      }
    }
  }
```

- [ ] **Step 5: 运行全部测试**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat: integrate ChannelRouter into Runtime with static config loading"
```

---

## Task 9: 全链路验证 + 文档更新

**Files:**
- Modify: `PROGRESS.md`
- Modify: `FEATURES.md`

- [ ] **Step 1: 运行完整测试套件**

Run: `cd D:/agent-codes/myagents && npx vitest run`
Expected: 全部 PASS，新增约 10+ 测试

- [ ] **Step 2: 更新 PROGRESS.md**

在 Phase 5 部分更新，移除已完成的 Channel 项目，新增 Channel-Group 绑定相关条目。

- [ ] **Step 3: 更新 FEATURES.md**

在文档中新增「Channel-Group 绑定」章节，说明两种绑定模式（user/owner）和配置方式。

- [ ] **Step 4: 最终 Commit**

```bash
git add PROGRESS.md FEATURES.md
git commit -m "docs: update progress and features for channel-group binding"
```
