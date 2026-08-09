/**
 * ButlerAgent — privileged agent that manages other agents and groups
 */
import type { AgentConfig } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import type { AppConfig } from "../config/schema.js";
import path from "node:path";
import { Agent } from "./agent.js";
import { AgentRegistry } from "./registry.js";
import type { GroupManager } from "../group/manager.js";
import { ConversationLoop } from "../conversation/conversation-loop.js";
import { PermissionEnforcer } from "../tools/permission.js";
import { ToolExecutor } from "../tools/executor.js";
import { makeGroupMembersTool, makeTalkCreateTool, makeTalkSendTool, makeTalkReadTool, makeGroupSendTool } from "../tools/group-tools.js";
import { ButlerRegistry } from "./butler-registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { makeTodoAddTool, makeTodoListTool, makeTodoCompleteTool, makeTodoRemoveTool, makeTodoReviewTool } from "../todo/tools.js";
import {
  makeGlobalTodoAddTool,
  makeGlobalTodoListTool,
  makeGlobalTodoUpdateTool,
  makeGlobalTodoLinkExecutionTool,
  makeGlobalTodoContinueTool,
} from "../todo/global-tools.js";
import { makeCreateAgentTool, makeDestroyAgentTool, makeModifyAgentTool, makeFindAgentTool } from "./butler/tools/agent-tools.js";
import { makeCreateGroupTool, makeDestroyGroupTool, makeAddToGroupTool, makeRunGroupTool, makeCheckGroupTool } from "./butler/tools/group-tools.js";
import { makeBindWorkspaceTool, makeListTool } from "./butler/tools/workspace-tools.js";
import { makeChannelBindTool, makeChannelUnbindTool } from "./butler/tools/channel-tools.js";
import { makeReadRegistryTool, makeUpdateRegistryTool } from "./butler/tools/registry-tools.js";
import { makeWorkflowAnalyzeTool, makeWorkflowPlanTool } from "./butler/tools/workflow-tools.js";
import { makeDispatchToAgentTool, makeDispatchToGroupTool, makeGetWorkStatusTool, makeCancelWorkTool, makeReplyToGroupTool, makeDispatchTaskTool } from "./butler/tools/dispatch-tools.js";
import { makeReviewProposalsTool } from "./butler/tools/review-tools.js";
import { makeMarketRecommendTool, makeMarketInstallTool } from "../market/tools.js";
import { makeListPersonasTool, makeSetPersonaTool, makeUpdateStyleTool } from "./butler/tools/persona-tools.js";
import { buildLocalResources } from "../market/catalog.js";
import { buildCacheablePrompt } from "../conversation/prompt-builder.js";

// ---- Butler 常量 ----

/** 管家默认系统提示（短底座）— 人格/职责/转接规则由文件 prompt 承担（CHARACTER.md / JOB.md） */
export const BUTLER_DEFAULT_SYSTEM_PROMPT = `你是管家，用户的第一联系人，负责与用户对话、管理 Agent 与群组。
你的说话风格由 CHARACTER.md 定义，职责、分级转接规则与多步推理流程由 JOB.md 定义——按文件行事，不要自行发明规则。`;

/**
 * 管家禁止的执行类工具 — 结构约束（决策 #1 / P2 管家工具分级）。
 * 管家靠协调/派发工作，不亲自执行：移除 bash（执行命令）、edit-file（编辑）、
 * glob/grep（全盘扫描 — 陈默专项曾致管家 grep 扫描大目录 OOM）。
 * 保留 read-file/write-file：用户个人事务（日程/购物清单 md）走本地文件。
 */
export const BUTLER_FORBIDDEN_TOOLS: readonly string[] = ["bash", "edit-file", "glob", "grep"];

/** 运行时过滤管家禁止工具（对齐 host 结构约束），返回过滤后的清单 */
export function stripButlerForbiddenTools(tools: string[]): string[] {
  return tools.filter((t) => !BUTLER_FORBIDDEN_TOOLS.includes(t));
}

