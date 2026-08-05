/**
 * MarketInstaller 单元测试
 * 临时目录：依赖树（缺失保守节点/防环）/社区门禁/三类安装落盘/卸载/路径穿越/already_installed 幂等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MarketCatalog } from "./catalog.js";
import { MarketInstaller, type MarketInstallerHooks } from "./installer.js";

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "alpha",
    type: "skill",
    name: "测试资源",
    description: "用于单元测试的资源",
    version: "1.0.0",
    tier: "official",
    author: "CoBeing Team",
    tags: ["测试"],
    riskLevel: "low",
    permissions: ["workspace:readwrite"],
    dependencies: [],
    ...overrides,
  };
}

/** 构造一个带依赖链的 fake data/market 目录 */
function buildMarketDir(dataRoot: string): void {
  const m = path.join(dataRoot, "market");
  // 官方 skill（无依赖）
  writeJson(path.join(m, "official/lib-skill/market.json"), manifest({ id: "lib-skill", type: "skill", name: "基础技能", description: "基础技能描述" }));
  fs.writeFileSync(path.join(m, "official/lib-skill/SKILL.md"), "---\nname: lib-skill\ndescription: 基础技能\n---\n\n# 基础技能正文\n", "utf-8");
  fs.writeFileSync(path.join(m, "official/lib-skill/extra.txt"), "extra payload", "utf-8");

  // 官方 agent（依赖 skill）
  writeJson(path.join(m, "official/agent-bob/market.json"), manifest({
    id: "agent-bob", type: "agent", name: "助手鲍勃", description: "鲍勃助手",
    dependencies: [{ type: "skill", id: "lib-skill" }],
  }));
  fs.writeFileSync(path.join(m, "official/agent-bob/AGENTS.md"), "# AGENTS\n规则", "utf-8");

  // 官方 group（依赖 agent）
  writeJson(path.join(m, "official/team-omega/market.json"), manifest({
    id: "team-omega", type: "group", name: "欧米茄小队", description: "小队",
    dependencies: [{ type: "agent", id: "agent-bob" }],
  }));
  fs.writeFileSync(path.join(m, "official/team-omega/GUIDE.md"), "# GUIDE\n群组规则", "utf-8");

  // 防环：a <-> b
  writeJson(path.join(m, "official/cyclic-a/market.json"), manifest({
    id: "cyclic-a", type: "agent", name: "环A", description: "a",
    dependencies: [{ type: "agent", id: "cyclic-b" }],
  }));
  writeJson(path.join(m, "official/cyclic-b/market.json"), manifest({
    id: "cyclic-b", type: "agent", name: "环B", description: "b",
    dependencies: [{ type: "agent", id: "cyclic-a" }],
  }));

  // 缺失依赖
  writeJson(path.join(m, "official/dep-missing/market.json"), manifest({
    id: "dep-missing", type: "agent", name: "缺依赖", description: "missing",
    dependencies: [{ type: "skill", id: "nonexistent-skill" }],
  }));

  // 恶意依赖 id（路径穿越）
  writeJson(path.join(m, "official/evil-dep/market.json"), manifest({
    id: "evil-dep", type: "agent", name: "恶意依赖", description: "evil",
    dependencies: [{ type: "skill", id: "../evil" }],
  }));

  // 社区 agent（无依赖）
  writeJson(path.join(m, "community/comm-agent/market.json"), manifest({
    id: "comm-agent", type: "agent", name: "社区助手", description: "社区资源演示",
    tier: "community", riskLevel: "medium",
    permissions: ["workspace:readwrite", "agent-message"],
  }));
  fs.writeFileSync(path.join(m, "community/comm-agent/AGENTS.md"), "# AGENTS\n社区规则", "utf-8");
}

function collectAgentIds(node: { id: string; children: unknown[] }): string[] {
  return [node.id, ...node.children.flatMap((c) => collectAgentIds(c as { id: string; children: unknown[] }))];
}

