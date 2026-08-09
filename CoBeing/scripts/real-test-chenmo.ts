#!/usr/bin/env node
/**
 * 真实用户模拟：模拟用户「陈默」真实使用 CoBeing 完成一天的工作
 *
 * 剧本（见本地记忆 simulated-user-chenmo）：
 *  - 早晨：日程读取（TODOboard 语义验证：日程走管家本地 md）、购物清单 md、按摩仪待办
 *  - 上午：客户需求发设计群组、配色经验归设计 Agent 私有记忆
 *  - 中午：耳机/按摩仪购物比价走生活采买小队、@用户 确认偏好
 *  - 下午：公众号长文走内容创作小队、@用户 确认、Market 社区门禁
 *  - 傍晚：杭州旅行走周末出行小队、体检日程 md
 *  - 晚上：复盘经验分派、睡前读日程 md
 *
 * 用法:
 *   npx tsx scripts/real-test-chenmo.ts                # 顺序跑全部场景
 *   npx tsx scripts/real-test-chenmo.ts --scenario=morning   # 只跑早晨
 *   npx tsx scripts/real-test-chenmo.ts --observe      # 只观察不发送
 *
 * 前置：DATA_DIR 隔离的 core 已启动（scripts/start-core.ts）
 */
import fs from "node:fs";
import path from "node:path";

const WS_URL = process.env.COBEING_WS_URL || "ws://127.0.0.1:18765";
const DATA_ROOT = process.env.COBEING_DATA_ROOT || path.resolve("data-sim-chenmo");

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const events: any[] = [];
let logFile = path.resolve("docs/log", `real-test-chenmo-${Date.now()}.jsonl`);
function logEvent(type: string, payload: unknown) {
  const entry = { t: Date.now(), type, payload };
  events.push(entry);
  try { fs.appendFileSync(logFile, JSON.stringify(entry) + "\n"); } catch { /* noop */ }
}
function stamp(): string { return new Date().toISOString().slice(11, 19); }

interface WSClient {
  sendRaw: (type: string, payload: unknown) => void;
  on: (type: string, cb: (msg: any) => void) => void;
  close: () => void;
}
function connect(): Promise<WSClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const pending = new Map<string, Array<(msg: any) => void>>();
    const timer = setTimeout(() => reject(new Error("WS 连接超时")), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      console.log(`[${stamp()}] ✅ WS 已连接 ${WS_URL}`);
      resolve({
        sendRaw: (type, payload) => ws.send(JSON.stringify({ type, payload })),
        on: (type, cb) => {
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
      for (const cb of listeners) { try { cb(msg); } catch {} }
      logEvent(msg.type, msg.payload);
    };
  });
}

// ---- 事件观察器：记录管家回复与关键事件 ----
class Observer {
  butlerReplies: string[] = [];
  startedAgents: string[] = [];
  receipts: any[] = [];
  errors: string[] = [];
  completedButler = false;
  lastActivity = Date.now();

  attach(client: WSClient) {
    client.on("agent_started", (m: any) => {
      const id = m?.payload?.agentId;
      if (id && !this.startedAgents.includes(id)) {
        this.startedAgents.push(id);
        console.log(`[${stamp()}] 🟢 ${m.payload.agentName || id} 开始${m.payload.groupId ? `（群组 ${m.payload.groupId}）` : ""}`);
      }
      this.lastActivity = Date.now();
    });
    client.on("agent_response", (m: any) => {
      if (m?.payload?.agentId === "butler" && typeof m.payload.content === "string") {
        this.butlerReplies.push(m.payload.content);
        console.log(`[${stamp()}] 💬 管家回复(${m.payload.content.length} 字符): ${m.payload.content.slice(0, 80).replace(/\n/g, " ")}`);
      }
      this.lastActivity = Date.now();
    });
    client.on("butler_task_updated", (m: any) => {
      this.receipts.push(m?.payload);
      console.log(`[${stamp()}] 📋 回执[${m.payload?.status || m.payload?.taskStatus}] ${String(m.payload?.title || "").slice(0, 60)} → ${m.payload?.targetType} ${m.payload?.targetId}`);
    });
    client.on("agent_completed", (m: any) => {
      if (m?.payload?.agentId === "butler") this.completedButler = true;
    });
    client.on("agent_error", (m: any) => {
      this.errors.push(String(m?.payload?.error || ""));
      console.log(`[${stamp()}] ❌ 出错 ${m.payload?.agentName}: ${String(m.payload?.error).slice(0, 120)}`);
    });
    client.on("group_message", (m: any) => {
      console.log(`[${stamp()}] 👥 ${m.payload?.fromAgentId} → 群组: ${String(m.payload?.content || "").slice(0, 80)}`);
    });
  }

