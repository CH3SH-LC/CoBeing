/**
 * PermissionEnforcer — 5 级免审批权限检查 + 多工作区绑定
 */
import path from "node:path";
import fs from "node:fs";
import type { PermissionPolicy, ToolsConfig, WorkspaceBinding } from "@cobeing/shared";
import { classifyBash } from "./bash-classifier.js";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const WRITE_TOOLS = new Set(["bash", "write-file", "edit-file"]);

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

  /** 当前权限模式的对外访问器 */
  get mode(): string { return this.policy.mode; }

  /** 所有允许写操作的工作区目录（原始 + 默认绑定 + 用户 readwrite 绑定） */
  private allWorkingDirs(): string[] {
    const dirs = [this.originalWorkspace];
    if (this.defaultBindingDir) dirs.push(this.defaultBindingDir);
    for (const b of this.userBindings) {
      if (b.mode === "readwrite") dirs.push(b.path);
    }
    return dirs;
  }

  check(toolName: string, params: Record<string, unknown>): PermissionResult {
    const mode = this.policy.mode;

    // 1. Deny 列表 — 覆盖所有（包括 full-access）
    if (this.policy.deny?.includes(toolName)) {
      return { allowed: false, reason: `${toolName} 在 deny 列表中` };
    }

    // 2. Allow 列表 — 覆盖模式级别（包括 read-only 和工具配置）
    if (this.policy.allow?.includes(toolName)) {
      return { allowed: true };
    }

    // 3. L4: FullAccess — 全过
    if (mode === "full-access") return { allowed: true };

    // 4. L0: ReadOnly — 委托 bash 分级器（选择性放行只读命令）
    if (mode === "read-only") {
      if (toolName === "bash") {
        const cmd = typeof params.command === "string" ? params.command : "";
        if (!cmd) return { allowed: false, reason: "bash 命令为空" };
        return classifyBash({
          command: cmd,
          workingDirs: this.allWorkingDirs(),
          level: mode,
        });
      }
      if (WRITE_TOOLS.has(toolName)) {
        return { allowed: false, reason: `工具 ${toolName} 在 read-only 模式下被拒绝` };
      }
      return { allowed: true };
    }

    // 5. L1–L3: bash 全部委托分级器
    if (toolName === "bash") {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return { allowed: false, reason: "bash 命令为空" };
      return classifyBash({
        command: cmd,
        workingDirs: this.allWorkingDirs(),
        level: mode,
      });
    }

    // 6. L1–L3: 写工具路径检查
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

    // 7. 工具配置兜底 allow（工具级 allow 可覆盖模式级隐式 deny）
    const toolPerm = this.toolConfig?.permissions?.[toolName];
    if (toolPerm) {
      const verdict = toolPerm[mode];
      if (verdict === "allow") return { allowed: true };
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
