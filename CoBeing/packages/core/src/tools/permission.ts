import fs from "node:fs";
import path from "node:path";
import type { PermissionPolicy, ToolsConfig, WorkspaceBinding } from "@cobeing/shared";
import { classifyBash } from "./bash-classifier.js";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const WRITE_TOOLS = new Set(["bash", "write-file", "edit-file"]);

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
      return { allowed: true };
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
