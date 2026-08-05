/**
 * MarketCatalog — 市场资源目录
 *
 * 扫描 `dataRoot/market/<tier>/<id>/market.json`（tier ∈ official/certified/community），
 * 资源目录内除 market.json 外的所有文件视为载荷（payload），安装时整体复制。
 * 安装状态持久化于 `dataRoot/market/installed.json`（`{ "<id>": InstalledEntry }`）。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type { InstalledEntry, MarketResource, MarketResourceType, MarketTier } from "./types.js";

const log = createLogger("market-catalog");

/** 扫描层：官方 / 官方认证 / 社区（local 为运行时合成，不落盘扫描） */
const SCAN_TIERS: MarketTier[] = ["official", "certified", "community"];

/** 资源 id 合法格式（与 WS handler 一致：字母数字下划线开头，仅 \w 与连字符） */
export const RESOURCE_ID_PATTERN = /^[\w][\w\-]*$/;

export class MarketCatalog {
  private readonly marketDir: string;
  private readonly installedPath: string;
  private resources = new Map<string, MarketResource>();

  constructor(dataRoot: string) {
    this.marketDir = path.join(dataRoot, "market");
    this.installedPath = path.join(this.marketDir, "installed.json");
    this.reload();
  }

  /** 重新扫描 data/market/ 下 official/certified/community 三层的 market.json */
  reload(): void {
    this.resources.clear();
    for (const tier of SCAN_TIERS) {
      const tierDir = path.join(this.marketDir, tier);
      if (!fs.existsSync(tierDir)) continue;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(tierDir, { withFileTypes: true });
      } catch (err) {
        log.warn("Failed to read market tier dir %s: %s", tierDir, (err as Error).message);
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        // 目录名必须为合法 id（防异常目录名被纳入）
        if (!RESOURCE_ID_PATTERN.test(id)) {
          log.warn("Skip market resource dir with invalid id: %s", id);
          continue;
        }
        const manifestPath = path.join(tierDir, id, "market.json");
        if (!fs.existsSync(manifestPath)) {
          log.warn("Market resource %s missing market.json, skipped", id);
          continue;
        }
        const resource = this.loadManifest(manifestPath, id, tier);
        if (resource) {
          if (this.resources.has(resource.id)) {
            log.warn("Duplicate market resource id '%s', skipping %s", resource.id, manifestPath);
          } else {
            this.resources.set(resource.id, resource);
            log.info("Loaded market resource: %s (%s/%s)", resource.id, tier, resource.type);
          }
        }
      }
    }
  }

  /** 读取并校验单个 market.json（id 非法 / 与目录名不一致 / type 非法 → 跳过） */
  private loadManifest(manifestPath: string, dirId: string, tier: MarketTier): MarketResource | null {
    let raw: string;
    try {
      raw = fs.readFileSync(manifestPath, "utf-8");
    } catch (err) {
      log.warn("Failed to read market manifest %s: %s", manifestPath, (err as Error).message);
      return null;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      log.warn("Invalid JSON in market manifest %s: %s", manifestPath, (err as Error).message);
      return null;
    }
    const id = typeof data.id === "string" ? data.id : dirId;
    if (!RESOURCE_ID_PATTERN.test(id)) {
      log.warn("Market resource id invalid '%s', skipped (%s)", id, manifestPath);
      return null;
    }
    if (id !== dirId) {
      log.warn("Market manifest id '%s' mismatches directory '%s', skipped", id, dirId);
      return null;
    }
    const type = data.type as MarketResourceType;
    if (type !== "agent" && type !== "group" && type !== "skill") {
      log.warn("Market resource %s has invalid type '%s', skipped", id, String(data.type));
      return null;
    }
    return {
      id,
      type,
      name: typeof data.name === "string" && data.name ? data.name : id,
      description: typeof data.description === "string" ? data.description : "",
      version: typeof data.version === "string" ? data.version : "1.0.0",
      tier,
      author: typeof data.author === "string" ? data.author : "unknown",
      icon: typeof data.icon === "string" ? data.icon : undefined,
      tags: Array.isArray(data.tags) ? (data.tags.filter((t) => typeof t === "string") as string[]) : [],
      riskLevel: data.riskLevel === "medium" || data.riskLevel === "high" ? data.riskLevel : "low",
      permissions: Array.isArray(data.permissions)
        ? (data.permissions.filter((p) => typeof p === "string") as string[])
        : [],
      dependencies: Array.isArray(data.dependencies)
        ? (data.dependencies
            .filter(
              (d): d is { type: MarketResourceType; id: string; version?: string } =>
                typeof d === "object" &&
                d !== null &&
                (d as { type?: unknown }).type !== undefined &&
                typeof (d as { id?: unknown }).id === "string",
            )
            .map((d) => ({ type: d.type as MarketResourceType, id: d.id, version: d.version })))
        : [],
    };
  }

  /** 全部文件型资源（按 id 排序，保证确定性） */
  list(): MarketResource[] {
    return [...this.resources.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get(id: string): MarketResource | undefined {
    return this.resources.get(id);
  }

  /** 关键词搜索（id/name/description/tags 子串匹配，大小写不敏感）+ type/tier 过滤 */
  search(query: string, opts?: { type?: MarketResourceType; tier?: MarketTier }): MarketResource[] {
    const q = (query ?? "").trim().toLowerCase();
    return this.list().filter((r) => {
      if (opts?.type && r.type !== opts.type) return false;
      if (opts?.tier && r.tier !== opts.tier) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }

  isInstalled(id: string): boolean {
    return this.getInstalledMap().has(id);
  }

  /** 读取 data/market/installed.json → 条目数组 */
  getInstalled(): InstalledEntry[] {
    return [...this.getInstalledMap().values()];
  }

  private getInstalledMap(): Map<string, InstalledEntry> {
    if (!fs.existsSync(this.installedPath)) return new Map();
    try {
      const raw = fs.readFileSync(this.installedPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      const map = new Map<string, InstalledEntry>();
      for (const [id, entry] of Object.entries(data)) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Partial<InstalledEntry>;
        if (typeof e.type === "string" && (e.type === "agent" || e.type === "group" || e.type === "skill")) {
          map.set(id, {
            id,
            type: e.type,
            name: typeof e.name === "string" ? e.name : id,
            installedAt: typeof e.installedAt === "string" ? e.installedAt : "",
            sourceId: typeof e.sourceId === "string" ? e.sourceId : id,
            installedIds: Array.isArray(e.installedIds) ? (e.installedIds.filter((x) => typeof x === "string") as string[]) : [],
          });
        }
      }
      return map;
    } catch (err) {
      log.warn("Failed to parse installed.json (%s): %s", this.installedPath, (err as Error).message);
      return new Map();
    }
  }

  /** 写 installed.json（按 id 合并） */
  markInstalled(entry: InstalledEntry): void {
    const map = this.getInstalledMap();
    map.set(entry.id, entry);
    this.writeInstalledMap(map);
  }

  unmarkInstalled(id: string): void {
    const map = this.getInstalledMap();
    if (map.delete(id)) {
      this.writeInstalledMap(map);
    }
  }

  private writeInstalledMap(map: Map<string, InstalledEntry>): void {
    fs.mkdirSync(this.marketDir, { recursive: true });
    const data: Record<string, InstalledEntry> = {};
    for (const [id, entry] of map) data[id] = entry;
    const tmpPath = this.installedPath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmpPath, this.installedPath);
  }
}

/**
 * 把现有 Agent / 技能合成为「本地私有」（tier: local）市场资源。
 * - agent：排除 id 为 butler/host 的系统核心
 * - skill：按名称合成
 * 均无依赖、riskLevel low、permissions ["workspace:readwrite"]、tags ["本地"]
 */
export function buildLocalResources(
  agents: Array<{ id: string; name: string; role?: string }>,
  skills: Array<{ name: string; description: string }>,
): MarketResource[] {
  const resources: MarketResource[] = [];
  for (const agent of agents) {
    if (agent.id === "butler" || agent.id === "host") continue;
    resources.push({
      id: agent.id,
      type: "agent",
      name: agent.name || agent.id,
      description: agent.role ? `本地 Agent：${agent.role}` : "本地 Agent",
      version: "1.0.0",
      tier: "local",
      author: "local",
      tags: ["本地"],
      riskLevel: "low",
      permissions: ["workspace:readwrite"],
      dependencies: [],
    });
  }
  for (const skill of skills) {
    if (!skill.name) continue;
    resources.push({
      id: skill.name,
      type: "skill",
      name: skill.name,
      description: skill.description || "",
      version: "1.0.0",
      tier: "local",
      author: "local",
      tags: ["本地"],
      riskLevel: "low",
      permissions: ["workspace:readwrite"],
      dependencies: [],
    });
  }
  return resources;
}
