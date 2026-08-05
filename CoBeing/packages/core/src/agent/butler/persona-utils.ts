/**
 * 管家人格工具模块 — 被 WS 命令（butler-persona.ts）与管家工具（persona-tools.ts）共用
 *
 * 能力：
 * - listButlerPersonas：列出 templates/butler/personas/ 下全部人格模板
 * - applyButlerPersona：切换人格（复制模板 CHARACTER.md/JOB.md 到管家目录）
 * - applyButlerUserStyle：写入用户偏好（称呼/欢迎语/语气 → CHARACTER.md「用户偏好」段 + config.json name）
 */
import fs from "node:fs";
import path from "node:path";

/** 模板根解析：项目根（源码树）优先，兼容 CWD=packages/core 与编译产物目录 */
export function resolveButlerTemplatesRoot(): string | null {
  const candidates = [
    path.resolve("packages/core/src/templates/butler"),
    path.resolve("src/templates/butler"),
    path.resolve("core/src/templates/butler"),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, "personas"))) ?? null;
}

/** 从 CHARACTER.md 解析人格显示名（`**姓名**: xxx` 或 `- 姓名: xxx`），无则回退目录名 */
export function readPersonaName(id: string, personasDir: string): string {
  const charPath = path.join(personasDir, id, "CHARACTER.md");
  try {
    const content = fs.readFileSync(charPath, "utf-8");
    const m = content.match(/\*\*姓名\*\*:\s*(.+)/) || content.match(/-\s*(?:Name|姓名):\s*(.+)/);
    if (m) return m[1].trim().slice(0, 32);
  } catch { /* 模板损坏则用目录名 */ }
  return id;
}

/** 列出 templates/butler/personas/ 下全部人格 */
export function listButlerPersonas(): Array<{ id: string; name: string }> {
  const root = resolveButlerTemplatesRoot();
  if (!root) return [];
  const personasDir = path.join(root, "personas");
  if (!fs.existsSync(personasDir)) return [];
  return fs.readdirSync(personasDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((id) => ({ id, name: readPersonaName(id, personasDir) }));
}

/**
 * 检测当前人格：data/coreagents/butler/ 的 CHARACTER.md + JOB.md 与某个模板完全一致（trim 后）→ 该模板 id；
 * 不匹配（用户自定义/风格更新后）→ null。
 */
export function detectCurrentPersona(dataRoot: string): string | null {
  const butlerDir = path.join(dataRoot, "coreagents", "butler");
  const charPath = path.join(butlerDir, "CHARACTER.md");
  const jobPath = path.join(butlerDir, "JOB.md");
  if (!fs.existsSync(charPath) || !fs.existsSync(jobPath)) return null;
  let char: string;
  let job: string;
  try {
    char = fs.readFileSync(charPath, "utf-8").trim();
    job = fs.readFileSync(jobPath, "utf-8").trim();
  } catch {
    return null;
  }
  const root = resolveButlerTemplatesRoot();
  if (!root) return null;
  const personasDir = path.join(root, "personas");
  if (!fs.existsSync(personasDir)) return null;
  for (const id of fs.readdirSync(personasDir, { withFileTypes: true })) {
    if (!id.isDirectory()) continue;
    try {
      const tChar = fs.readFileSync(path.join(personasDir, id.name, "CHARACTER.md"), "utf-8").trim();
      const tJob = fs.readFileSync(path.join(personasDir, id.name, "JOB.md"), "utf-8").trim();
      if (tChar === char && tJob === job) return id.name;
    } catch { /* 模板损坏则跳过 */ }
  }
  return null;
}

export interface ApplyPersonaResult {
  ok: boolean;
  error?: string;
}

/**
 * 切换管家人格：复制模板 CHARACTER.md/JOB.md 到 data/coreagents/butler/。
 * 含路径穿越防御；persona 不存在返回错误。
 */
export function applyButlerPersona(dataRoot: string, persona: string): ApplyPersonaResult {
  if (!persona || persona.length > 64) {
    return { ok: false, error: "无效的 persona：必须是非空字符串" };
  }
  const root = resolveButlerTemplatesRoot();
  if (!root) {
    return { ok: false, error: "管家人格模板不可用" };
  }
  const personasDir = path.join(root, "personas");
  const srcDir = path.join(personasDir, persona);
  // 防御：persona 必须是 personas/ 下的直接子目录（防路径穿越）
  if (!path.resolve(srcDir).startsWith(path.resolve(personasDir) + path.sep)) {
    return { ok: false, error: `非法 persona: ${persona}` };
  }
  const srcChar = path.join(srcDir, "CHARACTER.md");
  const srcJob = path.join(srcDir, "JOB.md");
  if (!fs.existsSync(srcChar) || !fs.existsSync(srcJob)) {
    return { ok: false, error: `persona 不存在: ${persona}` };
  }

  // 复制人格文件到管家目录（config.json 不动）
  const butlerDir = path.join(dataRoot, "coreagents", "butler");
  fs.mkdirSync(butlerDir, { recursive: true });
  try {
    fs.copyFileSync(srcChar, path.join(butlerDir, "CHARACTER.md"));
    fs.copyFileSync(srcJob, path.join(butlerDir, "JOB.md"));
  } catch (err: any) {
    return { ok: false, error: `切换人格失败: ${err.message}` };
  }
  return { ok: true };
}

/** 风格字段清洗（三态）：undefined/null → 未提供；字符串 → 清洗后值；非法类型 → null */
function sanitizeStyleField(value: unknown, maxLen: number): { provided: boolean; value: string } | null {
  if (value === undefined || value === null) return { provided: false, value: "" };
  if (typeof value !== "string") return null;
  return { provided: true, value: value.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLen) };
}

