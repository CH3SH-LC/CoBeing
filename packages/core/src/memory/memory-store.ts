/**
 * MemoryStore — 统一记忆存储引擎
 *
 * 四个目标: memory / experience / user / tools
 * 双存储: Markdown (权威) + SQLite (搜索索引)
 * 冻结快照保证会话内 system prompt 稳定
 */
import fs from "node:fs";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter.js";
import { scanContent } from "./security-scan.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("memory-store");

export type MemoryTarget = "memory" | "experience" | "user" | "tools";

export interface MemoryStoreConfig {
  charLimits?: Partial<Record<MemoryTarget, number>>;
}

export interface ToolResult {
  success: boolean;
  content?: string;
  error?: string;
}

const DEFAULT_CHAR_LIMITS: Record<MemoryTarget, number> = {
  memory: 3000,
  experience: 5000,
  user: 2000,
  tools: 3000,
};

const TARGET_FILE_MAP: Record<MemoryTarget, string> = {
  memory: "MEMORY.md",
  experience: "EXPERIENCE.md",
  user: "USER.md",
  tools: "TOOLS.md",
};

const SEPARATOR = "\n§\n";

export class MemoryStore {
  private sqlite!: SqliteAdapter;
  private readonly charLimits: Record<MemoryTarget, number>;
  private snapshot: Record<MemoryTarget, string>;
  private _baseDir: string;
  private _ready = false;
  private _initPromise: Promise<void> | null = null;

  private constructor(baseDir: string, config?: MemoryStoreConfig) {
    this._baseDir = baseDir;
    this.charLimits = { ...DEFAULT_CHAR_LIMITS, ...config?.charLimits };
    this.snapshot = { memory: "", experience: "", user: "", tools: "" };
  }

  /** 异步工厂方法 */
  static async create(agentId: string, baseDir: string, config?: MemoryStoreConfig): Promise<MemoryStore> {
    const store = new MemoryStore(baseDir, config);
    await store.init();
    return store;
  }

  /** 同步构造 + 延迟初始化（用于 Agent 构造函数） */
  static createLazy(baseDir: string, config?: MemoryStoreConfig): MemoryStore {
    const store = new MemoryStore(baseDir, config);
    // 启动异步初始化（不等待）
    store._initPromise = store.init().then(() => {
      store._ready = true;
    }).catch(err => {
      log.error("MemoryStore lazy init failed: %s", err);
    });
    return store;
  }

  /** 确保初始化完成 */
  async ready(): Promise<void> {
    if (this._ready) return;
    if (this._initPromise) await this._initPromise;
  }

  get readyState(): boolean {
    return this._ready;
  }

  private async init(): Promise<void> {
    // 确保目录存在
    fs.mkdirSync(this._baseDir, { recursive: true });

    // 打开 SQLite
    const dbPath = path.join(this._baseDir, "memory.db");

    try {
      this.sqlite = SqliteAdapter.create(dbPath);

      // 启动同步: md → SQLite
      this.syncFromMarkdown();
    } catch (err: any) {
      // 数据库损坏 → 删除后重建
      if (err?.code === "SQLITE_CORRUPT_VTAB" || err?.message?.includes("malformed")) {
        log.warn("SQLite database corrupted, recreating: %s", dbPath);
        try { this.sqlite?.close(); } catch {}
        try { fs.unlinkSync(dbPath); } catch {}
        try { fs.unlinkSync(dbPath + "-wal"); } catch {}
        try { fs.unlinkSync(dbPath + "-shm"); } catch {}

        this.sqlite = SqliteAdapter.create(dbPath);
        this.syncFromMarkdown();
      } else {
        throw err;
      }
    }

    // 生成冻结快照
    this.snapshot = this.buildSnapshot();
    this._ready = true;
  }

  // ─── 工具接口 ───

