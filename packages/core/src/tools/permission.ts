/**
 * PermissionEnforcer — 配置驱动的工具权限检查
 */
import path from "node:path";
import type { PermissionPolicy, ToolsConfig } from "@cobeing/shared";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const WRITE_TOOLS = new Set(["bash", "write-file", "edit-file"]);

export class PermissionEnforcer {
  constructor(
    private policy: PermissionPolicy,
    private toolConfig: ToolsConfig | undefined,
    private workingDir: string,
  ) {}

  check(toolName: string, params: Record<string, unknown>): PermissionResult {
    const mode = this.policy.mode;

    // full-access: 全部允许
    if (mode === "full-access") return { allowed: true };

    // 查工具级映射
    const toolPerm = this.toolConfig?.permissions[toolName];
    if (toolPerm) {
      const verdict = toolPerm[mode];
      if (verdict === "deny") return { allowed: false, reason: `工具 ${toolName} 在 ${mode} 模式下被拒绝` };
    }

    // ask 模式：deny 列表优先 → allow 列表 → 默认拒绝
    if (mode === "ask") {
      if (this.policy.deny?.includes(toolName)) return { allowed: false, reason: `${toolName} 在 deny 列表中` };
      if (this.policy.allow?.includes(toolName)) return { allowed: true };
      return { allowed: false, reason: `${toolName} 未在 allow 列表中` };
    }

    // workspace-write + 写操作：路径检查
    if (mode === "workspace-write" && WRITE_TOOLS.has(toolName)) {
      const targetPath = extractPath(params);
      if (targetPath && !isWithinWorkingDir(targetPath, this.workingDir)) {
        return { allowed: false, reason: `路径 ${targetPath} 超出工作目录 ${this.workingDir}` };
      }
    }

    return { allowed: true };
  }
}

function extractPath(params: Record<string, unknown>): string | null {
  const p = params.path ?? params.file;
  return typeof p === "string" ? p : null;
}

function isWithinWorkingDir(targetPath: string, workingDir: string): boolean {
  const resolved = path.resolve(targetPath);
  const resolvedWorking = path.resolve(workingDir);
  return resolved.startsWith(resolvedWorking + path.sep) || resolved === resolvedWorking;
}
