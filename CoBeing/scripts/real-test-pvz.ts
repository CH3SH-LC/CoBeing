#!/usr/bin/env node
/**
 * 真实测试：与管家对话制作「植物大战僵尸」塔防 demo
 *
 * 用法: npx tsx scripts/real-test-pvz.ts
 *
 * 验证链路（真实 data 目录，非临时目录）：
 * 1. send_message → butler 接收用户请求（agent_started 广播）
 * 2. butler 决策：创建 Agent（creator）/ 创建群组（create_group）/ 派发任务（dispatch_task）
 * 3. Agent 执行：工具调用（tool_event 全链路）、写作代码产物（群组 workspace / 沙箱）
 * 4. 回执链路：butler_task_updated 结构化广播（任务回执卡片数据源）
 * 5. 完成链路：agent_completed / group_message / agent_response
 *
 * 输出：
 * - 控制台实时打印事件流（✅/❌ 标记关键环节）
 * - 事件全量 JSONL 保存到 docs/log/real-test-pvz-<ts>.jsonl
 * - 结束时打印数据目录产物清单
 */
import fs from "node:fs";
import path from "node:path";

const WS_URL = process.env.COBEING_WS_URL || "ws://127.0.0.1:18765";
const USER_REQUEST =
  process.argv[2] ||
  "你好管家！请帮我制作一个植物大战僵尸风格的塔防游戏 demo，要有完整的可运行 HTML 文件，包含阳光收集、植物种植和僵尸进攻的核心玩法。完成后告诉我文件在哪里。";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

interface ToolEvent { toolName: string; status: string; params?: Record<string, unknown>; }
const events: any[] = [];
const toolCalls: ToolEvent[] = [];
const agentsStarted = new Map<string, boolean>();
const receipts: any[] = [];
let butlerCompleted = false;
let butlerError: string | undefined;

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

const logFile = path.resolve("docs/log", `real-test-pvz-${Date.now()}.jsonl`);
fs.mkdirSync(path.dirname(logFile), { recursive: true });
function logEvent(type: string, payload: unknown) {
  const entry = { t: Date.now(), type, payload };
  events.push(entry);
  fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
}

function connect(): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map<string, Array<(msg: any) => void>>();
    const timer = setTimeout(() => reject(new Error("WS 连接超时")), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      console.log(`[${stamp()}] ✅ WS 已连接 ${WS_URL}`);
      resolve({
        /** 即发即忘（send_message 等服务端不返回同类型响应） */
        sendRaw: (type: string, payload: unknown) => ws.send(JSON.stringify({ type, payload })),
        on: (type: string, cb: (msg: any) => void) => {
          if (!(ws as any).__listeners) (ws as any).__listeners = new Map<string, Array<(m: any) => void>>();
          const arr = (ws as any).__listeners;
          const list = arr.get(type) || [];
          list.push(cb);
          arr.set(type, list);
        },
        close: () => ws.close(),
      });
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("WS 连接失败")); };
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const handlers = pending.get(msg.type);
      if (handlers && handlers.length) {
        const h = handlers.shift()!;
        h(msg);
        if (!handlers.length) pending.delete(msg.type);
      }
      const listeners = (ws as any).__listeners?.get(msg.type) || [];
      for (const cb of listeners) { try { cb(msg); } catch { /* noop */ } }
      handleEvent(msg.type, msg.payload);
    };
  });
}