  /** 新增一条记忆 */
  add(target: MemoryTarget, content: string): ToolResult {
    if (!this._ready) return { success: false, error: "MemoryStore 尚未初始化完成。" };
    // 安全扫描
    const scan = scanContent(content);
    if (!scan.safe) {
      return { success: false, error: `Blocked: content matches threat pattern '${scan.threat}'.` };
    }

    // 容量检查
    if (!this.checkCapacity(target, content.length)) {
      return { success: false, error: `容量不足: ${target} 已达上限 ${this.charLimits[target]} 字符。请先删除或合并旧条目。` };
    }

    // 去重检查（完全相同的内容不重复添加）
    const existing = this.sqlite.getEntries(target);
    if (existing.some(e => e.content.trim() === content.trim())) {
      return { success: false, error: "重复条目: 相同内容已存在。" };
    }

    // 双写
    this.sqlite.insertEntry(target, content);
    this.writeMarkdown(target);

    log.info("Memory added: %s (%d chars)", target, content.length);
    return { success: true, content: `已添加到 ${target}。` };
  }

  /** 替换已有条目（通过 oldText 定位） */
  replace(target: MemoryTarget, oldText: string, newContent: string): ToolResult {
    if (!this._ready) return { success: false, error: "MemoryStore 尚未初始化完成。" };
    // 安全扫描
    const scan = scanContent(newContent);
    if (!scan.safe) {
      return { success: false, error: `Blocked: content matches threat pattern '${scan.threat}'.` };
    }

    const entry = this.sqlite.findEntryBySubstring(target, oldText);
    if (!entry) {
      return { success: false, error: `未找到包含 "${oldText}" 的条目。` };
    }

    // 容量检查（新内容可能更长）
    const delta = newContent.length - entry.content.length;
    if (delta > 0 && !this.checkCapacity(target, delta)) {
      return { success: false, error: `容量不足: 替换后超出 ${target} 上限。` };
    }

    this.sqlite.updateEntry(entry.id, newContent);
    this.writeMarkdown(target);

    log.info("Memory replaced: %s (id=%d)", target, entry.id);
    return { success: true, content: `已替换 ${target} 中的条目。` };
  }

  /** 删除已有条目（通过 oldText 定位） */
  remove(target: MemoryTarget, oldText: string): ToolResult {
    if (!this._ready) return { success: false, error: "MemoryStore 尚未初始化完成。" };
    const entry = this.sqlite.findEntryBySubstring(target, oldText);
    if (!entry) {
      return { success: false, error: `未找到包含 "${oldText}" 的条目。` };
    }

    this.sqlite.deleteEntry(entry.id);
    this.writeMarkdown(target);

    log.info("Memory removed: %s (id=%d)", target, entry.id);
    return { success: true, content: `已从 ${target} 删除条目。` };
  }

  /** 读取目标内容（当前数据，非冻结快照） */
  read(target?: MemoryTarget): ToolResult {
    if (!this._ready) return { success: false, error: "MemoryStore 尚未初始化完成。" };
    if (target) {
      const entries = this.sqlite.getEntries(target);
      const content = entries.map(e => e.content).join(SEPARATOR);
      return { success: true, content: content || `(${target} 为空)` };
    }

    // 返回所有目标
    const allTargets: MemoryTarget[] = ["memory", "experience", "user", "tools"];
    const parts: string[] = [];
    for (const t of allTargets) {
      const entries = this.sqlite.getEntries(t);
      const content = entries.map(e => e.content).join(SEPARATOR);
      if (content) {
        parts.push(`=== ${t} ===\n${content}`);
      }
    }
    return { success: true, content: parts.join("\n\n") || "(所有目标为空)" };
  }

  // ─── 快照接口（prompt-builder 使用） ───

  /** 返回冻结快照的格式化块 */
  formatForSystemPrompt(target: MemoryTarget): string {
    const content = this.snapshot[target];
    if (!content) return "";

    const limit = this.charLimits[target];
    const usage = content.length;
    const percent = Math.round((usage / limit) * 100);
    const label = {
      memory: "MEMORY (你的个人笔记)",
      experience: "EXPERIENCE (你的工作经验)",
      user: "USER (用户画像)",
      tools: "TOOLS (工具调用策略)",
    }[target];

    const bar = "═".repeat(50);
    return `${bar}\n${label} [${percent}% — ${usage.toLocaleString()}/${limit.toLocaleString()} chars]\n${bar}\n${content}`;
  }

