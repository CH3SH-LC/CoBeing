/**
 * 轻量 ToolAgent 注册表（决策 #8 / spec #4）
 *
 * 统一 ToolAgent 注册/发现入口：从 data/toolagents/ 配置卡全量加载 spec，
 * 接收插件 registerToolAgent 注册（复活死注册），提供按类型查询/列表。
 * 不做 GUI 面板、不做统一评估（anti-overengineering）。
 */
import { loadToolAgentSpec } from "./spec.js";
import type { ToolAgentSpec, ToolAgentType } from "./types.js";
import { createLogger } from "@cobeing/shared";

const log = createLogger("tool-agent-registry");

const ALL_TYPES: ToolAgentType[] = [
  "review", "judgment", "clone", "memory", "creator",
  "growth-reviewer", "task-archive", "capability-updater",
];

export class ToolAgentRegistry {
  private specs = new Map<ToolAgentType, ToolAgentSpec>();
  /** 插件注册的自定义工具智能体（保留原 def，供插件消费） */
  private pluginAgents = new Map<string, unknown>();

  /** 注册单个 spec */
  register(spec: ToolAgentSpec): void {
    this.specs.set(spec.type, spec);
  }

  /** 按类型查询 spec */
  getSpec(type: ToolAgentType): ToolAgentSpec | undefined {
    return this.specs.get(type);
  }

  /** 列出全部 spec */
  listSpecs(): ToolAgentSpec[] {
    return [...this.specs.values()];
  }

  /** 插件注册自定义工具智能体（原 registerToolAgent 死注册复活） */
  registerPluginAgent(def: { id?: string; name?: string } & Record<string, unknown>): void {
    if (!def?.id) {
      log.warn("Plugin registered tool-agent without id — skipped");
      return;
    }
    this.pluginAgents.set(def.id, def);
    log.info("Plugin registered tool-agent: %s (%s)", def.id, def.name ?? "unnamed");
  }

  /** 列出插件注册的自定义工具智能体 */
  listPluginAgents(): unknown[] {
    return [...this.pluginAgents.values()];
  }

  /** 从 data/toolagents/ 全量加载配置卡 spec */
  loadAll(dataRoot?: string): void {
    for (const type of ALL_TYPES) {
      try {
        const spec = loadToolAgentSpec(type, dataRoot);
        this.register(spec);
      } catch (err: any) {
        log.warn("Failed to load ToolAgent spec %s: %s", type, err?.message ?? err);
      }
    }
    log.info("ToolAgentRegistry loaded %d specs", this.specs.size);
  }
}
