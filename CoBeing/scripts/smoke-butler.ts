#!/usr/bin/env node
/**
 * 管家入口产品化 WS 冒烟测试(阶段 A/B/C/D)
 *
 * 用法: npx tsx scripts/smoke-butler.ts
 *
 * 验证链路(使用临时 data 目录):
 * 1. butler_get_personas  — 模板列表存在(≥4)+ current
 * 2. butler_set_persona   — 切换模板复制文件
 * 3. butler_update_style  — 称呼/欢迎语写入
 * 4. dispatch_task        — agent 目标派发 + butler_task_updated 事件携带结构化视图
 * 5. dispatch_task group  — group 目标派发
 * 6. onboarding_apply     — 问卷生成初始 Agent + Market 推荐;幂等 already_done
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { CoBeingRuntime, loadConfig } from "../packages/core/dist/index.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", () => resolve(18767));
  });
}

let WS_URL = "ws://127.0.0.1:18765";

function createClient(): Promise<{ send: (type: string, payload?: unknown) => Promise<any>; sendFor: (respType: string, type: string, payload?: unknown) => Promise<any>; on: (type: string, cb: (msg: any) => void) => void; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map<string, Array<(msg: any) => void>>();
    const listeners = new Map<string, Array<(msg: any) => void>>();
    const timeout = setTimeout(() => reject(new Error("WS 连接超时")), 10000);
    ws.onopen = () => {
      clearTimeout(timeout);
      const waitFor = (respType: string, type: string, payload?: unknown) => new Promise<any>((res, rej) => {
        const handlers = pending.get(respType) || [];
        const timer = setTimeout(() => {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
          rej(new Error(`等待 ${respType} 响应超时(15s), 请求=${type}`));
        }, 15000);
        const handler = (msg: any) => {
          clearTimeout(timer);
          if (msg.type === "error") rej(new Error(msg.payload?.message || "server error"));
          else res(msg.payload);
        };
        handlers.push(handler);
        pending.set(respType, handlers);
        ws.send(JSON.stringify({ type, payload: payload ?? {} }));
      });
      resolve({
        send: (type, payload) => waitFor(type, type, payload),
        sendFor: waitFor,
        on: (type, cb) => {
          const arr = listeners.get(type) || [];
          arr.push(cb);
          listeners.set(type, arr);
        },
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
      const ls = listeners.get(msg.type);
      if (ls) for (const cb of [...ls]) cb(msg);
    };
  });
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-butler-smoke-"));
  const wsPort = await pickFreePort();
  WS_URL = `ws://127.0.0.1:${wsPort}`;
  const config = loadConfig();
  const runtime = new CoBeingRuntime({
    ...config,
    core: { ...config.core, dataDir: tmpRoot, skillsDir: path.join(tmpRoot, "skills") },
    gui: { ...config.gui, enabled: true, wsPort },
  });

  console.log("== 启动 Runtime(临时 data 目录)==");
  await runtime.start();
  console.log("== Runtime 启动完成 ==");

  let client: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    client = await createClient();
    console.log("== WS 已连接 ==");

    // 1. 管家文件体系(ensureButlerDir 产物)
    const butlerDir = path.join(tmpRoot, "coreagents", "butler");
    check("ensureButlerDir 创建管家文件体系",
      fs.existsSync(path.join(butlerDir, "config.json")) &&
      fs.existsSync(path.join(butlerDir, "CHARACTER.md")) &&
      fs.existsSync(path.join(butlerDir, "JOB.md")) &&
      fs.existsSync(path.join(butlerDir, "AGENTS.md")),
      fs.readdirSync(butlerDir).join(", "));

    // 2. 管家模板
    const personas = await client.sendFor("butler_personas", "butler_get_personas", {});
    const personaIds = (personas.personas || []).map((p: any) => p.id);
    check("butler_get_personas 返回模板列表", personaIds.length >= 4, personaIds.join(", "));
    check("当前模板已设置", !!personas.current, `current=${personas.current}`);

    const switchTarget = personaIds.find((id: string) => id !== personas.current);
    if (switchTarget) {
      const switched = await client.sendFor("butler_persona_set", "butler_set_persona", { persona: switchTarget });
      check("butler_set_persona 切换模板", switched?.ok === true, `persona=${switchTarget}`);
      const after = await client.sendFor("butler_personas", "butler_get_personas", {});
      check("切换后 current 更新", after.current === switchTarget);
      check("模板 CHARACTER.md 已复制到管家目录",
        fs.existsSync(path.join(butlerDir, "CHARACTER.md")));
      const jobContent = fs.readFileSync(path.join(butlerDir, "JOB.md"), "utf-8");
      check("JOB.md 含分级转接规则", jobContent.includes("派发") || jobContent.includes("转接"));
      check("JOB.md 含 Market 纪律", jobContent.includes("Market") || jobContent.includes("推荐"));
    }

    // 3. 风格更新
    const style = await client.sendFor("butler_style_updated", "butler_update_style", { nickname: "小管家", greeting: "你好呀,今天想做什么?", apply: true });
    check("butler_update_style 写入", style?.ok === true, JSON.stringify(style));
    const charContent = fs.readFileSync(path.join(butlerDir, "CHARACTER.md"), "utf-8");
    check("CHARACTER.md 含用户偏好(称呼)", charContent.includes("小管家"));

    // 4. 转接回执:派发到 agent + butler_task_updated 事件
    const receiptEvents: any[] = [];
    client.on("butler_task_updated", (msg) => receiptEvents.push(msg.payload));
    const dispatch = await client.sendFor("dispatch_task_result", "dispatch_task", {
      agentId: "host", targetType: "agent", title: "冒烟测试任务", goal: "验证派发链路", notifyTarget: false,
    });
    check("dispatch_task(agent) 返回 ok", dispatch?.ok === true, JSON.stringify(dispatch).slice(0, 120));
    await new Promise((r) => setTimeout(r, 500));
    const lastEvent = receiptEvents[receiptEvents.length - 1];
    check("butler_task_updated 事件携带结构化视图",
      !!lastEvent && !!lastEvent.butlerTaskId && !!lastEvent.title && !!lastEvent.status,
      lastEvent ? `${lastEvent.butlerTaskId} ${lastEvent.status} ${lastEvent.title}` : "(无事件)");

    // 5. 派发到 group(需先建一个群组)
    const grpCreate = await client.sendFor("group_created", "create_group", { name: "冒烟测试组", members: ["host"], topic: "验证" }).catch(() => null);
    if (grpCreate) {
      const grpDispatch = await client.sendFor("dispatch_task_result", "dispatch_task", {
        groupId: "冒烟测试组", targetType: "group", title: "群组任务", goal: "验证群组派发", notifyTarget: false,
      });
      check("dispatch_task(group) 返回 ok", grpDispatch?.ok === true,
        grpDispatch ? JSON.stringify(grpDispatch).slice(0, 120) : "创建失败");
    } else {
      check("dispatch_task(group) 返回 ok", false, "create_group 失败,跳过");
    }

    // 6. onboarding
    const onb = await client.sendFor("onboarding_result", "onboarding_apply", { interests: ["旅行", "创作"], note: "喜欢旅行和写作" });
    check("onboarding_apply 返回 done", onb?.status === "done", JSON.stringify(onb).slice(0, 150));
    check("onboarding 创建了 Agent", Array.isArray(onb.createdAgents) && onb.createdAgents.length >= 1,
      `agents=[${(onb.createdAgents || []).map((a: any) => a.name).join(", ")}]`);
    const agentDirOk = (onb.createdAgents || []).every((a: any) =>
      fs.existsSync(path.join(tmpRoot, "agents", a.id, "config.json")));
    check("初始 Agent 文件落盘", agentDirOk);
    check("Market 推荐 ≤2 条且为官方", Array.isArray(onb.marketRecommendations) &&
      onb.marketRecommendations.length <= 2 &&
      (onb.marketRecommendations.length === 0 || onb.marketRecommendations.every((r: any) => r.tier === "official")),
      JSON.stringify((onb.marketRecommendations || []).map((r: any) => r.name)));
    const onb2 = await client.sendFor("onboarding_result", "onboarding_apply", { interests: ["学习"] });
    check("onboarding 幂等 already_done", onb2?.status === "already_done");

    // 7. 本地私有资源(Market 集成回归)
    const market = await client.send("market_list", {});
    const localCount = (market.resources || []).filter((r: any) => r.tier === "local").length;
    check("onboarding 创建的 Agent 出现在本地资源", localCount >= 1, `${localCount} 个本地资源`);
  } catch (err: any) {
    check("冒烟流程异常", false, err.message);
  } finally {
    client?.close();
    await runtime.stop();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\n== 结果 ==");
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.error("失败项:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("管家入口冒烟测试全部通过 ✅");
  process.exit(0);
}

main().catch((err) => {
  console.error("冒烟测试异常退出:", err);
  process.exit(1);
});
