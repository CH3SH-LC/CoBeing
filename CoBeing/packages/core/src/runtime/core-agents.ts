/**
 * 核心 Agent 创建辅助模块（从 runtime.ts 提取，行为不变）
 *
 * 职责：确保 host/butler 目录文件体系、创建管家（ButlerAgent + LLM Gateway）、
 * 注册预置 Agent（host 等）、注册群主增强工具、从 Master Registry 恢复持久化 Agent。
 */
import path from "node:path";
import fs from "node:fs";
import type { AppConfig, AgentSelfConfig } from "../config/schema.js";
import type { LLMProvider } from "@cobeing/providers";
import {
  createLogger, setGlobalLogLevel, readMasterRegistry, migrateFromFilesystem,
  cleanupOrphanDirectories, addAgentToRegistry, migratePermissionMode,
  DEFAULT_PROVIDER, DEFAULT_MODEL,
} from "@cobeing/shared";
import type { AgentConfig } from "@cobeing/shared";
import { AgentPaths } from "../agent/paths.js";
import { Agent } from "../agent/agent.js";
import { AgentRegistry } from "../agent/registry.js";
import { AgentEventBus } from "../agent/event-bus.js";
import { ButlerAgent, BUTLER_DEFAULT_TOOLS, BUTLER_DEFAULT_SYSTEM_PROMPT, stripButlerForbiddenTools } from "../agent/butler.js";
import { LLMGateway } from "../gateway/llm-gateway.js";
import { ChannelRouter } from "../group/router.js";
import { GroupManager } from "../group/manager.js";
import { SkillRepository } from "../skills/repository.js";
import type { ObservabilityDB } from "../observability/observability-db.js";
import { makeGroupPlanTool, makeGroupInviteTalkTool, makeGroupSummarizeTool, makeGroupAssignTaskTool } from "../group/owner.js";
import { ensureSandboxConfig } from "./sandbox-helper.js";

const log = createLogger("runtime");

/** 核心 Agent 创建域所需依赖（由 CoBeingRuntime 提供） */
export interface CoreAgentsDeps {
  config: AppConfig;
  dataRoot: string;
  registry: AgentRegistry;
  groupManager: GroupManager;
  eventBus: AgentEventBus;
  router: ChannelRouter;
  skillRepo: SkillRepository;
  providers: Map<string, LLMProvider>;
  observabilityDB: ObservabilityDB;
  /** Docker 可用性（启动时已检查缓存） */
  dockerAvailable: boolean;
}

/** 管家创建结果（写回 CoBeingRuntime） */
export interface ButlerCreateResult {
  butler: ButlerAgent;
  gateway: LLMGateway;
}

export class CoreAgentsLifecycle {
  constructor(private deps: CoreAgentsDeps) {}

  /** 读取管家自治配置（ensureButlerDir 首次启动可能刚写入 config.json，start 前需重读） */
  reloadButlerSelfConfig(): Partial<AgentSelfConfig> {
    const butlerPaths = AgentPaths.forAgent("butler", this.deps.dataRoot);
    let butlerSelfConfig: Partial<AgentSelfConfig> = {};
    if (fs.existsSync(butlerPaths.configPath)) {
      try {
        butlerSelfConfig = JSON.parse(fs.readFileSync(butlerPaths.configPath, "utf-8"));
      } catch {
        // config.json 损坏
      }
    }
    return butlerSelfConfig;
  }

