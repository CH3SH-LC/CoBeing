/**
 * onboarding 域 WS 命令 handler — 首启问卷
 * onboarding_apply / onboarding_get
 *
 * onboarding_apply：问卷答案（兴趣标签）→ 生成 1-2 个初始 Agent（复用 create_agent 链路）
 * + 返回 Market 官方资源轻量推荐（≤2 条，不自动安装）；onboarding_done 幂等标记 data/onboarding.json。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger, DEFAULT_PROVIDER, DEFAULT_MODEL, addAgentToRegistry } from "@cobeing/shared";
import type { AgentConfig, SandboxConfig } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { Agent } from "../../agent/agent.js";
import { AgentPaths, AgentFiles, createDefaultCapabilityCard } from "../../agent/paths.js";
import { ButlerRegistry } from "../../agent/butler-registry.js";
import { runAgentCreator } from "../../agent/tool-agent/creator.js";
import { DockerSandbox } from "../../tools/sandbox/docker-sandbox.js";
import type { MarketCatalog } from "../../market/catalog.js";
import type { HandlerRegistrar } from "./types.js";
import type { CoreWSServer } from "../ws-server.js";

const log = createLogger("ws-server");

/** 兴趣 → 角色映射表（内置） */
const INTEREST_ROLE_MAP: Record<string, string> = {
  生活: "家庭事务助理",
  学习: "学习监督员",
  旅行: "旅行规划师",
  购物: "购物顾问",
  创作: "写作编辑",
  家庭事务: "家庭事务助手",
  工作杂事: "资料整理员",
};

/** create_agent 同款默认工具白名单 */
const DEFAULT_TOOLS = ["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"];

/** create_agent 同款默认 sandbox（Docker 可用时启用） */
const DEFAULT_SANDBOX: SandboxConfig = { enabled: true, filesystem: "isolated", network: { enabled: true, mode: "all" } };

export interface OnboardingCreatedAgent {
  id: string;
  name: string;
  role: string;
}

export interface OnboardingMarketRecommendation {
  id: string;
  name: string;
  description: string;
  tier: string;
}

interface OnboardingMarker {
  done: boolean;
  createdAt: string;
  createdAgents: OnboardingCreatedAgent[];
  marketRecommendations: OnboardingMarketRecommendation[];
}

function markerPath(dataRoot: string): string {
  return path.join(dataRoot, "onboarding.json");
}

/** 读取幂等标记；不存在 / 损坏 / done!==true 一律视为未完成 */
function readMarker(dataRoot: string): OnboardingMarker | null {
  const p = markerPath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    if (data && typeof data === "object" && data.done === true) {
      return {
        done: true,
        createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
        createdAgents: Array.isArray(data.createdAgents) ? (data.createdAgents as OnboardingCreatedAgent[]) : [],
        marketRecommendations: Array.isArray(data.marketRecommendations)
          ? (data.marketRecommendations as OnboardingMarketRecommendation[])
          : [],
      };
    }
  } catch (err) {
    log.warn("Failed to parse onboarding marker %s: %s", p, (err as Error).message);
  }
  return null;
}

function writeMarker(dataRoot: string, marker: OnboardingMarker): void {
  const p = markerPath(dataRoot);
  if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmpPath = p + ".tmp." + Date.now();
  fs.writeFileSync(tmpPath, JSON.stringify(marker, null, 2), "utf-8");
  fs.renameSync(tmpPath, p);
}

/**
 * 单个初始 Agent 创建 — 照搬 create_agent (handlers/agent.ts) 的核心行为：
 * AgentPaths.ensureDirs → writeConfig → writeCapability → runAgentCreator（失败模板 fallback）
 * → new Agent → registry.register → 注入工具 → addAgentToRegistry → ButlerRegistry。
 */