function handleEvent(type: string, payload: any) {
  logEvent(type, payload);
  switch (type) {
    case "agent_started": {
      const id = payload?.agentId;
      if (id && !agentsStarted.has(id)) {
        agentsStarted.set(id, true);
        console.log(`[${stamp()}] 🟢 ${payload?.agentName || id} 开始处理${payload?.groupId ? `（群组: ${payload.groupId}）` : ""}${payload?.mentions?.length ? ` mentions: ${payload.mentions.map((m: any) => m.text).join(",")}` : ""}`);
      }
      break;
    }
    case "tool_event": {
      if (payload?.status === "start") {
        toolCalls.push({ toolName: payload.toolName, status: "start", params: payload.params });
        console.log(`[${stamp()}] 🔧 ${payload.agentName || payload.agentId} 调用工具: ${payload.toolName}${payload.params ? " " + JSON.stringify(payload.params).slice(0, 120) : ""}`);
      } else {
        const tc = toolCalls.find(t => t.toolName === payload.toolName && t.status === "start");
        if (tc) tc.status = "complete";
        console.log(`[${stamp()}] ✅ ${payload.agentName || payload.agentId} 工具完成: ${payload.toolName}${payload.result ? " " + String(payload.result).slice(0, 80) : ""}`);
      }
      break;
    }
    case "butler_task_updated": {
      receipts.push(payload);
      const p = payload;
      console.log(`[${stamp()}] 📋 任务回执[${p.status || p.taskStatus}] "${p.title || p.taskTitle}" 指派: ${p.targetType} ${p.targetId}${p.summary ? ` 摘要: ${String(p.summary).slice(0, 100)}` : ""}`);
      break;
    }
    case "agent_response": {
      if (payload?.agentId === "butler") {
        console.log(`[${stamp()}] 💬 管家回复(${String(payload.content).length} 字符)`);
        fs.writeFileSync("docs/log/real-test-pvz-butler-response.md", String(payload.content));
      }
      break;
    }
    case "agent_completed": {
      if (payload?.agentId === "butler") butlerCompleted = true;
      console.log(`[${stamp()}] 🏁 ${payload?.agentName || payload?.agentId} 完成`);
      break;
    }
    case "agent_error": {
      if (payload?.agentId === "butler") { butlerError = payload?.error; butlerCompleted = true; }
      console.log(`[${stamp()}] ❌ ${payload?.agentName || payload?.agentId} 出错: ${String(payload?.error || "").slice(0, 150)}`);
      break;
    }
    case "group_message": {
      console.log(`[${stamp()}] 👥 ${payload?.fromAgentId} → 群组(${payload?.groupId}): ${String(payload?.content || "").slice(0, 100)}`);
      break;
    }
    case "usage_stats": {
      console.log(`[${stamp()}] 📊 ${payload?.agentId} tokens: in=${payload?.inputTokens} out=${payload?.outputTokens} cache=${payload?.cacheHitTokens ?? 0}`);
      break;
    }
  }
}

async function verifyArtifacts() {
  console.log("\n=== 产物核验 ===");
  const dataRoot = path.resolve("data");
  // 1. 用户创建的 Agent
  const agentDirs = fs.readdirSync(path.join(dataRoot, "agents")).filter(d => !["butler", "host"].includes(d));
  check(`用户 Agent 已创建: ${agentDirs.join(", ") || "无"}`, agentDirs.length > 0, agentDirs.map(d => d).join(","));
  // 2. 群组
  const groupDirs = fs.readdirSync(path.join(dataRoot, "groups"));
  check(`群组已创建: ${groupDirs.join(", ") || "无"}`, groupDirs.length > 0);
  // 3. 群组工作区产物
  let artifactFiles: string[] = [];
  for (const g of groupDirs) {
    const ws = path.join(dataRoot, "groups", g, "workspace");
    if (fs.existsSync(ws)) {
      const walk = (dir: string, acc: string[] = []): string[] => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, acc);
          else if (/\.(html?|js|css|json|md|ts)$/i.test(e.name)) acc.push(path.relative(ws, p).replace(/\\/g, "/"));
        }
        return acc;
      };
      artifactFiles = walk(ws);
    }
  }
  check(`群组工作区产物文件: ${artifactFiles.length} 个`, artifactFiles.length > 0, artifactFiles.slice(0, 10).join(", "));
  // 4. 全局 TODO
  const todos = fs.existsSync(path.join(dataRoot, "coreagents/butler/global-todos.json"))
    ? JSON.parse(fs.readFileSync(path.join(dataRoot, "coreagents/butler/global-todos.json"), "utf8"))
    : [];
  check(`全局 TODO 已建立: ${todos.length} 条`, todos.length > 0, todos.map((t: any) => t.title).slice(0, 3).join(" | "));
  // 5. 任务回执
  check(`任务回执广播: ${receipts.length} 次`, receipts.length > 0);
  // 6. 工具调用
  check(`工具调用链路: ${toolCalls.length} 次`, toolCalls.length > 0, toolCalls.map(t => t.toolName).join(", "));
  // 7. HTML 产物
  const htmlArtifacts = artifactFiles.filter(f => f.endsWith(".html"));
  check(`HTML demo 产物: ${htmlArtifacts.join(", ") || "无"}`, htmlArtifacts.length > 0);
}

