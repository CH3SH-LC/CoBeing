import type { PermissionMode } from "@cobeing/shared";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const EXTREME_DANGER: RegExp[] = [
  /rm\s+-rf\s+\//i,
  /rm\s+-rf\s+~(\s|$)/i,
  /rm\s+-rf\s+\*(\s|$)/i,
  /dd\s+.*of=\/dev\//i,
  /mkfs\./i,
  /:\{\s*:\|:&\s*\}/,
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

const READ_ONLY_RE = new RegExp(
  "^(cat|head|tail|less|more|ls|dir|pwd|echo|printf|" +
  "file|stat|readlink|wc|sort|uniq|cut|tr|" +
  "grep|rg|awk|sed|find|findstr|" +
  "Get-ChildItem|Get-Content|Get-Location|Write-Output|Select-String|" +
  "Test-Path|" +
  "where|which|type|comp|fc|tree|git\\s+status|git\\s+diff|git\\s+log|" +
  "pnpm\\s+test|pnpm\\s+build|pnpm\\s+list|pnpm\\s+ls|npm\\s+test|npm\\s+run)\\b",
);

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

const RELATIVE_ESCAPE_RE = /(?:^|\s)(\.\.[\\/]){2,}/;
const SHELL_CONTROL_RE = /(;|&&|\|\||\||`|\$\(|\$\{|\n|\r|>\s*|<\s*)/;

export interface BashClassifyInput {
  command: string;
  workingDirs: string[];
  level: PermissionMode;
}

function checkDangerousPatterns(command: string, level: PermissionMode): PermissionResult | null {
  for (const re of EXTREME_DANGER) {
    if (re.test(command)) return { allowed: false, reason: "extreme-danger command requires full-access" };
  }

  if (level !== "basic-access") {
    for (const re of PATH_ESCAPE_RES) {
      if (re.test(command)) return { allowed: false, reason: "command accesses a restricted system path" };
    }
    if (RELATIVE_ESCAPE_RE.test(command)) {
      return { allowed: false, reason: "command contains multi-level relative traversal" };
    }
  }

  if (level === "workspace-readwrite" || level === "workspace-access" || level === "read-only") {
    for (const re of HIGH_RISK) {
      if (re.test(command)) return { allowed: false, reason: "high-risk command requires basic-access or higher" };
    }
  }

  return null;
}

export function classifyBash(input: BashClassifyInput): PermissionResult {
  const { command, level } = input;

  if (level === "full-access") return { allowed: true };

  const dangerous = checkDangerousPatterns(command, level);
  if (dangerous) return dangerous;

  if (level === "read-only") {
    if (SHELL_CONTROL_RE.test(command)) {
      return { allowed: false, reason: "bash read-only mode does not allow shell control operators or redirection" };
    }
    if (READ_ONLY_RE.test(command.trimStart())) return { allowed: true };
    return { allowed: false, reason: "bash read-only mode only allows read-only commands" };
  }

  if (READ_ONLY_RE.test(command.trimStart())) return { allowed: true };
  return { allowed: true };
}
