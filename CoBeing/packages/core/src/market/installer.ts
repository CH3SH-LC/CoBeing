/**
 * MarketInstaller — 市场资源安装器
 *
 * 流程：依赖树解析（visited 防环，缺失依赖生成 community 保守节点）→
 * 分级安装门禁（community 需用户 confirmed）→ 拓扑序安装（先依赖后自身）→
 * 三类落盘（skill → data/skills/<id>、agent → data/agents/<id>、group → data/groups/<id>）→
 * installed.json 逐节点记录。
 *
 * 安全：资源 id 必须匹配 ^[\w][\w\-]*$；复制目标 resolve 后必须仍在目标根目录内（防路径穿越）。
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import { RESOURCE_ID_PATTERN, type MarketCatalog } from "./catalog.js";
import type {
  InstalledEntry,
  MarketDepNode,
  MarketInstallResult,
  MarketResource,
  MarketResourceType,
} from "./types.js";

const log = createLogger("market-installer");

export interface MarketInstallerHooks {
  /** Agent 注册（id, 目标目录绝对路径） */
  registerAgent?: (id: string, dir: string) => Promise<void> | void;
  /** 群组创建（id, 名称, 成员 Agent id 列表, 主题可选） */
  createGroup?: (id: string, name: string, memberIds: string[], topic?: string) => Promise<void> | void;
  destroyGroup?: (id: string) => Promise<void> | void;
  reloadSkills?: () => void;
}

export class MarketInstaller {
  private readonly dataRoot: string;
  private readonly hooks: MarketInstallerHooks;

  constructor(
    private readonly catalog: MarketCatalog,
    opts: { dataRoot: string; hooks?: MarketInstallerHooks },
  ) {
    this.dataRoot = opts.dataRoot;
    this.hooks = opts.hooks ?? {};
  }

  /**
   * 递归构建依赖树。
   * - visited 集合防环（同一节点只展开一次）
   * - 依赖缺失时生成 tier:"community" 的保守节点（name 用 dep.id，riskLevel high）
   * - 资源不存在返回 null
   */
  buildDependencyTree(id: string): MarketDepNode | null {
    const root = this.catalog.get(id);
    if (!root) return null;
    const visited = new Set<string>([id]);
    const build = (resource: MarketResource, required: boolean): MarketDepNode => {
      const node: MarketDepNode = {
        id: resource.id,
        type: resource.type,
        name: resource.name,
        tier: resource.tier,
        riskLevel: resource.riskLevel,
        required,
        children: [],
      };
      for (const dep of resource.dependencies) {
        const depResource = this.catalog.get(dep.id);
        if (!depResource) {
          // 缺失依赖 → community 保守节点（不展开）
          node.children.push({
            id: dep.id,
            type: dep.type,
            name: dep.id,
            tier: "community",
            riskLevel: "high",
            required: true,
            children: [],
          });
          continue;
        }
        if (visited.has(dep.id)) continue; // 防环
        visited.add(dep.id);
        node.children.push(build(depResource, true));
      }
      return node;
    };
    return build(root, true);
  }