  /**
   * 创建管家（在 loadAllPlugins 之后调用，确保插件 providers 可用）。
   * 返回 butler 与 gateway 供 runtime 写回。
   */
  createButler(butlerSelfConfig: Partial<AgentSelfConfig>): ButlerCreateResult {
    const { providers, registry, groupManager, router, config, dataRoot, skillRepo, observabilityDB } = this.deps;

    // 管家工具分级结构约束（决策 #1 / P2，对齐 host）：移除执行类工具 + 修复持久化 config.json
    if (butlerSelfConfig.tools && butlerSelfConfig.tools.length > 0) {
      const stripped = stripButlerForbiddenTools(butlerSelfConfig.tools);
      if (stripped.length < butlerSelfConfig.tools.length) {
        const removed = butlerSelfConfig.tools.length - stripped.length;
        log.warn("Butler config had %d forbidden execution tools — stripped at runtime", removed);
        butlerSelfConfig.tools = stripped;
        try {
          const butlerPaths = AgentPaths.forAgent("butler", dataRoot);
          const fixed = JSON.parse(fs.readFileSync(butlerPaths.configPath, "utf-8"));
          fixed.tools = stripButlerForbiddenTools(fixed.tools || []);
          fs.writeFileSync(butlerPaths.configPath, JSON.stringify(fixed, null, 2) + "\n", "utf-8");
          log.info("Butler config.json fixed: removed %d forbidden tools", removed);
        } catch { /* best effort */ }
      }
    }

    const butlerProviderId = butlerSelfConfig.provider || DEFAULT_PROVIDER;
    const butlerModel = butlerSelfConfig.model || DEFAULT_MODEL;
    const butlerProvider = providers.get(butlerProviderId);
    if (!butlerProvider) {
      throw new Error(`Provider not found: ${butlerProviderId}. Available: ${[...providers.keys()].join(", ")}`);
    }

    // 创建 LLM Gateway（全局必经链路：并发 + RPM + 超时 + 重试；provider 由调用方传入）
    const gateway = new LLMGateway({
      maxConcurrency: 5,
      rpmLimit: 60,
      timeout: 120000,
      retryAttempts: 3,
    });
    (globalThis as any).__cobeing.gateway = gateway;

    // 创建管家（systemPrompt 为短底座，人格/职责/转接规则由文件 prompt 承担：CHARACTER.md / JOB.md）
    const butler = new ButlerAgent({
      id: "butler",
      name: butlerSelfConfig.name || "管家",
      role: butlerSelfConfig.role || "CoBeing 管家",
      systemPrompt: butlerSelfConfig.systemPrompt || BUTLER_DEFAULT_SYSTEM_PROMPT,
      provider: butlerProviderId,
      model: butlerModel,
      permissions: (butlerSelfConfig.permissions as any) || { mode: "full-access" },
      sandbox: (butlerSelfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
      tools: butlerSelfConfig.tools || BUTLER_DEFAULT_TOOLS,
    }, butlerProvider, registry, groupManager, (providerId: string) => providers.get(providerId), router, config, dataRoot);

    // 注入 SkillRepository 到管家
    butler.injectSkillRepository(skillRepo);
    // 注入群组通信工具（group-send / group-update-progress / group-experience-add / group-experience-summarize）
    butler.injectGroupTools((gid) => groupManager.get(gid));
    // 设置 Provider 回落列表
    butler.setAllProviders(providers);
    butler.setObservabilityDB(observabilityDB);

    return { butler, gateway };
  }

  /** 确保 data/coreagents/butler/ 文件体系存在（首次启动创建全套，已存在不覆盖） */
  ensureButlerDir(): void {
    const butlerDir = path.join(this.deps.dataRoot, "coreagents", "butler");
    fs.mkdirSync(butlerDir, { recursive: true });

    // config.json — 不存在才写（已存在保留用户配置）
    const configPath = path.join(butlerDir, "config.json");
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({
        name: "管家",
        role: "CoBeing 管家",
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        permissions: { mode: "full-access" },
        sandbox: { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        tools: BUTLER_DEFAULT_TOOLS,
        skills: [],
      }, null, 2) + "\n", "utf-8");
      log.info("Butler config.json written (first start): %s", configPath);
    }

    // 模板根：项目根（源码树）优先，兼容 CWD=packages/core 与编译产物目录
    const templatesRoot = [
      path.resolve("packages/core/src/templates/butler"),
      path.resolve("src/templates/butler"),
      path.resolve("core/src/templates/butler"),
    ].find((p) => fs.existsSync(p));

    // base 三件套 + 默认人格（亲密朋友）两件套
    const seedFiles: Array<[string, string]> = [
      ["AGENTS.md", "base/AGENTS.md"],
      ["MEMORY.md", "base/MEMORY.md"],
      ["EXPERIENCE.md", "base/EXPERIENCE.md"],
      ["CHARACTER.md", "personas/亲密朋友/CHARACTER.md"],
      ["JOB.md", "personas/亲密朋友/JOB.md"],
    ];
    for (const [name, rel] of seedFiles) {
      const target = path.join(butlerDir, name);
      if (fs.existsSync(target)) continue; // 用户改过的人格/记忆/经验保留
      if (!templatesRoot) {
        log.warn("Butler templates root not found — skip creating %s", name);
        continue;
      }
      const src = path.join(templatesRoot, rel);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, target);
      log.info("Butler %s seeded from template: %s", name, target);
    }
  }

  /** 确保 data/coreagents/host/ 目录结构存在 */
  ensureHostDir(): void {
    const hostDir = path.join(this.deps.dataRoot, "coreagents", "host");
    fs.mkdirSync(hostDir, { recursive: true });

    const HOST_ALLOWED_TOOLS = [
      "group-plan", "group-invite-talk", "group-summarize", "group-assign-task",
      "host-guide-discussion", "host-decompose-task", "host-summarize-progress",
      "host-record-decision", "host-manage-todo", "host-review-todo",
      "host-invite-member", "host-remove-member", "host-set-screener-prompt", "host-manage-workspace",
      "talk-close",
      "todo-add", "todo-list", "todo-complete", "todo-remove", "todo-review",
      "todo-batch-complete", "todo-batch-remove", "todo-batch-update",
    ];
    const HOST_FORBIDDEN = ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"];

    const hostConfigPath = path.join(hostDir, "config.json");
    let needsRewrite = false;
    if (!fs.existsSync(hostConfigPath)) {
      needsRewrite = true;
    } else {
      // 检查已有 config 是否包含禁止的执行工具，有则修复
      try {
        const existing = JSON.parse(fs.readFileSync(hostConfigPath, "utf-8"));
        if (existing.tools && Array.isArray(existing.tools)) {
          const hasForbidden = existing.tools.some((t: string) => HOST_FORBIDDEN.includes(t));
          if (hasForbidden) {
            log.warn("Host config.json contains forbidden execution tools — will rewrite");
            needsRewrite = true;
          }
        }
      } catch { needsRewrite = true; }
    }
    if (needsRewrite) {
      fs.writeFileSync(hostConfigPath, JSON.stringify({
        name: "群主",
        role: "项目协调者和讨论引导者",
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        permissions: { mode: "full-access" },
        sandbox: { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        tools: HOST_ALLOWED_TOOLS,
        _note: "群主只能使用协调工具，执行类工具（bash/read-file/write-file 等）已被系统强制禁止",
      }, null, 2) + "\n", "utf-8");
      log.info("Host config.json written with coordination-only tools: %s", hostConfigPath);
    }

    // 从模板写入 HOST_JOB.md（始终同步，确保禁止执行工作的指令最新）
    const hostJobPath = path.join(hostDir, "JOB.md");
    const hostJobTemplate = path.resolve("packages/core/src/templates/host/HOST_JOB.md");
    if (fs.existsSync(hostJobTemplate)) {
      const content = fs.readFileSync(hostJobTemplate, "utf-8");
      fs.writeFileSync(hostJobPath, content, "utf-8");
      log.info("Host JOB.md synced from template: %s", hostJobPath);
    }

    // 人味表达规范（EXPRESSION.md，首次缺失时从 agent 模板复制；host 无角色，只约束说话方式）
    const hostExpressionPath = path.join(hostDir, "EXPRESSION.md");
    if (!fs.existsSync(hostExpressionPath)) {
      const exprTemplate = path.resolve("packages/core/src/templates/agent/EXPRESSION.md");
      if (fs.existsSync(exprTemplate)) {
        fs.copyFileSync(exprTemplate, hostExpressionPath);
        log.info("Host EXPRESSION.md created from template: %s", hostExpressionPath);
      }
    }

    for (const file of ["DECISIONS.md", "GROUPS_REGISTRY.md"]) {
      const filePath = path.join(hostDir, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `# ${file.replace(".md", "")}\n`, "utf-8");
      }
    }
  }

  /** 注册群主增强工具 */
  registerHostTools(agent: Agent): void {
    import("../group/host-tools.js").then(({
      makeHostGuideDiscussionTool,
      makeHostDecomposeTaskTool,
      makeHostSummarizeProgressTool,
      makeHostRecordDecisionTool,
      makeHostManageTodoTool,
      makeHostReviewTodoTool,
      makeHostInviteMemberTool,
      makeHostRemoveMemberTool,
      makeHostSetScreenerPromptTool,
      makeHostManageWorkspaceTool,
      makeHostReportEventTool,
    }) => {
      const groupGetter = (gid: string) => this.deps.groupManager.get(gid);
      const hostDataDir = path.join(this.deps.dataRoot, "coreagents", "host");

      agent.registerTool(makeHostGuideDiscussionTool(groupGetter));
      agent.registerTool(makeHostReportEventTool());
      agent.registerTool(makeHostDecomposeTaskTool(groupGetter, (input: any) => {
        const store = this.deps.groupManager.getGroupTodoStore(input.groupId);
        if (store) return store.add(input);
        return { id: "no-store", ...input };
      }, (todoId, depIds) => {
        // 从上下文获取 groupTodoStore 并设置依赖
        for (const g of this.deps.groupManager.list()) {
          const store = this.deps.groupManager.getGroupTodoStore(g.id);
          if (store && store.get(todoId)) {
            store.setDependsOn(todoId, depIds);
            return;
          }
        }
      }));
      agent.registerTool(makeHostSummarizeProgressTool(groupGetter));
      agent.registerTool(makeHostRecordDecisionTool(groupGetter, (gid, decision, reason) => {
        const decPath = path.join(hostDataDir, "DECISIONS.md");
        const entry = `\n## ${new Date().toISOString()}\n**群组**: ${gid}\n**决策**: ${decision}\n**理由**: ${reason}\n`;
        fs.appendFileSync(decPath, entry, "utf-8");
      }));
      agent.registerTool(makeHostManageTodoTool(
        (gid, status) => this.deps.groupManager.getGroupTodoStore(gid)?.list(status as any) ?? [],
        async (todoId, updates) => {
          // 遍历所有群组找到包含该 TODO 的 store
          for (const g of this.deps.groupManager.list()) {
            const store = this.deps.groupManager.getGroupTodoStore(g.id);
            if (store) {
              const item = store.get(todoId);
              if (item) {
                if (updates.status === "completed") return this.deps.groupManager.completeGroupTodo(g.id, todoId);
                return item;
              }
            }
          }
          return undefined;
        },
        (todoId) => {
          for (const g of this.deps.groupManager.list()) {
            const store = this.deps.groupManager.getGroupTodoStore(g.id);
            if (store && store.remove(todoId)) return true;
          }
          return false;
        },
      ));
      agent.registerTool(makeHostReviewTodoTool(
        (gid) => this.deps.groupManager.getGroupTodoStore(gid)?.getDueTodos() ?? [],
      ));
      agent.registerTool(makeHostInviteMemberTool(groupGetter));
      agent.registerTool(makeHostRemoveMemberTool(groupGetter));
      agent.registerTool(makeHostSetScreenerPromptTool(groupGetter));
      agent.registerTool(makeHostManageWorkspaceTool(groupGetter));

      log.info("Host-enhanced tools registered for agent: %s", agent.id);
    }).catch(err => {
      log.warn("Failed to register host tools: %s", err.message);
    });
  }
}