/** 管家默认工具白名单 — ensureButlerDir 写入 config.json，runtime createButler 兜底共用 */
export const BUTLER_DEFAULT_TOOLS: string[] = [
  "read-file", "write-file",
  "butler-create-agent", "butler-destroy-agent",
  "butler-create-group", "butler-destroy-group",
  "butler-list", "butler-run-group", "butler-add-to-group",
  "butler-read-registry", "butler-update-registry", "butler-check-group", "butler-modify-agent",
  "butler-bind-workspace",
  "butler-list-personas", "butler-set-persona", "butler-update-style",
  "group-members", "talk-create", "talk-send", "talk-read", "talk-close",
  "group-send", "group-update-progress",
  "group-experience-add", "group-experience-summarize",
];

// ---- ButlerAgent ----

export class ButlerAgent extends Agent {
  readonly butlerRegistry: ButlerRegistry;

  constructor(
    config: AgentConfig,
    provider: LLMProvider,
    registry: AgentRegistry,
    groupManager: GroupManager,
    providerResolver?: (providerId: string) => LLMProvider | undefined,
    router?: import("../group/router.js").ChannelRouter,
    appConfig?: AppConfig,
    runtimeDataRoot?: string,
  ) {
    super(config, provider, runtimeDataRoot);

    // 初始化 ButlerRegistry
    this.butlerRegistry = new ButlerRegistry();

    // 工作流引擎
    const engine = new WorkflowEngine({
      provider,
      butlerRegistry: this.butlerRegistry,
      agentRegistry: registry,
      groupManager,
    });

    // Register butler tools
    const bsDataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeCreateAgentTool(registry, () => provider, this.butlerRegistry, providerResolver));
    this.toolRegistry.register(makeDestroyAgentTool(registry, this.butlerRegistry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeCreateGroupTool(groupManager, this.butlerRegistry, registry));
    this.toolRegistry.register(makeDestroyGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeBindWorkspaceTool(registry));
    this.toolRegistry.register(makeListTool(registry, groupManager));
    this.toolRegistry.register(makeRunGroupTool(groupManager, this.butlerRegistry));
    this.toolRegistry.register(makeAddToGroupTool(groupManager, this.butlerRegistry, registry));

    // 新增管家工具
    this.toolRegistry.register(makeReadRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeUpdateRegistryTool(this.butlerRegistry));
    this.toolRegistry.register(makeModifyAgentTool(registry));
    this.toolRegistry.register(makeCheckGroupTool(groupManager));

    // Register channel binding tools
    if (router) {
      this.toolRegistry.register(makeChannelBindTool(router, groupManager));
      this.toolRegistry.register(makeChannelUnbindTool(router));
    }

    // Register group communication tools
    this.toolRegistry.register(makeGroupMembersTool(
      (gid) => groupManager.get(gid),
      (id) => registry.get(id)?.name ?? id,
    ));
    this.toolRegistry.register(makeTalkCreateTool((gid) => groupManager.get(gid)));
    this.toolRegistry.register(makeTalkSendTool((gid) => groupManager.get(gid)));
    this.toolRegistry.register(makeTalkReadTool((gid) => groupManager.get(gid)));
    this.toolRegistry.register(makeGroupSendTool((gid) => groupManager.get(gid)));

    // 工作流工具
    this.toolRegistry.register(makeWorkflowAnalyzeTool(engine));
    this.toolRegistry.register(makeWorkflowPlanTool(engine));

    // Persona 工具 — 对话式收集用户对管家的喜好后切换人格 / 记录偏好
    this.toolRegistry.register(makeListPersonasTool());
    this.toolRegistry.register(makeSetPersonaTool(bsDataRoot));
    this.toolRegistry.register(makeUpdateStyleTool(bsDataRoot));

    // TODO 工具
    const dataRoot = path.dirname(path.dirname(this.paths.directory));
    this.toolRegistry.register(makeTodoAddTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoListTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoCompleteTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid), (gid) => groupManager.getScanner?.(gid)));
    this.toolRegistry.register(makeTodoRemoveTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid)));
    this.toolRegistry.register(makeTodoReviewTool(dataRoot, (gid) => groupManager.getGroupTodoStore?.(gid), (gid) => groupManager.getScanner?.(gid)));

    // Global TODO 编排工具（Phase 2）
    const globalTodoStore = (globalThis as any).__cobeing?.runtime?.globalTodoStore;
    if (globalTodoStore) {
      this.toolRegistry.register(makeGlobalTodoAddTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoListTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoUpdateTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoLinkExecutionTool(globalTodoStore));
      this.toolRegistry.register(makeGlobalTodoContinueTool(globalTodoStore));
    }

    // Market 分级工具：官方/认证资源轻量推荐，社区资源必须向用户确认
    const marketCatalog = (globalThis as any).__cobeing?.runtime?.marketCatalog;
    const marketInstaller = (globalThis as any).__cobeing?.runtime?.marketInstaller;
    if (marketCatalog && marketInstaller) {
      this.toolRegistry.register(makeMarketRecommendTool(marketCatalog, {
        dataRoot: bsDataRoot,
        listLocalResources: () => {
          const reg = (globalThis as any).__cobeing?.agentRegistry;
          const agents = (reg && typeof reg.list === "function" ? reg.list() : []).filter(
            (a: { id: string }) => a.id !== "butler" && a.id !== "host",
          ).map((a: any) => ({ id: a.id, name: a.name, role: a.config?.role as string | undefined }));
          const skills = (globalThis as any).__cobeing?.skillRepo?.list?.() ?? [];
          return buildLocalResources(agents, skills.map((s: any) => ({ name: s.name, description: s.description })));
        },
      }));
      this.toolRegistry.register(makeMarketInstallTool(marketCatalog, marketInstaller));
    }

    // Agent Enhancement — Butler tools
    this.toolRegistry.register(makeFindAgentTool(registry, bsDataRoot, provider, config.model));
    this.toolRegistry.register(makeDispatchToAgentTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeDispatchToGroupTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeGetWorkStatusTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeCancelWorkTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeReplyToGroupTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeDispatchTaskTool(registry, groupManager, bsDataRoot));
    this.toolRegistry.register(makeReviewProposalsTool(bsDataRoot));

    // Re-create conversation loop with updated tools
    const perm = new PermissionEnforcer({ mode: "full-access" }, undefined, this.paths.workspaceDir);
    const executor = new ToolExecutor(this.toolRegistry, perm);
    this.conversationLoop = new ConversationLoop({
      agentConfig: {
        name: config.name,
        role: config.role,
        systemPrompt: config.systemPrompt,
        model: config.model,
      },
      provider,
      tools: this.toolRegistry.listDefinitions(),
      toolExecutor: executor,
      agentId: config.id,
      sessionId: "butler",
      workingDir: this.effectiveWorkspace,
      maxToolRounds: appConfig?.core?.butlerMaxToolRounds ?? config.maxToolRounds,
      // 管家走文件 prompt：AGENTS/CHARACTER/JOB/EXPERIENCE/MEMORY 每次 run() 实时组装，
      // 人格切换（butler_set_persona）与 style 更新（butler_update_style）即时生效。
      promptBuilder: () => this.buildButlerPrompt(),
    });

    // Register self
    if (!registry.get(config.id)) {
      registry.register(this);
    }
  }

  /**
   * 管家 prompt 组装（三层架构，与 Agent.createLoop 的 promptBuilder 同构）：
   * 共享前缀（STATIC + AGENTS.md）→ 人格前缀（CHARACTER + ROLE_PLAY + systemPrompt + JOB）→
   * 易失层（EXPERIENCE.md 概要 + MEMORY.md 索引）+ 插件 Prompt 层。
   * 每次 run() 实时读取文件，人格切换/样式更新无需重建 loop。
   */
  private buildButlerPrompt(): string {
    const { sharedPrefix, agentPrefix, volatile } = buildCacheablePrompt(
      this.files,
      { name: this.name, role: this.config.role, systemPrompt: this.config.systemPrompt },
    );
    const parts = [sharedPrefix, agentPrefix];
    if (volatile) parts.push(volatile);
    const promptLayers = (globalThis as any).__cobeingPromptLayers;
    if (promptLayers) {
      const pluginContent = promptLayers.build({ agentId: this.id });
      if (pluginContent) parts.push(pluginContent);
    }
    return parts.join("\n\n");
  }
}