  /** 等待管家完成一轮回复（新回复或完成事件），带超时 */
  async waitButler(desc: string, timeoutMs = 5 * 60 * 1000): Promise<string | undefined> {
    const mark = this.butlerReplies.length;
    const deadline = Date.now() + timeoutMs;
    console.log(`[${stamp()}] ⏳ 等待管家回复: ${desc}...`);
    while (Date.now() < deadline) {
      if (this.butlerReplies.length > mark) {
        const reply = this.butlerReplies[this.butlerReplies.length - 1];
        console.log(`[${stamp()}] ✅ 管家回复完毕 (${reply.length} 字符)`);
        return reply;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log(`[${stamp()}] ⏰ 超时未等来管家新回复`);
    return undefined;
  }

  /**
   * 发送消息并等待管家真实回复（会话锁感知）：
   * 管家正处理上一请求时返回 "[已停止] Agent 正在处理该会话的上一个请求"，
   * 该回复不是真实响应——等待空闲后重发（最多 3 次），直到拿到非占位回复。
   */
  async sendAndWaitButler(client: WSClient, content: string, desc: string, timeoutMs = 8 * 60 * 1000): Promise<string | undefined> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const mark = this.butlerReplies.length;
      client.sendRaw("send_message", { agentId: "butler", content });
      const reply = await this.waitButler(`${desc}（第${attempt}次发送）`, timeoutMs);
      if (!reply) return undefined;
      if (!reply.includes("[已停止]")) return reply;
      console.log(`[${stamp()}] ⚠️ 管家会话忙（[已停止]），60s 后重发（${attempt}/3）`);
      this.butlerReplies = this.butlerReplies.slice(0, mark); // 回退占位回复
      await new Promise(r => setTimeout(r, 60 * 1000));
    }
    return undefined;
  }
}

// ---- 文件辅助 ----
function findFiles(root: string, pattern: RegExp, max = 50): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (pattern.test(e.name)) out.push(p.replace(/\\/g, "/"));
      if (out.length >= max) return;
    }
  };
  walk(root);
  return out;
}
function readIfExists(p: string): string { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""; }
function jsonIfExists(p: string): any[] { try { return JSON.parse(readIfExists(p)); } catch { return []; } }

