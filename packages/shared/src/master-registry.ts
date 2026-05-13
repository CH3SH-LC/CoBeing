/**
 * Master Registry — 统一的 Agent/Group 注册表
 *
 * 单一真相源：data/registry.json。
 * 优先级：registry.json > 文件系统。
 * 所有 Agent/Group 的 CRUD 必须先更新此文件，再操作文件系统。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";
import { rmDirRecursive } from "./fs-utils.js";

const log = createLogger("master-registry");

// ─── 类型 ───

export interface MasterAgentEntry {
  id: string;
  name: string;
  role: string;
  status: "active" | "inactive";
  createdAt: string;
}

export interface MasterGroupEntry {
  id: string;
  name: string;
  owner: string;
  members: string[];
  topic?: string;
  status: "active" | "completed" | "archived";
  createdAt: string;
}

export interface MasterRegistry {
  version: number;
  updatedAt: string;
  agents: Record<string, MasterAgentEntry>;
  groups: Record<string, MasterGroupEntry>;
}

// ─── 默认值 ───

function emptyRegistry(): MasterRegistry {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: {},
    groups: {},
  };
}

// ─── 路径 ───

function registryPath(dataRoot: string): string {
  return path.join(dataRoot, "registry.json");
}

// ─── 读/写 ───

export function readMasterRegistry(dataRoot: string): MasterRegistry {
  const rp = registryPath(dataRoot);
  if (!fs.existsSync(rp)) {
    log.info("No registry.json found — returning empty");
    return emptyRegistry();
  }
  try {
    const raw = fs.readFileSync(rp, "utf-8");
    const parsed = JSON.parse(raw) as MasterRegistry;
    if (!parsed.agents) parsed.agents = {};
    if (!parsed.groups) parsed.groups = {};
    // 防御：如果文件存在但内容损坏，不要返回空 registry（会导致所有目录被当作孤儿删除）
    if (Object.keys(parsed.agents).length === 0 && Object.keys(parsed.groups).length === 0 && raw.trim().length > 10) {
      log.error("Registry file exists but parsed empty — possible corruption, keeping file content");
      // 返回原始读取结果而非空 registry
    }
    return parsed;
  } catch (err: any) {
    log.error("Failed to read registry.json: %s — keeping existing (treating as empty to prevent data loss)", err.message);
    // 不要返回空 registry，这会导致所有目录被当作孤儿清理
    return emptyRegistry();
  }
}

export function writeMasterRegistry(dataRoot: string, registry: MasterRegistry): void {
  const rp = registryPath(dataRoot);
  const dir = path.dirname(rp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(rp, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

// ─── Agent 操作 ───

export function addAgentToRegistry(dataRoot: string, entry: MasterAgentEntry): void {
  const registry = readMasterRegistry(dataRoot);
  registry.agents[entry.id] = entry;
  writeMasterRegistry(dataRoot, registry);
  log.info("Agent added to registry: %s", entry.id);
}

export function removeAgentFromRegistry(dataRoot: string, agentId: string): void {
  const registry = readMasterRegistry(dataRoot);
  delete registry.agents[agentId];
  writeMasterRegistry(dataRoot, registry);
  log.info("Agent removed from registry: %s", agentId);
}

// ─── Group 操作 ───

export function addGroupToRegistry(dataRoot: string, entry: MasterGroupEntry): void {
  const registry = readMasterRegistry(dataRoot);
  registry.groups[entry.id] = entry;
  writeMasterRegistry(dataRoot, registry);
  log.info("Group added to registry: %s (%s)", entry.id, entry.name);
}

export function removeGroupFromRegistry(dataRoot: string, groupId: string): void {
  const registry = readMasterRegistry(dataRoot);
  delete registry.groups[groupId];
  writeMasterRegistry(dataRoot, registry);
  log.info("Group removed from registry: %s", groupId);
}

export function updateGroupMembers(dataRoot: string, groupId: string, members: string[]): void {
  const registry = readMasterRegistry(dataRoot);
  const entry = registry.groups[groupId];
  if (!entry) {
    log.warn("updateGroupMembers: group not found in registry: %s", groupId);
    return;
  }
  entry.members = members;
  writeMasterRegistry(dataRoot, registry);
  log.info("Group members updated in registry: %s (%d members)", groupId, members.length);
}

export function updateGroupStatus(
  dataRoot: string,
  groupId: string,
  status: "active" | "completed" | "archived",
): void {
  const registry = readMasterRegistry(dataRoot);
  const entry = registry.groups[groupId];
  if (!entry) {
    log.warn("updateGroupStatus: group not found in registry: %s", groupId);
    return;
  }
  entry.status = status;
  writeMasterRegistry(dataRoot, registry);
  log.info("Group status updated in registry: %s → %s", groupId, status);
}

// ─── 迁移：从文件系统生成 registry.json（首次启动时调用） ───

export function migrateFromFilesystem(dataRoot: string): MasterRegistry {
  const registry = emptyRegistry();

  // 扫描 data/agents/
  const agentsDir = path.join(dataRoot, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(agentsDir, entry.name, "config.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        registry.agents[entry.name] = {
          id: entry.name,
          name: config.name || entry.name,
          role: config.role || "unknown",
          status: "active",
          createdAt: new Date().toISOString(),
        };
      } catch {
        log.warn("Skipping unparseable agent config: %s", entry.name);
      }
    }
  }

  // 扫描 data/groups/
  const groupsDir = path.join(dataRoot, "groups");
  if (fs.existsSync(groupsDir)) {
    for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const configPath = path.join(groupsDir, entry.name, "config.json");
      if (!fs.existsSync(configPath)) continue;
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        // 跳过幽灵群组（空成员 + 无对话历史）
        if (!config.members || config.members.length === 0) {
          const contextPath = path.join(groupsDir, entry.name, "context.jsonl");
          if (!fs.existsSync(contextPath)) {
            log.warn("Skipping ghost group during migration: %s", entry.name);
            continue;
          }
        }
        registry.groups[entry.name] = {
          id: config.id || entry.name,
          name: config.name || entry.name,
          owner: config.owner || "host",
          members: config.members || [],
          topic: config.topic,
          status: config.status || "active",
          createdAt: new Date().toISOString(),
        };
      } catch {
        log.warn("Skipping unparseable group config: %s", entry.name);
      }
    }
  }

  // 确保 butler 和 host 在 registry 中
  if (!registry.agents["butler"]) {
    registry.agents["butler"] = {
      id: "butler", name: "Butler", role: "butler",
      status: "active", createdAt: new Date().toISOString(),
    };
  }
  if (!registry.agents["host"]) {
    registry.agents["host"] = {
      id: "host", name: "Host", role: "host",
      status: "active", createdAt: new Date().toISOString(),
    };
  }

  writeMasterRegistry(dataRoot, registry);
  log.info("Migrated from filesystem: %d agents, %d groups",
    Object.keys(registry.agents).length, Object.keys(registry.groups).length);
  return registry;
}

// ─── 孤儿目录清理（启动时调用） ───

/** 系统关键 Agent ID — 永不被清理，缺失时自动修复 */
const SYSTEM_AGENTS = new Set(["butler", "host"]);