async function createOnboardingAgent(
  this: CoreWSServer,
  spec: { name: string; role: string; providerId: string; modelId: string; provider: LLMProvider; sandboxConfig: SandboxConfig },
): Promise<OnboardingCreatedAgent> {
  const { name, role, providerId, modelId, provider, sandboxConfig } = spec;
  const id = name.toLowerCase().replace(/\s+/g, "-");

  const config: AgentConfig = {
    id,
    name,
    role,
    systemPrompt: `你是${name}，${role}`,
    provider: providerId,
    model: modelId,
    permissions: { mode: "workspace-readwrite" },
    sandbox: sandboxConfig,
    tools: DEFAULT_TOOLS,
  };

  // Write config to agent directory
  const agentPaths = AgentPaths.forAgent(id, this.dataRoot);
  agentPaths.ensureDirs();
  const agentFiles = new AgentFiles(agentPaths);
  agentFiles.writeConfig({
    name, role, provider: providerId, model: modelId,
    permissions: { mode: "workspace-readwrite" },
    sandbox: sandboxConfig,
    tools: DEFAULT_TOOLS,
  });
  agentFiles.writeCapability(createDefaultCapabilityCard({
    agentId: id,
    displayName: name,
    role,
    tools: config.tools,
  }));

  // 用 AgentCreator ToolAgent 生成核心文件（表达规范 + 工作范式；不再生成人物形象）
  const provided: Record<string, string> = {};
  const missingFields = ["expression", "job"] as const;

  try {
    const result = await runAgentCreator(provider, modelId, {
      name,
      role,
      fields: [...missingFields],
    });
    for (const field of missingFields) {
      if (result.files[field]) {
        provided[field] = result.files[field];
      }
    }
    log.info("AgentCreator generated files for %s: %s", id, missingFields.filter(f => result.files[f]).join(", "));
  } catch (err) {
    log.warn("AgentCreator generation failed for %s, falling back to templates: %s", id, err);
  }

  // 写入 LLM 生成的内容
  if (provided.expression) {
    fs.writeFileSync(path.join(agentPaths.directory, "EXPRESSION.md"), provided.expression, "utf-8");
  }
  if (provided.job) {
    fs.writeFileSync(path.join(agentPaths.directory, "JOB.md"), provided.job, "utf-8");
  }

  // 从模板复制其余文件（EXPRESSION, JOB, AGENTS, MEMORY, EXPERIENCE — 仅未生成或未写入的）
  const templatesDir = path.resolve("packages/core/src/templates/agent");
  const templateFiles = ["EXPRESSION.md", "JOB.md", "AGENTS.md", "MEMORY.md", "EXPERIENCE.md"];
  for (const tmplFile of templateFiles) {
    const dst = path.join(agentPaths.directory, tmplFile);
    if (!fs.existsSync(dst)) {
      const src = path.join(templatesDir, tmplFile);
      if (fs.existsSync(src)) {
        let content = fs.readFileSync(src, "utf-8");
        content = content.replace(/\{\{name\}\}/g, name).replace(/\{\{role\}\}/g, role);
        fs.writeFileSync(dst, content, "utf-8");
      }
    }
  }

  const agent = new Agent(config, provider, this.dataRoot);
  this.agentRegistry!.register(agent);

  // 注册 skills 和群组通信工具
  if (this.skillRepo) {
    agent.injectSkillRepository(this.skillRepo);
  }
  if (this.groupManager) {
    agent.injectGroupTools((gid) => this.groupManager!.get(gid));
  }
  if (this.agentRegistry) {
    agent.injectAgentMessageTool(this.agentRegistry);
  }
  // Set up provider fallback via runtime
  const runtime = (globalThis as any).__cobeing?.runtime;
  if (runtime?.providersMap) {
    agent.setAllProviders(runtime.providersMap);
  }

  // 更新 master registry（单一真相源）
  addAgentToRegistry(this.dataRoot, {
    id, name, role,
    status: "active",
    createdAt: new Date().toISOString(),
  });

  // Update ButlerRegistry
  const butlerReg = new ButlerRegistry(this.dataRoot);
  butlerReg.registerAgent({
    id, name, role,
    provider: providerId, model: modelId,
    systemPrompt: config.systemPrompt,
  });

  this.logMessage("system", `Agent created: ${name} (${id})`);
  this.broadcastState();
  return { id, name, role };
}

/**
 * Market 官方资源轻量推荐：按兴趣关键词搜 official tier，不足 2 条补 certified，
 * 聚合去重，总计 ≤2 条，不自动安装。
 */
function collectMarketRecommendations(
  catalog: MarketCatalog | null,
  interests: string[],
): OnboardingMarketRecommendation[] {
  if (!catalog) return [];
  const out: OnboardingMarketRecommendation[] = [];
  const seen = new Set<string>();
  const push = (id: string, name: string, description: string, tier: string) => {
    if (out.length >= 2 || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, description, tier });
  };
  for (const tier of ["official", "certified"] as const) {
    if (out.length >= 2) break;
    for (const kw of interests) {
      if (out.length >= 2) break;
      for (const r of catalog.search(kw, { tier })) {
        push(r.id, r.name, r.description, r.tier);
        if (out.length >= 2) break;
      }
    }
  }
  return out;
}

