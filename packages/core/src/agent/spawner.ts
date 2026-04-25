/**
 * SubAgent Spawner — 从父 Agent 动态创建子 Agent
 */
import { Agent } from "./agent.js";
import type { AgentConfig, AgentResponse } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("subagent-spawner");

export interface SpawnConfig {
  name: string;
  role: string;
  task: string;
  tools?: string[];         // 继承的工具列表，默认继承父 Agent 全部
  parentContext?: boolean;   // 是否继承对话上下文
}

export interface SpawnForJSONConfig {
  /** 子智能体的系统提示 */
  systemPrompt: string;
  /** 要求子智能体完成的任务 */
  task: string;
  /** 期望返回的 JSON 字段列表（用于解析提示） */
  expectedFields: string[];
}

export class SubAgentSpawner {
  private spawnedAgents = new Map<string, Agent>();

  constructor(
    private parentConfig: AgentConfig,
    private provider: LLMProvider,
    _parentWorkingDir: string,
  ) {
    // parentWorkingDir 留作 Phase 4 上下文继承
  }

  /**
   * 创建并运行一个子 Agent
   */
  async spawn(config: SpawnConfig): Promise<{ agentId: string; response: AgentResponse }> {
    const agentId = `sub:${config.name}:${Date.now()}`;

    const tools = config.tools ?? this.parentConfig.tools;
    const subConfig: AgentConfig = {
      id: agentId,
      name: config.name,
      role: config.role,
      systemPrompt: `你是 ${config.name}，${config.role}。完成以下任务：${config.task}`,
      provider: this.parentConfig.provider,
      model: this.parentConfig.model,
      tools,
      toolsConfig: this.parentConfig.toolsConfig,
      permissions: this.parentConfig.permissions,
      sandbox: this.parentConfig.sandbox,
    };

    const agent = new Agent(subConfig, this.provider);
    this.spawnedAgents.set(agentId, agent);

    log.info("Spawned sub-agent: %s (%s)", config.name, agentId);

    try {
      const response = await agent.run(config.task);
      return { agentId, response };
    } finally {
      this.spawnedAgents.delete(agentId);
      log.info("Sub-agent completed: %s", agentId);
    }
  }

  /**
   * 创建子 Agent 生成结构化 JSON 输出
   * 用于 Agent 创建场景：子智能体独立生成核心文件内容
   */
  async spawnForJSON(config: SpawnForJSONConfig): Promise<Record<string, string>> {
    const agentId = `sub:creator:${Date.now()}`;

    const jsonPrompt = `${config.systemPrompt}

你的任务：${config.task}

你必须返回一个合法的 JSON 对象，包含以下字段：${config.expectedFields.join(", ")}
不要返回任何 JSON 之外的内容。不要用 markdown 代码块包裹。
直接输出 JSON，例如：{"${config.expectedFields[0]}": "...", "${config.expectedFields[1] || "..."}": "..."}`;

    const subConfig: AgentConfig = {
      id: agentId,
      name: "CreatorSubAgent",
      role: "Agent 核心文件生成器",
      systemPrompt: config.systemPrompt,
      provider: this.parentConfig.provider,
      model: this.parentConfig.model,
      tools: [],
      toolsConfig: this.parentConfig.toolsConfig,
      permissions: this.parentConfig.permissions,
      sandbox: this.parentConfig.sandbox,
    };

    const agent = new Agent(subConfig, this.provider);
    this.spawnedAgents.set(agentId, agent);

    log.info("Spawned JSON sub-agent: %s", agentId);

    try {
      const response = await agent.run(jsonPrompt);
      const content = response.content.trim();

      // 尝试解析 JSON（处理可能的 markdown 代码块包裹）
      let jsonStr = content;
      const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr) as Record<string, string>;
      log.info("JSON sub-agent completed: %s, fields: %s", agentId, Object.keys(parsed).join(", "));
      return parsed;
    } catch (err) {
      log.error("JSON sub-agent failed to parse: %s", err);
      // 返回空对象，让调用方回退到模板
      return {};
    } finally {
      this.spawnedAgents.delete(agentId);
    }
  }

  /** 获取当前活跃的子 Agent */
  getActive(): Array<{ id: string; name: string; status: string }> {
    return [...this.spawnedAgents.values()].map(a => ({
      id: a.id,
      name: a.name,
      status: a.getStatus(),
    }));
  }
}
