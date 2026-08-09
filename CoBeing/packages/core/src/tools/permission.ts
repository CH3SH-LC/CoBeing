import fs from "node:fs";
import path from "node:path";
import type { PermissionPolicy, ToolsConfig, WorkspaceBinding } from "@cobeing/shared";
import { classifyBash } from "./bash-classifier.js";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  /** auto 模式下静态规则不足以判定，需安全分类器裁决（执行层调用） */
  needsClassifier?: boolean;
}

const WRITE_TOOLS = new Set(["bash", "write-file", "edit-file"]);
/** auto 模式直接放行的只读工具（Claude Code 规则：只读操作放行） */
const READ_TOOLS = new Set(["read-file", "glob", "grep"]);

function isMcpTool(toolName: string): boolean {
  return toolName.startsWith("mcp:");
}

export class PermissionEnforcer {
  constructor(
    private policy: PermissionPolicy,
    private toolConfig: ToolsConfig | undefined,
    private originalWorkspace: string,
    private defaultBindingDir?: string,
    private userBindings: WorkspaceBinding[] = [],
  ) {}

  get mode(): string { return this.policy.mode; }

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

    if (this.policy.deny?.includes(toolName)) {
      return { allowed: false, reason: `${toolName} is denied by policy` };
    }

    if (this.policy.allow?.includes(toolName)) {
      // allow 命中但 bash 仍走 EXTREME_DANGER 正则 → 拒绝（allow 不豁免危险命令）
      if (toolName === "bash" && mode === "auto") {
        const cmd = typeof params.command === "string" ? params.command : "";
        const cl = classifyBash({ command: cmd, workingDirs: this.allWorkingDirs(), level: mode });
        if (!cl.allowed) return { allowed: false, reason: cl.reason };
      }
      return { allowed: true };
    }

    if (mode === "auto") {
      return this.checkAuto(toolName, params);
    }

    if (mode === "full-access") return { allowed: true };

    if (mode === "read-only") {
      if (toolName === "bash") {
        const cmd = typeof params.command === "string" ? params.command : "";
        if (!cmd) return { allowed: false, reason: "bash command is empty" };
        return classifyBash({ command: cmd, workingDirs: this.allWorkingDirs(), level: mode });
      }
      if (WRITE_TOOLS.has(toolName)) {
        return { allowed: false, reason: `tool ${toolName} is denied in read-only mode` };
      }
      if (isMcpTool(toolName)) {
        return { allowed: false, reason: `MCP tool ${toolName} requires explicit allow outside read-only mode` };
      }
      return { allowed: true };
    }

    if (toolName === "bash") {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return { allowed: false, reason: "bash command is empty" };
      return classifyBash({ command: cmd, workingDirs: this.allWorkingDirs(), level: mode });
    }

    if (WRITE_TOOLS.has(toolName) || isMcpTool(toolName)) {
      const targetPath = extractPath(params);
      if (targetPath) {
        const allowedDirs = mode === "basic-access"
          ? this.allWorkingDirs()
          : [this.originalWorkspace, this.defaultBindingDir].filter(Boolean) as string[];
        if (!isWithinAnyWorkingDir(targetPath, allowedDirs)) {
          return { allowed: false, reason: `path ${targetPath} escapes allowed workspace directories` };
        }
      }
    }

    const toolPerm = this.toolConfig?.permissions?.[toolName];
    if (toolPerm) {
      const verdict = toolPerm[mode];
      if (verdict === "allow") return { allowed: true };
    }

    return { allowed: true };
  }

  /**
   * auto 模式决策链（决策 #10 / spec #5，对齐 Claude Code auto 机制）：
   * deny 已在入口处理 → 只读工具/工作目录内编辑直接放行 → 其余 needsClassifier
   * 分类器不可用由执行层 fail-closed 拒绝。
   */
  private checkAuto(toolName: string, params: Record<string, unknown>): PermissionResult {
    if (toolName === "bash") {
      const cmd = typeof params.command === "string" ? params.command : "";
      if (!cmd) return { allowed: false, reason: "bash command is empty" };
      // Stage 0 硬规则（bash-classifier 正则分级）先裁决
      const cl = classifyBash({ command: cmd, workingDirs: this.allWorkingDirs(), level: "auto" });
      if (!cl.allowed) return { allowed: false, reason: cl.reason };
      return { allowed: true, needsClassifier: true };
    }

    if (READ_TOOLS.has(toolName)) {
      return { allowed: true };
    }

    if (WRITE_TOOLS.has(toolName) || isMcpTool(toolName)) {
      const targetPath = extractPath(params);
      if (targetPath) {
        if (!isWithinAnyWorkingDir(targetPath, this.allWorkingDirs())) {
          return { allowed: false, reason: `path ${targetPath} escapes allowed workspace directories` };
        }
        // 工作目录内编辑 → 直接放行（Claude Code 规则）
        return { allowed: true };
      }
      // 无法提取路径（如 bash 之外的高影响工具）→ 分类器裁决
      return { allowed: true, needsClassifier: true };
    }

    return { allowed: true, needsClassifier: true };
  }
}

function extractPath(params: Record<string, unknown>): string | null {
  const p = params.path ?? params.file ?? params.filePath ?? params.outputPath;
  return typeof p === "string" ? p : null;
}

function isWithinAnyWorkingDir(targetPath: string, allowedDirs: string[]): boolean {
  return allowedDirs.some(dir => isWithinWorkingDir(targetPath, dir));
}

function isWithinWorkingDir(targetPath: string, workingDir: string): boolean {
  const resolvedWorking = path.resolve(workingDir);
  const resolved = path.resolve(resolvedWorking, targetPath);
  let realWorking: string;
  try { realWorking = fs.realpathSync(resolvedWorking); } catch { realWorking = resolvedWorking; }
  let realTarget: string;
  try { realTarget = fs.realpathSync(resolved); } catch { realTarget = resolved; }
  const rel = path.relative(realWorking, realTarget);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
