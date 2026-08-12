/**
 * Agent 内置工具注册辅助模块（从 agent.ts 提取，行为不变）
 *
 * 职责：在 Agent 构造时注册 memory/TODO/群组记忆/阶段总结/克隆/增强 等内置工具。
 * 接收显式上下文（避免跨类访问 private 成员）。
 */
import path from "node:path";
import type { LLMProvider } from "@cobeing/providers";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentFiles, AgentPaths } from "./paths.js";
import type { MemoryStore } from "../memory/memory-store.js";
import { makeMemoryTool } from "../memory/memory-tool.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool, makeTodoReviewTool, makeTodoBatchCompleteTool, makeTodoBatchRemoveTool, makeTodoBatchUpdateTool } from "../todo/tools.js";
import { currentTimeTool } from "../todo/time-tool.js";
import { makeGroupMemorySearchTool } from "../tools/group-memory-search.js";
import { makeSummarizePhaseTool } from "../tools/summarize-phase.js";
import { makeAgentCloneTool } from "../tools/agent-clone.js";
import { makeAgentGetCapabilityTool, makeAgentUpdateCapabilityTool } from "../tools/agent-capability.js";
import { makeAgentTaskAcceptTool, makeAgentTaskReportTool, makeAgentTaskCompleteTool } from "../tools/agent-task.js";
import { makeAgentReflectExperienceTool, makeAgentProposeJobUpdateTool, makeAgentProposeCharacterUpdateTool, makeAgentProposeConfigUpdateTool } from "../tools/agent-growth.js";
import { makeAgentRequestResourceTool } from "../tools/agent-resource.js";

/** 内置工具注册所需上下文（由 Agent 构造时提供） */
export interface AgentToolContext {
  paths: AgentPaths;
  files: AgentFiles;
  memoryStore: MemoryStore;
  provider: LLMProvider;
  model: string;
  /** 群组 TODO store/scanner 解析（经全局 __cobeingGroupManager） */
  getGroupTodoStore: (groupId: string) => import("../todo/store.js").TodoStore | undefined;
  getGroupTodoScanner: (groupId: string) => import("../todo/group-scanner.js").GroupTodoScanner | undefined;
  getGroupAgentMemory: (groupId: string, agentId: string) => import("../group/agent-memory.js").GroupAgentMemory | undefined;
  getProvider: (providerId: string) => LLMProvider | undefined;
  /** 克隆体目标 model（当前用主 model） */
  getCloneModel: () => string;
  /** 克隆体目标名称（当前用主名称） */
  getCloneName: () => string;
}

/** 在 Agent 构造时注册全部内置工具 */
export function registerAgentTools(ctx: AgentToolContext, registry: ToolRegistry): void {
  const { files, memoryStore, provider, model } = ctx;

  // 记忆工具
  registry.register(makeMemoryTool(memoryStore));

  // TODO 工具（群组 TODO 存储/扫描器经全局 __cobeingGroupManager 解析）
  const todoDataRoot = path.dirname(path.dirname(ctx.paths.directory));
  registry.register(makeTodoAddTool(todoDataRoot, ctx.getGroupTodoStore));
  registry.register(makeTodoListTool(todoDataRoot, ctx.getGroupTodoStore));
  registry.register(makeTodoCompleteTool(todoDataRoot, ctx.getGroupTodoStore, ctx.getGroupTodoScanner));
  registry.register(makeTodoRemoveTool(todoDataRoot, ctx.getGroupTodoStore));
  registry.register(makeTodoReviewTool(todoDataRoot, ctx.getGroupTodoStore, ctx.getGroupTodoScanner));
  registry.register(makeTodoBatchCompleteTool(todoDataRoot, ctx.getGroupTodoStore, ctx.getGroupTodoScanner));
  registry.register(makeTodoBatchRemoveTool(todoDataRoot, ctx.getGroupTodoStore));
  registry.register(makeTodoBatchUpdateTool(todoDataRoot, ctx.getGroupTodoStore));
  registry.register(currentTimeTool);

  // 群组记忆搜索工具
  registry.register(makeGroupMemorySearchTool(ctx.getGroupAgentMemory));

  // 阶段总结工具（群组上下文中使用）
  registry.register(makeSummarizePhaseTool());

  // agent-clone 工具（创建克隆体并行工作）
  registry.register(makeAgentCloneTool(
    (providerId) => providerId ? ctx.getProvider(providerId) : provider,
    ctx.getCloneModel,
    ctx.getCloneName,
  ));

  // Agent 增强工具
  registry.register(makeAgentGetCapabilityTool(files));
  registry.register(makeAgentUpdateCapabilityTool(files, provider, model));
  registry.register(makeAgentTaskAcceptTool(files));
  registry.register(makeAgentTaskReportTool(files));
  registry.register(makeAgentTaskCompleteTool(files, provider, model));
  registry.register(makeAgentReflectExperienceTool(files));
  registry.register(makeAgentProposeJobUpdateTool(files, provider, model));
  registry.register(makeAgentProposeCharacterUpdateTool(files, provider, model));
  registry.register(makeAgentProposeConfigUpdateTool(files, provider, model));
  registry.register(makeAgentRequestResourceTool());
}