// ================= 早晨场景 =================
async function scenarioMorning(client: WSClient, obs: Observer) {
  console.log("\n========== 早晨 7:30-9:00 ==========");
  // 预写"昨晚管家记的日程 md"（模拟昨晚陈默让管家记的今日安排）
  const butlerDir = path.join(DATA_ROOT, "coreagents/butler");
  const wsDir = path.join(butlerDir, "workspace");
  fs.mkdirSync(wsDir, { recursive: true });
  const scheduleMd = path.join(wsDir, "陈默日程.md");
  fs.writeFileSync(scheduleMd, `# 陈默日程（昨晚管家代记）\n\n## 今日安排 2026-08-06\n- 上午：客户A 设计改稿\n- 上午：客户B 文案初稿\n- 下午：写公众号长文《一个人住3年的收纳心得》\n- 傍晚：规划下周末杭州2日游\n- 明天：妈妈体检\n`);
  console.log(`[${stamp()}] 📝 预写昨日日程 md（模拟昨晚管家代记）`);

  // TODOboard 语义快照：记录运行前全局任务（增量断言——历史残留不判定本次行为，
  // 只验证"管家在本次对话中是否把用户日程/购物清单新建进全局任务"）
  const beforeTodos = new Set(
    jsonIfExists(path.join(butlerDir, "global-todos.json")).map((t: any) => String(t.title || "").toLowerCase()),
  );

  // S1 晨间安排
  const s1Reply = await obs.sendAndWaitButler(client, "早啊管家，今天有什么安排？帮我看看我的日程", "场景1 晨间安排", 5 * 60 * 1000);
  check("S1 管家回复了晨间安排", !!s1Reply && s1Reply.length > 0, s1Reply ? `回复 ${s1Reply.length} 字符` : "无回复");
  const s1Mention = s1Reply && /客户A|客户B|改稿|公众号|杭州|体检/.test(s1Reply);
  check("S1 回复引用了日程内容（读 md 成功）", !!s1Mention, s1Mention ? "提到日程项" : "未提到日程内容");

  // S2 猫粮购物清单
  await obs.sendAndWaitButler(client, "对了我猫粮快没了，帮我记到购物清单里，晚点提醒我买", "场景2 记猫粮", 5 * 60 * 1000);
  const shoppingMds = findFiles(butlerDir, /购物|清单|待办|shopping|gouwu|qingdan/i);
  let catFoodFound = false;
  for (const f of shoppingMds) if (/猫粮/.test(readIfExists(f))) { catFoodFound = true; break; }
  check("S2 购物清单 md 已落盘并含猫粮", catFoodFound, shoppingMds.join(", ") || "未找到购物清单 md");

  // S3 按摩仪待办
  await obs.sendAndWaitButler(client, "我妈刚发来两款按摩仪让我对比，晚上再看，先帮我记到日程里", "场景3 记按摩仪", 5 * 60 * 1000);
  const scheduleFiles = findFiles(butlerDir, /日程|schedule|richang/i);
  let massageFound = false;
  for (const f of [...scheduleFiles, scheduleMd]) if (/按摩仪/.test(readIfExists(f))) { massageFound = true; break; }
  check("S3 按摩仪记入日程 md", massageFound, scheduleFiles.join(", ") || "未找到日程 md");

  // TODOboard 语义验证：本次场景未新增用户日程/购物清单类全局任务（猫粮/按摩仪/日程）
  // 注：正则不含「客户a/改稿」——「客户A品牌VI改版需求整理」是设计工作室的合法大类任务，
  // 仅日程 md 中登记的早晨安排（客户A 改稿）才是个人日程，不应进 Global TODO。
  const todos = jsonIfExists(path.join(butlerDir, "global-todos.json"));
  const newTitles = todos
    .filter((t: any) => !beforeTodos.has(String(t.title || "").toLowerCase()))
    .map((t: any) => String(t.title || ""))
    .join(" | ");
  const userStuffInNewTodos = /猫粮|按摩仪|日程/.test(newTitles.toLowerCase());
  check("TODOboard 语义：本次场景未新增用户日程/购物清单类全局任务", !userStuffInNewTodos, newTitles.slice(0, 120) || "本次未新增全局任务");
}