describe("MarketInstaller", () => {
  let dataRoot: string;
  let catalog: MarketCatalog;
  let hooks: MarketInstallerHooks & {
    registerAgent: ReturnType<typeof vi.fn>;
    createGroup: ReturnType<typeof vi.fn>;
    destroyGroup: ReturnType<typeof vi.fn>;
    reloadSkills: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-market-installer-"));
    buildMarketDir(dataRoot);
    catalog = new MarketCatalog(dataRoot);
    hooks = {
      registerAgent: vi.fn(),
      createGroup: vi.fn(),
      destroyGroup: vi.fn(),
      reloadSkills: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  function makeInstaller(extraHooks: Partial<MarketInstallerHooks> = {}): MarketInstaller {
    return new MarketInstaller(catalog, { dataRoot, hooks: { ...hooks, ...extraHooks } });
  }

  describe("buildDependencyTree", () => {
    it("递归构建依赖链（先依赖后自身），required 均为 true", () => {
      const installer = makeInstaller();
      const tree = installer.buildDependencyTree("team-omega");
      expect(tree).not.toBeNull();
      expect(tree!.id).toBe("team-omega");
      expect(tree!.type).toBe("group");
      expect(tree!.required).toBe(true);
      expect(tree!.children).toHaveLength(1);
      const bob = tree!.children[0];
      expect(bob.id).toBe("agent-bob");
      expect(bob.type).toBe("agent");
      expect(bob.children).toHaveLength(1);
      const lib = bob.children[0];
      expect(lib.id).toBe("lib-skill");
      expect(lib.type).toBe("skill");
      expect(lib.children).toEqual([]);
    });

    it("缺失依赖生成 tier=community 的保守节点，name 用 dep.id", () => {
      const installer = makeInstaller();
      const tree = installer.buildDependencyTree("dep-missing");
      const dep = tree!.children[0];
      expect(dep.id).toBe("nonexistent-skill");
      expect(dep.name).toBe("nonexistent-skill");
      expect(dep.tier).toBe("community");
      expect(dep.children).toEqual([]);
    });

    it("依赖环不会无限递归（visited 防环）", () => {
      const installer = makeInstaller();
      const tree = installer.buildDependencyTree("cyclic-a");
      expect(tree).not.toBeNull();
      const ids = collectAgentIds(tree!);
      expect(ids).toContain("cyclic-a");
      expect(ids).toContain("cyclic-b");
      expect(ids.length).toBeLessThan(10);
    });

    it("资源不存在返回 null", () => {
      const installer = makeInstaller();
      expect(installer.buildDependencyTree("nope")).toBeNull();
    });
  });

  describe("社区分级门禁", () => {
    it("community 资源无 confirmed → approval_required，不写任何文件", () => {
      const installer = makeInstaller();
      const result = installer.install("comm-agent");
      expect(result.status).toBe("approval_required");
      expect(result.installedIds).toEqual([]);
      expect(result.dependencyTree.tier).toBe("community");
      expect(fs.existsSync(path.join(dataRoot, "agents/comm-agent"))).toBe(false);
      expect(hooks.registerAgent).not.toHaveBeenCalled();
    });

    it("community 资源 confirmed: true → installed，载荷落盘 + hook 调用", () => {
      const installer = makeInstaller();
      const result = installer.install("comm-agent", { confirmed: true });
      expect(result.status).toBe("installed");
      expect(result.installedIds).toEqual(["comm-agent"]);
      const agentDir = path.join(dataRoot, "agents/comm-agent");
      expect(fs.existsSync(path.join(agentDir, "AGENTS.md"))).toBe(true);
      expect(hooks.registerAgent).toHaveBeenCalledWith("comm-agent", agentDir);
      expect(catalog.isInstalled("comm-agent")).toBe(true);
    });
  });

  describe("skill 安装", () => {
    it("官方 skill 载荷整体复制到 dataRoot/skills/<id>，触发 reloadSkills", () => {
      const installer = makeInstaller();
      const result = installer.install("lib-skill");
      expect(result.status).toBe("installed");
      expect(result.installedIds).toEqual(["lib-skill"]);
      const skillDir = path.join(dataRoot, "skills/lib-skill");
      expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "extra.txt"))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, "market.json"))).toBe(false); // 清单不落盘
      expect(hooks.reloadSkills).toHaveBeenCalledTimes(1);
      const entries = catalog.getInstalled();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: "lib-skill", type: "skill", sourceId: "lib-skill", installedIds: ["lib-skill"] });
    });
  });

  describe("agent 安装", () => {
    it("先装依赖 skill 再装 agent，installedIds 为拓扑序", () => {
      const installer = makeInstaller();
      const result = installer.install("agent-bob");
      expect(result.status).toBe("installed");
      expect(result.installedIds).toEqual(["lib-skill", "agent-bob"]);
      const agentDir = path.join(dataRoot, "agents/agent-bob");
      expect(fs.existsSync(path.join(agentDir, "AGENTS.md"))).toBe(true);
      expect(hooks.registerAgent).toHaveBeenCalledWith("agent-bob", agentDir);
      expect(catalog.isInstalled("agent-bob")).toBe(true);
      expect(catalog.isInstalled("lib-skill")).toBe(true);
    });
  });

  describe("group 安装", () => {
    it("先装成员 agent 依赖，createGroup hook 收到 memberIds（仅 agent 类型节点）", () => {
      const installer = makeInstaller();
      const result = installer.install("team-omega");
      expect(result.status).toBe("installed");
      expect(result.installedIds).toEqual(["lib-skill", "agent-bob", "team-omega"]);
      const groupDir = path.join(dataRoot, "groups/team-omega");
      expect(fs.existsSync(path.join(groupDir, "GUIDE.md"))).toBe(true);
      expect(hooks.createGroup).toHaveBeenCalledWith("team-omega", "欧米茄小队", ["agent-bob"]);
      expect(hooks.registerAgent).toHaveBeenCalledWith("agent-bob", path.join(dataRoot, "agents/agent-bob"));
    });
  });

  describe("uninstall", () => {
    it("按类型删除目录并清除 installed.json 记录，依赖不级联", () => {
      const installer = makeInstaller();
      installer.install("team-omega");

      const res = installer.uninstall("team-omega");
      expect(res).toMatchObject({ id: "team-omega", removedIds: ["team-omega"] });
      expect(res.message).toContain("依赖");
      expect(fs.existsSync(path.join(dataRoot, "groups/team-omega"))).toBe(false);
      expect(hooks.destroyGroup).toHaveBeenCalledWith("team-omega");
      expect(catalog.isInstalled("team-omega")).toBe(false);
      // 依赖未被级联卸载
      expect(catalog.isInstalled("agent-bob")).toBe(true);
      expect(fs.existsSync(path.join(dataRoot, "agents/agent-bob"))).toBe(true);
    });

    it("agent/skill 卸载删除对应目录", () => {
      const installer = makeInstaller();
      installer.install("agent-bob");
      installer.uninstall("agent-bob");
      expect(fs.existsSync(path.join(dataRoot, "agents/agent-bob"))).toBe(false);
      expect(catalog.isInstalled("agent-bob")).toBe(false);
      installer.uninstall("lib-skill");
      expect(fs.existsSync(path.join(dataRoot, "skills/lib-skill"))).toBe(false);
    });

    it("未安装资源卸载返回空 removedIds 且不报错", () => {
      const installer = makeInstaller();
      const res = installer.uninstall("never-installed");
      expect(res).toMatchObject({ id: "never-installed", removedIds: [] });
    });
  });

  describe("安全防护", () => {
    it("非法 id（路径穿越）→ error 且不写任何文件", () => {
      const installer = makeInstaller();
      const result = installer.install("../evil");
      expect(result.status).toBe("error");
      expect(result.message).toContain("../evil");
      expect(fs.existsSync(path.join(dataRoot, "skills"))).toBe(false);
      expect(fs.existsSync(path.join(dataRoot, "agents"))).toBe(false);
      expect(fs.existsSync(path.join(dataRoot, "groups"))).toBe(false);
    });

    it("依赖 id 为 ../evil → error 且不写任何文件", () => {
      const installer = makeInstaller();
      const result = installer.install("evil-dep");
      expect(result.status).toBe("error");
      expect(fs.existsSync(path.join(dataRoot, "skills"))).toBe(false);
      expect(fs.existsSync(path.join(dataRoot, "agents"))).toBe(false);
    });
  });

  describe("幂等", () => {
    it("二次安装 → already_installed（installedIds 空、依赖齐全判断）", () => {
      const installer = makeInstaller();
      const first = installer.install("agent-bob");
      expect(first.status).toBe("installed");
      const second = installer.install("agent-bob");
      expect(second.status).toBe("already_installed");
      expect(second.installedIds).toEqual([]);
      expect(hooks.registerAgent).toHaveBeenCalledTimes(1);
      expect(hooks.reloadSkills).toHaveBeenCalledTimes(1);
    });

    it("资源不存在 → error 且 dependencyTree 为单节点占位", () => {
      const installer = makeInstaller();
      const result = installer.install("ghost");
      expect(result.status).toBe("error");
      expect(result.message).toBe("Resource not found: ghost");
      expect(result.dependencyTree.id).toBe("ghost");
      expect(result.dependencyTree.children).toEqual([]);
    });
  });
});
