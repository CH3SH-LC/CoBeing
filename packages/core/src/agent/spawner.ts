/**
 * SubAgent Spawner — 从父 Agent 动态创建子 Agent
 */
import { Agent } from "./agent.js";
import type { AgentConfig, AgentResponse } from "@myagents/shared";
import type { LLMProvider } from "@myagents/providers";
import { createLogger } from "@myagents/shared";

const log = createLogger("subagent-spawner");

export interface SpawnConfig {
  name: string;
  role: string;
  task: string;
  tools?: string[];         // 继承的工具列表，默认继承父 Agent 全部
  parentContext?: boolean;   // 是否继承对话上下文
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

  /** 获取当前活跃的子 Agent */
  getActive(): Array<{ id: string; name: string; status: string }> {
    return [...this.spawnedAgents.values()].map(a => ({
      id: a.id,
      name: a.name,
      status: a.getStatus(),
    }));
  }
}
