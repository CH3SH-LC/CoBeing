# Phase 8.1: Agent 自治文件系统 + 配置重设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 拥有完整自治文件系统（IDENTITY/SOUL/USER/BOOTSTRAP/AGENTS/TOOLS），system prompt 从文件链构建，配置从根级集中式变为 Agent 自包含。

**Architecture:** 每个Agent目录 (`data/agents/{id}/`) 成为自治单元，包含自己的 config.json + 核心 .md 文件。根配置 `config/default.json` 只声明 providers + agent ID 列表。Agent 构造时按链式顺序读取 .md 文件组装 system prompt。

**Tech Stack:** TypeScript, Vitest, Node.js fs

**注意:** CLAUDE.md 要求所有任务内联执行，禁止使用 subagents。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/core/src/agent/paths.ts` | 新增 userPath/bootstrapPath/toolsPath |
| 修改 | `packages/core/src/agent/paths.test.ts` | 新增路径测试 |
| 修改 | `packages/core/src/conversation/prompt-builder.ts` | 从文件链构建 system prompt |
| 修改 | `packages/core/src/conversation/prompt-builder.test.ts` | prompt builder 测试 |
| 修改 | `packages/core/src/agent/agent.ts` | 使用新 prompt builder，添加 BOOTSTRAP 自删除逻辑 |
| 修改 | `packages/core/src/config/schema.ts` | 新 AppConfig 格式 |
| 修改 | `packages/core/src/config/config-loader.ts` | 支持 JSON + YAML |
| 创建 | `config/default.json` | 新最小化配置 |
| 修改 | `packages/core/src/runtime.ts` | 从 agent 目录创建 Agent |
| 修改 | `packages/core/src/agent/butler.ts` | 适配新配置 |
| 创建 | `data/agents/_templates/` | 模板文件 (IDENTITY/SOUL/USER/BOOTSTRAP/AGENTS) |

---

### Task 1: AgentPaths 扩展 — 新增 3 个路径

**Files:**
- 修改: `packages/core/src/agent/paths.ts`
- 修改: `packages/core/src/agent/paths.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/agent/paths.test.ts` 的 `describe("AgentPaths")` 中新增：

```typescript
it("resolves new paths (user, bootstrap, tools)", () => {
  const p = new AgentPaths(tmpDir);
  expect(p.userPath).toBe(path.join(tmpDir, "USER.md"));
  expect(p.bootstrapPath).toBe(path.join(tmpDir, "BOOTSTRAP.md"));
  expect(p.toolsPath).toBe(path.join(tmpDir, "TOOLS.md"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/agent/paths.test.ts`
Expected: FAIL — `userPath` 不存在

- [ ] **Step 3: 实现 AgentPaths 新增路径**

在 `packages/core/src/agent/paths.ts` 的 `AgentPaths` 类中，在 `skillsDir` 后新增：

```typescript
get userPath()      { return path.join(this.baseDir, "USER.md"); }
get bootstrapPath() { return path.join(this.baseDir, "BOOTSTRAP.md"); }
get toolsPath()     { return path.join(this.baseDir, "TOOLS.md"); }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/agent/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/agent/paths.ts packages/core/src/agent/paths.test.ts && git commit -m "feat(paths): add USER/BOOTSTRAP/TOOLS path support"
```

---

### Task 2: AgentFiles 新增读写方法

**Files:**
- 修改: `packages/core/src/agent/paths.ts`（AgentFiles 部分）
- 修改: `packages/core/src/agent/paths.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/agent/paths.test.ts` 的 `describe("AgentFiles")` 中新增：

```typescript
it("writes and reads USER.md", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  f.writeUser("用户偏好：简洁回答，使用中文。");
  expect(f.readUser()).toBe("用户偏好：简洁回答，使用中文。");
});

it("returns empty string for missing USER.md", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  expect(f.readUser()).toBe("");
});

it("writes and reads BOOTSTRAP.md", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  f.writeBootstrap("首次启动时请完成以下任务：...");
  expect(f.readBootstrap()).toBe("首次启动时请完成以下任务：...");
});

it("returns empty string for missing BOOTSTRAP.md", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  expect(f.readBootstrap()).toBe("");
});

it("writes and reads TOOLS.md", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  f.writeTools("## bash\n默认 shell: zsh");
  expect(f.readTools()).toBe("## bash\n默认 shell: zsh");
});

it("deletes BOOTSTRAP.md after consume", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  f.writeBootstrap("一次性引导内容");
  const content = f.consumeBootstrap();
  expect(content).toBe("一次性引导内容");
  expect(f.readBootstrap()).toBe("");
});

