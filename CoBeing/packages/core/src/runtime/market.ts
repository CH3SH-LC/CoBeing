/**
 * Market 分级服务辅助模块（从 runtime.ts 提取，行为不变）
 *
 * 职责：确保 data/market/<tier>/ 目录、首次启动同步 bundled 内置资源、
 * 重扫 catalog；Market 安装 Agent/Group 的注册/销毁钩子。
 */
import path from "node:path";
import fs from "node:fs";
import type { AgentConfig } from "@cobeing/shared";
import { DEFAULT_PROVIDER, DEFAULT_MODEL, createLogger } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { Agent } from "../agent/agent.js";
import { AgentRegistry } from "../agent/registry.js";
import { ButlerRegistry } from "../agent/butler-registry.js";
import { GroupManager } from "../group/manager.js";
import { SkillRepository } from "../skills/repository.js";
import type { MarketCatalog } from "../market/catalog.js";
import type { MarketInstaller } from "../market/installer.js";

const log = createLogger("runtime");

/** Market 服务域所需依赖（由 CoBeingRuntime 提供） */
export interface MarketDeps {
  dataRoot: string;
  registry: AgentRegistry;
  groupManager: GroupManager;
  skillRepo: SkillRepository;
  providers: Map<string, LLMProvider>;
  marketCatalog: MarketCatalog;
  marketInstaller: MarketInstaller;
}

/** 确保 data/market/<tier>/ 目录结构（official/certified/community） */
export function ensureMarketDirs(dataRoot: string): void {
  for (const tier of ["official", "certified", "community"]) {
    fs.mkdirSync(path.join(dataRoot, "market", tier), { recursive: true });
  }
}

/** 首次启动时把 packages/core/src/market/bundled/ 内置资源同步到 data/market/（已存在不覆盖） */
export function syncBundledMarketResources(dataRoot: string): void {
  const bundledRoot = path.resolve("packages/core/src/market/bundled");
  if (!fs.existsSync(bundledRoot)) {
    log.debug("Bundled market resources not found at %s, skipping sync", bundledRoot);
    return;
  }
  for (const tier of ["official", "certified", "community"]) {
    const tierDir = path.join(bundledRoot, tier);
    if (!fs.existsSync(tierDir)) continue;
    for (const id of fs.readdirSync(tierDir)) {
      const srcDir = path.join(tierDir, id);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(dataRoot, "market", tier, id);
      if (fs.existsSync(dstDir)) continue;
      try {
        fs.cpSync(srcDir, dstDir, { recursive: true });
        log.info("Market bundled resource synced: %s/%s", tier, id);
      } catch (err) {
        log.warn("Failed to sync bundled market resource %s/%s: %s", tier, id, err);
      }
    }
  }
}

/** 初始化 Market 分级服务：确保目录 + 同步内置资源 + 重扫 catalog */
export function initMarketServices(deps: MarketDeps): void {
  const { dataRoot, marketCatalog } = deps;
  ensureMarketDirs(dataRoot);
  syncBundledMarketResources(dataRoot);
  marketCatalog.reload();
  log.info("Market catalog loaded: %d resources, %d installed",
    marketCatalog.list().length, marketCatalog.getInstalled().length);
}

/** Market 安装 Agent 后的注册钩子：读取 config.json 并注册 Agent 实例 */
export function registerMarketAgent(deps: MarketDeps, id: string, dir: string): void {
  const { registry, providers, dataRoot } = deps;
  if (registry.get(id)) return;
  const cfgPath = path.join(dir, "config.json");
  if (!fs.existsSync(cfgPath)) {
    log.warn("Market agent %s has no config.json, skipped registration", id);
    return;
  }
  let cfg: Record<string, any>;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch (err) {
    log.warn("Market agent %s config.json invalid: %s", id, err);
    return;
  }
  const providerId = cfg.provider || DEFAULT_PROVIDER;
  const prov = providers.get(providerId);
  if (!prov) {
    log.warn("Market agent %s provider %s not found, skipped registration", id, providerId);
    return;
  }
  const config: AgentConfig = {
    id,
    name: cfg.name || id,
    role: cfg.role || "",
    systemPrompt: cfg.systemPrompt || `你是${cfg.name || id}，${cfg.role || "专业智能体"}`,
    provider: providerId,
    model: cfg.model || DEFAULT_MODEL,
    permissions: cfg.permissions || { mode: "workspace-readwrite" },
    sandbox: cfg.sandbox,
    tools: cfg.tools,
    skills: cfg.skills,
  };
  const agent = new Agent(config, prov, dataRoot);
  registry.register(agent);
  log.info("Market agent registered: %s", id);
}

/** Market 安装群组后的钩子：创建群组并写入 ButlerRegistry */
export function createMarketGroup(deps: MarketDeps, id: string, name: string, memberIds: string[], topic?: string): void {
  const { registry, groupManager, dataRoot } = deps;
  if (groupManager.get(id)) return;
  const allMembers = ["host", ...memberIds.filter((m) => m !== "host")];
  groupManager.create({ id, name, members: allMembers, owner: "host", topic });
  for (const memberId of allMembers) {
    const mAgent = registry.get(memberId);
    if (mAgent) {
      mAgent.injectGroupTools((gid) => groupManager.get(gid));
    }
  }
  const butlerReg = new ButlerRegistry(dataRoot);
  butlerReg.registerGroup({ id, name, members: allMembers });
  log.info("Market group created: %s (%s)", name, id);
}

/** Market 卸载群组后的钩子 */
export function destroyMarketGroup(deps: MarketDeps, id: string): void {
  const { groupManager } = deps;
  if (groupManager.get(id)) {
    groupManager.delete(id);
    log.info("Market group destroyed: %s", id);
  }
}