  /**
   * 安装资源（顺序执行）：
   * 1. 资源不存在 → error
   * 2. 构建依赖树
   * 3. 树中任一节点 tier === "community" 且未 confirmed → approval_required
   * 4. 已安装且依赖齐全 → already_installed
   * 5. 预校验（所有节点 id 合法、skill 载荷含 SKILL.md）→ 拓扑序安装
   * 6. 返回 installed（installedIds = 实际新装节点）
   */
  install(id: string, opts?: { confirmed?: boolean }): MarketInstallResult {
    const confirmed = opts?.confirmed === true;
    const resource = this.catalog.get(id);

    // 1. 资源不存在
    if (!resource) {
      const placeholder: MarketDepNode = {
        id,
        type: "skill",
        name: id,
        tier: "community",
        riskLevel: "high",
        required: true,
        children: [],
      };
      return {
        status: "error",
        id,
        type: "skill",
        name: id,
        message: `Resource not found: ${id}`,
        installedIds: [],
        dependencyTree: placeholder,
      };
    }

    // 2. 依赖树
    const tree = this.buildDependencyTree(id) ?? {
      id: resource.id,
      type: resource.type,
      name: resource.name,
      tier: resource.tier,
      riskLevel: resource.riskLevel,
      required: true,
      children: [],
    };
    const allNodes = collectNodes(tree);

    // 3. 安全预校验：所有节点 id 合法（防路径穿越，拒绝且不写文件）
    //    先于社区门禁，恶意 id 直接拒绝，不进入用户确认流程
    const invalidId = allNodes.find((n) => !RESOURCE_ID_PATTERN.test(n.id));
    if (invalidId) {
      return {
        status: "error",
        id: resource.id,
        type: resource.type,
        name: resource.name,
        message: `非法资源 id：${invalidId.id}`,
        installedIds: [],
        dependencyTree: tree,
      };
    }

    // 4. 社区分级门禁
    const communityNodes = allNodes.filter((n) => n.tier === "community");
    if (communityNodes.length > 0 && !confirmed) {
      return {
        status: "approval_required",
        id: resource.id,
        type: resource.type,
        name: resource.name,
        message: `包含社区未认证资源（${communityNodes.map((n) => n.id).join(", ")}），需要用户确认后安装`,
        installedIds: [],
        dependencyTree: tree,
      };
    }

    // 5. 已安装且所有依赖已装 → 幂等
    const depNodes = allNodes.filter((n) => n.id !== id);
    if (this.catalog.isInstalled(id) && depNodes.every((n) => this.catalog.isInstalled(n.id))) {
      return {
        status: "already_installed",
        id: resource.id,
        type: resource.type,
        name: resource.name,
        message: "资源及其依赖均已安装",
        installedIds: [],
        dependencyTree: tree,
      };
    }

    // 6a. 预校验：skill 载荷必须含 SKILL.md
    const toInstall = allNodes.filter((n) => !this.catalog.isInstalled(n.id));
    for (const node of toInstall) {
      if (node.type !== "skill") continue;
      const sourceDir = this.sourceDirOf(node);
      if (sourceDir && fs.existsSync(path.join(sourceDir, "market.json"))) {
        if (!fs.existsSync(path.join(sourceDir, "SKILL.md"))) {
          return {
            status: "error",
            id: resource.id,
            type: resource.type,
            name: resource.name,
            message: `技能 ${node.id} 缺少 SKILL.md，拒绝安装`,
            installedIds: [],
            dependencyTree: tree,
          };
        }
      }
    }

    // 6b. 拓扑序安装（先依赖后自身）
    const installedIds: string[] = [];
    const warnings: string[] = [];
    const skipAlready: string[] = allNodes.filter((n) => this.catalog.isInstalled(n.id)).map((n) => n.id);

    const visit = (node: MarketDepNode): void => {
      for (const child of node.children) visit(child);
      if (this.catalog.isInstalled(node.id)) return;
      const result = this.installNode(node, id);
      installedIds.push(node.id);
      if (result === "placeholder") {
        warnings.push(`依赖 ${node.id} 未在市场中找到，已占位记录（无载荷）`);
      }
    };
    visit(tree);

    if (skipAlready.length > 0) {
      warnings.push(`已跳过已安装节点：${skipAlready.join(", ")}`);
    }

    return {
      status: "installed",
      id: resource.id,
      type: resource.type,
      name: resource.name,
      message: `安装完成：${resource.name}（${resource.id}）及 ${installedIds.length - 1} 个依赖`,
      installedIds,
      dependencyTree: tree,
      warning: warnings.length > 0 ? warnings.join("；") : undefined,
    };
  }

