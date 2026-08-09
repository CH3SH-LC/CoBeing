/**
 * Butler 文件体系与人格测试（阶段 C 地基 + 阶段 A/D prompt 规则）
 *
 * 覆盖：
 * 1. ensureButlerDir 首次启动创建 data/coreagents/butler/ 全套文件（config.json + AGENTS/CHARACTER/JOB/MEMORY/EXPERIENCE）
 * 2. 重复执行不覆盖（用户修改过的人格保留）
 * 3. createCoreAgents 顺序：ensureButlerDir 先于 createButler（管家 prompt 走文件）
 * 4. butler_get_personas 列出 4 个人格模板 + current 检测
 * 5. butler_set_persona 复制模板 CHARACTER.md/JOB.md 到管家目录；非法 persona → error
 * 6. butler_update_style 写入 CHARACTER.md「用户偏好」段 + config.json name；apply=false 不写入
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoBeingRuntime } from "./runtime.js";
import { loadConfig } from "./config/config-loader.js";
import { registerButlerPersonaHandlers } from "./api/handlers/butler-persona.js";
import type { WsCommandHandler } from "./api/handlers/types.js";

const RUNTIME_GLOBALS = [
  "__cobeing",
  "__cobeingHookBus",
  "__cobeingPromptLayers",
  "__cobeingConfig",
  "__cobeingDataRoot",
  "__cobeingAgentRegistry",
  "__cobeingObsDb",
  "__cobeingGetProvider",
  "__cobeingWSServer",
  "__cobeingGroupManager",
];

describe("butler 文件体系与人格（ensureButlerDir / butler-persona handlers）", () => {
  let tmpDir: string;
  let runtime: CoBeingRuntime;
  const commands = new Map<string, WsCommandHandler>();
  const sent: Array<{ type: string; payload?: unknown }> = [];
  let fakeServer: { dataRoot: string; sendToClient: (_ws: unknown, msg: { type: string; payload?: unknown }) => void };

  async function callCommand(type: string, payload: unknown): Promise<void> {
    const handler = commands.get(type);
    expect(handler, `命令 ${type} 应已注册`).toBeDefined();
    await handler!.call(fakeServer as any, {} as any, { type, payload });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-butler-"));
    const config = loadConfig();
    config.core.dataDir = tmpDir;
    runtime = new CoBeingRuntime(config);
    commands.clear();
    sent.length = 0;
    fakeServer = {
      dataRoot: tmpDir,
      sendToClient: (_ws: unknown, msg: { type: string; payload?: unknown }) => { sent.push(msg); },
    };
    registerButlerPersonaHandlers((t, h) => commands.set(t, h));
  });

  afterEach(() => {
    for (const k of RUNTIME_GLOBALS) {
      delete (globalThis as any)[k];
    }
    // runtime 的 store 可能仍持有文件句柄（Windows 上 EPERM），临时目录残留无害
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore EPERM on Windows */
    }
  });

  it("ensureButlerDir 首次启动创建管家文件体系（config.json + 5 个 md）", () => {
    (runtime as any).ensureButlerDir();
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    for (const f of ["config.json", "AGENTS.md", "CHARACTER.md", "JOB.md", "MEMORY.md", "EXPERIENCE.md"]) {
      expect(fs.existsSync(path.join(butlerDir, f)), `${f} 应已创建`).toBe(true);
    }

    // config.json：provider/model/权限/tools 白名单
    const cfg = JSON.parse(fs.readFileSync(path.join(butlerDir, "config.json"), "utf-8"));
    expect(cfg.provider).toBe("deepseek"); // DEFAULT_PROVIDER
    expect(cfg.model).toBeTruthy();
    expect(cfg.permissions?.mode).toBe("full-access");
    expect(Array.isArray(cfg.tools)).toBe(true);
    expect(cfg.tools).toContain("butler-list");
    expect(cfg.tools).toContain("butler-create-agent");
    expect(cfg.tools).toContain("group-send");

    // JOB.md 承载分级转接规则 + Market 推荐纪律 + 多步任务推进流程（澄清→推进→确认点→继续）
    const job = fs.readFileSync(path.join(butlerDir, "JOB.md"), "utf-8");
    expect(job).toContain("分级转接");
    expect(job).toContain("Market 推荐纪律");
    expect(job).toContain("butler-dispatch-to-agent");
    expect(job).toContain("butler-dispatch-to-group");
    expect(job).toContain("多步任务推进流程");
    expect(job).toContain("确认点");
    expect(job).toContain("confirmed:true");

    // 默认人格 = 亲密朋友
    const char = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    expect(char).toContain("亲密朋友");
  });

  it("重复执行 ensureButlerDir 不覆盖（用户修改过的人格/配置保留）", () => {
    (runtime as any).ensureButlerDir();
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    const charPath = path.join(butlerDir, "CHARACTER.md");
    const cfgPath = path.join(butlerDir, "config.json");

    // 模拟用户修改人格 + 配置
    fs.writeFileSync(charPath, "# 自定义人格\n", "utf-8");
    const cfgBefore = fs.readFileSync(cfgPath, "utf-8");
    const cfg = JSON.parse(cfgBefore);
    cfg.provider = "custom-provider";
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf-8");

    (runtime as any).ensureButlerDir();
    (runtime as any).ensureButlerDir();

    expect(fs.readFileSync(charPath, "utf-8")).toBe("# 自定义人格\n");
    const cfgAfter = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    expect(cfgAfter.provider).toBe("custom-provider");
  });

  it("createCoreAgents 顺序：ensureButlerDir 先于 createButler（文件 prompt 地基已就绪）", async () => {
    await (runtime as any).createCoreAgents();
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    // 管家已创建，且文件体系已就绪（prompt 走文件的输入完整）
    expect((runtime as any).butler).toBeTruthy();
    expect((runtime as any).butler.constructor.name).toBe("ButlerAgent");
    expect(fs.existsSync(path.join(butlerDir, "JOB.md"))).toBe(true);
    expect(fs.existsSync(path.join(butlerDir, "CHARACTER.md"))).toBe(true);
    expect(fs.existsSync(path.join(butlerDir, "config.json"))).toBe(true);
  });

  it("管家走文件 prompt：AGENTS/CHARACTER/JOB 真实进入 system prompt，工具注册不退化", async () => {
    // butler 的 AgentPaths 按 CWD 相对解析 data/coreagents/butler →
    // chdir 到临时目录后，dataRoot 对齐到 tmpDir/data（与 ensureButlerDir 写入位置一致）
    (runtime as any).dataRoot = path.join(tmpDir, "data");
    (runtime as any).ensureButlerDir();

    // 捕获发给 LLM 的 messages 与 tools（mock provider 替换 deepseek）
    const captured: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[] }> = [];
    const mockProvider = {
      id: "deepseek",
      name: "mock",
      chat: async function* (opts: { messages: unknown[]; tools?: unknown[] }) {
        captured.push({ messages: opts.messages as any, tools: opts.tools });
        yield { type: "content", content: "好的，我明白了。" };
      },
      chatComplete: async () => "ok",
      listModels: async () => [],
      capabilities: () => ({ tools: true, vision: false, streaming: true, maxTokens: 4096, contextWindow: 128000 }),
    };
    (runtime as any).providers.set("deepseek", mockProvider);

    // butler 的 AgentPaths 按 CWD 解析 → chdir 到临时目录，使管家文件指向 tmpDir/coreagents/butler
    const oldCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await (runtime as any).createCoreAgents();
      const response = await (runtime as any).butler.run("你好，帮我看看我的项目");
      expect(response.content).toContain("好的");

      expect(captured.length).toBeGreaterThan(0);
      const sys = captured[0].messages[0];
      expect(sys.role).toBe("system");
      // 五/三层架构：AGENTS.md（共享前缀）+ CHARACTER.md + JOB.md（易失层 EXPERIENCE/MEMORY 模板）
      expect(sys.content).toContain("亲密朋友");          // CHARACTER.md（默认人格）
      expect(sys.content).toContain("分级转接");           // JOB.md
      expect(sys.content).toContain("Market 推荐纪律");    // JOB.md
      expect(sys.content).toContain("管家运行边界");        // AGENTS.md

      // 工具注册不退化：完整管家工具面仍随 prompt 下发
      const toolNames = (captured[0].tools ?? []).map((t: any) => t.function?.name ?? t.name);
      for (const expected of ["butler-list", "butler-create-agent", "butler-create-group", "butler-run-group", "butler-dispatch-to-agent", "butler-get-work-status", "group-send", "read-file", "write-file"]) {
        expect(toolNames).toContain(expected);
      }
      // 管家工具分级结构约束（决策 #1 / P2）：执行类工具必须被移除
      for (const forbidden of ["bash", "edit-file", "glob", "grep"]) {
        expect(toolNames).not.toContain(forbidden);
      }
    } finally {
      process.chdir(oldCwd);
    }
  });

  it("butler_get_personas 列出 4 个人格模板 + current 检测（默认亲密朋友）", async () => {
    (runtime as any).ensureButlerDir();
    await callCommand("butler_get_personas", {});
    const resp = sent[0];
    expect(resp.type).toBe("butler_personas");
    const payload = resp.payload as { personas: Array<{ id: string; name: string }>; current: string | null };
    expect(payload.personas.length).toBe(4);
    expect(payload.personas.map((p) => p.id)).toEqual(["专业秘书", "亲密朋友", "学习陪伴", "家庭助理"].sort());
    expect(payload.personas.every((p) => p.name.length > 0)).toBe(true);
    // 首次启动 ensureButlerDir 复制默认人格 → current 应为亲密朋友
    expect(payload.current).toBe("亲密朋友");
  });

  it("butler_set_persona 切换人格：复制模板到管家目录，config.json 不动", async () => {
    (runtime as any).ensureButlerDir();
    await callCommand("butler_set_persona", { persona: "专业秘书" });
    const resp = sent[0];
    expect(resp.type).toBe("butler_persona_set");
    expect(resp.payload).toEqual({ ok: true, persona: "专业秘书" });

    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    const char = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    const job = fs.readFileSync(path.join(butlerDir, "JOB.md"), "utf-8");
    expect(char).toContain("专业秘书");
    expect(job).toContain("分级转接");
    // config.json 未被改动
    const cfg = JSON.parse(fs.readFileSync(path.join(butlerDir, "config.json"), "utf-8"));
    expect(cfg.name).toBe("管家");

    // 切换后 current 跟随
    await callCommand("butler_get_personas", {});
    expect((sent[1].payload as { current: string | null }).current).toBe("专业秘书");
  });

  it("butler_set_persona 非法 persona → error", async () => {
    (runtime as any).ensureButlerDir();
    await callCommand("butler_set_persona", { persona: "不存在的模板" });
    expect(sent[0].type).toBe("error");
    // 路径穿越防御
    await callCommand("butler_set_persona", { persona: "../agent" });
    expect(sent[1].type).toBe("error");
  });

  it("butler_update_style apply=true 写入 CHARACTER.md「用户偏好」段与 config.json name", async () => {
    (runtime as any).ensureButlerDir();
    await callCommand("butler_update_style", {
      nickname: "小伴",
      greeting: "你好呀，今天想做什么？",
      tone: "轻松",
      apply: true,
    });
    expect(sent[0].type).toBe("butler_style_updated");
    expect(sent[0].payload).toEqual({ ok: true, applied: true });

    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    const char = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    expect(char).toContain("## 用户偏好");
    expect(char).toContain("**称呼**: 小伴");
    expect(char).toContain("**欢迎语**: 你好呀，今天想做什么？");
    expect(char).toContain("**语气偏好**: 轻松");

    const cfg = JSON.parse(fs.readFileSync(path.join(butlerDir, "config.json"), "utf-8"));
    expect(cfg.name).toBe("小伴");

    // 再次更新：用户偏好段被替换而非追加
    await callCommand("butler_update_style", { nickname: "阿伴", apply: true });
    const char2 = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    expect(char2).toContain("**称呼**: 阿伴");
    expect(char2).not.toContain("**称呼**: 小伴");
  });

  it("butler_update_style apply=false 或非法字段 → 不写入", async () => {
    (runtime as any).ensureButlerDir();
    const butlerDir = path.join(tmpDir, "coreagents", "butler");
    const charBefore = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    const cfgBefore = fs.readFileSync(path.join(butlerDir, "config.json"), "utf-8");

    await callCommand("butler_update_style", { nickname: "预览名", apply: false });
    expect(sent[0].type).toBe("butler_style_updated");
    expect(sent[0].payload).toEqual({ ok: true, applied: false });

    await callCommand("butler_update_style", { nickname: 123, apply: true });
    expect(sent[1].type).toBe("error");

    expect(fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8")).toBe(charBefore);
    expect(fs.readFileSync(path.join(butlerDir, "config.json"), "utf-8")).toBe(cfgBefore);
  });
});