/** 从 Master Registry 恢复已持久化的 Agent（优先从 config.json 读取自治配置） */
export function restoreAgents(deps: CoreAgentsDeps): void {
  const { dataRoot, registry, providers, eventBus, skillRepo, groupManager, observabilityDB, config, dockerAvailable } = deps;
  const reg = readMasterRegistry(dataRoot);
  const agentEntries = Object.values(reg.agents);

  for (const entry of agentEntries) {
    // 跳过已注册的（如 butler 本身）
    if (registry.get(entry.id)) continue;
    // 跳过 inactive 的 Agent
    if (entry.status === "inactive") continue;

    // 尝试从 agent 目录读取自治配置
    const paths = AgentPaths.forAgent(entry.id, dataRoot);
    migratePermissionMode(path.dirname(paths.configPath));
    let selfConfig: Record<string, any> = {};
    if (fs.existsSync(paths.configPath)) {
      try {
        const raw = fs.readFileSync(paths.configPath, "utf-8");
        selfConfig = JSON.parse(raw);
      } catch {
        // config.json 损坏
      }
    }

    const providerId = selfConfig.provider || DEFAULT_PROVIDER;
    const model = selfConfig.model || DEFAULT_MODEL;
    const provider = providers.get(providerId) ?? providers.get(DEFAULT_PROVIDER);

    if (!provider) {
      log.warn("Skipping agent %s: no provider %s", entry.id, providerId);
      continue;
    }

    const agentConfig: AgentConfig = {
      id: entry.id,
      name: selfConfig.name || entry.name || entry.id,
      role: selfConfig.role || entry.role,
      systemPrompt: selfConfig.systemPrompt || `你是${entry.name}，${entry.role}`,
      provider: providerId,
      model,
      permissions: (selfConfig.permissions as any) || { mode: "workspace-readwrite" },
      sandbox: ensureSandboxConfig(
        (selfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        dockerAvailable,
      ),
      tools: selfConfig.tools || ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"],
      skills: selfConfig.skills,
      maxToolRounds: config.core.maxToolRounds,
    };

    try {
      const agent = new Agent(agentConfig, provider, dataRoot);
      agent.subscribeToBus(eventBus);
      agent.injectSkillRepository(skillRepo);
      agent.injectGroupTools((gid) => groupManager.get(gid));
      agent.injectAgentMessageTool(registry);
      agent.setAllProviders(providers);
      agent.setObservabilityDB(observabilityDB);
      registry.register(agent);
      log.info("Restored agent: %s (%s) [from master registry]", agentConfig.name, entry.id);
    } catch (err: any) {
      log.warn("Failed to restore agent %s: %s", entry.id, err.message);
    }
  }
}

/** 确保 master registry 存在（首次启动从文件系统迁移）+ 恢复持久化 Agent + 注册预置 Agent */
export function restoreRegistryState(deps: CoreAgentsDeps, lifecycle: CoreAgentsLifecycle): void {
  const { dataRoot } = deps;
  // 确保 master registry 存在（首次启动从文件系统迁移）
  const rp = path.join(dataRoot, "registry.json");
  if (!fs.existsSync(rp)) {
    log.info("No registry.json found — migrating from filesystem");
    migrateFromFilesystem(dataRoot);
  }

  // Clean registry/directory drift before restore, otherwise stale registry
  // entries can recreate manually deleted agents/groups as ghosts.
  cleanupOrphanDirectories(dataRoot);

  // 从 Master Registry 恢复已持久化的 Agent
  restoreAgents(deps);

  // Register pre-built agents (e.g., HostAgent)
  registerPrebuiltAgents(deps, lifecycle);
}

/** Register pre-built agents from config.agents ID list (e.g., host) */
export function registerPrebuiltAgents(deps: CoreAgentsDeps, lifecycle: CoreAgentsLifecycle): void {
  const { config, dataRoot, registry, providers, eventBus, skillRepo, groupManager, observabilityDB, dockerAvailable } = deps;
  const agentIds = config.agents || [];

  for (const agentId of agentIds) {
    if (registry.get(agentId)) continue;
    if (agentId === "butler") continue; // butler handled separately

    // Load self-config from data/agents/{id}/config.json
    const agentPaths = AgentPaths.forAgent(agentId, dataRoot);
    migratePermissionMode(path.dirname(agentPaths.configPath));
    if (!fs.existsSync(agentPaths.configPath)) {
      log.warn("Skipping agent %s: no config.json at %s", agentId, agentPaths.configPath);
      continue;
    }

    let selfConfig: Partial<AgentSelfConfig> = {};
    try {
      selfConfig = JSON.parse(fs.readFileSync(agentPaths.configPath, "utf-8"));
    } catch (err: any) {
      log.warn("Skipping agent %s: invalid config.json: %s", agentId, err.message);
      continue;
    }

    // 强制禁止群主使用执行类工具：群主只能协调，不能自己执行工作
    if (agentId === "host" && selfConfig.tools) {
      const HOST_FORBIDDEN_TOOLS = [
        "bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch",
        "agent-message",
      ];
      const originalCount = selfConfig.tools.length;
      selfConfig.tools = selfConfig.tools.filter((t: string) => !HOST_FORBIDDEN_TOOLS.includes(t));
      if (selfConfig.tools.length < originalCount) {
        const removed = originalCount - selfConfig.tools.length;
        log.warn("Host config had %d forbidden execution tools — stripped at runtime", removed);
        // 修复持久化的 config.json，防止下次再包含执行工具
        try {
          const fixed = { ...JSON.parse(fs.readFileSync(agentPaths.configPath, "utf-8")) };
          fixed.tools = fixed.tools.filter((t: string) => !HOST_FORBIDDEN_TOOLS.includes(t));
          fs.writeFileSync(agentPaths.configPath, JSON.stringify(fixed, null, 2) + "\n", "utf-8");
          log.info("Host config.json fixed: removed %d forbidden tools", removed);
        } catch { /* best effort */ }
      }
    }

    const providerId = selfConfig.provider || DEFAULT_PROVIDER;
    const provider = providers.get(providerId);
    if (!provider) {
      log.warn("Skipping agent %s: no provider %s", agentId, providerId);
      continue;
    }

    const agent = new Agent({
      id: agentId,
      name: selfConfig.name || agentId,
      role: selfConfig.role || "",
      systemPrompt: agentId === "host"
        ? `你是群主，唯一职责是协调群组成员。你绝对不能亲自执行任何具体工作。

🚫 **绝对禁令（违反将导致群组失败）**：
你没有任何执行类工具（bash、read-file、write-file、edit-file、glob、grep、web-fetch 等），
系统层面已强制移除。即使你以为可以调用，这些工具对你不可用。
- 永远不要试图自己写代码、改文件、读文件、运行命令
- 永远不要尝试使用不存在的执行工具
- 缺少专业 Agent 时，向用户/管家申请创建，禁止自己顶上

✅ **你唯一能做的事**：
- @mention 委派：使用 group-send @memberAgent 将具体工作分配给专业成员
- 任务管理：使用 host-decompose-task / host-manage-todo / host-review-todo 管理 TODO
- 进度追踪：使用 host-summarize-progress / group-update-progress 跟踪进展
- 决策记录：使用 host-record-decision 记录关键决策
- 成员管理：使用 host-invite-member / host-remove-member 调整成员
- 讨论引导：使用 host-guide-discussion 组织讨论
- 工作空间：使用 host-manage-workspace 维护群组文档
- 群组工具：使用 group-plan / group-assign-task / group-invite-talk / group-summarize

⚠️ 每次收到任务时，第一反应必须是"分配给谁做"，而不是"我来做"。`
        : (selfConfig.systemPrompt || `你是${selfConfig.name}，${selfConfig.role}`),
      provider: providerId,
      model: selfConfig.model || DEFAULT_MODEL,
      permissions: (selfConfig.permissions as any) || { mode: "workspace-readwrite" },
      sandbox: ensureSandboxConfig(
        (selfConfig.sandbox as any) || { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } },
        dockerAvailable,
      ),
      tools: selfConfig.tools,
      maxToolRounds: config.core.maxToolRounds,
    }, provider, dataRoot);

    agent.subscribeToBus(eventBus);
    agent.injectSkillRepository(skillRepo);
    // 注入群组通信工具（所有 Agent 都需要）
    agent.injectGroupTools((gid) => groupManager.get(gid));
    agent.injectAgentMessageTool(registry);
    agent.setAllProviders(providers);
    agent.setObservabilityDB(observabilityDB);

    // 注册群主专属工具（owner tools）
    if (selfConfig.tools?.some((t: string) => ["group-plan", "group-invite-talk", "group-summarize", "group-assign-task"].includes(t))) {
      const groupGetter = (gid: string) => groupManager.get(gid);
      agent.registerTool(makeGroupPlanTool(groupGetter));
      agent.registerTool(makeGroupInviteTalkTool(groupGetter));
      agent.registerTool(makeGroupSummarizeTool(groupGetter));
      agent.registerTool(makeGroupAssignTaskTool(groupGetter));
    }

    // 注册 host-* 增强工具（群主专用）
    if (agentId === "host") {
      lifecycle.registerHostTools(agent);
    }

    registry.register(agent);
    // 确保 agent 在 master registry 中
    if (!readMasterRegistry(dataRoot).agents[agentId]) {
      addAgentToRegistry(dataRoot, {
        id: agentId,
        name: selfConfig.name || agentId,
        role: selfConfig.role || "",
        status: "active",
        createdAt: new Date().toISOString(),
      });
    }
    log.info("Pre-built agent registered: %s (%s)", selfConfig.name || agentId, agentId);
  }
}