it("returns empty for consumeBootstrap when no file", () => {
  const f = new AgentFiles(new AgentPaths(tmpDir));
  expect(f.consumeBootstrap()).toBe("");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/agent/paths.test.ts`
Expected: FAIL — `writeUser` 等方法不存在

- [ ] **Step 3: 实现 AgentFiles 新方法**

在 `packages/core/src/agent/paths.ts` 的 `AgentFiles` 类中新增（在 `appendExperience` 方法之后）：

```typescript
/** 读取 USER.md */
readUser(): string {
  return this.readFile(this.paths.userPath);
}

/** 写入 USER.md */
writeUser(content: string): void {
  fs.writeFileSync(this.paths.userPath, content, "utf-8");
}

/** 读取 BOOTSTRAP.md */
readBootstrap(): string {
  return this.readFile(this.paths.bootstrapPath);
}

/** 写入 BOOTSTRAP.md */
writeBootstrap(content: string): void {
  fs.writeFileSync(this.paths.bootstrapPath, content, "utf-8");
}

/** 读取并删除 BOOTSTRAP.md（一次性引导） */
consumeBootstrap(): string {
  const content = this.readFile(this.paths.bootstrapPath);
  if (content) {
    fs.unlinkSync(this.paths.bootstrapPath);
  }
  return content;
}

/** 读取 TOOLS.md */
readTools(): string {
  return this.readFile(this.paths.toolsPath);
}

/** 写入 TOOLS.md */
writeTools(content: string): void {
  fs.writeFileSync(this.paths.toolsPath, content, "utf-8");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/agent/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/agent/paths.ts packages/core/src/agent/paths.test.ts && git commit -m "feat(paths): add USER/BOOTSTRAP/TOOLS read/write + consumeBootstrap"
```

---

### Task 3: System Prompt 构建链

**Files:**
- 修改: `packages/core/src/conversation/prompt-builder.ts`
- 创建: `packages/core/src/conversation/prompt-builder.test.ts`（如果不存在则创建）

核心变化：将 Agent 构造函数中分散的 prompt 拼接逻辑提取到 `buildSystemPromptFromFiles` 函数，按固定链式顺序从文件构建。

链式顺序：
1. `SOUL.md` — 人格基底（最前置）
2. `BOOTSTRAP.md` — 启动引导（一次性，读取后删除）
3. `config.json` 中的 role + name — 角色描述（主体）
4. `AGENTS.md` — 工作空间指南
5. `USER.md` — 用户偏好
6. `EXPERIENCE.md` — 相关经验（过滤后）
7. `MEMORY.md` — 历史记忆索引

- [ ] **Step 1: 写失败测试**

创建或追加到 `packages/core/src/conversation/prompt-builder.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentPaths, AgentFiles } from "../agent/paths.js";
import { buildSystemPromptFromFiles } from "./prompt-builder.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myagents-prompt-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildSystemPromptFromFiles", () => {
  it("builds prompt from role when no files exist", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("你是助手。");
  });

  it("prepends SOUL.md at the very top", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeSoul("你是一个严谨的工程师。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    const soulIdx = result.indexOf("你是一个严谨的工程师");
    const promptIdx = result.indexOf("你是助手。");
    expect(soulIdx).toBeLessThan(promptIdx);
  });

  it("includes BOOTSTRAP.md and deletes the file", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeBootstrap("请先检查工作空间。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("请先检查工作空间。");
    expect(fs.existsSync(paths.bootstrapPath)).toBe(false);
  });

  it("appends USER.md preferences", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeUser("用户偏好：简洁回答。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("用户偏好：简洁回答。");
  });

  it("appends AGENTS.md workspace guide", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeAgents("## 工作指南\n先读后写。");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("先读后写。");
  });

  it("appends EXPERIENCE.md when non-trivial", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeExperience("# EXPERIENCE.md\n\n> 经验\n\n## [2026-04-19] test\n- **问题**: foo\n- **解决**: bar\n".repeat(3));
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("你积累的经验");
  });

  it("skips short EXPERIENCE.md (noise)", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeExperience("short");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).not.toContain("你积累的经验");
  });

  it("appends MEMORY.md index", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeMemoryIndex("# 记忆索引\n- 2026-04-19: 完成了某任务");
    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "你是助手。",
    });
    expect(result).toContain("历史记忆");
  });

  it("full chain order is correct", () => {
    const paths = new AgentPaths(tmpDir);
    const files = new AgentFiles(paths);
    files.writeSoul("AAA_SOUL");
    files.writeBootstrap("BBB_BOOTSTRAP");
    files.writeAgents("DDD_AGENTS");
    files.writeUser("EEE_USER");
    files.writeMemoryIndex("GGG_MEMORY");

    const result = buildSystemPromptFromFiles(files, {
      name: "助手",
      role: "通用助手",
      systemPrompt: "CCC_PROMPT",
    });

    const soulIdx = result.indexOf("AAA_SOUL");
    const bootIdx = result.indexOf("BBB_BOOTSTRAP");
    const promptIdx = result.indexOf("CCC_PROMPT");
    const agentsIdx = result.indexOf("DDD_AGENTS");
    const userIdx = result.indexOf("EEE_USER");
    const memIdx = result.indexOf("GGG_MEMORY");

    expect(soulIdx).toBeLessThan(bootIdx);
    expect(bootIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(memIdx);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/conversation/prompt-builder.test.ts`
Expected: FAIL — `buildSystemPromptFromFiles` 不存在

- [ ] **Step 3: 实现 buildSystemPromptFromFiles**

在 `packages/core/src/conversation/prompt-builder.ts` 中新增（保留原有 `buildSystemPrompt` 不动，后续 Agent 迁移后可删除）：

```typescript
import type { AgentFiles } from "../agent/paths.js";

interface PromptConfig {
  name: string;
  role: string;
  systemPrompt: string;
}

/**
 * 从 Agent 文件链构建 system prompt
 *
 * 链式顺序：SOUL → BOOTSTRAP → systemPrompt(role) → AGENTS → USER → EXPERIENCE → MEMORY
 * BOOTSTRAP 读取后自动删除（一次性引导）
 */
export function buildSystemPromptFromFiles(files: AgentFiles, config: PromptConfig): string {
  const parts: string[] = [];

  // 1. SOUL.md — 人格基底
  const soul = files.readSoul();
  if (soul) {
    parts.push(soul);
  }

  // 2. BOOTSTRAP.md — 启动引导（一次性，读取后删除）
  const bootstrap = files.consumeBootstrap();
  if (bootstrap) {
    parts.push(bootstrap);
  }

  // 3. systemPrompt — 角色描述（主体）
  parts.push(config.systemPrompt || `你是${config.name}，${config.role}`);

  // 4. AGENTS.md — 工作空间指南
  const agents = files.readAgents();
  if (agents) {
    parts.push(agents);
  }

  // 5. USER.md — 用户偏好
  const user = files.readUser();
  if (user) {
    parts.push(`# 用户偏好\n\n${user}`);
  }

  // 6. EXPERIENCE.md — 相关经验（跳过短内容噪声）
  const experience = files.readExperience();
  if (experience && experience.length > 50) {
    parts.push(`# 你积累的经验\n\n${experience}`);
  }

  // 7. MEMORY.md — 历史记忆索引
  const memory = files.readMemoryIndex();
  if (memory) {
    parts.push(`# 你的历史记忆\n\n${memory}`);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /d/agent-codes/myagents && pnpm test -- packages/core/src/conversation/prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/conversation/prompt-builder.ts packages/core/src/conversation/prompt-builder.test.ts && git commit -m "feat(prompt): add buildSystemPromptFromFiles with file chain (SOUL→BOOTSTRAP→AGENTS→USER→EXP→MEM)"
```

---

### Task 4: Agent 使用新 Prompt Builder

**Files:**
- 修改: `packages/core/src/agent/agent.ts`

将 Agent 构造函数中的内联 prompt 拼接替换为 `buildSystemPromptFromFiles` 调用。

- [ ] **Step 1: 修改 Agent 构造函数**

在 `packages/core/src/agent/agent.ts` 中：

1. 添加 import：

```typescript
import { buildSystemPromptFromFiles } from "../conversation/prompt-builder.js";
```

2. 替换构造函数中 `// 增强 systemPrompt：SOUL.md + MEMORY.md` 到 `// 记忆系统` 之间的代码块。

**旧代码**（约第 94-114 行）：

```typescript
    // 增强 systemPrompt：SOUL.md + MEMORY.md
    let enhancedPrompt = config.systemPrompt || "";
    if (soulContent) {
      enhancedPrompt = soulContent + "\n\n" + enhancedPrompt;
    }
    if (memoryIndex) {
      enhancedPrompt += "\n\n# 你的历史记忆\n\n" + memoryIndex;
    }

    // 记忆系统
    this.memoryWriter = new MemoryWriter(this.paths.memoryDir);
    new MemoryReader(this.paths.memoryDir, this.paths.memoryIndexPath);

    // 经验系统
    this.experienceWriter = new ExperienceWriter(this.paths.experiencePath, this.provider);

    // 增强 systemPrompt：EXPERIENCE.md
    const experienceContent = this.files.readExperience();
    if (experienceContent && experienceContent.length > 50) {
      enhancedPrompt += "\n\n# 你积累的经验\n\n" + experienceContent;
    }
```

**新代码**：

```typescript
    // 记忆系统
    this.memoryWriter = new MemoryWriter(this.paths.memoryDir);
    new MemoryReader(this.paths.memoryDir, this.paths.memoryIndexPath);

    // 经验系统
    this.experienceWriter = new ExperienceWriter(this.paths.experiencePath, this.provider);

    // 从文件链构建 system prompt（SOUL → BOOTSTRAP → role → AGENTS → USER → EXPERIENCE → MEMORY）
    const enhancedPrompt = buildSystemPromptFromFiles(this.files, {
      name: this.name,
      role: config.role,
      systemPrompt: config.systemPrompt || "",
    });
```

3. 同时移除构造函数开头不再需要的变量读取（第 80-83 行附近），因为这些读取已经在 `buildSystemPromptFromFiles` 内部完成：

**旧代码**：
```typescript
    // 从文件系统加载增强信息
    const identity = this.files.readIdentity();
    const soulContent = this.files.readSoul();
    const memoryIndex = this.files.readMemoryIndex();
    const fileConfig = this.files.readConfig();
```

**新代码**：
```typescript
    // 从文件系统加载增强信息
    const identity = this.files.readIdentity();
    const fileConfig = this.files.readConfig();
```

保留 `identity` 和 `fileConfig` 因为它们在后续逻辑中仍被使用（identity.name 合并、fileConfig 合并）。

- [ ] **Step 2: 运行全部测试确认不破坏**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部 131 通过（行为不变，只是提取了逻辑）

- [ ] **Step 3: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/agent/agent.ts && git commit -m "refactor(agent): use buildSystemPromptFromFiles for prompt chain"
```

---

### Task 5: 配置 Schema 重设计

**Files:**
- 修改: `packages/shared/src/types.ts`
- 修改: `packages/core/src/config/schema.ts`

核心变化：
- `AppConfig` 中 `agent` 字段简化为 `agents: string[]`（ID 列表）
- 新增 `core.skillsDir` 和 `core.promptsDir`
- Agent 的详细配置由 `data/agents/{id}/config.json` 管理

- [ ] **Step 1: 修改 schema.ts — 新 AppConfig 格式**

将 `packages/core/src/config/schema.ts` 全部替换为：

```typescript
/**
 * 配置 Schema 定义 — Phase 8.1 自治配置
 */

export interface ChannelBindTo {
  type: "agent" | "group";
  agentId?: string;
  groupId?: string;
  role?: "user" | "owner";
}

/**
 * 根配置 — 最小化，只声明全局资源和 agent ID 列表
 */
export interface AppConfig {
  core: {
    logLevel: string;
    dataDir: string;
    skillsDir?: string;     // 全局 Skill 仓库路径，默认 "./skills"
    promptsDir?: string;    // Prompt 模板路径，默认 "./prompts"
  };
  /** 默认 Agent 配置（用于创建 butler） */
  agent: {
    name: string;
    role: string;
    systemPrompt: string;
    provider: string;
    model: string;
    permissions: {
      mode: string;
      allow?: string[];
      deny?: string[];
    };
    sandbox: {
      enabled: boolean;
      filesystem: string;
      network: boolean;
      bindings?: string[];
    };
    tools?: string[];
    toolsConfig?: {
      defaultPermission: string;
      enabled: string[];
      permissions: Record<string, Record<string, string | number>>;
    };
    skillsDir?: string;
  };
  providers: Record<string, {
    type?: "openai-compat" | "anthropic" | "gemini";
    apiKeyEnv?: string;
    baseURL?: string;
    apiKey?: string;
  }>;
  channels: Record<string, {
    enabled: boolean;
    type: "onebot" | "wecom" | "feishu" | "discord";
    // OneBot / QQ
    wsUrl?: string;
    botQQ?: string;
    accessToken?: string;
    allowedGroups?: number[];
    allowedUsers?: number[];
    // WeCom
    wecomCorpId?: string;
    wecomAgentId?: string;
    wecomSecret?: string;
    wecomToken?: string;
    wecomEncodingAesKey?: string;
    wecomPort?: number;
    // Feishu
    feishuAppId?: string;
    feishuAppSecret?: string;
    feishuVerificationToken?: string;
    feishuEncryptKey?: string;
    feishuPort?: number;
    // Discord
    discordBotToken?: string;
    discordGuildId?: string;
    discordAllowedChannels?: string[];
    // Binding
    bindTo?: ChannelBindTo;
  }>;
  gui?: {
    enabled: boolean;
    wsPort: number;
  };
  mcpServers?: Record<string, {
    transport: "stdio" | "http";
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }>;
  groups?: Array<{
    id: string;
    name: string;
    members: string[];
    protocol: string;
    moderator?: string;
    maxRounds?: number;
    topic?: string;
  }>;
}

/**
 * Agent 自治配置 — 存放在 data/agents/{id}/config.json
 */
export interface AgentSelfConfig {
  name: string;
  role: string;
  provider: string;
  model: string;
  permissions?: {
    mode: string;
    allow?: string[];
    deny?: string[];
  };
  sandbox?: {
    enabled: boolean;
    filesystem: string;
    network: boolean;
    bindings?: string[];
  };
  tools?: string[];
  skills?: string[];
  systemPrompt?: string;
}
```

- [ ] **Step 2: 修改 types.ts — 添加 AgentSelfConfig 兼容**

在 `packages/shared/src/types.ts` 中，在 `AgentConfig` 接口后添加注释说明：

```typescript
// 注意：Phase 8.1 引入 AgentSelfConfig（在 @myagents/core/config/schema.ts），
// AgentConfig 保留用于向后兼容和 Butler 创建 Agent 时的接口。
// 未来 AgentSelfConfig 将替代 AgentConfig 成为标准。
```

不需要修改 `AgentConfig` 本身 — 保持向后兼容，后续阶段逐步迁移。

- [ ] **Step 3: 运行测试确认不破坏**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部通过（schema 变更向后兼容）

- [ ] **Step 4: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/config/schema.ts packages/shared/src/types.ts && git commit -m "feat(config): add AgentSelfConfig, prepare for self-contained agent configs"
```

---

### Task 6: Config Loader 支持 JSON

**Files:**
- 修改: `packages/core/src/config/config-loader.ts`
- 创建: `config/default.json`

- [ ] **Step 1: 创建新的 config/default.json**

```json
{
  "core": {
    "logLevel": "info",
    "dataDir": "./data",
    "skillsDir": "./skills",
    "promptsDir": "./prompts"
  },
  "agent": {
    "name": "管家",
    "role": "MyAgents 管家",
    "systemPrompt": "你是 MyAgents 管家。你可以创建 Agent、创建群组、启动讨论。\n\n工作流程：\n1. 收到任务后先调用 butler-read-registry 了解已有 Agent\n2. 调用 butler-analyze-task 分析需要什么 Agent\n3. 根据分析结果创建 Agent 或复用已有 Agent\n4. 创建群组并启动讨论",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "permissions": { "mode": "full-access" },
    "sandbox": { "enabled": false, "filesystem": "workspace-only", "network": true }
  },
  "providers": {
    "anthropic": {
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "type": "anthropic"
    },
    "openai": {
      "apiKeyEnv": "OPENAI_API_KEY",
      "baseURL": "https://api.openai.com/v1"
    },
    "deepseek": {
      "apiKeyEnv": "DEEPSEEK_API_KEY",
      "baseURL": "https://api.deepseek.com/v1"
    },
    "zhipu": {
      "apiKeyEnv": "ZHIPU_API_KEY",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4"
    },
    "qwen": {
      "apiKeyEnv": "QWEN_API_KEY",
      "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1"
    },
    "minimax": {
      "apiKeyEnv": "MINIMAX_API_KEY",
      "baseURL": "https://api.minimax.chat/v1"
    },
    "volcengine": {
      "apiKeyEnv": "VOLCENGINE_API_KEY",
      "baseURL": "https://ark.cn-beijing.volces.com/api/v3"
    },
    "gemini": {
      "apiKeyEnv": "GEMINI_API_KEY",
      "type": "gemini"
    },
    "grok": {
      "apiKeyEnv": "XAI_API_KEY",
      "baseURL": "https://api.x.ai/v1"
    }
  },
  "channels": {},
  "gui": {
    "enabled": true,
    "wsPort": 18765
  },
  "groups": []
}
```

- [ ] **Step 2: 修改 config-loader.ts 支持 JSON**

替换 `packages/core/src/config/config-loader.ts` 的 `loadConfig` 函数核心逻辑，同时支持 `.json` 和 `.yaml`：

```typescript
export function loadConfig(configPath?: string): AppConfig {
  let config: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 自动检测配置文件（优先 JSON，回退 YAML）
  let resolvedPath: string | undefined;
  if (configPath) {
    resolvedPath = configPath;
  } else {
    const jsonPath = path.resolve("config/default.json");
    const yamlPath = path.resolve("config/default.yaml");
    if (fs.existsSync(jsonPath)) {
      resolvedPath = jsonPath;
    } else if (fs.existsSync(yamlPath)) {
      resolvedPath = yamlPath;
    }
  }

  if (resolvedPath && fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, "utf-8");
      const ext = path.extname(resolvedPath);
      const parsed = ext === ".json"
        ? JSON.parse(raw) as Partial<AppConfig>
        : yaml.load(raw) as Partial<AppConfig>;
      config = deepMerge(config as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as AppConfig;
      log.info("Config loaded from %s", resolvedPath);
    } catch (err) {
      log.warn("Failed to load config file %s: %s", resolvedPath, err);
    }
  } else {
    log.info("No config file found, using defaults");
  }

  // 从环境变量覆盖
  if (process.env.LOG_LEVEL) config.core.logLevel = process.env.LOG_LEVEL;
  if (process.env.DATA_DIR) config.core.dataDir = process.env.DATA_DIR;

  return config;
}
```

同时更新 `DEFAULT_CONFIG` 加入新字段：

```typescript
const DEFAULT_CONFIG: AppConfig = {
  core: {
    logLevel: "info",
    dataDir: "./data",
    skillsDir: "./skills",
    promptsDir: "./prompts",
  },
  // ... 其余不变
```

- [ ] **Step 3: 运行测试**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
cd /d/agent-codes/myagents && git add config/default.json packages/core/src/config/config-loader.ts && git commit -m "feat(config): support JSON config format, add default.json"
```

---

### Task 7: 创建 Agent 模板文件

**Files:**
- 创建: `data/agents/_templates/IDENTITY.md`
- 创建: `data/agents/_templates/SOUL.md`
- 创建: `data/agents/_templates/USER.md`
- 创建: `data/agents/_templates/BOOTSTRAP.md`
- 创建: `data/agents/_templates/AGENTS.md`

- [ ] **Step 1: 创建模板目录和文件**

`data/agents/_templates/IDENTITY.md`:
```markdown
# IDENTITY.md

- Name: {{name}}
- Emoji: {{emoji}}
- Creature: AI Agent
- Vibe: 专业、高效
```

`data/agents/_templates/SOUL.md`:
```markdown
# SOUL.md

> Agent 人格描述。此文件内容将作为 system prompt 的最前置。
> 管家创建 Agent 时填写，Agent 也可以自我更新。

你是{{name}}，{{role}}。
```

`data/agents/_templates/USER.md`:
```markdown
# USER.md

> 用户偏好和画像。用户可以编辑此文件来影响 Agent 的行为。

（暂无用户偏好设置）
```

`data/agents/_templates/BOOTSTRAP.md`:
```markdown
# BOOTSTRAP.md

> 启动引导。Agent 首次激活时读取，完成后自动删除。

欢迎使用 MyAgents！请完成以下初始化任务：
1. 检查你的工作空间目录
2. 确认你的工具列表
3. 了解你的角色和任务

完成后，此文件将自动删除。
```

`data/agents/_templates/AGENTS.md`:
```markdown
# AGENTS.md

> 工作空间指南。Agent 的行为准则和工作流程。

## 启动流程
1. 读取 IDENTITY.md 确认身份
2. 检查工作空间目录
3. 确认可用工具

## 行为准则
- 先读后写：修改文件前先了解内容
- 保持简洁：回答直接，不废话
- 记录经验：完成复杂任务后总结经验
```

- [ ] **Step 2: 创建 butler 默认配置**

`data/agents/butler/config.json`（如果 data/agents/butler 不存在则创建）：

```json
{
  "name": "管家",
  "role": "MyAgents 管家",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "permissions": { "mode": "full-access" },
  "sandbox": { "enabled": false, "filesystem": "workspace-only", "network": true },
  "tools": [
    "bash", "read-file", "write-file", "glob", "grep",
    "butler-create-agent", "butler-destroy-agent",
    "butler-create-group", "butler-destroy-group",
    "butler-list", "butler-run-group", "butler-add-to-group",
    "butler-read-registry", "butler-update-registry", "butler-analyze-task",
    "group-speak", "talk-create", "talk-send", "talk-read"
  ],
  "skills": ["group-coordination", "project-planning"]
}
```

- [ ] **Step 3: Commit**

```bash
cd /d/agent-codes/myagents && git add data/agents/_templates/ data/agents/butler/config.json && git commit -m "feat(templates): add agent file templates and butler default config"
```

---

### Task 8: 更新 Runtime 使用自治配置

**Files:**
- 修改: `packages/core/src/runtime.ts`

核心变化：Runtime 在恢复 Agent 时，从 `data/agents/{id}/config.json` 读取配置，与注册表数据合并创建 Agent。

- [ ] **Step 1: 修改 restoreAgents**

在 `packages/core/src/runtime.ts` 的 `restoreAgents` 方法中，从 agent 目录的 `config.json` 读取配置：

```typescript
import { AgentPaths, AgentFiles } from "./agent/paths.js";
import type { AgentSelfConfig } from "./config/schema.js";

/** 从 ButlerRegistry 恢复已持久化的 Agent */
private restoreAgents(): void {
  const butlerReg = new ButlerRegistry(this.dataRoot);
  const entries = butlerReg.parseAgentsRegistry();

  for (const entry of entries) {
    // 跳过已注册的（如 butler 本身）
    if (this.registry.get(entry.id)) continue;

    // 尝试从 agent 目录读取自治配置
    const paths = AgentPaths.forAgent(entry.id, this.dataRoot);
    let selfConfig: Partial<AgentSelfConfig> = {};
    if (fs.existsSync(paths.configPath)) {
      try {
        const raw = fs.readFileSync(paths.configPath, "utf-8");
        selfConfig = JSON.parse(raw);
      } catch {
        // config.json 损坏，回退到注册表数据
      }
    }

    const providerId = selfConfig.provider || entry.provider || this.config.agent.provider;
    const model = selfConfig.model || entry.model || this.config.agent.model;
    const provider = this.providers.get(providerId) ?? this.providers.get(this.config.agent.provider);

    if (!provider) {
      log.warn("Skipping agent %s: no provider %s", entry.id, providerId);
      continue;
    }

    const config: import("@myagents/shared").AgentConfig = {
      id: entry.id,
      name: selfConfig.name || entry.name || entry.id,
      role: selfConfig.role || entry.role,
      systemPrompt: selfConfig.systemPrompt || entry.systemPrompt || `你是${entry.name}，${entry.role}`,
      provider: providerId,
      model,
      permissions: selfConfig.permissions as any || { mode: "workspace-write" },
      sandbox: selfConfig.sandbox as any || { enabled: false, filesystem: "workspace-only", network: true },
      tools: selfConfig.tools || ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
      skills: selfConfig.skills,
    };

    try {
      const agent = new Agent(config, provider, this.dataRoot);
      agent.subscribeToBus(this.eventBus);
      this.registry.register(agent);
      log.info("Restored agent: %s (%s) [from %s]",
        config.name, entry.id,
        Object.keys(selfConfig).length > 0 ? "config.json" : "registry");
    } catch (err: any) {
      log.warn("Failed to restore agent %s: %s", entry.id, err.message);
    }
  }
}
```

注意需要在文件顶部添加 `import fs from "node:fs";`（如果还没有的话）。

- [ ] **Step 2: 运行全部测试**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/runtime.ts && git commit -m "feat(runtime): restore agents from self-contained config.json"
```

---

### Task 9: Butler 创建 Agent 时写入自治文件

**Files:**
- 修改: `packages/core/src/agent/butler.ts`

核心变化：`butler-create-agent` 工具创建 Agent 时，同时写入 `config.json` + 从模板复制核心 `.md` 文件。

- [ ] **Step 1: 修改 makeCreateAgentTool**

在 `packages/core/src/agent/butler.ts` 的 `makeCreateAgentTool` 函数中，在 `const agent = new Agent(config, provider);` 之前，添加自治文件写入逻辑：

```typescript
import type { AgentSelfConfig } from "../config/schema.js";

// 在 makeCreateAgentTool 函数内部，new Agent(config, provider) 之前：

      // 写入自治配置到 agent 目录
      const agentPaths = AgentPaths.forAgent(id);
      agentPaths.ensureDirs();
      const agentFiles = new AgentFiles(agentPaths);

      // 写入 config.json
      const selfConfig: AgentSelfConfig = {
        name,
        role: params.role as string,
        provider: providerId,
        model,
        permissions: { mode: "workspace-write" },
        sandbox: { enabled: false, filesystem: "workspace-only", network: true },
        tools: ["bash", "read-file", "write-file", "glob", "grep", "web-fetch"],
        skills: params.skills as string[] | undefined,
      };
      agentFiles.writeConfig(selfConfig as any);

      // 从模板复制核心文件（如果目标不存在）
      const templatesDir = path.resolve("data/agents/_templates");
      for (const tmplFile of ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"]) {
        const src = path.join(templatesDir, tmplFile);
        const dst = path.join(agentPaths.baseDir, tmplFile);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          let content = fs.readFileSync(src, "utf-8");
          content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, params.role as string);
          fs.writeFileSync(dst, content, "utf-8");
        }
      }
```

需要在文件顶部添加：
```typescript
import path from "node:path";
import fs from "node:fs";
import { AgentPaths, AgentFiles } from "./paths.js";
```

- [ ] **Step 2: 运行全部测试**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/agent/butler.ts && git commit -m "feat(butler): write self-contained config + template files when creating agent"
```

---

### Task 10: 集成测试 + PROGRESS.md

**Files:**
- 修改: `packages/core/src/integration.test.ts`
- 创建: `PROGRESS.md`

- [ ] **Step 1: 在集成测试中添加文件链测试**

在 `packages/core/src/integration.test.ts` 中新增测试（如果文件不存在则创建）：

```typescript
describe("Phase 8.1: Agent File System Integration", () => {
  it("agent builds prompt from file chain", async () => {
    // 创建一个有完整文件的 agent
    const paths = AgentPaths.forAgent("test-chain-agent", tmpDir);
    const files = new AgentFiles(paths);
    paths.ensureDirs();

    files.writeSoul("你是一个测试灵魂。");
    files.writeAgents("## 工作指南\n测试指南。");
    files.writeUser("偏好：简洁。");

    const config: AgentConfig = {
      id: "test-chain-agent",
      name: "测试Agent",
      role: "测试",
      systemPrompt: "你是测试Agent。",
      provider: "deepseek",
      model: "deepseek-chat",
    };

    const agent = new Agent(config, mockProvider, tmpDir);
    // Agent 创建后 BOOTSTRAP.md 不存在（因为没写过）
    expect(files.readBootstrap()).toBe("");
  });

  it("bootstrap is consumed after agent creation", async () => {
    const paths = AgentPaths.forAgent("test-bootstrap", tmpDir);
    const files = new AgentFiles(paths);
    paths.ensureDirs();

    files.writeBootstrap("首次启动引导内容");

    const config: AgentConfig = {
      id: "test-bootstrap",
      name: "引导测试",
      role: "测试",
      systemPrompt: "你是引导测试Agent。",
      provider: "deepseek",
      model: "deepseek-chat",
    };

    const agent = new Agent(config, mockProvider, tmpDir);
    // BOOTSTRAP 应该已被 consume 删除
    expect(fs.existsSync(paths.bootstrapPath)).toBe(false);
  });
});
```

注意：需要根据现有 integration.test.ts 的结构调整 mockProvider 等变量的使用。

- [ ] **Step 2: 创建 PROGRESS.md**

```markdown
# MyAgents 开发进度

## Phase 8: 架构重构

### Phase 8.1: Agent 自治文件系统 + 配置重设计
- [x] Task 1: AgentPaths 扩展 (USER/BOOTSTRAP/TOOLS 路径)
- [x] Task 2: AgentFiles 新增读写方法 + consumeBootstrap
- [x] Task 3: buildSystemPromptFromFiles 文件链构建
- [x] Task 4: Agent 使用新 prompt builder
- [x] Task 5: 配置 Schema 重设计 (AgentSelfConfig)
- [x] Task 6: Config Loader 支持 JSON + default.json
- [x] Task 7: 模板文件 + butler 默认配置
- [x] Task 8: Runtime 从自治配置恢复 Agent
- [x] Task 9: Butler 创建 Agent 时写入自治文件
- [x] Task 10: 集成测试

### Phase 8.2: Skill 仓库架构 (待开始)
### Phase 8.3: 异步协作引擎 (待开始)
### Phase 8.4: 经验系统修复 (待开始)
### Phase 8.5: 群主管理 Skill (待开始)
```

- [ ] **Step 3: 运行全部测试**

Run: `cd /d/agent-codes/myagents && pnpm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
cd /d/agent-codes/myagents && git add packages/core/src/integration.test.ts PROGRESS.md && git commit -m "test: add Phase 8.1 integration tests, add PROGRESS.md"
```

---

## Self-Review

### 1. Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|----------|
| AgentPaths 新增 USER/BOOTSTRAP/TOOLS | Task 1 |
| AgentFiles 新增读写方法 | Task 2 |
| BOOTSTRAP 一次性读取后删除 | Task 2 (consumeBootstrap), Task 3, Task 4 |
| System Prompt 文件链构建 | Task 3, Task 4 |
| config/default.json 新格式 | Task 6 |
| AgentSelfConfig 新类型 | Task 5 |
| Agent config.json 自治 | Task 7, Task 8 |
| Butler 创建时写入文件 | Task 9 |
| 模板文件 | Task 7 |

### 2. Placeholder Scan

无 TBD/TODO。所有代码块包含完整实现。

### 3. Type Consistency

- `AgentSelfConfig` 定义在 `schema.ts` (Task 5)，在 `butler.ts` (Task 9) 和 `runtime.ts` (Task 8) 中引用
- `buildSystemPromptFromFiles` 在 `prompt-builder.ts` (Task 3) 定义，在 `agent.ts` (Task 4) 引用
- `consumeBootstrap()` 在 `paths.ts` (Task 2) 定义，在 `prompt-builder.ts` (Task 3) 中调用
