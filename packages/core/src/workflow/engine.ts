/**
 * WorkflowEngine — 自动化任务执行管线
 * 串联: 分析任务 → 选择/创建 Agent → 组建群组 → 执行 → 收集结果
 */
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("workflow-engine");

export interface WorkflowConfig {
  provider?: LLMProvider;
  butlerRegistry?: import("../butler/registry.js").ButlerRegistry;
  agentRegistry?: import("../agent/registry.js").AgentRegistry;
  groupManager?: import("../group/manager.js").GroupManager;
}

export class WorkflowEngine {
  private provider?: LLMProvider;

  constructor(private config: WorkflowConfig) {
    this.provider = config.provider;
  }

  /** 分析任务需要什么 Agent */
  async analyze(task: string): Promise<string> {
    if (!this.provider) {
      return "Error: No provider available";
    }

    const existingAgents = this.config.butlerRegistry?.parseAgentsRegistry() ?? [];
    const agentInfo = existingAgents.map(a => `- ${a.id}: ${a.role} (${a.capabilities || "无"})`).join("\n");

    const prompt = `分析任务需要什么类型的 Agent。

已有 Agent:
${agentInfo || "(无)"}

任务: ${task}

请回答:
1. 需要哪些类型的 Agent（角色 + 能力）
2. 已有哪些可以复用
3. 需要新创建哪些
4. 建议的群组配置

用简洁的中文回答。`;

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }
      return result;
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  /** 生成执行计划 */
  async plan(task: string, analysis: string): Promise<string[]> {
    if (!this.provider) {
      return ["Error: No provider available"];
    }

    const prompt = `基于任务和分析，生成具体的执行步骤。

任务: ${task}

分析结果:
${analysis}

每行一个步骤，格式: "序号. 步骤描述"。不要其他内容。`;

    try {
      let result = "";
      for await (const chunk of this.provider.chat({
        model: "",
        messages: [{ role: "user", content: prompt }],
      })) {
        if (chunk.type === "content" && chunk.content) {
          result += chunk.content;
        }
      }
      return result.split("\n").filter(l => l.trim().match(/^\d+\./));
    } catch {
      return ["Error: plan generation failed"];
    }
  }
}
