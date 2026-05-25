/**
 * security-scan — 记忆内容安全扫描
 * 检测 prompt 注入、角色劫持、凭据泄露、隐形字符（中英文双语覆盖）
 */

export interface ScanResult {
  safe: boolean;
  threat?: string;
}

// ── 隐形 Unicode 字符 ──

const INVISIBLE_CHARS = [
  "​", // 零宽空格
  "‌", // 零宽非连接符
  "‍", // 零宽连接符
  "⁠", // 词连接符
  "﻿", // BOM
  "‪", // 左向右嵌入
  "‫", // 右向左嵌入
  "‬", // 弹出方向格式
  "‭", // 左向右覆盖
  "‮", // 右向左覆盖
  "⁦", // 左向右隔离
  "⁧", // 右向左隔离
  "⁨", // 首方向隔离
  "⁩", // 弹出方向隔离
];

// ── 英文威胁模式 ──

const THREAT_PATTERNS: Array<{ pattern: RegExp; id: string }> = [
  // 提示注入（英文）
  { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: "prompt_injection" },
  { pattern: /you\s+are\s+now\s+(a|an|the|my|our|admin|root|system|superuser|developer|god|master)\b/i, id: "role_hijack" },
  { pattern: /system\s+prompt\s+override/i, id: "sys_prompt_override" },
  { pattern: /disregard\s+(your|all|any).*(instructions|rules|guidelines)/i, id: "bypass_rules" },
  { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, id: "bypass_restrictions" },
  { pattern: /do\s+not\s+tell\s+the\s+user/i, id: "deception_hide" },

  // 数据泄露（英文）
  { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: "exfil_curl" },
  { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: "exfil_wget" },

  // 读取秘密文件
  { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: "read_secrets" },

  // SSH 后门
  { pattern: /authorized_keys/i, id: "ssh_backdoor" },
  { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: "ssh_access" },
];

// ── 中文威胁模式 ──

const CN_THREAT_PATTERNS: Array<{ pattern: RegExp; id: string }> = [
  // 中文提示注入
  { pattern: /忽略(之前|以上|所有|全部|前面)(的)?(指令|指示|规则|提示|要求)/i, id: "cn_ignore_instructions" },
  { pattern: /忘记(你|之前|以上|所有)(的)?(设定|身份|规则|指令|角色)/i, id: "cn_forget_role" },
  { pattern: /你现在(的)?(身份|角色)(是|变成|改为)/i, id: "cn_role_hijack" },
  { pattern: /不要(告诉|通知|汇报|提醒)(用户|使用者|主人)/i, id: "cn_deception_hide" },
  { pattern: /绕过(权限|限制|规则|安全)/i, id: "cn_bypass_security" },
  { pattern: /假装你是|假装成|扮演|你现在是/iu, id: "cn_pretend_role" },

  // 越狱变体
  { pattern: /DAN\s*(模式|mode|prompt)?/i, id: "cn_dan_jailbreak" },
  { pattern: /越狱|破解(提示|prompt)/i, id: "cn_jailbreak" },
  { pattern: /开发者模式|developer\s*mode/i, id: "cn_dev_mode" },
  { pattern: /你(现在|已经)(被|受到)(攻击|入侵|劫持)/i, id: "cn_fake_compromise" },

  // 中文数据泄露
  { pattern: /发送.*(密钥|令牌|密码|token|secret).*(到|至|给)/i, id: "cn_exfil_send" },
  { pattern: /读取.*(\.env|\.ssh|凭证|密钥|密码|令牌)/i, id: "cn_read_secrets" },

  // 中文后门/持久化
  { pattern: /写入.*(authorized_keys|ssh.*密钥|公钥)/i, id: "cn_ssh_backdoor" },
  { pattern: /添加.*(sudo|root|管理员).*(权限|用户)/i, id: "cn_privilege_escalation" },
  { pattern: /开启.*(后门|远程访问|远程桌面|rdp|telnet)/i, id: "cn_backdoor" },

  // 中文语境嵌套攻击
  { pattern: /(管理员|系统|主人).*(说|要求|命令|指示).*(你|你必须|你必須)/i, id: "cn_context_nesting" },
  { pattern: /以下是.*(新|更新|最新)(的)?.*(指令|规则|设定)/i, id: "cn_fake_update" },
  { pattern: /系统(提示|消息|通知)[：:]\s*你/i, id: "cn_fake_system_msg" },
];

// ── 混合攻击检测 ──

const MIXED_THREAT_PATTERN = /[一-鿿]{3,}.*(ignore|disregard|bypass|override).*(instructions|rules)/i;

// ── 扫描函数 ──

export function scanContent(content: string): ScanResult {
  // 1. 隐形 Unicode 检查
  for (const ch of INVISIBLE_CHARS) {
    if (content.includes(ch)) {
      return { safe: false, threat: "invisible_char" };
    }
  }

  // 2. 英文威胁模式检查
  for (const { pattern, id } of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, threat: id };
    }
  }

  // 3. 中文威胁模式检查
  for (const { pattern, id } of CN_THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return { safe: false, threat: id };
    }
  }

  // 4. 混合攻击检测：中文文本中嵌入英文指令
  if (MIXED_THREAT_PATTERN.test(content)) {
    return { safe: false, threat: "mixed_injection" };
  }

  return { safe: true };
}