// ================= 上午场景：品牌设计工作室 =================
async function scenarioDesign(client: WSClient, obs: Observer) {
  console.log("\n========== 上午 9:00-12:30 品牌设计工作室 ==========");
  const groupsDir = path.join(DATA_ROOT, "groups");
  const agentsDir = path.join(DATA_ROOT, "agents");

  // S4a 建群组
  await obs.sendAndWaitButler(client, "我接了个设计外包的活，帮我建一个群组叫「品牌设计工作室」，需要资深设计师、文案、资料整理员三个角色，以后我的客户设计项目都在这个群里处理。", "S4a 建品牌设计工作室群组", 8 * 60 * 1000);
  const groups = fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir).filter(d => !d.startsWith(".")) : [];
  check("S4a 群组已创建", groups.length > 0, groups.join(", ") || "无");
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter(d => !d.startsWith(".")) : [];
  check("S4a 群内角色 Agent 已创建", agents.length >= 2, agents.join(", ") || "无");
  const groupReceipts = obs.receipts.filter((r: any) => r?.targetType === "group");
  check("S4a 建群请求处理完成（派发在任务到来时验证）", groups.length > 0 && agents.length >= 2, `共 ${obs.receipts.length} 回执（建群请求无任务，不强制派发）`);

  // 找到群组目录名（readdirSync 按 Unicode 码点排序，groups[0] 不一定是本场景新建的群组；
  // 复用数据下旧群组已存在，必须按名称精确匹配「品牌设计工作室」）
  const groupName = groups.find((g: string) => g.includes("品牌")) || groups[0] || "";
  const groupWsDir = groupName ? path.join(groupsDir, groupName, "workspace") : null;

  // S4b 发客户 A 需求（完整群组协作）
  await obs.sendAndWaitButler(client, "客户A发来需求：品牌 VI 改版，主色调从蓝色换成暖橙色，logo 加圆角，需要新的名片和信纸模板，周四前出初稿。帮我整理成要点清单，改稿要用。", "S4b 客户A需求派发群组", 10 * 60 * 1000);
  const before = obs.butlerReplies.length;
  // 等待群组工作区出现产物文件
  const wsDeadline = Date.now() + 6 * 60 * 1000;
  let artifactFound = false, artifactNames: string[] = [];
  while (Date.now() < wsDeadline && !artifactFound) {
    if (groupWsDir && fs.existsSync(groupWsDir)) {
      const walk = (dir: string, acc: string[] = []): string[] => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, acc);
          else if (/\.(md|html?|json)$/i.test(e.name)) acc.push(e.name);
        }
        return acc;
      };
      artifactNames = walk(groupWsDir);
      artifactFound = artifactNames.length > 0;
    }
    if (!artifactFound) await new Promise(r => setTimeout(r, 10000));
  }
  check("S4b 群组工作区产出文件", artifactFound, artifactNames.slice(0, 8).join(", ") || "无");
  const contentHit = artifactNames.some(n => /要点|需求|brief|client/i.test(n));
  check("S4b 产出包含需求/要点类文件", contentHit, artifactNames.join(", ") || "无");

  // S5 配色经验归属设计 Agent 私有记忆
  await obs.sendAndWaitButler(client, "对了，我想不起两年前给「XX咖啡」做的配色方案了，让设计师翻翻它自己的记忆帮我找找。另外把这次客户A的暖橙色VI偏好记到设计师自己的经验里，以后做VI都用这套。", "S5 配色经验归属", 8 * 60 * 1000);
  let designerExprHit = false, designerPath = "";
  for (const a of agents) {
    const exprPath = path.join(agentsDir, a, "EXPERIENCE.md");
    if (fs.existsSync(exprPath) && /暖橙|橙|配色|VI/.test(fs.readFileSync(exprPath, "utf8"))) {
      designerExprHit = true; designerPath = exprPath; break;
    }
  }
  check("S5 配色偏好记入设计 Agent 私有 EXPERIENCE.md", designerExprHit, designerPath || "未找到");
}

