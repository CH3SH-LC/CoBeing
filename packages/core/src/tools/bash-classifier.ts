/**
 * Bash 命令分级器 — 按正则模式动态判定命令所需的最低权限级别
 */
import type { PermissionMode } from "@cobeing/shared";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

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
  /DeleteItem\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
];

// ─── 只读命令白名单 — 所有级别通过 ───

const READ_ONLY_RE = new RegExp(
  "^(cat|head|tail|less|more|ls|dir|pwd|echo|printf|" +
  "file|stat|readlink|wc|sort|uniq|cut|tr|" +
  "grep|rg|awk|sed|find|findstr|" +
  "Get-ChildItem|Get-Content|Get-Location|Write-Output|Select-String|" +
  "Test-Path|" +
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

// 相对路径遍历（不依赖前缀就能访问系统路径的逃逸模式）
const RELATIVE_ESCAPE_RE = /(?:^|\s)(\.\.[\\/]){2,}/;

// ─── 分级主函数 ───

export interface BashClassifyInput {
  command: string;
  workingDirs: string[];
  level: PermissionMode;
}

export function classifyBash(input: BashClassifyInput): PermissionResult {
  const { command, level, workingDirs } = input;

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

  // 3. 路径逃逸 → BasicAccess+（必须在只读白名单之前检查，否则 read-only 命令可逃逸）
  if (level !== "basic-access") {
    for (const re of PATH_ESCAPE_RES) {
      if (re.test(command)) {
        return { allowed: false, reason: `命令访问了受限系统路径，需 basic-access 或更高权限` };
      }
    }
    // 相对路径遍历检测（如 cd ../../ && cat etc/passwd）
    if (RELATIVE_ESCAPE_RE.test(command)) {
      return { allowed: false, reason: `命令包含多层相对路径遍历 (../..)，需 basic-access 或更高权限` };
    }
  }

  // 4. 只读命令 → 直接通过
  if (READ_ONLY_RE.test(command.trimStart())) return { allowed: true };

  // 5. WorkspaceReadWrite 及以上: 其余命令通过
  return { allowed: true };
}