  /** 返回四个目标的拼接快照 */
  snapshotForSystemPrompt(): string {
    const order: MemoryTarget[] = ["user", "tools", "experience", "memory"];
    const parts: string[] = [];
    for (const target of order) {
      const block = this.formatForSystemPrompt(target);
      if (block) parts.push(block);
    }
    return parts.join("\n\n");
  }

  // ─── 搜索接口 ───

  /** 搜索记忆条目 */
  searchEntries(query: string, target?: MemoryTarget, limit = 10) {
    return this.sqlite.searchEntries(query, target, limit);
  }

  /** 搜索对话历史 */
  searchHistory(query: string, session?: string, limit = 10) {
    return this.sqlite.searchHistory(query, session, limit);
  }

  // ─── 对话历史接口 ───

  /** 追加对话历史（双写: md 每日文件 + SQLite） */
  appendHistory(entry: { session: string; role: string; content: string; toolName?: string }): void {
    if (!this._ready) return;
    const timestamp = Date.now();

    // SQLite
    this.sqlite.insertHistory({
      session: entry.session,
      role: entry.role,
      content: entry.content,
      tool_name: entry.toolName,
      timestamp,
    });

    // Markdown 每日文件
    const today = new Date().toISOString().split("T")[0];
    const memoryDir = path.join(this._baseDir, "memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    const filePath = path.join(memoryDir, `${today}.md`);

    const formatted = this.formatHistoryEntry(entry, timestamp);
    if (!fs.existsSync(filePath)) {
      this.atomicWrite(filePath, `# ${today} 对话记录\n\n${formatted}\n`);
    } else {
      fs.appendFileSync(filePath, formatted + "\n", "utf-8");
    }

    // 更新 sync_state
    const dateKey = `history:${today}`;
    this.sqlite.setSyncMtime(dateKey, timestamp);
  }

  // ─── 经验反思接口 ───

  /** 通过 LLM 反思对话，自动提取经验 */
  async reflectFromHistory(task: string, history: Array<{ role: string; content: string }>, provider: { chat: (opts: any) => AsyncIterable<any> }, model?: string): Promise<void> {
    const convText = history.map(m => `[${m.role}]: ${m.content}`).join("\n");

    const prompt = `分析以下任务执行过程，提取关键经验。

任务: ${task}

执行过程:
${convText}

请严格按以下格式输出（不要输出其他内容）:
问题: <遇到的核心问题或挑战，一句话>
解决: <最终的解决方案，一句话>`;

    try {
      let result = "";
      for await (const chunk of provider.chat({
        model: model ?? "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }

      const problemMatch = result.match(/问题[：:]\s*(.+)/);
      const solutionMatch = result.match(/解决[：:]\s*(.+)/);

      if (!problemMatch || !solutionMatch) {
        log.warn("Reflection output format unexpected: %s", result.slice(0, 100));
        return;
      }

      const problem = problemMatch[1].trim();
      const solution = solutionMatch[1].trim();

      // 质量过滤
      if (problem === "无" || solution === "无") return;
      if (problem.length < 10 || solution.length < 10) return;

      this.add("experience", `[${task}] 问题: ${problem} | 解决: ${solution}`);
    } catch (err) {
      log.warn("Reflection failed: %s", err);
    }
  }

  // ─── 关闭 ───

  close(): void {
    if (this.sqlite) {
      this.sqlite.close();
    }
  }

  // ─── 私有方法 ───

  /** 启动时 md → SQLite 同步 */
  private syncFromMarkdown(): void {
    const targets: MemoryTarget[] = ["memory", "experience", "user", "tools"];
    for (const target of targets) {
      const mdPath = this.mdPathFor(target);
      if (!fs.existsSync(mdPath)) continue;

      const stat = fs.statSync(mdPath);
      const lastSync = this.sqlite.getSyncMtime(target);

      if (stat.mtimeMs > lastSync) {
        const content = fs.readFileSync(mdPath, "utf-8");
        const entries = this.parseEntries(content, target);
        this.sqlite.replaceEntries(target, entries);
        this.sqlite.setSyncMtime(target, stat.mtimeMs);
        log.info("Synced %s from markdown (%d entries)", target, entries.length);
      }
    }

    // 同步历史文件
    this.syncHistoryFromFiles();
  }

  /** 同步 memory/ 目录下的每日 md 文件 */
  private syncHistoryFromFiles(): void {
    const memoryDir = path.join(this._baseDir, "memory");
    if (!fs.existsSync(memoryDir)) return;

    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md")).sort();
    for (const file of files) {
      const dateKey = `history:${file.replace(".md", "")}`;
      const filePath = path.join(memoryDir, file);
      const stat = fs.statSync(filePath);
      const lastSync = this.sqlite.getSyncMtime(dateKey);

      if (stat.mtimeMs > lastSync) {
        this.sqlite.setSyncMtime(dateKey, stat.mtimeMs);
      }
    }
  }

  /** 构建冻结快照 */
  private buildSnapshot(): Record<MemoryTarget, string> {
    const snapshot = {} as Record<MemoryTarget, string>;
    const targets: MemoryTarget[] = ["memory", "experience", "user", "tools"];
    for (const target of targets) {
      const entries = this.sqlite.getEntries(target);
      snapshot[target] = entries.map(e => e.content).join(SEPARATOR);
    }
    return snapshot;
  }

  /** 解析 md 内容为条目数组 */
  private parseEntries(mdContent: string, _target: MemoryTarget): Array<{ content: string; created_at: number }> {
    // 去掉标题行和描述行
    const lines = mdContent.split("\n");
    let bodyStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("# ")) { bodyStart = i + 1; continue; }
      if (lines[i].startsWith("> ") && bodyStart === i) { bodyStart = i + 1; }
    }
    const body = lines.slice(bodyStart).join("\n");

    // 按 § 分隔符分割
    const raw = body.split(SEPARATOR)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const now = Date.now();
    return raw.map((content, idx) => ({ content, created_at: now - (raw.length - idx) * 1000 }));
  }

  /** 将条目渲染回 md 格式 */
  private renderEntries(target: MemoryTarget): string {
    const entries = this.sqlite.getEntries(target);
    const header = `# ${TARGET_FILE_MAP[target]}\n`;
    if (entries.length === 0) return header + "\n(空)\n";
    return header + "\n" + entries.map(e => e.content).join(SEPARATOR) + "\n";
  }

  /** 双写: 更新 md 文件 */
  private writeMarkdown(target: MemoryTarget): void {
    const mdPath = this.mdPathFor(target);
    const content = this.renderEntries(target);
    this.atomicWrite(mdPath, content);
  }

  /** 原子写入 */
  private atomicWrite(filePath: string, content: string): void {
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch {
      // Windows rename may fail, fallback to direct write
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }

  /** 容量检查 */
  private checkCapacity(target: MemoryTarget, delta: number): boolean {
    const current = this.sqlite.getCharCount(target);
    return current + delta <= this.charLimits[target];
  }

  /** md 文件路径 */
  private mdPathFor(target: MemoryTarget): string {
    return path.join(this._baseDir, TARGET_FILE_MAP[target]);
  }

  /** 格式化历史条目 */
  private formatHistoryEntry(entry: { session: string; role: string; content: string; toolName?: string }, ts: number): string {
    const time = new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const header = `## ${time} [${entry.session}]`;
    let body = "";
    switch (entry.role) {
      case "user": body = `**User:** ${entry.content}`; break;
      case "assistant": body = `**Assistant:** ${entry.content}`; break;
      case "tool": body = `**Tool: ${entry.toolName ?? "unknown"}**\n\`\`\`\n${entry.content}\n\`\`\``; break;
      case "system": body = `**System:** ${entry.content}`; break;
    }
    return `${header}\n${body}\n`;
  }
}
