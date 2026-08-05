#!/usr/bin/env node
/**
 * Market 分级机制 WS 冒烟测试
 *
 * 用法: npx tsx scripts/smoke-market.ts
 *
 * 验证链路（使用临时 data 目录，不污染真实 data/）：
 * 1. market_list      — 内置资源齐全（3 official + 1 community）+ 本地私有聚合
 * 2. market_get       — 依赖树正确（travel-planner → travel-planning）
 * 3. market_install   — 官方 skill 直接安装，文件落盘 data/skills/
 * 4. market_install   — 社区资源无确认 → approval_required（门禁）
 * 5. market_install   — 社区资源 confirmed → installed，Agent 注册
 * 6. market_uninstall — 卸载后文件删除 + installed.json 记录清除
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

/** 选择一个随机空闲端口（避免与正在运行的 CoBeing 实例冲突） */
function pickFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => resolve(18766));
  });
}

let WS_URL = "ws://127.0.0.1:18765";

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  results.push({ name, ok: false, detail });
  console.log(`  ❌ ${name} — ${detail}`);
}

/** 简易 WS 客户端：send 后等待指定 type 的响应（sendFor 支持响应 type 与请求 type 不同，如 get_state → state） */
function createClient(): Promise<{ send: (type: string, payload?: unknown) => Promise<any>; sendFor: (respType: string, type: string, payload?: unknown) => Promise<any>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map<string, Array<(msg: any) => void>>();
    const timeout = setTimeout(() => reject(new Error("WS 连接超时")), 10000);
    ws.onopen = () => {
      clearTimeout(timeout);
      const waitFor = (respType: string, type: string, payload?: unknown) => new Promise<any>((res, rej) => {
        const handlers = pending.get(respType) || [];
        handlers.push((msg) => {
          if (msg.type === "error") rej(new Error(msg.payload?.message || "server error"));
          else res(msg.payload);
        });
        pending.set(respType, handlers);
        ws.send(JSON.stringify({ type, payload: payload ?? {} }));
      });
      resolve({
        send: (type, payload) => waitFor(type, type, payload),
        sendFor: waitFor,
        close: () => { try { ws.close(); } catch { /* noop */ } },
      });
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("WS 连接失败")); };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const handlers = pending.get(msg.type);
      if (handlers && handlers.length > 0) {
        pending.set(msg.type, handlers.slice(1));
        handlers[0](msg);
      }
    };
  });
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-market-smoke-"));
  const wsPort = await pickFreePort();
  WS_URL = `ws://127.0.0.1:${wsPort}`;
  const config = loadConfig();
  const runtime = new CoBeingRuntime({
    ...config,
    core: { ...config.core, dataDir: tmpRoot, skillsDir: path.join(tmpRoot, "skills") },
    gui: { ...config.gui, enabled: true, wsPort },
  });

  console.log("== 启动 Runtime（临时 data 目录: %s）==", tmpRoot);
  await runtime.start();
  console.log("== Runtime 启动完成 ==");

  let client: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    client = await createClient();
    console.log("== WS 已连接 ==");

    // 1. market_list
    const list = await client.send("market_list", {});
    const resources = (list.resources || []) as any[];
    const byId = new Map(resources.map((r: any) => [r.id, r]));
    check("market_list 返回资源", resources.length > 0, `${resources.length} 个资源`);
    check("内置官方技能 travel-planning", byId.has("travel-planning"));
    check("内置官方 Agent travel-planner", byId.has("travel-planner"));
    check("内置官方群组 travel-team", byId.has("travel-team"));
    check("社区资源 expense-assistant 存在且 tier=community",
      byId.get("expense-assistant")?.tier === "community");
    const localCount = resources.filter((r: any) => r.tier === "local").length;
    // 全新临时 data 目录下 registry 只有 butler/host（被排除），本地聚合可能为 0；
    // buildLocalResources 合成逻辑由 catalog.test.ts 单元测试覆盖。
    console.log(`  ℹ️ 本地私有资源聚合: ${localCount} 个（全新环境为 0 属预期）`);
    check("butler/host 不出现在市场", !byId.has("butler") && !byId.has("host"));
    const hasInstalledFlag = resources.every((r: any) => typeof r.installed === "boolean");
    check("所有资源带 installed 标记", hasInstalledFlag);

    // 1b. 过滤
    const onlySkill = await client.send("market_list", { type: "skill" });
    check("type 过滤只返回技能", (onlySkill.resources as any[]).every((r) => r.type === "skill"));
    const onlyCommunity = await client.send("market_list", { tier: "community" });
    check("tier 过滤只返回社区资源", (onlyCommunity.resources as any[]).every((r) => r.tier === "community"));

    // 2. market_get + 依赖树
    const detail = await client.send("market_get", { id: "travel-planner" });
    const tree = detail.dependencyTree as any;
    check("market_get 返回资源详情", detail.resource?.id === "travel-planner");
    check("依赖树含 travel-planning", !!tree?.children?.find((n: any) => n.id === "travel-planning"),
      JSON.stringify(tree?.children?.map((n: any) => `${n.type}:${n.id}`)));
    const groupDetail = await client.send("market_get", { id: "travel-team" });
    check("群组依赖树含 travel-planner",
      !!groupDetail.dependencyTree?.children?.find((n: any) => n.id === "travel-planner"));

    // 3. 官方 skill 直接安装
    const skillInstall = await client.send("market_install", { id: "travel-planning" });
    check("官方 skill 无需确认直接安装", skillInstall.status === "installed", `status=${skillInstall.status}`);
    check("skill 文件落盘", fs.existsSync(path.join(tmpRoot, "skills", "travel-planning", "SKILL.md")));

    // 3b. 重复安装幂等
    const reInstall = await client.send("market_install", { id: "travel-planning" });
    check("重复安装返回 already_installed", reInstall.status === "already_installed");

    // 4. 社区资源门禁：无确认 → approval_required
    const gate = await client.send("market_install", { id: "expense-assistant" });
    check("社区资源无确认被门禁", gate.status === "approval_required", `status=${gate.status}`);
    check("门禁响应带依赖树", !!gate.dependencyTree);

    // 5. 社区资源 confirmed → installed + Agent 注册
    const confirmed = await client.send("market_install", { id: "expense-assistant", confirmed: true });
    check("社区资源确认后安装", confirmed.status === "installed", `status=${confirmed.status}`);
    check("Agent 文件落盘", fs.existsSync(path.join(tmpRoot, "agents", "expense-assistant", "config.json")));
    // get_state 的响应 type 是 "state"（非请求同名），单独等待该响应
    const state = await client.sendFor("state", "get_state", {}).catch(() => null);
    if (state && Array.isArray(state.agents)) {
      const registered = (state.agents as any[]).some((a: any) => a.id === "expense-assistant");
      check("Agent 已注册到 registry", registered);
    } else if (state && Array.isArray(state.agentList)) {
      const registered = (state.agentList as any[]).some((a: any) => a.id === "expense-assistant");
      check("Agent 已注册到 registry", registered);
    } else {
      fail("Agent 注册验证", "get_state 响应无 agents 字段，跳过");
    }

    // 5b. 官方 agent 安装（依赖 skill 已在步骤 3 安装 → 只装自身，installedIds 含自身）
    const agentInstall = await client.send("market_install", { id: "travel-planner" });
    check("官方 agent 安装成功且 installedIds 含自身",
      agentInstall.status === "installed" && (agentInstall.installedIds || []).includes("travel-planner"),
      `status=${agentInstall.status} installedIds=[${(agentInstall.installedIds || []).join(", ")}]`);
    const installedAfter = await client.send("market_installed", {});
    check("依赖 skill 保持已安装状态",
      (installedAfter.installed || []).some((e: any) => e.id === "travel-planning"));

    // 6. 卸载
    const uninstalled = await client.send("market_uninstall", { id: "travel-planning" });
    check("卸载返回 removedIds", (uninstalled.removedIds || []).includes("travel-planning"));
    check("卸载后 skill 目录删除", !fs.existsSync(path.join(tmpRoot, "skills", "travel-planning")));

    // 6b. installed 记录
    const installedResp = await client.send("market_installed", {});
    const installedIds = (installedResp.installed || []).map((e: any) => e.id);
    check("installed 记录同步", installedIds.includes("expense-assistant") && !installedIds.includes("travel-planning"),
      `installed=[${installedIds.join(", ")}]`);
  } catch (err: any) {
    fail("冒烟流程异常", err.message);
  } finally {
    client?.close();
    await runtime.stop();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n== 结果 ==");
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.error("失败项：", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("Market WS 冒烟测试全部通过 ✅");
  process.exit(0);
}

main().catch((err) => {
  console.error("冒烟测试异常退出:", err);
  process.exit(1);
});
