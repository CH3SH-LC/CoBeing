/**
 * MarketCatalog 单元测试
 * 临时目录构造 fake data/market 结构 → list/get/search/reload 跳过非法项/
 * installed.json 持久化/buildLocalResources 合成
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MarketCatalog, buildLocalResources } from "./catalog.js";

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "alpha",
    type: "skill",
    name: "测试技能",
    description: "用于单元测试的技能资源",
    version: "1.0.0",
    tier: "official",
    author: "CoBeing Team",
    tags: ["测试", "技能"],
    riskLevel: "low",
    permissions: ["workspace:readwrite"],
    dependencies: [],
    ...overrides,
  };
}

describe("MarketCatalog", () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-market-catalog-"));
    // official 层
    writeJson(path.join(dataRoot, "market/official/alpha/market.json"), manifest());
    writeJson(path.join(dataRoot, "market/official/beta/market.json"), manifest({ id: "beta", type: "agent", name: "测试助手", description: "beta agent for trip planning" }));
    // certified 层
    writeJson(path.join(dataRoot, "market/certified/gamma/market.json"), manifest({ id: "gamma", type: "group", name: "测试小队", description: "gamma group" }));
    // community 层
    writeJson(path.join(dataRoot, "market/community/delta/market.json"), manifest({ id: "delta", type: "agent", name: "社区助手", description: "delta community agent" }));
    // 非法 id → 跳过
    writeJson(path.join(dataRoot, "market/official/evil-dir/market.json"), manifest({ id: "bad id!", name: "非法资源" }));
    // id 与目录名不一致 → 跳过
    writeJson(path.join(dataRoot, "market/official/mismatch-dir/market.json"), manifest({ id: "other-id", name: "错位资源" }));
    // 无 market.json → 跳过
    fs.mkdirSync(path.join(dataRoot, "market/official/no-manifest"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("构造后自动扫描三层目录，list() 返回全部文件型资源并按 id 排序", () => {
    const catalog = new MarketCatalog(dataRoot);
    const list = catalog.list();
    expect(list.map((r) => r.id)).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(list.map((r) => r.tier)).toEqual(["official", "official", "community", "certified"]);
    // 非法 id / 错位 id / 无清单的目录被跳过
    expect(list.some((r) => r.id === "bad id!")).toBe(false);
    expect(list.some((r) => r.id === "other-id")).toBe(false);
  });

  it("get() 按 id 精确查找", () => {
    const catalog = new MarketCatalog(dataRoot);
    expect(catalog.get("beta")?.name).toBe("测试助手");
    expect(catalog.get("nope")).toBeUndefined();
  });

  it("search() 支持关键词与 type/tier 过滤", () => {
    const catalog = new MarketCatalog(dataRoot);
    expect(catalog.search("trip").map((r) => r.id)).toEqual(["beta"]);
    expect(catalog.search("测试").length).toBeGreaterThanOrEqual(4);
    expect(catalog.search("测试", { type: "agent" }).map((r) => r.id)).toEqual(["beta", "delta"]);
    expect(catalog.search("测试", { tier: "official" }).map((r) => r.id)).toEqual(["alpha", "beta"]);
    expect(catalog.search("", { type: "group" }).map((r) => r.id)).toEqual(["gamma"]);
  });

  it("reload() 重新扫描：新增资源可见，删除资源消失", () => {
    const catalog = new MarketCatalog(dataRoot);
    expect(catalog.get("epsilon")).toBeUndefined();
    writeJson(path.join(dataRoot, "market/official/epsilon/market.json"), manifest({ id: "epsilon", name: "新资源" }));
    catalog.reload();
    expect(catalog.get("epsilon")?.name).toBe("新资源");
    fs.rmSync(path.join(dataRoot, "market/official/alpha"), { recursive: true, force: true });
    catalog.reload();
    expect(catalog.get("alpha")).toBeUndefined();
  });

  it("markInstalled/getInstalled/isInstalled/unmarkInstalled 持久化到 installed.json", () => {
    const catalog = new MarketCatalog(dataRoot);
    expect(catalog.isInstalled("alpha")).toBe(false);
    catalog.markInstalled({
      id: "alpha",
      type: "skill",
      name: "测试技能",
      installedAt: "2026-08-03T00:00:00.000Z",
      sourceId: "alpha",
      installedIds: ["alpha"],
    });
    expect(catalog.isInstalled("alpha")).toBe(true);
    const entries = catalog.getInstalled();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "alpha", type: "skill", name: "测试技能" });

    // 新实例读取同一文件（持久化生效）
    const catalog2 = new MarketCatalog(dataRoot);
    expect(catalog2.isInstalled("alpha")).toBe(true);
    expect(catalog2.getInstalled()[0].installedAt).toBe("2026-08-03T00:00:00.000Z");

    catalog2.unmarkInstalled("alpha");
    expect(catalog2.isInstalled("alpha")).toBe(false);
    expect(catalog2.getInstalled()).toHaveLength(0);
    // 再次新实例验证文件确实被清除
    const catalog3 = new MarketCatalog(dataRoot);
    expect(catalog3.getInstalled()).toHaveLength(0);
  });

  it("markInstalled 可覆盖已存在条目（幂等）", () => {
    const catalog = new MarketCatalog(dataRoot);
    catalog.markInstalled({ id: "alpha", type: "skill", name: "旧名", installedAt: "a", sourceId: "alpha", installedIds: ["alpha"] });
    catalog.markInstalled({ id: "alpha", type: "skill", name: "新名", installedAt: "b", sourceId: "alpha", installedIds: ["alpha"] });
    expect(catalog.getInstalled()).toHaveLength(1);
    expect(catalog.getInstalled()[0].name).toBe("新名");
  });

  it("market 目录不存在时安全空扫", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-market-empty-"));
    try {
      const catalog = new MarketCatalog(empty);
      expect(catalog.list()).toEqual([]);
      expect(catalog.getInstalled()).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("buildLocalResources", () => {
  it("排除 butler/host 系统核心，合成 local 层 agent 与 skill 资源", () => {
    const resources = buildLocalResources(
      [
        { id: "butler", name: "管家" },
        { id: "host", name: "主机" },
        { id: "alice", name: "爱丽丝", role: "数据分析" },
        { id: "bob", name: "鲍勃" },
      ],
      [
        { name: "planning", description: "规划技能" },
        { name: "writing", description: "写作技能" },
      ],
    );
    const agents = resources.filter((r) => r.type === "agent");
    const skills = resources.filter((r) => r.type === "skill");
    expect(agents.map((r) => r.id).sort()).toEqual(["alice", "bob"]);
    expect(skills.map((r) => r.id).sort()).toEqual(["planning", "writing"]);

    const alice = resources.find((r) => r.id === "alice")!;
    expect(alice.tier).toBe("local");
    expect(alice.riskLevel).toBe("low");
    expect(alice.permissions).toEqual(["workspace:readwrite"]);
    expect(alice.tags).toContain("本地");
    expect(alice.dependencies).toEqual([]);
    expect(alice.version).toBeTruthy();
    expect(alice.author).toBeTruthy();
    const desc = resources.find((r) => r.id === "planning")!;
    expect(desc.tier).toBe("local");
    expect(desc.type).toBe("skill");
    expect(desc.description).toBe("规划技能");
  });

  it("空输入返回空数组", () => {
    expect(buildLocalResources([], [])).toEqual([]);
  });
});