export function cleanupOrphanDirectories(dataRoot: string): void {
  const registry = readMasterRegistry(dataRoot);
  // 若 registry 为空（无任何 agent 或 group），跳过清理以防误删
  if (Object.keys(registry.agents).length === 0 && Object.keys(registry.groups).length === 0) return;

  let modified = false;

  // 修复缺失的系统 Agent（而不是当作孤儿删除）
  for (const sysId of SYSTEM_AGENTS) {
    if (!registry.agents[sysId]) {
      log.warn("System agent missing from registry, repairing: %s", sysId);
      const sysDir = path.join(dataRoot, "agents", sysId);
      const configPath = path.join(sysDir, "config.json");
      let name = sysId === "butler" ? "Butler" : "Host";
      let role = sysId === "butler" ? "butler" : "host";
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          name = config.name || name;
          role = config.role || role;
        } catch { /* use defaults */ }
      }
      registry.agents[sysId] = {
        id: sysId,
        name,
        role,
        status: "active",
        createdAt: new Date().toISOString(),
      };
      modified = true;
    }
  }
  if (modified) writeMasterRegistry(dataRoot, registry);

  // 清理 data/agents/ 中的孤儿目录（有 config.json 的 → 收养；无的 → 删除）
  const agentsDir = path.join(dataRoot, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (SYSTEM_AGENTS.has(entry.name)) continue;
      if (!registry.agents[entry.name]) {
        const aConfigPath = path.join(agentsDir, entry.name, "config.json");
        if (fs.existsSync(aConfigPath)) {
          // 有 config.json → 收养（前次迁移遗漏的合法 Agent）
          try {
            const aConfig = JSON.parse(fs.readFileSync(aConfigPath, "utf-8"));
            log.warn("Adopting orphan agent into registry: %s", entry.name);
            registry.agents[entry.name] = {
              id: aConfig.id || entry.name,
              name: aConfig.name || entry.name,
              role: aConfig.role || "unknown",
              status: "active",
              createdAt: new Date().toISOString(),
            };
            modified = true;
          } catch {
            log.warn("Unparseable agent config, deleting orphan: %s", entry.name);
            try { rmDirRecursive(path.join(agentsDir, entry.name)); } catch { /* ignore */ }
          }
        } else {
          // 无 config.json → 真正的残留目录
          log.warn("Cleaning up orphan agent directory (no config.json): %s", entry.name);
          try {
            rmDirRecursive(path.join(agentsDir, entry.name));
          } catch (e: any) {
            log.error("Failed to delete orphan agent dir %s: %s", entry.name, e.message);
          }
        }
      }
    }
  }

  // 清理 data/groups/ 中的孤儿目录（有 config.json 的 → 收养；无的 → 删除）
  const groupsDir = path.join(dataRoot, "groups");
  if (fs.existsSync(groupsDir)) {
    for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!registry.groups[entry.name]) {
        const gConfigPath = path.join(groupsDir, entry.name, "config.json");
        if (fs.existsSync(gConfigPath)) {
          // 有 config.json → 收养
          try {
            const gConfig = JSON.parse(fs.readFileSync(gConfigPath, "utf-8"));
            // 跳过幽灵（空成员 + 无 history）
            if ((!gConfig.members || gConfig.members.length === 0) && !fs.existsSync(path.join(groupsDir, entry.name, "context.jsonl"))) {
              log.warn("Deleting ghost group directory: %s", entry.name);
              try { rmDirRecursive(path.join(groupsDir, entry.name)); } catch { /* ignore */ }
              continue;
            }
            log.warn("Adopting orphan group into registry: %s", entry.name);
            registry.groups[entry.name] = {
              id: gConfig.id || entry.name,
              name: gConfig.name || entry.name,
              owner: gConfig.owner || "host",
              members: gConfig.members || [],
              topic: gConfig.topic,
              status: gConfig.status || "active",
              createdAt: new Date().toISOString(),
            };
            modified = true;
          } catch {
            log.warn("Unparseable group config, deleting orphan: %s", entry.name);
            try { rmDirRecursive(path.join(groupsDir, entry.name)); } catch { /* ignore */ }
          }
        } else {
          // 无 config.json → 真正的残留目录
          log.warn("Cleaning up orphan group directory (no config.json): %s", entry.name);
          try {
            rmDirRecursive(path.join(groupsDir, entry.name));
          } catch (e: any) {
            log.error("Failed to delete orphan group dir %s: %s", entry.name, e.message);
          }
        }
      }
    }
  }

  // 清理 registry 中的幽灵群组（空成员 + 无对话历史 — 防止通过旧数据复活）
  for (const [groupId, groupEntry] of Object.entries(registry.groups)) {
    if (groupEntry.members.length === 0) {
      const groupDir = path.join(groupsDir, groupId);
      const contextFile = path.join(groupDir, "context.jsonl");
      if (!fs.existsSync(contextFile)) {
        log.warn("Removing ghost group from registry: %s (%s)", groupId, groupEntry.name);
        delete registry.groups[groupId];
        modified = true;
        // 尝试清理残留目录
        if (fs.existsSync(groupDir)) {
          try { rmDirRecursive(groupDir); } catch { /* ignore */ }
        }
      }
    }
  }
  if (modified) writeMasterRegistry(dataRoot, registry);
}
