/**
 * Group — a multi-agent discussion group
 */
import type { GroupConfig, GroupMessage } from "@myagents/shared";
import type { Agent } from "../agent/agent.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { GroupContext } from "./context.js";
import { createProtocol } from "./protocol.js";
import { createLogger } from "@myagents/shared";

const log = createLogger("group");

export class Group {
  readonly id: string;
  readonly config: GroupConfig;
  private history: GroupMessage[] = [];
  private protocol;
  private registry: AgentRegistry;
  private ctx?: GroupContext;

  constructor(config: GroupConfig, registry: AgentRegistry, ctx?: GroupContext) {
    this.id = config.id;
    this.config = config;
    this.registry = registry;
    this.protocol = createProtocol(config.protocol, config.moderator);
    this.ctx = ctx;
  }

  async run(topic: string): Promise<GroupMessage[]> {
    const members = this.resolveMembers();
    if (members.length === 0) {
      log.warn("[%s] No members", this.id);
      return [];
    }

    const maxRounds = this.config.maxRounds ?? 10;

    for (let round = 0; round < maxRounds; round++) {
      for (let step = 0; step < members.length; step++) {
        const speaker = this.protocol.pickSpeaker(members, this.history, round, step);
        if (!speaker) break;

        const context = this.buildContext(topic);
        const prefix = round === 0 && step === 0
          ? `群组讨论主题: ${topic}\n\n你是 ${speaker.name}。请基于上下文发表你的观点。`
          : `你是 ${speaker.name}。请基于上下文继续讨论。`;

        try {
          const response = await speaker.run(`${prefix}\n\n${context}`);
          this.history.push({
            groupId: this.id,
            fromAgentId: speaker.id,
            content: response.content,
            timestamp: Date.now(),
          });
          // 写入 GroupContext（触发订阅者通知）
          if (this.ctx) {
            this.ctx.speakToMain(speaker.id, response.content);
          }
          log.info("[%s] R%d S%d: %s (%d chars)", this.id, round, step, speaker.name, response.content.length);
        } catch (err) {
          log.warn("[%s] %s failed: %s", this.id, speaker.name, err);
        }
      }

      if (!this.protocol.shouldContinue(this.history.length, round + 1, maxRounds)) {
        break;
      }
    }

    return [...this.history];
  }

  injectMessage(fromAgentId: string, content: string): void {
    this.history.push({ groupId: this.id, fromAgentId, content, timestamp: Date.now() });
  }

  getHistory(): GroupMessage[] {
    return [...this.history];
  }

  addMember(agentId: string): void {
    if (!this.config.members.includes(agentId)) {
      this.config.members.push(agentId);
    }
  }

  removeMember(agentId: string): void {
    this.config.members = this.config.members.filter(id => id !== agentId);
  }

  private resolveMembers(): Agent[] {
    return this.config.members
      .map(id => this.registry.get(id))
      .filter((a): a is Agent => a !== undefined);
  }

  private buildContext(topic: string): string {
    if (this.history.length === 0) return topic;
    const recent = this.history.slice(-10);
    return recent.map(m => `[${m.fromAgentId}]: ${m.content}`).join("\n\n");
  }
}