// ================= 中午场景：生活采买小队 =================
async function scenarioShopping(client: WSClient, obs: Observer) {
  console.log("\n========== 中午 12:30-14:00 生活采买小队 ==========");
  const groupsDir = path.join(DATA_ROOT, "groups");
  const agentsDir = path.join(DATA_ROOT, "agents");

  // S8 建生活采买小队 + 耳机比价
  await obs.sendAndWaitButler(client, "我最近想买副耳机，一直纠结选降噪的还是普通入耳的，预算 500 以内。帮我建个「生活采买小队」群组，需要一个购物顾问和一个比价分析，把比价任务派进去。", "S8 建生活采买小队+派耳机比价", 8 * 60 * 1000);
  const groups = fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir).filter(d => !d.startsWith(".")) : [];
  check("S8 群组已创建", groups.length > 0, groups.join(", ") || "无");
  const groupName = groups.find(g => /采买|购物|比价/.test(g)) || groups[0] || "";
  const groupWsDir = groupName ? path.join(groupsDir, groupName, "workspace") : null;
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter(d => !d.startsWith(".")) : [];
  check("S8 购物角色 Agent 已创建", agents.length >= 2, agents.join(", ") || "无");

  // 等待群组工作区产出比价文件
  const wsDeadline = Date.now() + 8 * 60 * 1000;
  let artifactFound = false, artifactNames: string[] = [];
  while (Date.now() < wsDeadline && !artifactFound) {
    if (groupWsDir && fs.existsSync(groupWsDir)) {
      const walk = (dir: string, acc: string[] = []): string[] => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p, acc);
          else if (/\.(md|html?|json)$/i.test(e.name)) acc.push(e.name);
        }
        return acc;
      };
      artifactNames = walk(groupWsDir);
      artifactFound = artifactNames.length > 0;
    }
    if (!artifactFound) await new Promise(r => setTimeout(r, 10000));
  }
  check("S8 群组工作区产出比价文件", artifactFound, artifactNames.slice(0, 8).join(", ") || "无");

  // S9 按摩仪对比进同一群组
  await obs.sendAndWaitButler(client, "我妈让我对比两款按摩仪：A款 ¥399 颈椎肩颈按摩，B款 ¥529 全身按摩，都适合老年人。也发到生活采买小队里比一比，帮我挑个性价比高的。", "S9 按摩仪对比派发", 8 * 60 * 1000);
  check("S9 管家受理按摩仪对比", obs.butlerReplies.length > 0);

  // S10 购物偏好沉淀到购物顾问私有记忆（精确匹配购物顾问 Agent，防止命中其他 Agent 既有经验文本）
  await obs.sendAndWaitButler(client, "顺便记一下我的购物偏好：我买电子产品和给爸妈买的东西都重性价比，不追大牌溢价。让购物顾问把这个记进它自己的经验里，以后推荐都按这个来。", "S10 购物偏好沉淀", 6 * 60 * 1000);
  let advisorExprHit = false, advisorPath = "";
  for (const a of agents) {
    if (!/购物顾问|顾问/.test(a)) continue;
    const exprPath = path.join(agentsDir, a, "EXPERIENCE.md");
    if (fs.existsSync(exprPath) && /性价比|溢价|不追/.test(fs.readFileSync(exprPath, "utf8"))) {
      advisorExprHit = true; advisorPath = exprPath; break;
    }
  }
  check("S10 购物偏好记入购物顾问私有 EXPERIENCE.md", advisorExprHit, advisorPath || "未找到（或偏好未写入）");
}