async function main() {
  const observeOnly = process.argv.includes("--observe");
  console.log(`=== CoBeing 真实测试：植物大战僵尸 demo（${observeOnly ? "观察模式" : "发送请求"}） ===`);
  if (!observeOnly) console.log(`请求: ${USER_REQUEST}`);
  const client = await connect();

  // 监听事件
  for (const t of ["agent_started", "tool_event", "butler_task_updated", "agent_response", "agent_completed", "agent_error", "group_message", "usage_stats"]) {
    client.on(t, (msg: any) => handleEvent(msg.type, msg.payload));
  }

  if (!observeOnly) {
    console.log(`[${stamp()}] 📤 发送消息给管家...`);
    client.sendRaw("send_message", { agentId: "butler", content: USER_REQUEST });
    console.log(`[${stamp()}] 消息已送达，等待管家响应（最长 15 分钟）...`);
  } else {
    console.log(`[${stamp()}] 👀 观察模式：持续监听事件流，等管家完成或 15 分钟超时...`);
  }

  // 等待 butler 完成（轮询，最多 15 分钟）
  const deadline = Date.now() + 15 * 60 * 1000;
  while (!butlerCompleted && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
  }

  if (!butlerCompleted) {
    console.log(`[${stamp()}] ⏰ 超时：管家 15 分钟内未完成`);
    check("管家完成", false, "超时");
  } else if (butlerError) {
    check("管家完成", false, butlerError.slice(0, 200));
  } else {
    check("管家完成", true, `共 ${events.filter(e => e.type === "tool_event").length} 个工具事件`);
  }

  // 管家首轮回复只代表派发完成；demo 由群组异步协作产出，等待工作区出现 HTML 文件（最长 15 分钟）
  // 产物可能在群组工作区或各 Agent 工作区（无沙箱挂载时降级路径）
  console.log(`[${stamp()}] ⏳ 等待协作产出 demo 文件（最长 15 分钟）...`);
  const dataRoot = path.resolve("data");
  const waitDeadline = Date.now() + 15 * 60 * 1000;
  let htmlFound: string[] = [];
  while (Date.now() < waitDeadline) {
    htmlFound = [];
    const scanDirs: string[] = [];
    if (fs.existsSync(path.join(dataRoot, "groups"))) {
      for (const g of fs.readdirSync(path.join(dataRoot, "groups"))) scanDirs.push(path.join(dataRoot, "groups", g, "workspace"));
    }
    if (fs.existsSync(path.join(dataRoot, "agents"))) {
      for (const a of fs.readdirSync(path.join(dataRoot, "agents"))) scanDirs.push(path.join(dataRoot, "agents", a, "workspace"));
    }
    for (const ws of scanDirs) {
      if (!fs.existsSync(ws)) continue;
      const walk = (dir: string, acc: string[] = []): string[] => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, acc);
          else if (/\.html?$/i.test(e.name)) acc.push(path.relative(ws, p).replace(/\\/g, "/") + ` (${ws.split("data")[1]})`);
        }
        return acc;
      };
      htmlFound = htmlFound.concat(walk(ws));
    }
    if (htmlFound.length > 0) break;
    await new Promise(r => setTimeout(r, 10000));
  }
  check(`协作产出 HTML demo 文件: ${htmlFound.join(", ") || "无"}`, htmlFound.length > 0, htmlFound.join(", "));

  await verifyArtifacts();

  console.log("\n=== 结果汇总 ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const allOk = results.every(r => r.ok);
  console.log(allOk ? "\n🎉 全部通过" : "\n⚠️ 存在失败项");
  console.log(`事件日志: ${logFile}`);
  client.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
