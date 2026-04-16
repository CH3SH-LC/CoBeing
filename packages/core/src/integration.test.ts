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
import { MemoryWriter } from "./memory/writer.js";
import { MemoryReader } from "./memory/reader.js";
import { ButlerRegistry } from "./butler/registry.js";
import { GroupManager } from "./group/manager.js";
import { GroupContext } from "./group/context.js";

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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "myagents-e2e-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Agent 文件系统 + 记忆", () => {
    it("Agent 创建时自动建立目录结构", () => {
      const agent = new Agent({
        id: "test-agent",
        name: "测试",
        role: "测试角色",
        systemPrompt: "test",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), path.join(tmpDir, "agents"));

      expect(fs.existsSync(agent.paths.workspaceDir)).toBe(true);
      expect(fs.existsSync(agent.paths.memoryDir)).toBe(true);
      expect(fs.existsSync(agent.paths.skillsDir)).toBe(true);
    });

    it("从 IDENTITY.md 和 SOUL.md 加载增强 system prompt", () => {
      const dataRoot = path.join(tmpDir, "agents");
      const agentDir = path.join(dataRoot, "expert");
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "IDENTITY.md"),
        "# IDENTITY.md\n- Name: 专家\n- Emoji: 🧠\n- Creature: 资深工程师\n- Vibe: 严谨\n", "utf-8");
      fs.writeFileSync(path.join(agentDir, "SOUL.md"),
        "# SOUL.md\n你是一位精通系统设计的资深工程师。", "utf-8");

      const agent = new Agent({
        id: "expert",
        name: "Expert",
        role: "工程师",
        systemPrompt: "base prompt",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), dataRoot);

      expect(agent.name).toBe("专家"); // IDENTITY.md 覆盖
    });

    it("对话自动写入记忆文件", async () => {
      const agent = new Agent({
        id: "writer-test",
        name: "Writer",
        role: "test",
        systemPrompt: "test",
        provider: "mock",
        model: "mock",
      }, createMockProvider(), path.join(tmpDir, "agents"));

      await agent.run("Hello");

      // 检查 memory 文件
      const memoryFiles = fs.readdirSync(agent.paths.memoryDir).filter(f => f.endsWith(".md"));
      expect(memoryFiles.length).toBeGreaterThanOrEqual(1);

      const content = fs.readFileSync(path.join(agent.paths.memoryDir, memoryFiles[0]), "utf-8");
      expect(content).toContain("Hello");
      expect(content).toContain("mock response");
    });
  });

  describe("群组通信 + GroupContext", () => {
    it("群组 main 频道 @mention 路由正确", () => {
      const ctx = new GroupContext("debate", tmpDir);

      ctx.speakToMain("moderator", "@react-expert 你怎么看 hooks？");
      ctx.speakToMain("moderator", "@vue-expert 你怎么看 composition API？");
      ctx.speakToMain("moderator", "@all 总结一下");

      expect(ctx.getPendingMentions("react-expert")).toHaveLength(2); // @react-expert + @all
      expect(ctx.getPendingMentions("vue-expert")).toHaveLength(2);   // @vue-expert + @all
      expect(ctx.getPendingMentions("moderator")).toHaveLength(0);
    });

    it("talk 私有讨论隔离", () => {
      const ctx = new GroupContext("team", tmpDir);
      const talk = ctx.createTalk(["alice", "bob"], "接口设计");

      talk.speak("alice", "我建议用 REST");
      talk.speak("bob", "我觉得 gRPC 更好");

      expect(talk.isMember("alice")).toBe(true);
      expect(talk.isMember("charlie")).toBe(false);
      expect(talk.getHistory()).toHaveLength(2);
    });

    it("群组 + GroupManager + Registry 协同", () => {
      const registry = new AgentRegistry();
      const groupManager = new GroupManager(registry, tmpDir);

      const agent1 = new Agent({
        id: "a1", name: "A1", role: "r1", systemPrompt: "s", provider: "mock", model: "mock",
      }, createMockProvider(), path.join(tmpDir, "agents"));
      const agent2 = new Agent({
        id: "a2", name: "A2", role: "r2", systemPrompt: "s", provider: "mock", model: "mock",
      }, createMockProvider(), path.join(tmpDir, "agents"));

      registry.register(agent1);
      registry.register(agent2);

      groupManager.create({
        id: "g1", name: "G1", members: ["a1", "a2"], protocol: "round-robin",
      });

      const ctx = groupManager.getContext("g1");
      expect(ctx).toBeDefined();
      expect(ctx!.groupId).toBe("g1");

      // 持久化
      ctx!.speakToMain("a1", "开始讨论");
      ctx!.saveMain();

      const mainFile = path.join(tmpDir, "groups", "g1", "main.md");
      expect(fs.existsSync(mainFile)).toBe(true);
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
        id: "web-team", name: "Web Team", members: ["fe", "be"], protocol: "round-robin",
      });

      const agent = br.getAgent("fe");
      expect(agent?.groups).toContain("web-team");

      const groups = br.parseGroupsRegistry();
      expect(groups[0].members).toEqual(["fe", "be"]);
    });
  });

  describe("SKILL.md 加载 + Agent 集成", () => {
    it("Agent 私有 skills 目录加载 SKILL.md", () => {
      const dataRoot = path.join(tmpDir, "agents");
      const skillsDir = path.join(dataRoot, "test-agent", "skills");
      fs.mkdirSync(path.join(skillsDir, "greet"), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, "greet", "SKILL.md"), [
        "---",
        "name: greet",
        "description: 打招呼",
        "---",
        "",
        "用友好的方式打招呼。",
      ].join("\n"), "utf-8");

      const agent = new Agent({
        id: "test-agent", name: "Test", role: "test", systemPrompt: "test",
        provider: "mock", model: "mock",
      }, createMockProvider(), dataRoot);

      // 工具应该被注册
      const toolDefs = agent["toolRegistry"].listDefinitions();
      const greetTool = toolDefs.find(t => t.function.name === "skill-greet");
      expect(greetTool).toBeDefined();
    });
  });

  describe("MemoryReader 搜索", () => {
    it("搜索历史对话关键词", () => {
      const agentDir = path.join(tmpDir, "agents", "search-test");
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
});