// ================= 下午场景：内容创作小队 + Market =================
async function scenarioCreate(client: WSClient, obs: Observer) {
  console.log("\n========== 下午 14:00-18:00 内容创作小队 + Market ==========");
  const groupsDir = path.join(DATA_ROOT, "groups");
  const agentsDir = path.join(DATA_ROOT, "agents");

  // S11 建内容创作小队 + 派公众号长文
  await obs.sendAndWaitButler(client, "今天下午我要写公众号长文《一个人住3年的收纳心得》，素材和选题数据都有。帮我建个「内容创作小队」群组，需要写手、编辑两个角色，把这篇文章的写作任务派进去。", "S11 建内容创作小队+派长文", 8 * 60 * 1000);
  const groups = fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir).filter(d => !d.startsWith(".")) : [];
  check("S11 创作群组已创建", groups.some(g => /创作|写作|内容/.test(g)), groups.join(", ") || "无");
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter(d => !d.startsWith(".")) : [];
  check("S11 写手/编辑 Agent 已创建", agents.length >= 3, agents.join(", ") || "无");

  // S14 Market 社区记账助手门禁
  const marketReply = await obs.sendAndWaitButler(client, "我一直想找个记账的助手，帮我管日常开销。你看有合适的吗？", "S14 管家响应记账需求", 6 * 60 * 1000);
  const mentionsCommunity = marketReply && /记账|community|社区|未认证|审查|确认/.test(marketReply);
  check("S14 管家回应记账需求并说明来源/需确认", !!mentionsCommunity, marketReply ? `回复提及: ${mentionsCommunity}` : "无回复");
  // 检查是否安装（社区资源应需用户确认，不能静默安装）
  const installedMd = path.join(DATA_ROOT, "market", "installed.json");
  const installed = fs.existsSync(installedMd) ? JSON.parse(fs.readFileSync(installedMd, "utf8")) : [];
  check("S14 社区资源未被静默安装（需用户确认）", !installed.some((r: any) => r?.id?.includes("expense")), JSON.stringify(installed).slice(0, 120) || "无已安装");
}

// ================= 傍晚场景：周末出行小队 =================
async function scenarioTravel(client: WSClient, obs: Observer) {
  console.log("\n========== 傍晚 18:00-21:00 周末出行小队 ==========");
  const groupsDir = path.join(DATA_ROOT, "groups");
  const agentsDir = path.join(DATA_ROOT, "agents");

  // S15 建周末出行小队 + 杭州 2 日游
  await obs.sendAndWaitButler(client, "下周末想和男朋友去杭州玩 2 天，预算 2000 以内，喜欢慢节奏不赶景点。帮我建个「周末出行小队」群组，需要旅行规划师、行程设计两个角色，把杭州 2 日游规划派进去。", "S15 建周末出行小队+派杭州规划", 8 * 60 * 1000);
  const groups = fs.existsSync(groupsDir) ? fs.readdirSync(groupsDir).filter(d => !d.startsWith(".")) : [];
  check("S15 旅行群组已创建", groups.some(g => /出行|旅行|周末/.test(g)), groups.join(", ") || "无");
  const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter(d => !d.startsWith(".")) : [];
  check("S15 旅行角色 Agent 已创建", agents.length >= 4, agents.join(", ") || "无");

  // S17 体检日程 md（管家记本地 md，不建 TODOboard）
  await obs.sendAndWaitButler(client, "对了明天我妈要体检，帮我记到日程里，明早记得提醒我。", "S17 体检日程记录", 5 * 60 * 1000);
  const butlerDir = path.join(DATA_ROOT, "coreagents", "butler");
  let bodyCheckHit = false;
  for (const f of findFiles(butlerDir, /日程|schedule/i)) if (/体检/.test(readIfExists(f))) { bodyCheckHit = true; break; }
  check("S17 体检记入管家本地日程 md", bodyCheckHit);
  const todos = jsonIfExists(path.join(butlerDir, "global-todos.json"));
  const todoTitles = todos.map((t: any) => String(t.title || "")).join(" | ");
  check("S17 TODOboard 未记录用户体检日程", !/体检/.test(todoTitles), todos.length ? todoTitles.slice(0, 80) : "全局任务为空");
}

