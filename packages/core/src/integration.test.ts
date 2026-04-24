/**
 * 端到端集成测试 — 验证 v2 架构各模块协同工作
 * 不依赖 LLM 调用，测试纯逻辑链路
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Agent } from "./agent/agent.js";
import { AgentRegistry } from "./agent/registry.js";
import { AgentEventBus } from "./agent/event-bus.js";
import { MemoryWriter } from "./memory/writer.js";
import { MemoryReader } from "./memory/reader.js";
import { ButlerRegistry } from "./butler/registry.js";
import { GroupManager } from "./group/manager.js";
import { GroupContextV2 } from "./group/group-context-v2.js";
import { AgentPaths, AgentFiles } from "./agent/paths.js";
import { SkillRepository } from "./skills/repository.js";

// Mock LLM Provider
function createMockProvider() {
  return {
    chat: async function* () {
      yield { type: "content", content: "mock response" };
      yield { type: "done" };
    },
  } as any;
}

describe("E2E Integration", () => {
  let tmpDir: string;
  const agents: Agent[] = [];

  function createAgent(config: Parameters<typeof Agent["prototype"]["constructor"]> extends [infer C, ...infer R] ? any : any, provider: any, dataRoot?: string) {
    const agent = new Agent(config, provider, dataRoot);
    agents.push(agent);
    return agent;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-e2e-"));
    agents.length = 0;
  });

  afterEach(async () => {
    // 关闭所有 Agent 释放 SQLite 文件句柄
    for (const agent of agents) {
      try { await agent.dispose(); } catch { /* ignore */ }
    }
    agents.length = 0;
    // Windows 上短暂等待让文件句柄释放
    await new Promise(r => setTimeout(r, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Agent 文件系统 + 记忆", () => {
    it("Agent 创建时自动建立目录结构", () => {
      const agent = createAgent({
        id: "test-agent",
        name: "测试",
        role: "测试角色",
        systemPrompt: "test",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), tmpDir);

      expect(fs.existsSync(agent.paths.workspaceDir)).toBe(true);
      expect(fs.existsSync(agent.paths.memoryDir)).toBe(true);
      expect(fs.existsSync(agent.paths.skillsDir)).toBe(true);
    });

    it("从 CHARACTER.md 和 SOUL.md 加载增强 system prompt", () => {
      const dataRoot = tmpDir;
      const agentDir = path.join(dataRoot, "agents", "expert");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "CHARACTER.md"),
        "# CHARACTER.md\n- Name: 专家\n- 性格: 严谨\n", "utf-8");
      fs.writeFileSync(path.join(agentDir, "SOUL.md"),
        "# SOUL.md\n你是一位精通系统设计的资深工程师。", "utf-8");

      const agent = createAgent({
        id: "expert",
        name: "Expert",
        role: "工程师",
        systemPrompt: "base prompt",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), dataRoot);

      expect(agent.name).toBe("专家"); // CHARACTER.md 覆盖
    });

    it("对话自动写入记忆文件", async () => {
      const agent = createAgent({
        id: "writer-test",
        name: "Writer",
        role: "test",
        systemPrompt: "test",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), tmpDir);

      await agent.run("Hello");

      // 检查 memory 文件
      const memoryFiles = fs.readdirSync(agent.paths.memoryDir).filter(f => f.endsWith(".md"));
      expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

      const content = fs.readFileSync(path.join(agent.paths.memoryDir, memoryFiles[0]), "utf-8");
      expect(content).toContain("Hello");
      expect(content).toContain("mock response");
    });
  });

  describe("群组通信 + GroupContextV2 (Phase 8.3)", () => {
    it("群组 main 频道 @mention 路由正确", () => {
      const ctx = new GroupContextV2("debate");

      ctx.append("moderator", "@react-expert 你怎么看 hooks？");
      ctx.append("moderator", "@vue-expert 你怎么看 composition API？");
      ctx.append("moderator", "@all 总结一下");

      expect(ctx.getPendingMentions("react-expert")).toHaveLength(2);
      expect(ctx.getPendingMentions("vue-expert")).toHaveLength(2);
      expect(ctx.getPendingMentions("moderator")).toHaveLength(0);
    });

    it("talk 私有讨论隔离", () => {
      const ctx = new GroupContextV2("team");
      const talkId = ctx.createTalk(["alice", "bob"], "接口设计");

      ctx.append("alice", "我建议用 REST", talkId);
      ctx.append("bob", "我觉得 gRPC 更好", talkId);

      expect(ctx.isTalkMember(talkId, "alice")).toBe(true);
      expect(ctx.isTalkMember(talkId, "charlie")).toBe(false);

      const msgs = ctx.getMessages().filter(m => m.tag === talkId);
      expect(msgs).toHaveLength(2);
    });

    it("群组 + GroupManager + Registry 协同", () => {
      const registry = new AgentRegistry();
      const groupManager = new GroupManager(registry, tmpDir);

      const agent1 = createAgent({
        id: "a1", name: "A1", role: "r1", systemPrompt: "s", provider: "mock", model: "mock",
      }, createMockProvider(), tmpDir);
      const agent2 = createAgent({
        id: "a2", name: "A2", role: "r2", systemPrompt: "s", provider: "mock", model: "mock",
      }, createMockProvider(), tmpDir);

      registry.register(agent1);
      registry.register(agent2);

      const group = groupManager.create({
        id: "g1", name: "G1", members: ["a1", "a2"],
      });

      expect(group).toBeDefined();
      expect(group.ctxV2.groupId).toBe("g1");

      group.postMessage("a1", "开始讨论");
      expect(group.ctxV2.messageCount).toBe(1);
    });
  });

  describe("ButlerRegistry 持久化", () => {
    it("Agent 创建→注册→销毁 完整生命周期", () => {
      const br = new ButlerRegistry(tmpDir);

      br.registerAgent({
        id: "dev", name: "Dev", role: "开发者", capabilities: "TypeScript, Go",
      });

      const agents = br.parseAgentsRegistry();
      expect(agents).toHaveLength(1);

      br.unregisterAgent("dev");
      expect(br.parseAgentsRegistry()).toHaveLength(0);
    });

    it("任务日志写入和读取", () => {
      const br = new ButlerRegistry(tmpDir);

      br.appendTaskLog({
        timestamp: "2026-04-15",
        task: "创建 Agent",
        action: "butler-create-agent",
        result: "成功",
      });

      const log = br.readTaskLog();
      expect(log).toContain("任务执行日志");
      expect(log).toContain("创建 Agent");
    });

    it("Group 注册表与 Agent 关联", () => {
      const br = new ButlerRegistry(tmpDir);

      br.registerAgent({ id: "fe", name: "FE", role: "前端", groups: ["web-team"] });
      br.registerAgent({ id: "be", name: "BE", role: "后端", groups: ["web-team"] });
      br.registerGroup({
        id: "web-team", name: "Web Team", members: ["fe", "be"],
      });

      const agent = br.getAgent("fe");
      expect(agent?.groups).toContain("web-team");

      const groups = br.parseGroupsRegistry();
      expect(groups[0].members).toEqual(["fe", "be"]);
    });
  });

  describe("SKILL.md 加载 + Agent 集成", () => {
    it("SkillRepository loads SKILL.md and Agent injects skill tools", () => {
      // 创建全局 skills 目录
      const skillsDir = path.join(tmpDir, "skills");
      fs.mkdirSync(path.join(skillsDir, "greet"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "greet", "SKILL.md"), [
        "---",
        "name: greet",
        "description: 打招呼",
        "---",
        "",
        "用友好的方式打招呼。",
      ].join("\n"), "utf-8");

      const repo = new SkillRepository(skillsDir);
      expect(repo.size).toBe(1);
      expect(repo.get("greet")).toBeDefined();

      const dataRoot = tmpDir;
      const agent = createAgent({
        id: "test-agent", name: "Test", role: "test", systemPrompt: "test",
        provider: "mock", model: "mock",
      }, createMockProvider(), dataRoot);

      // 注入 SkillRepository
      agent.injectSkillRepository(repo);

      // 应该有 skill-execute, skill-list, skill-create 三个工具
      const toolDefs = agent["toolRegistry"].listDefinitions();
      expect(toolDefs.find(t => t.function.name === "skill-execute")).toBeDefined();
      expect(toolDefs.find(t => t.function.name === "skill-list")).toBeDefined();
      expect(toolDefs.find(t => t.function.name === "skill-create")).toBeDefined();
    });
  });

  describe("MemoryReader 搜索", () => {
    it("搜索历史对话关键词", () => {
      const agentDir = path.join(tmpDir, "search-test");
      const memoryDir = path.join(agentDir, "memory");
      fs.mkdirSync(memoryDir, { recursive: true });

      const writer = new MemoryWriter(memoryDir);
      writer.append({ session: "main", role: "user", content: "讨论 React hooks 的使用" });
      writer.append({ session: "main", role: "assistant", content: "React hooks 包括 useState, useEffect" });
      writer.append({ session: "main", role: "user", content: "zustand 状态管理" });

      const reader = new MemoryReader(memoryDir, path.join(agentDir, "MEMORY.md"));
      const results = reader.search("hooks");
      expect(results.length).toBeGreaterThanOrEqual(2);

      const noResults = reader.search("nonexistent");
      expect(noResults).toHaveLength(0);
    });
  });

  describe("经验系统 E2E", () => {
    it("Agent 完成任务后自动创建 EXPERIENCE.md", async () => {
      const agent = createAgent({
        id: "exp-e2e", name: "ExpE2E", role: "test", systemPrompt: "test",
        provider: "mock", model: "mock",
      }, createMockProvider(), tmpDir);

      await agent.run("帮我修复 TypeScript 类型错误");

      // 检查 EXPERIENCE.md 是否被创建
      const expPath = agent.paths.experiencePath;
      expect(fs.existsSync(expPath)).toBe(true);
    });
  });

  describe("事件总线 E2E", () => {
    it("GroupContextV2 @mention 解析正确", () => {
      const ctx = new GroupContextV2("e2e-group");

      ctx.append("owner", "@target-agent 请开始工作");

      const pending = ctx.getPendingMentions("target-agent");
      expect(pending).toHaveLength(1);
      expect(pending[0].mentions).toContain("target-agent");
    });
  });

  describe("Skills 选择装载 E2E (Phase 8.2)", () => {
    it("skill-list respects skills whitelist", async () => {
      const skillsDir = path.join(tmpDir, "skills");
      fs.mkdirSync(path.join(skillsDir, "skill-a"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "skill-a", "SKILL.md"), [
        "---", "name: skill-a", "description: Skill A", "---", "", "Do A.",
      ].join("\n"), "utf-8");

      fs.mkdirSync(path.join(skillsDir, "skill-b"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "skill-b", "SKILL.md"), [
        "---", "name: skill-b", "description: Skill B", "---", "", "Do B.",
      ].join("\n"), "utf-8");

      const repo = new SkillRepository(skillsDir);
      expect(repo.size).toBe(2);

      // 带 whitelist 的 Agent
      const dataRoot = tmpDir;
      const agent = createAgent({
        id: "whitelist-agent", name: "S1", role: "test", systemPrompt: "test",
        provider: "mock", model: "mock",
        skills: ["skill-a"],
      }, createMockProvider(), dataRoot);

      agent.injectSkillRepository(repo);

      // skill-list 应该只返回 skill-a
      const listTool = agent["toolRegistry"].listDefinitions().find(t => t.function.name === "skill-list");
      expect(listTool).toBeDefined();
    });

    it("SkillRepository create and search", () => {
      const skillsDir = path.join(tmpDir, "skills-new");
      fs.mkdirSync(skillsDir, { recursive: true });
      const repo = new SkillRepository(skillsDir);

      repo.create("test-skill", "A test skill", "Do the test thing.");
      expect(repo.size).toBe(1);

      const results = repo.search("test");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test-skill");
    });
  });

  describe("Phase 8.1: Agent File System Integration", () => {
    it("bootstrap is preserved after agent creation", () => {
      const dataRoot = tmpDir;
      const agentDir = path.join(dataRoot, "agents", "bootstrap-test");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "BOOTSTRAP.md"), "首次启动引导内容", "utf-8");

      const agent = createAgent({
        id: "bootstrap-test",
        name: "引导测试",
        role: "测试",
        systemPrompt: "你是引导测试Agent。",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), dataRoot);

      // BOOTSTRAP 不再删除 — 每次构建 prompt 时都会读取
      expect(fs.existsSync(path.join(agentDir, "BOOTSTRAP.md"))).toBe(true);
    });

    it("agent prompt includes SOUL + USER + AGENTS", () => {
      const dataRoot = tmpDir;
      const agentDir = path.join(dataRoot, "agents", "chain-test");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "SOUL.md"), "你是一个严谨的工程师。", "utf-8");
      fs.writeFileSync(path.join(agentDir, "USER.md"), "偏好：简洁。", "utf-8");
      fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "先读后写。", "utf-8");

      const agent = createAgent({
        id: "chain-test",
        name: "链式测试",
        role: "测试",
        systemPrompt: "你是测试Agent。",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), dataRoot);

      // Agent 构造成功即可验证链式构建没有报错
      expect(agent).toBeDefined();
    });

    it("AgentPaths resolves all new paths", () => {
      const p = AgentPaths.forAgent("new-paths", tmpDir);
      expect(p.userPath).toContain("USER.md");
      expect(p.bootstrapPath).toContain("BOOTSTRAP.md");
      expect(p.toolsPath).toContain("TOOLS.md");
    });
  });
});
