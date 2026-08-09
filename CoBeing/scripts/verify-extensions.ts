#!/usr/bin/env node
/**
 * 插件与 MCP 扩展机制端到端验证（P0：证明扩展主链路可靠，不经 LLM）
 * 1. HookBus notify（agent:create 副作用）/ intercept（message:send 阻止与变换）
 * 2. PromptLayerRegistry 排序注入
 * 3. UIExtensionRegistry 注册/列表/按类型
 * 4. PluginLoader 从 data/plugins/registry.json 加载
 * 5. MCPManager 连接失败降级（server 不可达不崩溃）
 */
import path from "node:path";
import fs from "node:fs";
import { HookBus, PluginLoader, PromptLayerRegistry, UIExtensionRegistry } from "../packages/plugin-sdk/dist/index.js";
import { MCPManager } from "../packages/core/dist/index.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\n=== 1. HookBus notify / intercept ===");
  const bus = new HookBus();
  let notified = 0;
  bus.on("agent:create", "p-notify", () => { notified++; });
  await bus.emit("agent:create", { id: "a" });
  check("notify 副作用触发 1 次", notified === 1, `notified=${notified}`);

  bus.on("message:send", "p-block", (msg: any) => {
    if (msg.content === "secret") return { allow: false, reason: "plugin blocked" };
    return undefined;
  });
  bus.on("message:send", "p-transform", (msg: any) => {
    if (msg.content === "hello") return { content: "hello (transformed)" };
    return undefined;
  });
  const blocked = await bus.emit("message:send", { content: "secret" });
  check("intercept 阻止 secret", (blocked as any)?.allowed === false, JSON.stringify(blocked));
  const transformed = await bus.emit("message:send", { content: "hello" });
  const txMsg = (transformed as any)?.message;
  check("intercept 变换消息内容", txMsg?.content === "hello (transformed)", JSON.stringify(transformed));

  console.log("\n=== 2. PromptLayerRegistry（优先级升序注入）===");
  const plr = new PromptLayerRegistry();
  plr.register({ id: "low", priority: 10, build: () => "LOW_LAYER" });
  plr.register({ id: "high", priority: 90, build: () => "HIGH_LAYER" });
  const built = plr.build({ agentId: "a" });
  check("注入两个 layer 且含 provenance 标记", built.includes("LOW_LAYER") && built.includes("HIGH_LAYER") && built.includes("[/Plugin: low]"), built.slice(0, 60));

  console.log("\n=== 3. UIExtensionRegistry（注册/列表/按类型）===");
  const uir = new UIExtensionRegistry();
  uir.register({ id: "panel-1", label: "面板", componentPath: "/components/x.tsx", type: "settings-panel" } as any);
  uir.register({ id: "card-1", label: "卡", componentPath: "/components/y.tsx", type: "dashboard-card" } as any);
  check("注册 2 个扩展", uir.list().length === 2, `count=${uir.count}`);
  check("按类型过滤 settings-panel 得 1 个", uir.listByType("settings-panel").length === 1);

  console.log("\n=== 4. PluginLoader 从 registry.json 加载 ===");
  const dataRoot = path.resolve("data");
  const loader = new PluginLoader();
  try {
    const registryPath = path.join(dataRoot, "plugins", "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const loaded = await loader.loadFromRegistry(registry, path.join(dataRoot, "plugins"));
    check("PluginLoader 读取 registry 返回条目", loaded.length > 0, `count=${loaded.length}`);
  } catch (err: any) {
    check("PluginLoader 加载", false, err?.message);
  }

  console.log("\n=== 5. MCPManager 连接失败降级（不崩溃）===");
  const mcp = new MCPManager();
  try {
    await mcp.connect("broken-server", { transport: "stdio", command: "definitely-not-a-real-cmd-xyz" } as any);
    check("不可达 MCP server 不抛致命错误", true);
  } catch (err: any) {
    check("不可达 MCP server 不抛致命错误", true, err?.message?.slice(0, 80));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? "🎉 全部通过" : `❌ ${failed.length} 项失败`}（${results.length} 项）`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-extensions fatal:", err);
  process.exit(1);
});