export function registerOnboardingHandlers(register: HandlerRegistrar): void {
  register("onboarding_apply", async function (ws, msg) {
    const { interests, note } = msg.payload as { interests?: unknown; note?: unknown };

    // 校验 interests 非空数组
    if (!Array.isArray(interests) || interests.length === 0) {
      this.sendToClient(ws, { type: "error", payload: { message: "interests 必须是非空数组" } });
      return;
    }
    const cleanInterests = [...new Set(
      interests.filter((i): i is string => typeof i === "string" && i.trim().length > 0).map(i => i.trim()),
    )];
    if (cleanInterests.length === 0) {
      this.sendToClient(ws, { type: "error", payload: { message: "interests 不能为空" } });
      return;
    }
    const customNote = typeof note === "string" && note.trim() ? note.trim() : undefined;

    // 幂等：已 done 则直接返回，不重复创建
    const existing = readMarker(this.dataRoot);
    if (existing) {
      this.sendToClient(ws, {
        type: "onboarding_result",
        payload: {
          status: "already_done",
          createdAgents: existing.createdAgents,
          marketRecommendations: existing.marketRecommendations,
        },
      });
      return;
    }

    // 兴趣 → 角色映射（自定义 note 优先作 role 描述）
    const mappedRoles = [...new Set(
      cleanInterests.map(i => INTEREST_ROLE_MAP[i]).filter((r): r is string => Boolean(r)),
    )];
    let specs: Array<{ name: string; role: string }>;
    if (customNote) {
      // 有自定义描述 → 只生成 1 个，note 作 role 描述；
      // name 在映射角色名候选中取第一个未被占用的 id（全部被占用 → error）
      const candidates = mappedRoles.length > 0 ? mappedRoles : ["个人助理"];
      const firstFree = candidates.find(c => {
        const cid = c.toLowerCase().replace(/\s+/g, "-");
        return !this.agentRegistry?.get(cid);
      });
      if (!firstFree) {
        this.sendToClient(ws, { type: "error", payload: { message: "候选角色名均已被占用，无法创建初始 Agent" } });
        return;
      }
      specs = [{ name: firstFree, role: customNote }];
    } else if (mappedRoles.length > 0) {
      // 无自定义 → 取 1-2 个映射角色
      specs = mappedRoles.slice(0, 2).map(r => ({ name: r, role: r }));
    } else {
      this.sendToClient(ws, { type: "error", payload: { message: "interests 未匹配到任何可用角色，请补充自定义描述 note" } });
      return;
    }

    // Provider 不可用 → error（不创建任何 Agent）
    const providerId = DEFAULT_PROVIDER;
    const modelId = DEFAULT_MODEL;
    const prov = this.providerResolver?.(providerId);
    if (!prov) {
      this.sendToClient(ws, {
        type: "onboarding_result",
        payload: { status: "error", message: `Provider not found: ${providerId}`, createdAgents: [], marketRecommendations: [] },
      });
      return;
    }
    if (!this.agentRegistry) {
      this.sendToClient(ws, {
        type: "onboarding_result",
        payload: { status: "error", message: "Agent registry not available", createdAgents: [], marketRecommendations: [] },
      });
      return;
    }

    // Docker 可用性检查（与 create_agent 一致：不可用则禁用 sandbox）
    let sandboxConfig: SandboxConfig = DEFAULT_SANDBOX;
    try {
      const dockerCheck = await DockerSandbox.checkDockerAvailable();
      if (!dockerCheck.available) {
        log.warn("Docker not available, sandbox disabled for onboarding agents: %s", dockerCheck.error);
        sandboxConfig = { ...DEFAULT_SANDBOX, enabled: false };
      }
    } catch (err) {
      log.warn("Docker check failed for onboarding agents: %s", err);
      sandboxConfig = { ...DEFAULT_SANDBOX, enabled: false };
    }

    // 逐个创建 Agent — 单个失败不阻塞其他
    const createdAgents: OnboardingCreatedAgent[] = [];
    const failures: string[] = [];
    for (const spec of specs) {
      const id = spec.name.toLowerCase().replace(/\s+/g, "-");
      if (this.agentRegistry.get(id)) {
        log.warn("Onboarding: agent already exists, skipped: %s", id);
        continue;
      }
      try {
        const created = await createOnboardingAgent.call(this, {
          name: spec.name,
          role: spec.role,
          providerId,
          modelId,
          provider: prov,
          sandboxConfig,
        });
        createdAgents.push(created);
      } catch (err) {
        log.error("Onboarding: failed to create agent %s (%s): %s", spec.name, id, err);
        failures.push(`${spec.name} (${id})`);
      }
    }

    const marketRecommendations = collectMarketRecommendations(this.marketCatalog, cleanInterests);

    if (createdAgents.length === 0) {
      // 全部失败 → 不写幂等标记，允许重试
      this.sendToClient(ws, {
        type: "onboarding_result",
        payload: {
          status: "error",
          message: failures.length > 0 ? `所有 Agent 创建失败: ${failures.join(", ")}` : "未创建任何 Agent",
          createdAgents: [],
          marketRecommendations,
        },
      });
      return;
    }

    // 幂等标记 data/onboarding.json
    const marker: OnboardingMarker = {
      done: true,
      createdAt: new Date().toISOString(),
      createdAgents,
      marketRecommendations,
    };
    try {
      writeMarker(this.dataRoot, marker);
      log.info("Onboarding completed: %d agents created (%s), %d recommendations", createdAgents.length, createdAgents.map(a => a.id).join(", "), marketRecommendations.length);
    } catch (err) {
      log.error("Failed to write onboarding marker: %s", err);
    }

    this.sendToClient(ws, {
      type: "onboarding_result",
      payload: { status: "done", createdAgents, marketRecommendations },
    });
  });

  register("onboarding_get", function (ws) {
    const marker = readMarker(this.dataRoot);
    if (!marker) {
      this.sendToClient(ws, {
        type: "onboarding_get_result",
        payload: { done: false, createdAgents: [], marketRecommendations: [] },
      });
      return;
    }
    this.sendToClient(ws, {
      type: "onboarding_get_result",
      payload: {
        done: marker.done,
        createdAt: marker.createdAt,
        createdAgents: marker.createdAgents,
        marketRecommendations: marker.marketRecommendations,
      },
    });
  });
}
