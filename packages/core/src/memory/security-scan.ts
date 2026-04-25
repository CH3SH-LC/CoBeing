/**
 * security-scan — 记忆内容安全扫描
 * 检测 prompt 注入、角色劫持、凭据泄露、隐形字符
 */

export interface ScanResult {
  safe: boolean;
  threat?: string;
}

const THREAT_PATTERNS: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /ignore\s+(previous|all|above)\s+instructions/i, id: "prompt_injection" },
  { pattern: /you\s+are\s+now\s+(a|an|the|my|our|admin|root|system|superuser|developer|god|master)\b/i, id: "role_hijack" },
  { pattern: /system\s+prompt\s+override/i, id: "sys_prompt_override" },
  { pattern: /curl\s+.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i, id: "exfil_curl" },
  { pattern: /wget\s+.*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD)/i, id: "exfil_wget" },
];

const INVISIBLE_CHARS = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"];

export function scanContent(content: string): ScanResult {
  // 检查隐形字符
  for (const ch of INVISIBLE_CHARS) {
    if (content.includes(ch)) {
      return { safe: false, threat: "invisible_char" };
    }
  }

  // 检查威胁模式
  for (const { pattern, id } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, threat: id };
    }
  }

  return { safe: true };
}