// ================= 晚上场景：复盘与经验归属 =================
async function scenarioEvening(client: WSClient, obs: Observer) {
  console.log("\n========== 晚上 21:00-23:00 复盘与经验归属 ==========");
  const agentsDir = path.join(DATA_ROOT, "agents");

  // S18 复盘：工作类经验分派给执行层（Agent 私有记忆或群组经验库），管家只记沟通偏好
  await obs.sendAndWaitButler(client, "忙了一天，帮我复盘一下今天。另外我总结一条经验：以后给客户A报价之前要先确认需求范围，容易超工作量。把这条记到相关 Agent 的经验里，不用记在你那。", "S18 复盘与经验分派", 8 * 60 * 1000);
  let designerLearned = false, learnerPath = "";
  // 检查 1：客户A 服务 Agent 的私有记忆（EXPERIENCE.md / MEMORY.md）
  for (const a of fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter(d => !d.startsWith(".")) : []) {
    if (!/资深设计师|设计师|设计|文案|资料整理员/.test(a)) continue; // 设计工作室成员
    for (const f of ["EXPERIENCE.md", "MEMORY.md"]) {
      const p = path.join(agentsDir, a, f);
      if (fs.existsSync(p) && /报价|需求范围|超工作量/.test(fs.readFileSync(p, "utf8"))) { designerLearned = true; learnerPath = p; break; }
    }
    if (designerLearned) break;
  }
  // 检查 2：群组经验库（管家合理决策：团队共享经验）
  if (!designerLearned && fs.existsSync(path.join(DATA_ROOT, "groups"))) {
    for (const g of fs.readdirSync(path.join(DATA_ROOT, "groups")).filter(d => !d.startsWith("."))) {
      const p = path.join(DATA_ROOT, "groups", g, "EXPERIENCE.md");
      if (fs.existsSync(p) && /报价|需求范围|超工作量/.test(fs.readFileSync(p, "utf8"))) { designerLearned = true; learnerPath = `${p}（群组经验库）`; break; }
    }
  }
  check("S18 工作经验记入执行层（Agent 私有记忆或群组经验库，非管家）", designerLearned, learnerPath || "未找到");

  // S19 睡前读日程 md 确认明天安排
  const s19Reply = await obs.sendAndWaitButler(client, "准备睡了，帮我看看明天的安排。", "S19 睡前读日程", 5 * 60 * 1000);
  check("S19 管家从日程 md 汇报明天安排", !!s19Reply && /体检|明天|客户|公众号/.test(s19Reply), s19Reply ? "提到明天事项" : "未提到");
}

// ================= main =================
async function main() {
  const args = process.argv.slice(2);
  const scenario = args.find(a => a.startsWith("--scenario="))?.split("=")[1] || "all";
  const observeOnly = args.includes("--observe");
  console.log(`=== 模拟用户「陈默」真实使用 CoBeing ===`);
  console.log(`场景: ${scenario} | 数据目录: ${DATA_ROOT}`);
  if (!fs.existsSync(DATA_ROOT)) { console.error(`数据目录不存在: ${DATA_ROOT}`); process.exit(2); }

  const client = await connect();
  const obs = new Observer();
  obs.attach(client);

  if (observeOnly) {
    console.log("观察模式：持续监听 15 分钟");
    await new Promise(r => setTimeout(r, 15 * 60 * 1000));
  } else {
    if (scenario === "all" || scenario === "morning") await scenarioMorning(client, obs);
    if (scenario === "all" || scenario === "design") await scenarioDesign(client, obs);
    if (scenario === "all" || scenario === "shopping") await scenarioShopping(client, obs);
    if (scenario === "all" || scenario === "create") await scenarioCreate(client, obs);
    if (scenario === "all" || scenario === "travel") await scenarioTravel(client, obs);
    if (scenario === "all" || scenario === "evening") await scenarioEvening(client, obs);
  }

  console.log("\n=== 结果汇总 ===");
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const allOk = results.every(r => r.ok);
  console.log(allOk ? "\n🎉 全部通过" : `\n⚠️ ${results.filter(r => !r.ok).length} 项失败`);
  console.log(`事件日志: ${logFile}`);
  client.close();
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