export interface UserStyleInput {
  nickname?: unknown;
  greeting?: unknown;
  tone?: unknown;
}

export interface ApplyUserStyleResult {
  ok: boolean;
  error?: string;
}

/**
 * 写入用户偏好：CHARACTER.md 追加/替换「用户偏好」段（称呼/欢迎语/语气），
 * config.json 写 name（昵称，重启后生效）。任一字段非法类型 → 返回错误（不写入）。
 * apply=false 时只做字段校验（dry-run），不写入任何文件。
 */
export function applyButlerUserStyle(dataRoot: string, input: UserStyleInput, apply = true): ApplyUserStyleResult {
  const nickname = sanitizeStyleField(input.nickname, 30);
  const greeting = sanitizeStyleField(input.greeting, 120);
  const tone = sanitizeStyleField(input.tone, 120);
  if (nickname === null || greeting === null || tone === null) {
    return { ok: false, error: "无效的样式字段：nickname/greeting/tone 必须是字符串" };
  }

  // dry-run：只校验不写入
  if (!apply) return { ok: true };

  const butlerDir = path.join(dataRoot, "coreagents", "butler");
  fs.mkdirSync(butlerDir, { recursive: true });

  // CHARACTER.md 追加/替换「用户偏好」段
  const prefs: string[] = [];
  if (nickname.provided && nickname.value) prefs.push(`- **称呼**: ${nickname.value}`);
  if (greeting.provided && greeting.value) prefs.push(`- **欢迎语**: ${greeting.value}`);
  if (tone.provided && tone.value) prefs.push(`- **语气偏好**: ${tone.value}`);
  if (prefs.length > 0) {
    const charPath = path.join(butlerDir, "CHARACTER.md");
    let char = "";
    if (fs.existsSync(charPath)) {
      try {
        char = fs.readFileSync(charPath, "utf-8");
      } catch { /* 损坏则重建 */ }
    }
    const prefBlock = `## 用户偏好\n\n${prefs.join("\n")}`;
    if (char.includes("## 用户偏好")) {
      char = char.replace(/## 用户偏好[\s\S]*$/, prefBlock);
    } else {
      char = char.replace(/\s+$/, "");
      char = char ? `${char}\n\n${prefBlock}` : prefBlock;
    }
    fs.writeFileSync(charPath, char, "utf-8");
  }

  // config.json：nickname → name（重启后生效，createButler 读取）
  if (nickname.provided && nickname.value) {
    const cfgPath = path.join(butlerDir, "config.json");
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(cfgPath)) {
      try {
        cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      } catch { /* 损坏则重建默认 */ }
    }
    cfg.name = nickname.value;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
  }

  return { ok: true };
}