  /** 安装单个节点（已保证未被安装且 id 合法）。返回 "ok" | "placeholder"（缺失依赖占位） */
  private installNode(node: MarketDepNode, rootId: string): "ok" | "placeholder" {
    const sourceDir = this.sourceDirOf(node);
    const hasPayload = sourceDir !== null && fs.existsSync(path.join(sourceDir, "market.json"));

    if (!hasPayload) {
      // 缺失依赖保守节点：无载荷可复制 → 占位记录（保持依赖图一致）
      this.markEntry(node, rootId);
      return "placeholder";
    }

    const targetRoot = this.typeTargetRoot(node.type);
    if (!targetRoot) {
      this.markEntry(node, rootId);
      return "placeholder";
    }

    // 防御性路径校验：复制后 resolve 必须仍在目标根目录内
    const targetDir = path.join(targetRoot, node.id);
    if (!path.resolve(targetDir).startsWith(path.resolve(targetRoot) + path.sep)) {
      log.warn("Path traversal denied for target: %s", targetDir);
      return "placeholder";
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    copyDir(sourceDir, targetDir, { exclude: ["market.json"] });

    switch (node.type) {
      case "skill":
        this.fireHook("reloadSkills", this.hooks.reloadSkills?.());
        break;
      case "agent":
        this.fireHook("registerAgent", this.hooks.registerAgent?.(node.id, targetDir));
        break;
      case "group": {
        const memberIds = collectAgentIds(node.children);
        this.fireHook("createGroup", this.hooks.createGroup?.(node.id, node.name, memberIds));
        break;
      }
    }

    this.markEntry(node, rootId);
    return "ok";
  }

  /** 记录 installed.json 条目（sourceId 为安装入口 id） */
  private markEntry(node: MarketDepNode, sourceId: string): void {
    const entry: InstalledEntry = {
      id: node.id,
      type: node.type,
      name: node.name,
      installedAt: new Date().toISOString(),
      sourceId,
      installedIds: [node.id],
    };
    this.catalog.markInstalled(entry);
  }

  /** 节点对应的市场源目录（dataRoot/market/<tier>/<id>），tier=local 或异常时返回 null */
  private sourceDirOf(node: MarketDepNode): string | null {
    if (node.tier === "local") return null;
    return path.join(this.dataRoot, "market", node.tier, node.id);
  }

  private typeTargetRoot(type: MarketResourceType): string | null {
    switch (type) {
      case "skill":
        return path.join(this.dataRoot, "skills");
      case "agent":
        return path.join(this.dataRoot, "agents");
      case "group":
        return path.join(this.dataRoot, "groups");
      default:
        return null;
    }
  }

  /** hooks 可能返回 Promise，同步安装流程中 fire-and-forget（错误仅记日志） */
  private fireHook(label: string, result: void | Promise<void>): void {
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch((err) => log.warn("Hook %s failed: %s", label, (err as Error).message));
    }
  }

  /**
   * 卸载（installed.json 有记录才可卸载）：
   * skill → data/skills/<id>、agent → data/agents/<id>、
   * group → hooks.destroyGroup + data/groups/<id>；依赖不级联卸载。
   */
  uninstall(id: string): { id: string; removedIds: string[]; message?: string } {
    if (!RESOURCE_ID_PATTERN.test(id)) {
      return { id, removedIds: [], message: `非法资源 id：${id}` };
    }
    const entry = this.catalog.getInstalled().find((e) => e.id === id);
    if (!entry) {
      return { id, removedIds: [], message: `资源未安装：${id}` };
    }
    const targetRoot = this.typeTargetRoot(entry.type);
    if (targetRoot) {
      const targetDir = path.join(targetRoot, id);
      // 防御性路径校验
      if (path.resolve(targetDir).startsWith(path.resolve(targetRoot) + path.sep)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    }
    if (entry.type === "group") {
      this.fireHook("destroyGroup", this.hooks.destroyGroup?.(id));
    }
    this.catalog.unmarkInstalled(id);
    return {
      id,
      removedIds: [id],
      message: `已卸载 ${id}（依赖不级联卸载，它们是共享资源；如需一并清理请逐个处理）`,
    };
  }
}

/** 收集依赖树全部节点（含根） */
function collectNodes(tree: MarketDepNode): MarketDepNode[] {
  const out: MarketDepNode[] = [];
  const walk = (node: MarketDepNode): void => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return out;
}

/** 收集子树中全部 type === "agent" 的节点 id（群组成员） */
function collectAgentIds(nodes: MarketDepNode[]): string[] {
  const out: string[] = [];
  const walk = (node: MarketDepNode): void => {
    if (node.type === "agent") out.push(node.id);
    for (const child of node.children) walk(child);
  };
  for (const n of nodes) walk(n);
  return out;
}

/** 递归复制目录（可排除清单文件） */
function copyDir(src: string, dest: string, opts: { exclude: string[] }): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (opts.exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, { exclude: [] });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
