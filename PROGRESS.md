# CoBeing 开发进度记录

## 2026-08-05

### 清理：遗留测试群组「塔防游戏开发组」归档（真实验证时发现仍在低频自触发工作）

问题描述：
真实验证过程中观察到遗留群组「塔防游戏开发组」（PVZ 真实测试数据）仍在低频自触发：wake-system 持续唤醒 游戏开发工程师/前端工程师 处理 plants-vs-zombies.html。排查确认：自触发源自 0time TODO「已触发但长期未完成 → 10 分钟低频重触发」机制，且该群组状态为 active（registry.json 未归档）；观察期间 TODO 最终全部 completed（12:31-12:35），scanner 对 completed TODO 不重触发（group-scanner.ts line 56/63-64），群组自此自然安静。

处置方案（对齐代码 archiveGroup 语义，数据可恢复）：
1. 产物保留：`data/archives/plants-vs-zombies.html`（27,060 bytes，浏览器直接可玩）
2. 全量打包：`data/archives/塔防游戏开发组.zip`（1.8MB，含 context.jsonl/TODO/workspace/memory 等全部数据）
3. registry.json 群组 status → archived
4. 删除原目录 `data/groups/塔防游戏开发组/`（zip 已含全量数据）

顺带修复的环境问题：
- core 重启中断：destroy_agent 残留的 `临时验证资料员.deleted.*` 目录触发 pre-startup cleanup 删除失败（文件锁）导致 dev.ts 启动卡死（exit 127）；手动清理后恢复；另发现 TaskStop 只杀 tsx 父进程、node 子进程残留占用 18765 与 group.db（zip 打包失败根因），已停掉残留进程

验证：
- 重启 core：`[master-registry] Removing missing/deleting group from registry: 塔防游戏开发组` → `[group-manager] No groups in registry — skipping restore` → `getState: 4 agents, 0 groups`
- 45 秒观察窗口内 wake-system/group-todo-scanner 事件数 = 0（无任何自触发）
- 遗留 2 个测试 Agent（前端工程师/游戏开发工程师）保留（无自触发源，未在本次范围）

修改文件：
- Modify: `data/registry.json` — 群组条目 status=archived（重启后由 master-registry 自动移除缺失群组）
- Delete: `data/groups/塔防游戏开发组/`（已打包归档）
- Add: `data/archives/塔防游戏开发组.zip`、`data/archives/plants-vs-zombies.html`

### 专项：人味分级与对话式产品化（真人模拟调研 → CHARACTER 体系重构 → 用户唤醒 → 多轮交互闭环 → 对话式首启）

变更原因：
用户提出三个产品方向修正并批准实施：①初次使用不应跳问卷，应由管家对话式收集用户信息（含对管家的喜好）；②真实工作应多轮交互（先澄清→推进→确认点→继续），而非"一句话直接出成果"；③人味分级——管家重人味，执行型智能体抛弃独立角色（CHARACTER）但保留"像真人说话"的表达质感。

**一、真人模拟调研（独立产出）**
- 调研真人对话语言学特征（短句/省略/话语标记/不流畅性/上下文承接）、anti-AI-slop 社区实践（禁词清单/句式规则/自检清单）、多 Agent 框架风格控制对比（openclaw 子代理不注入 SOUL.md 只给行为约束、Claude Code 简洁即人味）
- 核心结论：**人味 = 说话方式而非身份设定**——"执行者抛弃人设但保留人味"完全可行
- 产出：`docs/调研/真人说话模拟调研.md`（含 26 条可检查的「人味表达规范」草案）

**二、CHARACTER 体系重构（执行型智能体抛弃独立角色）**
- 新增 `templates/agent/EXPRESSION.md` 取代 `CHARACTER.md`：人味表达规范（篇幅≤3句/结论先行/第一人称主动句/禁词清单/标点纪律/真人信号/群聊纪律），无任何身份设定；删除旧角色模板
- `prompt-builder.ts`：优先加载 EXPRESSION.md（无角色扮演指令）；历史 Agent 无 EXPRESSION 时兼容 CHARACTER.md + ROLE_PLAY（butler 保留人格走兼容路径）
- `creator.ts` / `create_agent` / `onboarding.ts` / `butler-create-agent`：生成字段 character → expression（LLM 生成"表达规范"而非"人物小传"）
- `AGENTS.md`/`JOB.md` 模板：启动流程与文件体系改为 EXPRESSION.md；「你的声音」改为"像同事说话不做角色扮演"
- host 协调者同样走 EXPRESSION（ensureHostDir 首次复制表达规范）；`enhancement.ts` 成长建议 CHARACTER 目标改写入 EXPRESSION
- 管家保留 CHARACTER（4 人格模板不变，默认人格检测/切换链路不受影响）

**三、用户唤醒机制（低打扰）**
- 前端 `helpers.ts`：`mentionsUser()` 用户别名识别（@用户/@主人/@老板/@user，2 字符短词不受 3 字符限制）；后端 `group-context-v2.ts` parseMentions 同步支持
- `chat.ts` addMessage 增加 `countUnread` 显式开关；`chat-handlers.ts`：群组 agent 平时消息**不通知不计未读**（低打扰核心）；仅消息 @用户 时 maybeNotify + 未读；agent_response 群组分支持去掉无条件通知（单聊/管家消息保持唤醒）
- 新增 `mentions-user.test.ts`（5 断言）

**四、多轮交互闭环（澄清→推进→确认点→继续）**
- 管家 JOB.md（data + 4 人格模板）「多步推理标准流程」重写为「多步任务推进流程」：第一步澄清关键约束（2-3 个问题后立即行动）→ 第二步推进（复用优先派发）→ **第三步确认点（方案出稿/主观偏好/群组需决策时必须停下等用户，等待期间任务置 waiting_user）**；分级转接规则增加"需求模糊→先澄清"档；决策原则增加"请求用户确认是常态"
- 群组提示词（prompt-builder GROUP_MECHANICS_NOTICE + Agent 判断框架第 3 步）：新增「如何唤醒用户」机制说明——需要用户信息/确认时 `@用户` 直接唤醒（路线 B：用户进群组回复），或经群主收束转达（路线 A）
- HOST_JOB.md（模板 + 运行时）：职责 7 与判断框架第 3 条补充 @用户 直接唤醒路径
- 双路线落地：A=群组工作完成/需确认→管家收束给用户→用户反馈→管家转回群组；B=群组内 @用户→用户直接在群组回复（postMessage("user") 链路已存在）→成员继续

**五、对话式首启（替换问卷）**
- 前端：删除 `OnboardingOverlay.tsx` 问卷弹窗与 App.tsx 挂载；首启教程关闭后注入管家欢迎消息（改为对话式引导："你平时最想让我帮你处理哪类事？希望我怎么称呼你？"）
- 管家新增 3 个 persona 工具（`butler-list-personas` / `butler-set-persona` / `butler-update-style`）——对话中按用户喜好切换人格/记录称呼语气偏好；`persona-utils.ts` 与 WS 命令（butler-persona.ts）共用文件操作逻辑（dry-run 修复：apply=false 不再误写入）
- 管家 JOB.md（data + 4 模板）新增「首启对话」范式：自我介绍→分次收集用户信息（兴趣/称呼/相处方式）→按喜好切人格→创建 1-2 个初始 Agent→轻量推荐（≤1 次）
- 后端 onboarding_apply handler 保留（能力不删，前端不再调用）；stores/onboarding.ts 保留（ws-handlers 防御引用）

验证：全量 64 files / 574 tests 全绿（含新增 mentions-user 5 断言、EXPRESSION 读写、JOB 确认点断言）；`pnpm build`（core tsc + gui-v2 tsc+vite）通过；gui-v2 类型检查修复（WsHandlerContext.addMessage 签名同步）

修改文件列表：
- Add: `docs/调研/真人说话模拟调研.md`（调研报告：特征清单/反 AI 味实践/框架对比/26 条表达规范草案）
- Add: `packages/core/src/templates/agent/EXPRESSION.md`（人味表达规范模板，取代 CHARACTER）
- Add: `packages/core/src/agent/butler/persona-utils.ts`（人格文件操作：list/apply persona、apply user style，WS+工具共用）
- Add: `packages/core/src/agent/butler/tools/persona-tools.ts`（butler-list-personas/set-persona/update-style 三工具）
- Add: `gui-v2/src/hooks/ws-handlers/mentions-user.test.ts`（@用户 唤醒识别测试）
- Delete: `packages/core/src/templates/agent/CHARACTER.md`（旧角色模板）
- Delete: `gui-v2/src/components/onboarding/OnboardingOverlay.tsx`（问卷弹窗）
- Modify: `packages/core/src/conversation/prompt-builder.ts` — EXPRESSION 优先/CHARACTER 兼容；GROUP_MECHANICS_NOTICE @用户 机制；判断框架第 3 步双路径；Speaking style 更新
- Modify: `packages/core/src/agent/paths.ts` — expressionPath + readExpression/writeExpression（保留 character 兼容）
- Modify: `packages/core/src/agent/tool-agent/creator.ts` — CreatorField character→expression；SYSTEM_PROMPT 改写为表达规范生成
- Modify: `packages/core/src/api/handlers/agent.ts` + `onboarding.ts` — 创建链路 expression 字段 + EXPRESSION.md 模板复制
- Modify: `packages/core/src/agent/butler/tools/agent-tools.ts` — butler-create-agent character 参数→expression
- Modify: `packages/core/src/agent/butler.ts` — 注册 3 个 persona 工具 + 白名单
- Modify: `packages/core/src/group/group-context-v2.ts` — parseMentions 用户别名（2 字符短词）识别
- Modify: `packages/core/src/api/handlers/butler-persona.ts` — 复用 persona-utils；dry-run 修复
- Modify: `packages/core/src/api/handlers/enhancement.ts` — 成长建议 CHARACTER→EXPRESSION 目标
- Modify: `packages/core/src/runtime.ts` — ensureHostDir 补 EXPRESSION.md 复制
- Modify: `packages/core/src/templates/agent/AGENTS.md` + `JOB.md` — EXPRESSION 文件体系 + 同事式说话准则 + @用户
- Modify: `packages/core/src/templates/host/HOST_JOB.md` + `data/coreagents/host/JOB.md` — EXPRESSION 引用 + @用户 唤醒路径
- Modify: `packages/core/src/templates/butler/personas/*/JOB.md`（4 文件）+ `data/coreagents/butler/JOB.md` — 首启对话范式 + 多步任务推进流程（确认点）+ waiting_user + 需求模糊先澄清
- Modify: `gui-v2/src/App.tsx` — 移除问卷挂载；首启欢迎消息改为对话式引导
- Modify: `gui-v2/src/stores/chat.ts` — addMessage countUnread 开关
- Modify: `gui-v2/src/hooks/ws-handlers/chat-handlers.ts` — 群组低打扰（默认不通知不计未读）+ @用户 唤醒 + 通知收紧
- Modify: `gui-v2/src/hooks/ws-handlers/helpers.ts` — mentionsUser + extractMentions 用户别名
- Modify: `gui-v2/src/hooks/ws-handlers/types.ts` — addMessage 签名同步
- Modify: `gui-v2/src/components/layout/surface-style-audit.test.ts` — 审计清单移除已删问卷
- Modify: 测试 `paths.test.ts`（EXPRESSION 读写）、`prompt-builder.test.ts`（speaking style 断言）、`runtime.test.ts`（多步任务推进流程断言）

### 专项：PVZ 真实测试复盘与修复（为什么产出不符合要求 → 7 类根因 → 12 项代码修复 → 6 轮重测通过）

变更原因：
用户要求重新检查 PVZ 真实测试（scripts/real-test-pvz.ts），真实读取工作过程弄清产出不符合要求的原因，修复后清空测试数据从零重测直至达标。

**一、真实工作过程复盘（证据）**
- 读取群组 context.jsonl（373 条消息）、PROGRESS.md（host 全程协调记录）、工程师 MEMORY/EXPERIENCE、群组 SQLite、TODO.json（**318 条重复 TODO**）、多轮测试 JSONL
- 核心现象：游戏开发工程师 bash 沙箱持续不可用（Docker 镜像未建成）→ 逻辑版产不出；前端工程师 4 次"声明动手"（如"收到规格了，开写"）但从不调用 write-file → 无 HTML 产物；host 协调与审核管道本身正常

**二、7 类根因**
1. **群组 TODO 0time 无限重建循环**（group-scanner.ts）：每次扫描把"已触发未完成"的 0time TODO 标记 expired 并新建同内容条目 → 下一扫描再触发 → 每 2 分钟向群组上下文注入一条完整任务通知，数小时堆积 300+ 重复条目、TODO.json 膨胀 600KB
2. **ConversationLoop 设计缺口**（conversation-loop.ts:383-408）：LLM 首轮无工具调用立即返回，WakeSystem 把任何文本回复当"完成"——成员"承诺开始"（如"收到规格了，开写"）即结束 run，无续做机制；GROUP_MECHANICS_NOTICE 反而写"被 @ 时优先响应"强化了只回状态的行为
3. **bash 沙箱无降级**（bash.ts/container-pool.ts）：Docker daemon 在但镜像缺失时 sandbox 开启但 bash 必失败（ensureImage → doBuild 抛错），agent 的 bash 全部瘫痪；文件工具（write-file 等）是本地直写，形成"bash 挂、文件工具可用"的脑裂
4. **WS 服务端 pong 超时误杀静默客户端**（ws-server.ts:238-254）：连接建立时立即武装 20s pong 超时，而心跳 ping 每 30s 一次——静默客户端（测试脚本发完消息后等待）在首个 ping 前（t=20s）被 terminate → 两轮测试都只收到前 20 秒事件（76-80 条）后全静默，误以为协作无产出
5. **group-memory-search 100% 失效 + todo 工具群组级失效**（group-memory-search.ts:32 / agent.ts:291）：group-memory-search 读 `(context as any).groupId` 但 ToolContext 无该字段 → 永远报错；todo 工具注册时 groupStoreGetter 传 `undefined` → host 的 todo-list 群组级调用永远"无法确定 TODO 存储"
6. **workingDir 认知混乱**：agent 不知道群组上下文的工作目录是群组工作区，用绝对路径访问自己 Agent 目录 → "path escapes working directory" 被权限系统拒绝 → 永远写不出文件；上下文也因 wake 窗口 200 条 + 大工具结果膨胀到单轮 115k-150k tokens
7. **推理模型空输出 + max_tokens 截断大参数工具调用**（最终根因）：deepseek-v4-flash 是推理模型，每轮产出 1.7万-2.6万 reasoning tokens 但零 content（思考轮被当"空回复"结束）；且 provider 默认 max_tokens=4096，write-file 携带完整 HTML 内容（上万 token）在 4096 处被截断 → 工具调用永远不完整 → 模型无限"思考写文件"但发不出调用（butler 参数短所以正常）

**三、修复（12 项，全量 535 测试通过）**
- Modify: `packages/core/src/todo/group-scanner.ts` — 删除 0time 未完成重建逻辑，已触发即保持 pending；**后补 10 分钟低频重触发**（已触发但长期未完成时重新唤醒一次，防停滞且不刷屏）；配套测试 scanner.test.ts 更新（"does not recreate or retrigger an already-triggered 0time todo"，双扫描验证）
- Modify: `packages/core/src/conversation/conversation-loop.ts` — ①新增"群组工作推回"机制：文本承诺/空响应但未产出文件时，注入「立即调用 write-file 产出交付物」指令继续循环（上限 2 次/run，**run 开始重置计数器**，修复跨唤醒累积）；仅对具备 write/edit 工具的群组成员生效（host 协调者不受影响）；②**思考轮机制**：推理模型只产出 reasoning 未产出正文时继续循环（上限 3 轮，超限以推理摘要兜底），修复 0 字符响应；③**工具结果截断 8000 字符**防上下文膨胀；④**chat 调用 maxTokens 4096→8192**（最终根因修复）
- Modify: `packages/core/src/conversation/prompt-builder.ts` — GROUP_MECHANICS_NOTICE @mention 行强化：工作任务必须先调用工具产出文件，禁止只回复"收到/开始/马上做"
- Modify: `packages/core/src/tools/bash.ts` — 沙箱基础设施故障（Docker 不可用/镜像缺失/daemon 错误）时降级本地执行（PowerShell），容器内命令失败不回退
- Modify: `packages/core/src/api/ws-server.ts` — pong 超时改为仅在心跳 ping 后武装（20s 窗口），连接建立与客户端消息只清除不武装，修复静默客户端 20s 被误杀（心跳间隔 30s > 超时 20s 的时序矛盾）
- Modify: `packages/shared/src/types.ts` + `packages/core/src/tools/executor.ts` + `group-memory-search.ts` — ToolContext 增加 groupId 字段并在群组 session 注入，修复 group-memory-search 100% 失效
- Modify: `packages/core/src/agent/agent.ts` — ①群组提示词注入**工作目录说明**（相对路径、禁止绝对路径访问自己 Agent 目录，path escapes 归零）；②**大文件分块写入指导**（单次 write-file ≤3000 字符）；③**todo 工具 groupStoreGetter 全局解析**（`undefined` → `__cobeingGroupManager.getGroupTodoStore`，修复 host 的 todo-list "无法确定 TODO 存储"）
- Modify: `packages/core/src/group/wake-system.ts` — 近期消息窗口 200→60 条，控制唤醒上下文体积
- Modify: `packages/providers/src/openai-compat/openai-provider.ts` — finish_reason="length"（max_tokens 截断）时输出已累积的部分工具调用，让截断变为可见错误而非静默丢失
- Add: `scripts/start-core.ts`（非交互 core 启动）、`scripts/clear-pvz-test-data.ts`（测试数据清理脚本，保留系统核心）

**四、验证与重测（6 轮迭代后通过）**
- 全量测试：core+shared 57 files/535 tests 全绿（含 scanner 18、bash 4、prompt-builder 25）
- 第 1-2 轮：无 HTML；发现并修复 WS pong 超时误杀（20s vs 30s 心跳）、空响应推回、推回计数器跨 run 累积
- 第 3 轮：WS 修复生效（456 事件完整流、回执 8 次、TODOboard 仅触发一次），但暴露新根因：agent 用绝对路径访问自己目录（path escapes working directory）、上下文膨胀 115k+ tokens、host todo 工具群组级失效
- 第 4-5 轮：修复工作目录提示词（path escapes 归零）、上下文瘦身（wake 窗口 60/工具结果 8K 截断）、todo store getter 全局解析、0time 10 分钟低频重触发；第 5 轮确认思考轮修复；第 6 轮管家完成 + 回执 4 次，但发现**最终根因：provider max_tokens 默认 4096，大参数工具调用（write-file 携带完整文件内容）被截断 → 工具调用永远不完整 → 模型反复"思考"但发不出调用**（engineers 的 run 每轮 17k-26k reasoning tokens、零 content）
- 第 7 轮修复：conversation-loop chat 调用 maxTokens 4096→8192 + 工作目录提示词增加"大文件分块写入（单次 ≤3000 字符）" + provider finish_reason=length 时输出已累积部分工具调用
- **第 7 轮测试全部通过（exit 0）**：管家完成（40 工具事件）→ 创建 2 Agent → 建群组 → 派发（回执 6 次）→ 群组协作产出 **plants-vs-zombies.html（检测时 9.2KB，协作随后继续完善至 26KB，单文件完整可运行）**：阳光收集（自动掉落+向日葵产出+点击）、3 植物种植（向日葵/豌豆射手/坚果墙）、2 僵尸（普通/路障）、豌豆射击+碰撞+啃食战斗、3 波次、胜负判定（overlay+重开）、Canvas 图形化（天空/云/草坪/实体）、主循环 requestAnimationFrame、全部 DOM 引用完整、JS 语法合法（复验通过）
- 测试数据已归档（2026-08-05）：`data/archives/plants-vs-zombies.html`（浏览器直接打开可玩）+ `data/archives/塔防游戏开发组.zip`（全量群组数据）



变更原因：
用户要求「整理从 1.3 开始以后的更新」。此前代码版本号自 2026-06-03 统一为 1.4.0，但 `PROGRESS-VERSION.md` 发布记录仍停在 v1.3.1（2026-05-26）。本次把 2026-06-01 ~ 2026-08-04 的全部开发工作按 10 个里程碑整理为 v1.4.0 条目补入发布记录。

修改文件：
- Modify: `PROGRESS-VERSION.md` — 新增 v1.4.0 条目，按里程碑组织：插件系统全能力 / 前端扩展系统重设计+基础架构重构 / TODOboard 三层架构+管家入口数据层 / 管家+通用智能体能力 / GUI A 方案优化与稳定性 / 聊天+群组稳定性大修 / 前端与后端重构 / Market 分级机制 / 管家入口产品化 / GUI 能力清理+美观化+真实测试

修改内容摘要：
- v1.4.0 条目注明"尚未产出发布包（releases/ 最新仍为 v1.3.1）"，与代码事实一致
- 里程碑内容全部基于 PROGRESS.md 已有记录，无新增幻觉

### 专项：数据清除 + GUI 全局美观化 + 真实测试（植物大战僵尸 demo 全链路验证，发现并修复 5 个真实 bug）

变更原因：
用户三项指令：① 清除已有运行数据减少干扰；② 自查 GUI 所有页面（含子页面）做美观化；③ 自主完成真实测试——与管家对话制作植物大战僵尸 demo，验证全部机制真实运行。

**1. 数据清除**
- 删除用户创建的 Agent（前端工程师/游戏开发工程师）、群组（植物大战僵尸---塔防游戏开发组）、观测数据（observability.db）、管家记忆与任务状态（butler-tasks/bindings/global-todos/current.md）、registry.json 用户条目；保留系统核心（butler/host/coreagents/toolagents/skills/plugins/market 官方资源）

**2. GUI 全局美观化（4 组并行审计 + 3 组并行修复 + 自查修复）**
- 派 4 个审计代理全量审查 ~60 个组件（chat/agent/group/todo/shared/onboarding/tutorial/layout/observability/extensions/sandbox/settings/ui），按用户 UI 偏好（层次化渲染/留白≥20px/字号≥14px/圆角统一/无硬编码色/浮层磨砂）输出 P0/P1/P2 违规清单
- 3 个修复代理执行：面板组 16 文件（CreateAgentDialog 白名单块/高级配置 text-xs→text-sm/select 统一 h-9、AgentConfigTab 硬白块→bg-elevated、Butler persona chip、tabs 基础类冲突、两详情面板 tab 栏统一 grid、列表行 14px20px、GroupHealthPanel 标题、GroupMembersTab 移除成员加 ConfirmDialog、disabled 统一 opacity-50 等）；任务/浮层组 13 文件（GlobalTodoPanel 列表行去边框+hover、CodeBlock 暗底补前景色、Onboarding/Tutorial 遮罩对齐标准磨砂参数、Sidebar 行 padding、TodoPanel/Kanban/Calendar/Clock/TodoForm 字号与留白、ToggleSwitch 增大、SearchInput 等）；独立页组 19 文件（DashboardView KPI 卡升级+复活 Latency/Token/ToolRank 死代码卡、ActiveAgentsPanel/PluginsTab/SkillsTab/McpsTab/MarketTab/SandboxMonitor/SettingsView/UserProfile/ThemeSelector/ChatSearch/LogsSection/AgentTimeline/WakeQueue/WorkspaceBinding 全量整改 + 空态统一图标化）
- 自查修复 chat 组：ChatInput 技能/@提及弹窗移出 overflow-hidden 容器（**P0 功能 bug：弹窗被裁剪不可见**）、ChatInputActions 去拥挤（padding 4px8px→8px12px、gap、text-sm）、ChatHeader/GroupHeader 统一复用 ChatAvatar+lucide Settings+text-sm 按钮、发送按钮统一 bg-accent、GroupMessageBubble 删重复 GroupToolCalls 改用共享 ToolCallsGroup、折叠卡统一 hover 态、TodoInline 溢出修复、ChatMessageFrame gap-4、删除死代码 ToolCallMessage.tsx
- **P0 启动崩溃修复：浏览器模式 React 不挂载**（CDP 实测发现）：useTray 直接调用 Tauri API（getCurrentWindow）在非 Tauri 环境抛错导致 App 崩溃白屏；新增 `lib/utils.ts isTauri()` 守卫，useTray 三个 Tauri effect + tray store emit 全部加守卫，exitApp 回退 window.close()；`surface-style-audit.test.ts` 审计清单从 16 个文件扩展到 66 个
- 验证：tsc 0 错误、vitest 568 全绿、vite build 通过、CDP 计算样式断言（渐变背景/20px padding/12px 圆角/粉色主按钮/弹窗在视口内/无横向溢出）通过

**3. 真实测试（scripts/real-test-pvz.ts 新增）：与管家对话制作植物大战僵尸 demo**
- 第 1 轮（未修复基线）：管家全链路可用（创建 2 Agent → 建群组 → 派发 → 回执 6 次 → 定时检查 TODO），但发现 **bug A：群组挂载失败**（沙箱镜像自动构建路径硬编码 `cobeing/sandbox/` 在项目根 CWD 不存在）→ Agent 未绑定群组工作区各自空转
- 第 2 轮（修复 A + reviewer 修复）：**bug B：group-send 崩溃**（`group.config.reviewer` 为 undefined 时 `reviewerCfg?.enabled !== false` 求值 true 却访问 `reviewerCfg.maxRounds` 崩溃，runtime.ts:1077 同类）→ 修复后 group-send 全链路工作（host 消息通过审核管道 "message passed review" → 入组 → wake 两位工程师）
- 第 3 轮：**bug C：镜像构建无依赖链**（Dockerfile.full FROM :python、:python FROM :base，自动构建只建目标）→ 补 base→python→full 链；**bug D：dockerCmd 30s 超时**杀死长构建 → 构建命令 600s；**bug E：Dockerfile.base `useradd -u 1000` 与 node:20-bookworm 自带 UID 1000 冲突** → 去掉固定 UID
- 第 5 轮（全部修复）：管家环节全绿（48 工具事件），群组协作真实产出：视觉设计方案.md（967 字符）+ visual_draw.js（8441 字符，含草坪/向日葵/豌豆射手/坚果墙/僵尸/阳光全绘制函数）、host 协作协议（逻辑版先行→视觉叠加→里程碑同步）、审核管道通过、wake 系统 143 次调度、群组记忆库（4 个 SQLite）落盘
- 残余环境阻塞（非代码）：Docker Hub 网络不稳定（EOF）导致沙箱镜像最终未能建成（国内网络建议配置 registry mirror）；LLM provider 偶发 "terminated" 中断游戏开发工程师产出轮次；demo HTML 在 15 分钟观察窗口内未完成
- 测试脚本：WS 驱动 send_message → 全事件监听（agent_started/tool_event/butler_task_updated/agent_response/agent_completed/group_message/usage_stats）→ 等待群组工作区 HTML 产物 → 产物核验（Agent/群组/工作区文件/全局 TODO/回执/工具链路）

修改文件列表（本次会话）：
- Modify: `gui-v2/src/lib/utils.ts` — 新增 isTauri() 守卫
- Modify: `gui-v2/src/hooks/useTray.ts` — Tauri effect 全量加 isTauri 守卫；exitApp 非 Tauri 回退 window.close()
- Modify: `gui-v2/src/stores/tray.ts` — emit 加 isTauri 守卫
- Modify: `gui-v2/src/components/chat/ChatInput.tsx` — 弹窗溢出修复（overflow-visible）+ padding 20 + 按钮/菜单 text-sm rounded-lg
- Modify: `gui-v2/src/components/chat/ChatInputActions.tsx` — 去拥挤（8px12px/gap8/text-sm/size14）
- Modify: `gui-v2/src/components/chat/ChatHeader.tsx`、`GroupChatView.tsx` — 复用 ChatAvatar、lucide Settings、text-sm 按钮、发送按钮统一 bg-accent、padding 20
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 删重复 GroupToolCalls 改用 ToolCallsGroup
- Modify: `gui-v2/src/components/chat/ToolCallsGroup.tsx`、`TaskReceiptCard.tsx` — 折叠头 hover 态、p-4、gap 8
- Modify: `gui-v2/src/components/chat/TodoInline.tsx`、`ChatAvatar.tsx`、`ChatMessageFrame.tsx` — 溢出修复/边框统一/gap-4
- Delete: `gui-v2/src/components/chat/ToolCallMessage.tsx`（死代码）
- Modify: 面板/任务/浮层/独立页 48 个组件（详见上节清单）
- Modify: `gui-v2/src/components/layout/surface-style-audit.test.ts` — 审计清单 16→66 文件
- Modify: `packages/core/src/tools/group-tools.ts` — reviewerCfg 默认 `{enabled:true, maxRounds:3}` 修复崩溃
- Modify: `packages/core/src/runtime.ts` — 同 reviewer 修复（L1077 同类模式）
- Modify: `packages/core/src/tools/sandbox/container-pool.ts` — resolveSandboxDir（cwd/module 双路径）、sandboxDockerfileFor、ensureImageExists 依赖链、dockerCmd 超时参数化（构建 600s）
- Modify: `sandbox/Dockerfile.base` — useradd 去固定 UID 1000
- Modify: `scripts/build-sandbox.sh` — full 构建补 -t cobeing-sandbox:latest
- Add: `scripts/real-test-pvz.ts` — 真实测试脚本（WS 驱动 + 产物核验）

### 修复：start.bat 端口清理失效导致新 core 启动失败（kill-cobeing-port.ps1 Start-Job 超时跳过 + start.bat 嵌套引号）

问题描述：
用户要求检查 start.bat 是否正常。实际运行 `start.bat /fast` 验证：主流程（前置检查 → 构建/快模式 → 启动 core → WS 就绪 → tauri dev → GUI 连接）能跑通，但发现 3 个缺陷：

1. **kill-cobeing-port.ps1 失效**：本机 18765 端口被 2026-08-03 挂起的 smoke-market.ts 进程（tsx 语法检查 eval 未退出，4 个 node 进程占端口至今）占用。脚本用 `Start-Job` 包裹 netstat 查询，本机子进程启动慢导致 15s 超时 → 打印 "[WARN] netstat timed out after 15s, skipping port check" 后跳过 → **旧进程未被杀掉**。
2. **新 core 绑定端口失败**：旧进程存活 → 新 core（pnpm dev）EADDRINUSE 启动失败（进程列表无 dev.ts）；start.bat 的 WS 就绪检测（TCP connect）连上的是**旧进程**，误判 "WS server is ready"，GUI 实际连的是昨天挂起的旧 core。
3. **start.bat 嵌套引号隐患**：`start "CoBeing Core" cmd /k "cd /d "%ROOT%" && call pnpm dev"` 引号嵌套脆弱（当前路径无空格碰巧可用）。

根因分析：
- kill 脚本用 Start-Job 异步执行 netstat —— 在该环境子进程启动显著慢于 15s 超时窗口，属于"用异步兜底同步慢查询"的错误设计；应同步查询 + 快速 cmdlet。
- start.bat 的 WS 就绪检测只验证 TCP 可连，无法区分新旧进程；端口 kill 失败时应显式告警。

修改文件列表：
- Modify: `CoBeing/scripts/kill-cobeing-port.ps1` — 弃用 `Start-Job`+netstat（超时跳过）；改用 `Get-NetTCPConnection -State Listen` 同步查询（毫秒级），失败时同步 netstat 兜底；杀进程后二次验证端口释放，`exit 0`（已释放）/ `exit 1`（仍占用）供调用方判断
- Modify: `CoBeing/start.bat` — ① `start "CoBeing Core" /D "%ROOT%" cmd /k "call pnpm dev"`（/D 指定工作目录，消除嵌套引号）；② kill 脚本返回 errorlevel 1 时打印明确 WARN（端口仍占用，新 core 可能绑定失败），不再静默继续

修改内容摘要：
- 修复后实测：kill 脚本对占用 18765 的残留进程瞬间生效（Killed PID 23916 → Port 18765 is now free）；清理 4 个昨天挂起的 smoke-market 僵尸进程
- 重新运行 `start.bat /fast` 端到端验证通过：Port free → 新 core 绑定成功（今日进程）→ WS 就绪（连的是新 core）→ tauri 编译 13s → cobeing.exe 启动 → **netstat 显示 GUI 与 core 之间 ESTABLISHED 连接**（GUI 真实连上新 core）
- 验证后已清理全部测试进程与日志，端口释放

### 新功能：GUI 未接入能力清理 + 真实数据流接入 + 视觉一致性（技能执行/孤儿组件/沙箱真实指标/通知音效/回执刷新）

变更原因：
用户指示「下一步完善 GUI 界面：把未更新的功能加入 GUI，同时保持前端美观」。按 `docs/项目信息/当前待办.md` P1「GUI 未接入能力清理」逐项核实，本次对「看起来可用其实不完整」的入口执行二选一（接入或删除），并补齐回执卡片状态流转与群组派发回执。

**1. 孤儿组件接入主视图（全部有真实 WS 数据链路，此前无人挂载）**
- Modify: `gui-v2/src/components/agent/AgentDetailPanel.tsx` — 新增「时间线」tab，挂载 `AgentTimeline`（`get_agent_timeline` / `agent_timeline` 事件，展示工具调用成功/失败时间线）
- Modify: `gui-v2/src/components/group/GroupDetailPanel.tsx` — tabs 4→5，新增「健康」tab，挂载 `GroupHealthPanel`（`get_group_health`：任务完成率/成员活跃度/最长阻塞）
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 新增「唤醒队列」入口（运维组），挂载 `WakeQueueSection`
- Modify: `gui-v2/src/components/settings/WakeQueueSection.tsx` — **修复 ws client 从未注入的断链**：`setWakeQueueWsClient` 无任何调用方，改为直接使用 `useWebSocket` 的 `getWsClient()`；高度从全屏页适配为设置页内嵌（maxHeight 480 + 空态 minHeight）
- Modify: `gui-v2/src/components/observability/DashboardView.tsx` — Agent 活跃度改为柱状图卡片 `AgentActivityCard`（替换冗余的内联统计，删除无引用 StatItem）

**2. 技能执行真实链路（此前「执行技能」按钮无 onClick，`execute_skill` 从未被发送）**
- Modify: `gui-v2/src/components/extensions/SkillsTab.tsx` — 执行区：任务输入 → `execute_skill` → 监听 `ws-skill-result` 展示结果 / `ws-error` 展示失败；执行中 spinner 状态
- Modify: `gui-v2/src/hooks/ws-handlers/system-handlers.ts` — `error` 消息额外广播 `ws-error` CustomEvent（供技能执行等组件捕获）

**3. 沙箱监控真实指标（此前 CPU/内存/磁盘硬编码 0）**
- Modify: `packages/core/src/tools/sandbox/container-pool.ts` — 新增 `stats()`（`docker stats --no-stream` 真实采集 CPU%/MemUsage）+ 导出 `parseDockerStats()` 解析器
- Modify: `packages/core/src/tools/sandbox/docker-sandbox.ts` — 新增 `getMetrics()`（真实指标或 null）；`getStatus()` 保持同步，不破坏 `SandboxRunner` 接口
- Modify: `packages/core/src/api/handlers/sandbox.ts` — `get_sandbox_status` 异步化：`getStatus()` + `getMetrics()` 合并，指标不可用降级 0
- Modify: `gui-v2/src/components/sandbox/SandboxMonitor.tsx` — 指标不可用时不展示假数据（显示「—」+ 提示行），磁盘无限量时隐藏磁盘项
- Modify: `packages/core/src/tools/sandbox/container-pool.test.ts` — 新增 parseDockerStats 3 测试

**4. 通知音效开关真实化（此前 `sendNotification` 从未被调用、sound 无行为）**
- Add: `gui-v2/src/lib/notify.ts` — `playNotificationSound()`（Web Audio 合成柔和双音，无需资源文件）+ `sendSystemNotification()`（Tauri 插件）+ `maybeNotify()`（仅目标会话非当前查看或窗口失焦时触发）
- Modify: `gui-v2/src/hooks/ws-handlers/chat-handlers.ts` — `agent_response`（单聊回复）/群组响应接入 `maybeNotify`
- Modify: `gui-v2/src/hooks/useTray.ts` — 删除从未被调用的 `sendNotification`（被 notify.ts 取代）

**5. 任务回执卡片状态流转（此前同 butlerTaskId 回执到达即丢弃，卡片永不刷新；群组派发无回执）**
- Modify: `gui-v2/src/stores/chat.ts` — 新增 `updateTaskReceipt(convId, receiptId, patch)`（按 id 合并更新消息 metadata.taskReceipt）
- Add: `gui-v2/src/lib/taskReceipt.ts` — `toTaskReceipt()` + RECEIPT_STATUSES 从 ChatView 提取共享
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — 回执事件改为「已存在则更新卡片，不存在才追加」（running → waiting_user/completed/failed 实时刷新）
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 监听 `ws-butler-task-receipt`，展示派发给当前群组的回执卡片（targetType=group 过滤）
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — agent 消息渲染 `TaskReceiptCard`，空内容消息不渲染空白段

**6. 视觉一致性**
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 左侧菜单分组标题从「── 组 ──」改为小标签 + 柔和分隔线（letter-spacing 0.12em）
- Modify: `gui-v2/src/stores/settings.ts` — `SettingsSection` 增加 `"wakequeue"`

验证：63 files / 568 tests 全绿（含新增 parseDockerStats 3 测试）；`pnpm -r run build`（shared/channels/providers/qqbot/office/plugin-sdk/core）+ `gui-v2 pnpm build`（tsc + vite）全部通过。

### 新功能：管家入口产品化四阶段全部实施（阶段 A 转接真实化 / B 首次问卷 / C 模板+风格 / D 低打扰）

变更原因：
用户指示「完成全部阶段」。基于 `docs/superpowers/specs/2026-08-04-butler-entry-productization-research.md` 的分阶段方案，拆解 5 个并行子任务（task-butler-core-backend / task-butler-receipt-backend / task-onboarding-backend / task-butler-receipt-frontend / task-onboarding-persona-frontend）实施，主线程集成注册、接线与验证。

**阶段 A：任务转接体验真实化（复活空壳资产）**
- Modify: `packages/shared/src/butler-bridge.ts` — 新增 `ButlerTaskReceiptPayload`（butlerTaskId/globalTodoId/title/targetType/targetId/assigneeName/status/summary/nextAction/timestamp）
- Modify: `packages/core/src/butler/dispatch.ts` — `buildButlerTaskReceiptPayload()`；`butler_task_updated` 广播携带完整结构化视图（原仅 timestamp）
- Modify: `packages/core/src/agent/butler/tools/dispatch-tools.ts` — `formatDispatchReceipt` 结构化（文本不变 + 结构化视图）；派发/取消/回复广播完整 payload
- Modify: `packages/core/src/tools/agent-task.ts` — 状态同步广播携带 status/title
- Modify: `packages/core/src/api/handlers/agent.ts` — `dispatch_task` 支持 `targetType:"agent"|"group"` + groupId + notifyTarget 透传，旧 payload 向后兼容
- Add: `packages/core/src/butler/dispatch.test.ts` — 10 测试
- Add: `gui-v2/src/hooks/ws-handlers/butler-task-handlers.ts` — `butler_task_updated` → store upsert + `ws-butler-task-receipt` 事件
- Modify: `gui-v2/src/stores/butlerTasks.ts` — 复活：新增 `upsertTask`（按 butlerTaskId 合并）+ `computeSummary`
- Modify: `gui-v2/src/components/todo/GlobalTodoPanel.tsx` — 顶部「管家任务」小计区（运行中/等待你/已完成徽章），空数据不渲染
- Modify: `gui-v2/src/components/chat/ChatInputActions.tsx` — 派发菜单升级为结构化 `dispatch_task`（选 Agent/Group 直接派发）
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — 监听回执事件 → 聊天流追加 metadata.taskReceipt 消息 → **TaskReceiptCard 首次真实点亮**（同 butlerTaskId 去重）

**阶段 B：首次使用问卷 + 初始 Agent**
- Add: `packages/core/src/api/handlers/onboarding.ts` — `onboarding_apply`（兴趣→角色映射→Creator 生成 1-2 个初始 Agent，失败模板 fallback 不阻塞；Market 官方推荐 ≤2 条不自动安装；data/onboarding.json 幂等）+ `onboarding_get`
- Add: `gui-v2/src/stores/onboarding.ts` — 问卷状态机（submit/applyResult/20s 超时降级）+ localStorage 首启标记
- Add: `gui-v2/src/components/onboarding/OnboardingOverlay.tsx` — 磨砂浮层兴趣问卷（7 项 chips 多选 + 自定义输入 → 结果视图：创建 Agent 列表 + Market 推荐卡）
- Modify: `gui-v2/src/App.tsx` — OnboardingController（tutorial 后出问卷，两浮层不叠加）+ 首启管家欢迎消息注入
- Modify: `gui-v2/src/components/chat/ChatHeader.tsx` — 副标题 undefined 修复（未加载显示「连接中…」）

**阶段 C：管家模板 + 风格优化（含固定 prompt → 文件 prompt 地基改造）**
- Add: `packages/core/src/templates/butler/base/` — AGENTS.md / MEMORY.md / EXPERIENCE.md 模板
- Add: `packages/core/src/templates/butler/personas/` — 4 人格（亲密朋友/专业秘书/学习陪伴/家庭助理）×（CHARACTER.md + JOB.md）；JOB.md 含分级转接规则 + Market 推荐纪律 + 多步推理流程（原硬编码 prompt 整体迁移）
- Modify: `packages/core/src/runtime.ts` — `ensureButlerDir()`（首启创建管家文件体系，已存在不覆盖，先于 createButler 执行）+ `reloadButlerSelfConfig()`；createButler 默认 prompt 改为短底座
- Modify: `packages/core/src/agent/butler.ts` — 导出 `BUTLER_DEFAULT_TOOLS`/`BUTLER_DEFAULT_SYSTEM_PROMPT`；ConversationLoop 增加 promptBuilder（**管家首次走文件 prompt：EXPERIENCE.md/记忆进入 prompt**，实时生效无需重建 loop，工具注册零改动）
- Add: `packages/core/src/api/handlers/butler-persona.ts` — `butler_get_personas`（4 模板 + current 内容匹配检测）/ `butler_set_persona`（复制模板文件，防路径穿越）/ `butler_update_style`（apply=true 写 CHARACTER.md 用户偏好段 + config.json name）
- Add: `packages/core/src/runtime.test.ts` — 9 测试（含文件 prompt 生效与工具注册不退化断言）
- Modify: `gui-v2/src/components/agent/ButlerConfigPanel.tsx` — 「管家形象」区：称呼/欢迎语输入 + 4 模板选择 + 保存

**阶段 D：低打扰提示**
- 推荐纪律写入 4 份 JOB.md：官方内置/认证且明显优于本地才轻量提示（每会话 ≤1 次）、社区必须 confirmed、本地已有能力时闭嘴

**主线程集成**
- Modify: `packages/core/src/api/ws-server.ts` — 注册 registerButlerPersonaHandlers / registerOnboardingHandlers
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 并入 buildButlerTaskHandlers / buildOnboardingHandlers
- Add: `gui-v2/src/hooks/ws-handlers/onboarding-handlers.ts` — onboarding_result → store；butler_personas/set/style_updated → CustomEvent
- Add: `scripts/smoke-butler.ts` — 管家冒烟脚本（19 项断言，随机空闲端口）

验证：
- `pnpm build` 全 workspace 通过
- `pnpm test` 63 files / 565 tests 全绿（此前 61/546；+runtime.test 9 + dispatch.test 10）
- `npx tsx scripts/smoke-butler.ts` 19/19：管家文件体系/4 模板/切换/风格更新/agent+group 派发 + 结构化回执事件/onboarding（含无 API key 时 Creator 降级模板 fallback 仍成功）/幂等/Market 集成回归
- `npx tsx scripts/smoke-market.ts` 25/25 回归通过
- gui-v2 tsc + build + vitest 19/19 通过

冒烟中修复的问题：
1. smoke-butler 客户端响应 type 不匹配（butler_personas/dispatch_task_result/group_created 等响应 type ≠ 请求 type）——与 smoke-market 的 get_state 同类问题，统一改用 sendFor
2. dispatch_task 无 API key 时通知目标 Agent 触发 LLM 挂起 → handler 透传 notifyTarget（工具层已有，WS 层遗漏）；冒烟用 notifyTarget:false 验证纯派发链路
3. onboarding-handlers 类型引用语法错误（typeof x.y() 非法）→ 改用显式导入 OnboardingApplyResultPayload

## 2026-08-04

### 记录：GUI 未接入能力清理问题复查确认

变更原因：
用户确认「GUI 功能接入还有问题」，据此对 `当前待办.md` P1「GUI 未接入能力清理」做状态复查。2026-08-01 的骨架重构与 2026-08-03 的 Market 开发均未触碰这些组件，问题依旧：

- 扩展页技能执行按钮：后端 `execute_skill` 命令真实存在，前端按钮发送链路未逐项验证
- WakeQueueSection / GroupHealthPanel / AgentTimeline：组件已写但无任何主视图引用
- 沙箱监控 CPU/内存/磁盘指标：前端展示位在，后端真实指标链路未确认
- 通知音效开关：无真实行为链路

修改文件：
- Modify: `docs/项目信息/当前待办.md` — GUI 清理项补充 2026-08-04 复查结论与处理顺序建议（先管家产品化、后清理）

### 研究：管家入口产品化专项（完成）

变更原因：
`当前待办.md` P1「管家入口产品化」优先级提升，用户指示「先研究加强管家」。完成专项研究：主线程一手核实 + 两路只读探索子智能体（后端管家能力 / 前端首次使用体验）交叉验证，对照战略五需求输出缺口分析与分阶段实施方案。

关键发现（代码事实）：
1. **任务转接断链**：后端广播 `butler_task_updated`（4 处）但前端零 handler；消息 metadata.taskReceipt 后端从不写入 → TaskReceiptCard 永不渲染；stores/butlerTasks.ts 零消费者（死代码）；ChatInputActions 派发/创建只插文本不触发结构化派发
2. **管家无配置载体**：data/coreagents/butler/ 无 config.json/JOB.md/CHARACTER.md；管家走固定 prompt 路径（EXPERIENCE.md/memory 不进 prompt）；人格是 runtime.ts 硬编码 systemPrompt
3. **无"自己答 vs 派发"分级规则**：只有 Agent 复用 5 条规则，转接决策全靠 LLM 临场发挥
4. **首次使用零引导**：6 步告知型教程存在但非问卷；无兴趣/需求收集；空数据态只有一行文案；后端未就绪时头部渲染 undefined
5. **管家模板/风格优化零实现**：无 templates/butler/；无称呼/语气/主动性配置面
6. **假开关与断链**：通知声音/系统通知/Tauri 通知无实现；托盘未读恒 0；escalationPolicy 存而未用
7. 已核实的真实资产：GlobalTodoPanel 数据流真实、find_agent/dispatch_task/get_global_todos 全部真实、派发链路闭环完整

产出：
- Add: `docs/superpowers/specs/2026-08-04-butler-entry-productization-research.md` — 现状盘点（§4.0 一手核实 + §4.1 后端 + §4.2 前端 + §4.3 未接入清单）、差距分析（§5 五需求逐项）、分阶段方案（§6：A 转接真实化 → B 问卷+初始 Agent → C 模板+风格优化 → D 低打扰策略）、风险与决策点（§7）

建议：下一轮开发按阶段 A（转接体验真实化，复活已有资产）优先，预计一轮开发即可点亮回执卡片/butlerTasks store/ChatInputActions 结构化派发。

## 2026-08-03

### 新功能：Market 分级机制落地（P1 待办完成）

变更原因：
`docs/项目信息/当前待办.md` P1「Market 分级机制落地」与 `产品战略.md`「Market 战略」要求落地官方/认证/社区/本地四层信任分级、依赖树透明、社区资源用户审查门禁、管家推荐规则。此前代码仅有战略文档与 prompt 提示词引用，无任何 Market 模块。本次实现 v1：agent / group / skill 三类可安装资源（persona/plugin 资源标记为规划中）。

修改文件（后端新增）：
- Add: `packages/core/src/market/types.ts` — MarketResourceType / MarketTier（official/certified/community/local）/ MarketRiskLevel / MarketDependency / MarketResource / MarketResourceView / MarketDepNode / MarketInstallStatus / MarketInstallResult / InstalledEntry
- Add: `packages/core/src/market/catalog.ts` — MarketCatalog（扫描 `data/market/<tier>/<id>/market.json`，非法/错位 id 跳过 warn，installed.json 原子持久化）+ buildLocalResources（现有 Agent/技能合成 local 层，排除 butler/host）
- Add: `packages/core/src/market/installer.ts` — MarketInstaller：visited 防环依赖树（缺失依赖生成 community 保守节点）、社区门禁（无 confirmed 返回 approval_required）、拓扑序三类安装（skill→data/skills、agent→data/agents、group→data/groups + 先装 agent 依赖）、双重路径穿越防护（根 id 与依赖 id）、卸载不级联
- Add: `packages/core/src/market/tools.ts` — makeMarketRecommendTool（butler-market-recommend：官方/认证优先、社区 ⚠️ 需用户审查标注、本地默认路径）+ makeMarketInstallTool（butler-market-install：approval_required 引导 confirmed:true）
- Add: `packages/core/src/market/bundled/` — 4 个内置示例资源（中文真实内容）：official/travel-planning（skill 旅行规划）、official/travel-planner（agent 旅行规划师，依赖 skill）、official/travel-team（group 旅行规划小队，依赖 agent）、community/expense-assistant（agent 记账小助手，community/medium 演示门禁）
- Add: `packages/core/src/market/catalog.test.ts`（9 测试）+ `installer.test.ts`（16 测试）— TDD 先行，覆盖依赖树/门禁/三类落盘/卸载/路径穿越/幂等/持久化

修改文件（后端接线）：
- Add: `packages/core/src/api/handlers/market.ts` — market_list / market_get / market_install / market_uninstall / market_installed 5 个 WS 命令；market_list 聚合文件型资源 + 本地私有资源并支持 type/tier/query 过滤
- Modify: `packages/core/src/api/ws-server.ts` — 注册 market handlers；增加 marketCatalog/marketInstaller 字段与 setMarketServices()
- Modify: `packages/core/src/runtime.ts` — 构造函数初始化 MarketCatalog + MarketInstaller（hooks 真实接线：registerMarketAgent 读 config.json 注册 Agent、createMarketGroup 建群+注册 ButlerRegistry、destroyMarketGroup、reloadSkills）；start() 增加 initMarketServices()（ensureMarketDirs + syncBundledMarketResources 首次把 bundled 复制到 data/market + catalog.reload）；ensureDataDirs 增加 market
- Modify: `packages/core/src/agent/butler.ts` — 注册 butler-market-recommend / butler-market-install（经 globalThis.__cobeing.runtime 取 catalog/installer，local 资源经 __cobeing.agentRegistry/skillRepo 实时聚合）
- Modify: `packages/core/src/skills/repository.ts` — 新增 public reload()（Market 安装/卸载技能后重扫）
- Modify: `packages/core/src/index.ts` — 导出 MarketCatalog/buildLocalResources/MarketInstaller/make*Tool 与全部类型

修改文件（前端）：
- Add: `gui-v2/src/stores/market.ts` — useMarketStore：resources/installed/filters/detail/installState 状态机/pendingInstall/lastError + 11 个 action，统一 getWsClient().send
- Add: `gui-v2/src/hooks/ws-handlers/market-handlers.ts` — 5 个 WS 消息 handler（含安装状态机、卸载同步 detail、emitActivity 日志）
- Add: `gui-v2/src/components/extensions/MarketTab.tsx` — 类型 chips + 信任分级 chips + 搜索过滤栏；资源卡片网格（tier/risk 徽章、类型图标、两行截断、tags、安装/已安装+卸载/本地禁用）；详情 Sheet 浮层（描述/权限列表/递归依赖树/操作条）；社区确认流（approval_required 警告区 + 确认安装）；加载/错误/安装中状态；全主题 token
- Modify: `gui-v2/src/lib/types.ts` — 追加 9 个 Market 类型；ExtensionsTab 增加 "market"
- Modify: `gui-v2/src/components/extensions/ExtensionsView.tsx` — TABS 增加 Market 项并渲染 MarketTab
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 并入 buildMarketHandlers

修改文件（其他）：
- Modify: `vitest.config.ts` — 根测试 include 追加 gui-v2/src/**/*.test.ts(x) + `@` 别名（修复既有问题：根 `pnpm test` 此前不覆盖 gui-v2 测试，gui-v2 需单独在子目录跑）
- Add: `scripts/smoke-market.ts` — Market WS 冒烟脚本（随机空闲端口，不污染真实 data/，25 项断言）

验证：
- `pnpm build`（全 workspace）通过
- `pnpm test` 61 files / 546 tests 全绿（此前 55/502；+25 Market 测试 + 19 gui-v2 测试纳入根命令）
- gui-v2 `tsc --noEmit` + `vite build` 通过；gui-v2 vitest 4 files / 19 tests 全绿
- `npx tsx scripts/smoke-market.ts` 25/25 通过：市场列表（4 内置 + 本地聚合）、type/tier 过滤、依赖树（agent→skill、group→agent）、官方资源直接安装落盘、already_installed 幂等、社区无确认门禁 approval_required、社区确认安装 + Agent 注册 registry、卸载删目录 + installed 记录同步

产品规则落地对照：
- 官方认证资源：管家可轻量推荐（butler-market-recommend 官方/认证优先）
- 未认证社区资源：必须用户确认（installer 门禁 + 前端确认流 + Butler 工具引导 confirmed:true）
- 私人生成资源：本地资源在 market_list 以 local 层展示，管家默认本地创建
- Group > Agent > Skill 依赖树：安装前 market_get/market_install 返回完整依赖树，前端递归渲染

## 2026-08-01

### 重构：前端 ChatView.tsx 拆分 7 个子组件 + useWebSocket.ts 消息处理拆分

变更原因：
`gui-v2/src/components/chat/ChatView.tsx`（646 行）同文件堆叠 7 个子区块；`gui-v2/src/hooks/useWebSocket.ts`（759 行）useEffect 内巨型 switch 处理 71 种 WS 消息。拆分提升可读性与可维护性。

修改文件：
- Add: `gui-v2/src/components/chat/ChatHeader.tsx`、`MessageList.tsx`、`MessageBubble.tsx`、`ToolCallsGroup.tsx`、`ThinkingBubble.tsx`、`ChatInput.tsx`、`TodoInline.tsx` — 从 ChatView.tsx 原样提取
- Add: `gui-v2/src/lib/chat-utils.ts` — statusLabel/statusStyle/getSenderDisplay/formatTime
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — 646 → 68 行，仅保留主入口
- Add: `gui-v2/src/hooks/ws-handlers/` — chat/registry/extension/todo/system/observability-handlers.ts + types.ts + helpers.ts，覆盖全部 71 种消息 type
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 759 → 104 行，改为 ctx + handler 表分发
- Fix: 3 个预存类型错误（ChatHeader/GroupChatView 的 startNewConversation null 传参、GlobalTodoPanel 死代码 executionRefLabel）；GlobalTodoPanel.test.ts 过时断言对齐紧凑展示

验证：gui-v2 `tsc && vite build` 通过；gui-v2 vitest 4 files / 19 tests 全绿。

### 重构：僵尸全局变量修复（B3）

变更原因：
分析确认 8 个旧式独立全局变量（`__cobeingHookBus`/`__cobeingPromptLayers`/`__cobeingConfig`/`__cobeingDataRoot`/`__cobeingAgentRegistry`/`__cobeingVoteStore`/`__cobeingObsDb`/`__cobeingGetProvider`）从未被写入（zombie），真实值都在 `__cobeing` 命名空间子字段。读取它们=undefined → 插件 hook 事件、PromptLayer、投票静默失效。

修改文件：
- Modify: `packages/core/src/runtime.ts` — 构造函数补齐 8 个兼容别名，指向真实对象
- Add: `packages/core/src/runtime-globals.test.ts` — 5 个聚焦测试（别名安装/同源/hook 触发/intercept/vote）

验证：新增测试 5/5 通过；全量 `pnpm test` 55 files / 502 tests 全绿（此前 54/497）。

### 重构：ws-server.ts 拆分（B1）

变更原因：
`packages/core/src/api/ws-server.ts`（3111 行）CoreWSServer 类内巨型 switch 处理 68 个 WS 命令，依赖访问方式不统一（部分 setter 注入、部分 `globalThis.__cobeing` 后门），可维护性差。

修改文件：
- Add: `packages/core/src/api/security.ts` — maskApiKey/cloneForClient/isSafeId/resolveWithin/isSafeConfigPath 等安全脱敏工具
- Add: `packages/core/src/api/types.ts` — WSMessage/TodoMutationAction/TodoMutationContext/buildTodoMutationPayload/buildGroupCreatorDraftNote
- Add: `packages/core/src/api/capability.ts` — loadCapabilityCards/scoreCapability
- Add: `packages/core/src/api/parsing.ts` — extractMentions/parseCurrentMd
- Add: `packages/core/src/api/handlers/` — system/agent/group/plugin/binding/message/todo/observability/sandbox/skill/enhancement.ts（68 个命令按域分组）
- Add: `packages/core/src/api/handlers/types.ts` — WsCommandHandler/HandlerRegistrar
- Modify: `packages/core/src/api/ws-server.ts` — 3111 → 571 行；巨型 switch 改为「命令注册表 + handler.call(this) 分发」；handler 通过 `function (this: CoreWSServer, ws, msg)` 原样保留 case 体
- Modify: `packages/core/src/api/ws-server.test.ts` — 导入改指向 ./types.js

验证：`pnpm build` 通过；`pnpm test` 54 files / 497 tests 全绿；冒烟脚本确认 68 命令全部注册、无缺失无多余。

### 重构：butler.ts 按域拆分 Butler 工具工厂函数到独立模块

变更原因：
`packages/core/src/agent/butler.ts`（1428 行）文件顶部堆叠约 24 个 `make*Tool` 工厂函数与 2 个辅助函数，体量过大、可读性与可维护性差。本次仅做结构性拆分，把工具工厂函数按业务域原样移动到 `agent/butler/tools/` 下的独立模块；函数签名、参数、返回值、内部逻辑一字未改，行为完全不变。

修改文件：
- Add: `packages/core/src/agent/butler/tools/agent-tools.ts` — makeCreateAgentTool / makeDestroyAgentTool / makeModifyAgentTool / makeFindAgentTool
- Add: `packages/core/src/agent/butler/tools/group-tools.ts` — makeCreateGroupTool / makeDestroyGroupTool / makeAddToGroupTool / makeRunGroupTool / makeCheckGroupTool
- Add: `packages/core/src/agent/butler/tools/dispatch-tools.ts` — makeDispatchToAgentTool / makeDispatchToGroupTool / makeGetWorkStatusTool / makeCancelWorkTool / makeReplyToGroupTool / makeDispatchTaskTool / getButlerDispatchDeps / formatDispatchReceipt
- Add: `packages/core/src/agent/butler/tools/workspace-tools.ts` — makeBindWorkspaceTool / makeListTool
- Add: `packages/core/src/agent/butler/tools/channel-tools.ts` — makeChannelBindTool / makeChannelUnbindTool
- Add: `packages/core/src/agent/butler/tools/registry-tools.ts` — makeReadRegistryTool / makeUpdateRegistryTool
- Add: `packages/core/src/agent/butler/tools/workflow-tools.ts` — makeWorkflowAnalyzeTool / makeWorkflowPlanTool
- Add: `packages/core/src/agent/butler/tools/review-tools.ts` — makeReviewProposalsTool
- Modify: `packages/core/src/agent/butler.ts` — 删除被移走的函数定义，改为从 `./butler/tools/*.js` 导入；清理随之不再使用的导入（fs、AgentPaths、runAgentCreator、dispatchButlerTask、createLogger、DockerSandbox 等）；`ButlerAgent` 类本身与构造函数内的工具注册调用完全未改动（1428 → 150 行）

修改内容摘要：
- 每个 make 函数保持原签名/参数/返回类型/内部逻辑逐字节不变，仅补 `export` 关键字；模块内保留 `createLogger("butler")` 日志实例（标签不变）
- 仅有的必要路径调整：原函数体内相对路径随文件下移两级（如 `../group/router.js` → `../../../group/router.js`），解析到的目标模块不变
- 无外部 re-export：grep 确认没有任何文件从 `butler.js` 导入 make 函数，仅 `index.ts`/`runtime.ts`/`butler.test.ts` 导入 `ButlerAgent`

验证：
- `pnpm exec tsc --noEmit`（packages/core）通过
- `pnpm build`（packages/core）通过
- `pnpm test` 54 files / 497 tests 全绿（含 `butler.test.ts` 4 tests）

### 重构：runtime.ts start()/stop() 拆分为职责清晰的私有辅助方法

变更原因：
`packages/core/src/runtime.ts` 的 `start()`（约 497-705 行，16 个初始化阶段）与 `stop()` 体量过大，可读性与可维护性差。本次仅做结构性重组，将巨型方法拆分为类内职责清晰、命名良好的私有辅助方法；行为保持不变（不新增/不修改任何逻辑、副作用顺序不变）。

修改文件：
- Modify: `packages/core/src/runtime.ts` — 拆分 start()/stop()；收敛 wsServer 的 8 个 setter 到 configureWSServer()；移除顶层 ensureSandboxConfig 改为导入
- Add: `packages/core/src/runtime/sandbox-helper.ts` — 纯函数 ensureSandboxConfig 移至此处并导出

修改内容摘要：
- `start()` 拆分为（按原顺序调用）：setupGlobalErrorHandlers()、checkDockerAvailability()、loadAllPluginsStep()、createCoreAgents()、restoreRegistryState()、setupMCP()、restoreGroups()、configureWSServer()、setupRouterCallbacks()、startServices()、startTodoScanner()、ensureRuntimeDirs()，start() 本身变为短方法
- `configureWSServer()` 收敛 wsServer 的 8 个 setter（setAgentRegistry/setGroupManager/setChannelRouter/setProviderResolver/setOnProviderChange/setDataRoot/setSkillRepository/setOnMcpConfigChange）按原顺序统一注入，同时保留 registerAgent(butler)
- `stop()` 拆分为对称清理方法：stopWSServer()、stopTodoScanner()、disposeLocalFilter()、stopChannels()、disposeAgents()、disposeGroups()、closeMCPConnections()，不新增清理逻辑、不改变行为
- `ensureSandboxConfig` 纯函数移至 `runtime/sandbox-helper.ts`（runtime.ts 导入使用）
- 保持所有公共 API 签名、`globalThis.__cobeing` 组装逻辑不变

验证：
- `pnpm exec tsc --noEmit`（packages/core）通过
- `pnpm build` 全 workspace 通过
- `pnpm test` 497/497 全绿

## 2026-07-09

### 修复：管家页面发送消息时整体上浮

问题描述：
之前在"管家界面输入文本时上浮"修复后（`flex-1`→`rows={4}`、`h-screen`→`h-full`、`overscroll-behavior: none`），仍存在发送消息时页面整体上浮的问题。表现为用户按下 Enter 发送消息后页面向上偏移，管家回复完成后恢复正常。

根因分析：
1. **scrollIntoView 传播**: `MessageList`/`GroupMessageList` 的 `useEffect` 中使用 `bottomRef.current?.scrollIntoView({ behavior: "smooth" })`。当消息列表内容不足以溢出容器时（消息较少），`scrollIntoView` 对内部容器是 no-op，但会向上传播到父级 `overflow: hidden` 容器（body div → SurfaceCard → grid → main），在 Tauri WebView2 中导致页面级滚动
2. **WebView2 聚焦滚动**: `handleSend` 在 textarea 仍保持焦点时调用 `setText("")`，WebView2 检测到聚焦元素的 value 变化后尝试重新滚动页面以保持光标可见

管家回答后恢复正常的原因：响应内容填充消息列表后，`scrollIntoView` 正确在内部容器滚动，不再传播到父级。

修改文件：
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `MessageList`: `scrollIntoView` → `scrollContainerRef.current.scrollTo({ top: scrollHeight })` 直接控制目标容器；`ChatInput.handleSend`: 状态变更前 blur 聚焦元素(`document.activeElement.blur()`)，`requestAnimationFrame` 后 refocus
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — `GroupMessageList`: 同上 scrollIntoView → scrollTo；`GroupChatInput.handleSend`: 同上 blur/refocus
- Modify: `gui-v2/src/components/settings/LogsSection.tsx` — 2 处 `scrollIntoView` → `containerRef.current.scrollTo({ top: scrollHeight })`（相似性扫描）

问题描述：
群主 config.json 中包含 bash、read-file、write-file、edit-file 等执行类工具，导致群主亲自执行工作而非委派。

根因：ensureHostDir() 仅创建默认配置但不修复已有错误配置；registerPrebuiltAgents() 无运行时工具过滤；仅靠 prompt 劝导不够。

修改文件：
- Modify: `packages/core/src/runtime.ts` — registerPrebuiltAgents() 运行时强制移除 8 个执行工具并自动修复 config.json；强化 host systemPrompt
- Modify: `packages/core/src/runtime.ts` — ensureHostDir() 始终检查并重写 config.json，始终同步 HOST_JOB.md
- Modify: `packages/core/src/templates/host/HOST_JOB.md` — 强化禁止执行措辞
- Modify: `data/coreagents/host/config.json` — 移除 8 个执行工具，仅保留协调工具
- Modify: `data/coreagents/host/JOB.md` — 同步更新

### 修复：@提及上拉框显示在输入框后面 + user/TODOboard 消息泄漏到前端

问题描述：
1. 群组聊天中 @mention 下拉框（包括自动弹出和按钮触发）显示在输入框后面，被遮挡
2. user 和 TODOboard 消息再次被发送到前端聊天界面，产生噪音

根因分析：

**问题1 — @mention 上拉框被遮挡：**
- 根因是弹窗被父容器的 `overflow-hidden` 裁剪。弹窗使用 `absolute bottom: 100%` 定位，向上延伸到容器之外，`overflow: hidden` 使其不可见
- 解决方案：将容器拆分为两层 — 外层 `relative` 仅作定位参考（无 overflow），内层保留所有视觉样式和 `overflow-hidden`。弹窗放到外层，作为内层的兄弟节点，不受 overflow 裁剪

**问题2 — user/TODOboard 消息泄漏：**
- `ws-server.ts` 中 `setOnMessageBroadcast` 回调对所有 `postMessage` 调用无条件广播 `group_message` 到前端
- `manager.ts` 中多处使用 `g.postMessage("user", ...)` 和 `g.postMessage("TODOboard", ...)` 发送内部消息
- 前端 `group_message` 处理器仅过滤 `system` 消息，未过滤 `user` 和 `TODOboard`
- 导致这些内部消息显示在聊天界面

修改文件：
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — 拆分输入容器为两层（外层 relative + 内层 overflow-hidden），斜杠命令菜单移至外层，z-index z-10→z-50
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 同上拆分，@mention 弹窗移至外层，z-index z-10→z-50
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 同上，移除 GroupChatInput 外层容器的 `overflow-hidden`
- Modify: `packages/core/src/api/ws-server.ts` — `setOnMessageBroadcast` 回调增加过滤：跳过 `fromAgentId === "user"`、`"TODOboard"`、`"system"` 的消息，从源头拦截
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `group_message` 处理器增加防御性过滤：同时跳过 `user` 和 `TODOboard`（原仅过滤 `system`）

### 修复：管家界面输入页面上浮 + 长任务后"正在回答"卡死 + 工具调用前文本丢失

问题描述：
1. 管家界面一旦输入文本，整个页面向上浮动，布局完全错位
2. 管家进行长任务工作时，窗口无法接收调用工具之后的所有信息（WebSocket 断连后 stream_token 丢失）
3. 下一次对话时会丢失调用工具前的文本（startWaiting 的 finishWaiting 删除 stream buffer）
4. 后台检测到管家完成，但管家界面一直显示"正在回答"（agent_completed 未清除等待状态）

根因分析：

**问题1 — 输入框导致页面上浮：**
- `ChatInput` 和 `GroupChatInput` 的 `<textarea>` 使用 `flex-1`，在 flex column 布局中其 flex-basis 为 0%，空 textarea 和多行 textarea 的内联尺寸不同，导致浏览器在输入时重新计算布局，引起整个页面向上浮动
- 同时 `resize-none` 只禁用 resize handle，不阻止浏览器对 textarea 的自动尺寸调整

**问题2-4 — 长任务流式响应丢失与状态卡死：**
- `agent_completed` / `agent_error` 处理器未调用 `finishWaiting`（7/8 修复中移除了该调用以消除竞态），导致 WebSocket 断连重建后 `agent_response` 丢失时，等待状态永远无法清除，UI 一直显示"正在回答"
- `agent_response` 和 `stream_token` 通过 `sendToClient(ws, ...)` 绑定到特定 WebSocket 连接。长工具执行期间若 WebSocket 断连重建，后续所有 stream_token 和 agent_response 均丢失
- `agent_completed` 通过 broadcast 发送，新连接可收到，但未清除 waiting 状态
- `startWaiting` 在检测到未完成流式内容时调用 `finishWaiting` 删除 `streamBuffers[targetId]`，导致累积的文本永久丢失

修改文件：
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — textarea 移除 `flex-1`，添加 `rows={4}` 和显式 `minHeight`/`maxHeight`，防止输入时布局重算
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 同上 textarea 修复（同类问题扫描）
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `agent_completed` 和 `agent_error` 处理器增加安全网：若 `waitingByConversation` 仍设置（agent_response 未到达），将累积的流式内容通过 `finalizeStream` 保存为消息；`agent_response` 处理器增加去重守卫，防止重复消息
- Modify: `gui-v2/src/stores/chat.ts` — `startWaiting` 在重置前将未完成的流式内容通过 `finalizeStream` 保存（而非 `finishWaiting` 直接丢弃）；`finalizeStream` 增加去重守卫：检查最后一条消息是否内容相同；修复 `capturedTools` 可能为 undefined 的 TypeScript 错误

验证：pnpm build 通过。

### 第二轮修复：真正根因 — Tauri WebView2 h-screen + 输入焦点滚动 + agent_response 广播丢失

**用户反馈第一轮未解决，重新深入排查后确认：**

问题1（整体页面上浮、顶部裁切）真正根因：
- Tauri WebView2 中 `h-screen`（100vh）与实际视口高度存在计算差异，textarea 获得焦点时浏览器尝试将焦点元素滚动到可见区域，导致整个页面上移
- `html, body, #root` 缺少 `overscroll-behavior: none`，WebView2 的自动滚动行为未被完全抑制
- CSS overflow 链上的缺口（ChatInput 容器、WorkbenchLayout grid）使布局溢出向上传播

问题2（流式数据丢失 + "正在回答"卡死）真正根因：
- **后端不对称**：`agent_response` 使用 `sendToClient(ws)`（单一连接），WS 断连重建后永久丢失；而 `tool_event`/`agent_completed` 使用 `broadcast()`（全部连接）可恢复
- **loadFromCurrent 覆盖竞争**：重连后 `chat_current` 响应覆盖 `messageStore`，销毁 agent_completed handler 刚保存的消息
- **agent_completed 广播时序**：在断开期间完成的 agent，重连后收不到已完成事件

修改文件：
- Modify: `gui-v2/src/components/layout/AppLayout.tsx` — `h-screen w-screen` → `h-full w-full`，消除 Tauri WebView2 的 vh 单位计算差异
- Modify: `gui-v2/src/styles/globals.css` — `html, body, #root` 增加 `overscroll-behavior: none`，彻底禁止 WebView 自动滚动
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — textarea 增加 `overflowY: "auto"`；ChatInput 容器增加 `overflow-hidden`
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 同上修复（同类问题）
- Modify: `gui-v2/src/components/layout/Surface.tsx` — WorkbenchLayout grid 增加 `overflow-hidden`
- Modify: `packages/core/src/api/ws-server.ts:932` — `agent_response` 从 `sendToClient(ws)` 改为 `broadcast()`，确保重连客户端也能收到最终文本
- Modify: `gui-v2/src/stores/chat.ts` `loadFromCurrent` — 增强合并：waiting 活跃时保留内存消息；自动清除已完成会话的 waiting 状态
- Modify: `gui-v2/src/stores/chat.ts` `startWaiting` — 安全超时从 300s 降至 60s

验证：pnpm build（backend + frontend）全部通过。

### 紧急修复：管家长工作丢失回复 / 说到一半的话丢失

问题描述：
1. 管家可以执行工具指令，但完全无法用自然语言回复用户
2. 一旦有长工作（多轮工具调用），回复内容丢失；说到一半的话也会丢失

根因分析：
- 问题1：`agent_completed` 处理器中的 `finishWaiting()` 调用（批次1添加）与 `agent_response` → `finalizeStream()` 产生竞态条件，先于后者删除 `streamBuffers[targetId]`，导致消息内容丢失。
- 问题2（核心）：`startWaiting()` 无条件执行 `streamBuffers[targetId] = ""` 重置操作。当管家进行多轮工具调用时，流式内容已在 buffer 中累积完毕，但 `agent_response` 尚未到达。此时发送按钮未因等待状态禁用，用户可以发送第二条消息，触发第二次 `startWaiting()` 将第一条回复的全部流式内容清空。这些内容永久丢失，无法恢复。旁证：对话数据中第一条请求的全部 toolEvents 被错误附加到第二条回复上。

修改文件：
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 从 agent_completed 处理器中移除 `finishWaiting()`，消除竞态
- Modify: `gui-v2/src/stores/chat.ts` — `startWaiting` 在重置前检查是否有未完成的流式内容，有则先调用 `finalizeStream` 保存；增加 5 分钟安全超时
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — ChatInput 新增 `waitingForResponse` 检查，等待中禁用发送按钮
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — GroupChatInput 同 ChatInput 处理

验证：pnpm build + pnpm test（54 files, 497 tests）全部通过。

### 第三批 4 项修复：消息去重/群主自执行/滚动/group-send

问题描述：
1. user 的话会被重复以智能体气泡形式多次显示在窗口内
2. 群主自己执行任务而非协调
3. 用户向上滚动历史后自动滚回底部
4. group-send 依旧报错

根因分析：
- Bug 1: 消息可能因 `agent_response` + `group_message` 双重广播或前端重复渲染而产生重复条目。在 `addMessage` 中增加去重逻辑（同 direction + content + senderId + 2s 内视为重复）。
- Bug 2: 群主（Host Agent）的 config.json 工具列表包含 bash/read-file/write-file/edit-file/glob/grep/web-fetch/agent-message 等执行工具，systemPrompt 也未明确禁止执行工作；HOST_JOB.md 虽有"不是万能执行者"声明但不够强硬。
- Bug 3: `MessageList` / `GroupMessageList` 的 useEffect 每次 `messages` 或 `streamBuffer` 变化都调用 `scrollIntoView()`，无用户手动滚动检测。
- Bug 4: `ensureGroupMember` 检查不允许 butler/host（非群组成员）调用 `group-send`，导致 butler 向群组发送消息时返回 "not a member" 错误。

修改文件：
- Modify: `gui-v2/src/stores/chat.ts` — `addMessage` 增加消息去重：同 direction、content、senderId 且在 2 秒内视为重复，跳过添加
- Modify: `packages/core/src/runtime.ts` — 移除 host config.json 中的执行工具（bash/read-file/write-file/edit-file/glob/grep/web-fetch/agent-message）；为 host 添加明确的协调者 systemPrompt（禁止执行工具、强调委派职责）
- Modify: `packages/core/src/templates/host/HOST_JOB.md` — 新增"严格禁止：不要亲自执行工作"章节，列出禁止和允许的行为
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `MessageList` 增加 `userScrolledUp` ref + `onScroll` handler；仅在未手动上滚或首次渲染时自动滚到底部；用户发新消息时重置滚动锁
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — `GroupMessageList` 同 ChatView 滚动修复
- Modify: `packages/core/src/tools/group-tools.ts` — `ensureGroupMember` 允许 butler 和 host 绕过成员检查（协调者可向任何群组发消息）

验证：pnpm build 全部通过；pnpm test 54 文件 497 测试全部通过。

### 第二批 5 项修复：group-send 工具/全局任务显示/群组创建消息/TODOboard 外显/对话未读徽章

问题描述：
1. group-send 工具不可用，Agent 无法通过群组返回消息给管家
2. 全局任务卡片显示过多细节（description/progressSummary/nextAction/executionRefs 等数百字），应仅显示简单名称
3. 创建群组时系统发送给群组的内部消息不应在对话中外显
4. TODOboard 定时触发任务时不应在对话中显示系统消息
5. 每个对话（智能体/群组）卡片上应显示未读消息数，而非仅在全局左上角显示总数

根因分析：
- Bug 1: ButlerAgent 构造函数直接注册了 group-members/talk-create/talk-send/talk-read 但未直接注册 group-send，依赖后续 injectGroupTools() 调用；若 injectGroupTools 调用时序早于 __cobeing 全局初始化，工具审查门可能失败。
- Bug 2: GlobalTodoPanel 的 TodoItemRow 渲染了 description（含完整 goal 文本）、progressSummary、nextAction、executionRefs、lastEvent、internalBlocker 等最多 10 项信息。
- Bug 3: create_group 中 postMessage("system", ...) 触发 _onMessageBroadcast → group_message WS 广播 → 前端存储为 direction:"out"，渲染为可见消息气泡。
- Bug 4: runtime.ts onTrigger 回调中 wsServer.logMessage("system", ...) 将 TODOboard 触发消息广播到对话中。
- Feature 5: chat.ts store 已维护 unreadCounts per conversation，但 Sidebar 的 AgentList/GroupList 未使用该数据渲染徽章。

修改文件：
- Modify: `packages/core/src/agent/butler.ts` — 在 ButlerAgent 构造函数中直接注册 makeGroupSendTool，与已有群组通信工具并列
- Modify: `gui-v2/src/components/todo/GlobalTodoPanel.tsx` — 简化为仅显示 title + status badge + assignee 标签，移除 description/progressSummary/nextAction/executionRefs/lastEvent/internalBlocker
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — group_message 处理器中 fromAgentId === "system" 时跳过 addMessage；agent_started 处理器中 source === "TODOboard" 时跳过
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — AgentList 和 GroupList 从 useChatStore 读取 unreadCounts，为每个有未读消息的条目渲染数字徽章（Agent 用 accent 色，Group 用 purple 色）
- Modify: `packages/core/src/runtime.ts` — 移除 TodoScanner onTrigger 中的 logMessage("system", ...) 调用

验证：pnpm build 全部通过；pnpm test 54 文件 497 测试全部通过。

### 第一批 5 项 Bug 修复：智能体回复/工具调用/新对话/侧栏导航/群组模型配置

问题描述：
1. 智能体回复完毕不能正确停止，也不能正确被记录下来
2. 智能体调用工具次数出现问题（计数不准确）
3. 一旦开启新对话，就会导致所有页面开启新对话
4. 点击侧栏的小图标时，主界面窗口依旧保持在原来的样子而不是自动变过去
5. 群组内配置智能体模型仅有图标没有功能

根因分析：
- Bug 1: `finalizeStream()` 中 `waitingForResponse` 只在 active conversation 时设为 false；`agent_completed` 处理器未调用 `finishWaiting()`，导致错过 `agent_response` 时等待状态无法清除。
- Bug 2: `addToolEvent()` 对 "start" 事件（无 toolCallId）每次创建新条目，未根据 toolName+status 去重；`ToolCallsGroup` 显示逻辑按全部条目计数导致数字膨胀。
- Bug 3: `startNewConversation()` 调用 `clearAllConversations()` 和 `clear_chat_current` 清空所有对话，而非仅当前对话。
- Bug 4: `MainContent` 的 view-switching useEffect 使用原始 agents 列表（含 butler/host）做 isAgent 判断，导致从 butler 切换到 agents 视图时误判 butler 为合法 agent，不触发切换。
- Bug 5: `Sheet` 与 `Dialog` 均用 `z-50`，群组成员页内的模型切换 Dialog 被 Sheet 遮挡；模型配置文字为 `<div>` 而非 `<button>`，无障碍性和点击可靠性不足。

修改文件：
- Modify: `gui-v2/src/stores/chat.ts` — `finalizeStream` 修正等待状态清除逻辑（检查其他会话是否仍等待）；`addToolEvent` 增加无 toolCallId 的 start 事件按 toolName 去重。
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `agent_completed` 处理器增加 `finishWaiting()` 安全网调用。
- Modify: `gui-v2/src/hooks/useChatPersistence.ts` — `startNewConversation` 改为仅清空当前对话（接受 conversationId 参数，调用 `clearMessages` 替代 `clearAllConversations`）。
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — "新对话"按钮传递 convId；`ChatHeader` 增加 convId prop；`ToolCallsGroup` 增加 useMemo 去重逻辑。
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — "新对话"按钮传递 activeConv。
- Modify: `gui-v2/src/components/layout/MainContent.tsx` — 引入 `getVisibleUserAgents` 过滤核心 Agent（butler/host），修复视图切换判断。
- Modify: `gui-v2/src/components/ui/dialog.tsx` — Dialog Overlay 和 Content z-index 从 `z-50` 提升至 `z-[60]`，确保 Dialog 始终位于 Sheet（z-50）之上。
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx` — 模型配置文字由 `<div>` 改为 `<button type="button">`，增强可点击性和可访问性。
- Modify: `packages/core/src/api/ws-server.ts` — `clear_chat_current` 接受可选 `conversationId` 参数，仅清除指定会话；不传则保留全量清除兼容行为。

验证：`pnpm build` 全部 workspace 编译通过；`pnpm test` 54 个测试文件 497 个测试全部通过。

## 2026-06-12

### 全局任务字面量显示与主题缓存刷新修复

问题描述：管家左侧全局任务卡片仍显示 `\u5168\u5c40\u4efb\u52a1`、`\u7ba1\u5bb6...`、`\u6682\u65e0\u4efb\u52a1` 等字面量；同时 Sakura Mint 配色改动在应用中可能继续被旧主题结果覆盖。

根因分析：
- JSX 文本节点中的 `\uXXXX` 不会被 React 当作字符串转义解析，会作为普通文本原样渲染。
- 内置主题加载直接使用普通 `fetch()`，浏览器/开发服务缓存可能继续返回旧 JSON。
- 自定义主题合并顺序允许本地持久化的同 ID 主题覆盖内置主题，旧 `sakura-mint` 如果曾被写入本地自定义主题，会压过发布包里的新配色。

修改文件：
- Modify: `CoBeing/gui-v2/src/components/todo/GlobalTodoPanel.tsx` — 将管家全局任务标题、说明、空状态、状态统计等文案改为字符串常量/表达式渲染，避免 JSX 裸 `\uXXXX` 字面量；修正执行引用分隔符显示。
- Modify: `CoBeing/gui-v2/src/components/todo/GlobalTodoPanel.test.ts` — 清理编码污染的测试内容，补充真实字段显示模型回归测试。
- Modify: `CoBeing/gui-v2/src/components/layout/Sidebar.tsx` — 将侧栏可见文案集中为常量，避免 Agent/Group 列表按钮与空状态出现同类裸转义问题。
- Modify: `CoBeing/gui-v2/src/components/layout/surface-style-audit.test.ts` — 扩展核心界面审计，阻止 JSX 文本节点再次渲染 literal unicode escape。
- Modify: `CoBeing/gui-v2/src/stores/theme.ts` — 内置主题 manifest 和 JSON 改为 `cache: "no-store"` 加载；新增 `loadBuiltInTheme()` 与 `mergeThemePresets()`，保证同 ID 内置主题优先于本地旧自定义主题。
- Modify: `CoBeing/gui-v2/src/stores/theme.test.ts` — 补充无缓存加载与旧持久化主题不能覆盖内置主题的回归测试。

修改内容摘要：
- 管家全局任务卡片现在会显示“全局任务 / 管家正在跟进的任务 / 暂无任务”等正常中文，不再显示 `\u...`。
- Sakura Mint 主题资源会绕开浏览器缓存重新加载；内置 `sakura-mint`、`executive-workbench` 等 ID 不再被同名本地旧自定义主题覆盖。
- 样式审计覆盖全局任务、侧栏、聊天、设置浮层、新手教程、Agent/Group 设置等核心界面文件，防止同类显示回归。

验证说明：
- 已先新增回归测试并看到失败：审计测试抓到 JSX 裸 `\uXXXX`，主题测试抓到缺少 `loadBuiltInTheme()` / `mergeThemePresets()`。
- `D:\agent-codes\CoBeing\node_modules\.bin\vitest.CMD run src\components\todo\GlobalTodoPanel.test.ts src\components\layout\surface-style-audit.test.ts src\stores\theme.test.ts --config vite.config.ts`（在 `gui-v2` 目录执行）：3 文件 10 测试通过。
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\tsc.cmd --noEmit`：通过。
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\vite.cmd build`：通过；仍保留既有 chunk 体积和动态 import 警告。
- `corepack pnpm build`（在 `CoBeing` 目录执行）：7 个 workspace 构建通过。
- 本地 dev server `http://127.0.0.1:1420/themes/sakura-mint.json` 返回新的 `#FFDCEA` 到 `#D9FFF4` Sakura Mint 配色；`dist/themes/sakura-mint.json` 也已包含同样新 token。

---

### 樱花薄荷默认主题层次增强

变更原因：默认樱花薄荷主题的背景、面板和聊天气泡色差太小，糖果色气泡感和层次感不够明显。

修改文件：
- Modify: `CoBeing/gui-v2/public/themes/sakura-mint.json` — 背景从纯白改为浅樱粉/薄荷渐变，主面板保持奶白半透明，子层、边框、divider、阴影和四类气泡色整体调亮并拉开差异。
- Modify: `CoBeing/gui-v2/src/styles/globals.css` — 同步默认 CSS fallback，保证主题加载前后的首屏色阶一致。
- Modify: `CoBeing/gui-v2/src/stores/theme.test.ts` — 新增 Sakura Mint 层次约束，防止默认主题回退到纯白底或气泡与面板过近。

修改内容摘要：
- 保留轻松糖果色方向：用户气泡改为更明确的樱花糖粉，智能体气泡改为更明显的薄荷糖绿。
- 背景、主面板、子层、气泡之间的明度和色相差拉大，增强浮层感与气泡感。
- 阴影从极弱投影改为柔和粉绿复合投影，避免界面平铺。

验证说明：
- 已先运行新增主题测试并看到失败，失败点为 Sakura Mint 仍使用纯白背景。
- 更新主题后，`D:\agent-codes\CoBeing\node_modules\.bin\vitest.CMD run src/stores/theme.test.ts --config vite.config.ts`（在 `gui-v2` 目录执行）：1 文件 4 测试通过。
- `D:\agent-codes\CoBeing\node_modules\.bin\vitest.CMD run src/lib/userProfile.test.ts src/stores/theme.test.ts --config vite.config.ts`（在 `gui-v2` 目录执行）：2 文件 13 测试通过。
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\tsc.cmd`：通过。
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\vite.cmd build`：通过；仍保留既有 chunk 体积和动态 import 警告。
- 临时 Vite 服务 `http://127.0.0.1:1420/` 返回 HTTP 200，`/themes/sakura-mint.json` 可读取到新的 `#FFF0F7`、`#FFD1E1`、`#BFFFF0` token。

---

## 2026-06-11

### GUI A 方案前端优化：主题气泡、用户资料与聊天头像

变更原因：根据最新功能更新和用户确认的 A 方案版式，统一前端聊天气泡比例、头像布局、主题可调色能力，并把“个人资料”从预览落实到真实单聊/群聊窗口。默认主题保留为樱花薄荷，B 方案工作台配色作为可选主题保留。

修改文件：
- Create: `CoBeing/gui-v2/src/lib/userProfile.ts` / `userProfile.test.ts` — 用户昵称、头像类型、默认资料、头像草稿与规范化 helper。
- Create: `CoBeing/gui-v2/src/stores/userProfile.ts` — 本地 `localStorage` 用户资料 store，写入失败时降级为内存态。
- Create: `CoBeing/gui-v2/src/components/chat/ChatAvatar.tsx` / `ChatMessageFrame.tsx` — 共享头像与消息气泡框架，统一左右头像、气泡 token、间距和元信息。
- Create: `CoBeing/gui-v2/src/components/settings/UserProfileSection.tsx` — 设置页个人资料界面，支持昵称、首字/Emoji/图片头像与实时聊天预览。
- Create: `CoBeing/gui-v2/public/themes/executive-workbench.json` — B 方案工作台主题。
- Create: `CoBeing/gui-v2/src/stores/theme.test.ts` — 内置主题顺序、工作台主题和 chat bubble token 校验。
- Modify: `CoBeing/gui-v2/public/themes/manifest.json` — 默认顺序保持 `sakura-mint`，新增 `executive-workbench`。
- Modify: `CoBeing/gui-v2/src/stores/theme.ts` / `components/settings/ThemeSelector.tsx` — 导入主题校验补齐 `chat.*` token；主题卡片预览显示用户/智能体气泡色。
- Modify: `CoBeing/gui-v2/src/components/chat/ChatView.tsx` / `GroupMessageBubble.tsx` / `GroupChatView.tsx` — 真实单聊与群聊改用共享消息框，用户头像在右、智能体头像在左；用户气泡显示个人资料昵称，不再硬编码“你”。
- Modify: `CoBeing/gui-v2/src/components/agent/AgentDetailPanel.tsx` / `CapabilityTab.tsx` / `TaskInboxTab.tsx` / `GrowthProposalsTab.tsx` — 能力、任务、成长页从偏调试小字号升级为主题 token、14px 正文和更稳的卡片布局。
- Modify: `CoBeing/gui-v2/src/components/layout/Sidebar.tsx` / `components/settings/WorkspaceBindingSection.tsx` — 清理 10/11px 可见文本和旧 token。
- Modify: `CoBeing/gui-v2/tsconfig.json` — 普通 `tsc` 排除 `*.test.ts`，由 Vitest 单独处理测试类型。

修改内容摘要：
- 聊天气泡颜色现在受主题 `msg-user` / `msg-assistant` / `msg-system` / `msg-tool` 控制，主题导入缺少这些 token 会被拒绝。
- 设置页新增“个人资料”，可配置用户昵称与头像；图片头像切换使用可编辑 SVG data URL 草稿，避免空值被规范化回首字头像。
- 单聊和群聊真实消息均显示头像：用户右侧、智能体左侧；群聊保留智能体身份色条、审核提示、工具调用、讨论总结和流式思考气泡。
- Agent 增强页（能力/任务/成长）改为更正式的产品界面，避免小字号 debug 风格和旧色值 token。

验证说明：
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\tsc.cmd`：通过。
- `D:\agent-codes\CoBeing\node_modules\.bin\vitest.CMD run src/lib/userProfile.test.ts src/stores/theme.test.ts --config vite.config.ts`（在 `gui-v2` 目录执行）：2 文件 12 测试通过。
- `D:\agent-codes\CoBeing\gui-v2\node_modules\.bin\vite.cmd build`：通过；仍保留既有 chunk 体积和动态 import 警告。
- 本地 Vite 服务 `http://127.0.0.1:1420/` 返回 HTTP 200，`/themes/manifest.json` 和 `/themes/executive-workbench.json` 返回正常；尝试连接 in-app Browser 做截图验收时被当前 Windows sandbox 阻止（`spawn setup refresh`），未完成截图级视觉验收。

---

### GUI 管家页导航渲染错误修复

变更原因：打开管家界面，或从管家界面切换到智能体/群组/设置等其他界面时，React 会出现渲染错误。排查发现 `Sidebar` 在 `activeView === "butler"` 时先提前 `return <GlobalTodoPanel />`，而其他视图会继续调用更多 Zustand store hooks 和 `useEffect`；同一个组件在页面切换前后 hook 调用数量不同，触发 React hook 顺序错误。

修改文件：
- Modify: `CoBeing/gui-v2/src/components/layout/Sidebar.tsx` — 将 `Sidebar` 内所有 store hooks、派生数据和自动选择 `useEffect` 移到条件渲染之前，保证管家/智能体/群组/设置等视图下 hook 调用顺序稳定。

修改内容摘要：
- 管家页仍显示 `GlobalTodoPanel` 作为左侧全局任务栏。
- 智能体/群组页仍显示原侧栏和创建弹窗。
- 仅调整 hook 调用顺序，不改变导航结构和用户可见功能。

验证说明：
- `corepack pnpm build`（`CoBeing/gui-v2`）：TypeScript + Vite 构建通过。
- 本地 Vite 验证服务 `http://127.0.0.1:5173/` 返回 HTTP 200。
- `corepack pnpm test`（`CoBeing`）：54 文件、497 测试通过。

---

### better-sqlite3 Node 24 原生绑定恢复

变更原因：用户明确要求需要真实 `better-sqlite3`，不能只靠 fallback 回避问题。复查发现当前运行环境是 Node `24.13.0`（ABI `node-v137`），项目锁定的 `better-sqlite3@11.10.0` 安装目录没有生成任何 `better_sqlite3.node`；`pnpm rebuild better-sqlite3` 没有产生产物，最小 `require("better-sqlite3")` 仍报 `Could not locate the bindings file`。

修改文件：
- Modify: `CoBeing/packages/core/package.json` — 将 `better-sqlite3` 从 `^11.9.0` 升级到 `^12.10.0`，匹配 Node 24 支持范围。
- Modify: `CoBeing/pnpm-lock.yaml` — 锁定 `better-sqlite3@12.10.0`；安装脚本已在本机编译生成 `build/Release/better_sqlite3.node`。
- Modify: `CoBeing/packages/core/src/agent/butler.test.ts` — 测试 teardown 释放 registry 中真实 Agent/Butler 的 `dispose()`，避免启用原生 SQLite 后 MemoryStore 文件句柄导致 Windows 临时目录清理 EPERM。

修改内容摘要：
- 当前 Node 24.13.0 下 `require("better-sqlite3")` 已能打开 `:memory:` 数据库，SQLite 版本验证为 `3.53.1`。
- Memory/Group/Observability 的 SQLite 正常路径已恢复；fallback 仍保留为异常兜底，但不再是本机启动的主路径。
- 测试生命周期补齐真实 SQLite 句柄释放，避免 native binding 正常工作后暴露出的 Windows 文件锁问题。

验证说明：
- `node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log(JSON.stringify(db.prepare('select sqlite_version() as version, 1 as ok').get())); db.close();"`：输出 `{"version":"3.53.1","ok":1}`。
- `corepack pnpm vitest run packages/core/src/memory/sqlite-adapter.test.ts packages/core/src/memory/memory-store.test.ts packages/core/src/group/agent-memory.test.ts packages/core/src/group/manager.test.ts packages/core/src/group/three-layer-memory.test.ts`：5 文件、62 测试通过，未再出现 SQLite binding 缺失降级警告。
- `corepack pnpm vitest run packages/core/src/agent/butler.test.ts`：1 文件、4 测试通过。
- `corepack pnpm test`：54 文件、497 测试通过。
- `corepack pnpm build`：7 个 workspace 包编译通过。

---

### better-sqlite3 原生绑定缺失启动崩溃修复

变更原因：`docs/log/报错061101.txt` 记录启动时 `ObservabilityDB` 构造 `better-sqlite3` 失败，缺少 `better_sqlite3.node` 会导致 Runtime 直接退出；同时扫描同类 SQLite 入口，补齐 Memory、Group 与 Observability 的降级路径，并修复全量测试暴露的 Windows 并发超时点。

修改文件：
- Modify: `CoBeing/packages/core/src/observability/observability-db.ts` — SQLite 打开失败时使用 `observability.db.fallback.json` 文件备份；LLM/Tool 写入、Dashboard 聚合、LLM/Tool stats、close 全部支持降级。
- Create: `CoBeing/packages/core/src/observability/observability-db.test.ts` — 增加原生 binding 不可用时仍可记录和查询观测数据的回归测试。
- Modify: `CoBeing/packages/core/src/memory/sqlite-adapter.ts` — Memory SQLite/FTS5 不可用时使用文件型 JSON fallback，保留 entries/history/search/trust/sync state 主要行为。
- Modify: `CoBeing/packages/core/src/group/group-db.ts` / `CoBeing/packages/core/src/group/agent-memory.ts` — 群组消息库与 Agent 群组记忆在 SQLite 不可用时降级为内存存储，避免 Group 创建/测试因 native binding 缺失失败。
- Modify: `CoBeing/packages/core/src/tools/bash.ts` — Windows 本地命令改用 `execFile` + `powershell.exe -NoProfile -NonInteractive`，降低全量测试中 PowerShell 启动开销。
- Modify: `CoBeing/packages/core/src/group/manager.ts` — 删除删除/归档路径中的同步 busy-wait，保留 rename 标记删除机制，避免并发测试 worker 被阻塞。

修改内容摘要：
- Runtime 启动不再因为 ObservabilityDB 的 `better-sqlite3` 原生绑定缺失而致命退出。
- Memory/Group/Observability 三类 SQLite 入口均具备降级路径；native SQLite 仍是优先路径，fallback 是开发环境/缺失 binding 时的可用性兜底。
- 全量测试曾暴露的 Windows 并发超时点已收敛：Group 删除不再阻塞 500ms，bash 工具避免加载 PowerShell profile。

验证说明：
- `corepack pnpm vitest run packages/core/src/observability/observability-db.test.ts`：1 文件、1 测试通过。
- `corepack pnpm vitest run packages/core/src/observability/observability-db.test.ts packages/core/src/memory/sqlite-adapter.test.ts packages/core/src/memory/memory-store.test.ts packages/core/src/group/agent-memory.test.ts packages/core/src/group/manager.test.ts packages/core/src/group/three-layer-memory.test.ts`：6 文件、63 测试通过。
- `corepack pnpm test`：54 文件、497 测试通过。
- `corepack pnpm build`：7 个 workspace 包编译通过。

---

## 2026-06-10

### 非 Market 未实现项审查 — Butler 托管任务第一闭环

参考 `docs/项目信息/非Market未实现项审查.md` 的 P0/P1 缺口，补齐“管家作为用户入口和任务托管中心”的后端第一闭环。

变更原因：审查指出 ButlerTaskStore / GroupButlerBindingStore 未进入运行链路、Butler 派发只是发消息、Global TODO 与 Agent inbox 不同步、新建 Agent 没有能力卡、WS find/dispatch 仍是占位、群组上下文可能泄露私有记忆、Group TODO 回传 Global TODO 过粗。

修改文件：
- Create: `CoBeing/packages/core/src/butler/dispatch.ts` — 新增 `dispatchButlerTask()`，统一创建 Global TODO、ButlerTask、Agent inbox 或 Group TODO，并写入 executionRefs。
- Modify: `CoBeing/packages/core/src/runtime.ts` — Runtime 初始化 `ButlerTaskStore` 与 `GroupButlerBindingStore`，和 `GlobalTodoStore` 一起挂入 `__cobeing.runtime`。
- Modify: `CoBeing/packages/core/src/agent/butler.ts` — 新增 `butler-dispatch-to-agent`、`butler-dispatch-to-group`、`butler-get-work-status`、`butler-cancel-work`、`butler-reply-to-group`，旧 `butler-dispatch-task` 改为可追踪派发别名；新建 Agent 自动写入默认 `capability.json`。
- Modify: `CoBeing/packages/core/src/tools/agent-task.ts` — Agent accept/report/complete 同步 Global TODO、ButlerTask、executionRefs 与 WS 事件；完成路径接入续作判断。
- Modify: `CoBeing/packages/core/src/tools/agent-capability.ts` / `CoBeing/packages/core/src/agent/paths.ts` — 缺失能力卡时可生成默认 CapabilityCard，避免新 Agent 无法被 Butler 匹配。
- Modify: `CoBeing/packages/core/src/group/manager.ts` / `CoBeing/packages/core/src/todo/group-scanner.ts` — 创建/恢复/删除 Group 同步 Butler binding；Group TODO 完成按 executionRef.todoIds 精确更新 Global TODO，并同步 ButlerTask 完成。
- Modify: `CoBeing/packages/core/src/conversation/prompt-builder.ts` — 群组 prompt 不再加载 Agent 私有 memory/experience，避免群组上下文泄露个人记忆。
- Modify: `CoBeing/packages/core/src/api/ws-server.ts` — `find_agent` 读取 capability.json 做本地匹配，`dispatch_task` 调用真实 tracked dispatch；GUI 创建 Agent 同步写默认能力卡。
- Modify: `CoBeing/packages/core/src/todo/continuation-judgment.ts` — 续作判断失败/解析失败改为 `wait_user`，避免静默默认收束。
- Test: `CoBeing/packages/core/src/agent/butler.test.ts`、`tools/agent-task.test.ts`、`conversation/prompt-builder.test.ts`、`todo/scanner.test.ts`、`todo/continuation-judgment.test.ts`、`group/manager.test.ts` 补充覆盖。

剩余边界：
- Group -> Butler 的结构化 Host 事件工具仍未完整产品化。
- 前端管家回执卡片/快捷派发需要继续接真实 ButlerTask 数据流。
- 资源请求仍需进入 Butler 审批/授权队列。
- `GroupManager` 单测当时受本地 `better-sqlite3` Node 24 原生 binding 缺失影响；该阻塞已在 2026-06-11 先通过 fallback 兜底修复，并随后通过升级 `better-sqlite3@12.10.0` 恢复 native SQLite 路径。

验证说明：
- `vitest run packages/core/src/agent/butler.test.ts packages/core/src/tools/agent-task.test.ts packages/core/src/conversation/prompt-builder.test.ts packages/core/src/todo/scanner.test.ts packages/core/src/todo/continuation-judgment.test.ts`：5 文件、49 测试通过。
- `corepack pnpm build`：7 个 workspace 包编译通过。
- `vitest run packages/core/src/group/manager.test.ts`：2026-06-10 当时 6 项在 `GroupDB` 构造处失败，原因是本机缺少 `better_sqlite3.node`（Node 24.13.0 / win32-x64），不是断言失败；2026-06-11 已重新跑通。

---

### ToolAgent 标准化补齐 — Creator Group 草案与 Memory 修改建议

参考 `docs/项目信息/非Market未实现项审查.md` 的 P2-12 缺口，补齐工具智能体第一步统一协议和 Creator/Memory 职责边界。

变更原因：审查指出 ToolAgent 仍缺统一配置卡，`creator` 未纳入 ToolAgent 家族，Group 创建未调用 Creator，Memory ToolAgent 不能返回 `MEMORY.md` 修改建议。

修改文件：
- Create: `CoBeing/packages/core/src/agent/tool-agent/spec.ts` — 新增 `loadToolAgentSpec()`，统一读取 ToolAgent 配置卡、触发说明、失败策略、可见性策略和写入策略。
- Create: `CoBeing/data/toolagents/creator/config.json` / `prompt.md` — 新增 Creator ToolAgent 数据配置与提示词。
- Modify: `CoBeing/packages/core/src/agent/tool-agent/types.ts` — `ToolAgentType` 加入 `creator`，新增 `ToolAgentSpec`、可见性/写入/失败策略类型，以及 `MemoryFileUpdate`。
- Modify: `CoBeing/packages/core/src/agent/tool-agent/creator.ts` — 保留 Agent 创建能力，新增 `runGroupCreator()`，可返回 Group `GUIDE.md`、`PLAN.md`、成员缺口、初始任务和用户确认项。
- Modify: `CoBeing/packages/core/src/agent/tool-agent/memory.ts` 与 `CoBeing/data/toolagents/memory/prompt.md` — Memory 输出从单纯 entries 扩展为 `entries + memoryUpdates + warnings`，同时兼容旧数组输出。
- Modify: `CoBeing/packages/core/src/api/ws-server.ts` — `create_group` 创建后调用 Creator 草案，写入 `GUIDE.md` / `PLAN.md`，并把成员缺口、初始任务、确认项交给 host 首条系统消息。
- Modify: `CoBeing/packages/core/src/agent/tool-agent/tool-agent.test.ts` / `CoBeing/packages/core/src/api/ws-server.test.ts` — 增加 ToolAgentSpec、Group Creator、Memory 更新建议和 host handoff 摘要测试。
- Modify: `CoBeing/packages/core/src/index.ts` — 导出 Group Creator 与 ToolAgentSpec API。
- Modify: `CoBeing/package.json` / `CoBeing/pnpm-workspace.yaml` — 将 pnpm 构建脚本批准清单迁到 workspace 配置，适配 pnpm 11。

修改内容摘要：
- ToolAgent 现在有统一 `ToolAgentSpec` 数据结构和 loader，配置包括 trigger、visibility、writePolicy、failurePolicy。
- Creator 现在属于 ToolAgent 类型，并能辅助 Group 创建初始草案；调用方只应用低风险文件草案，不静默创建额外资源。
- Memory ToolAgent 可返回 `MEMORY.md` 修改建议，但仍由调用方决定是否应用，保持“ToolAgent 不拥有长期记忆主体”的边界。
- 前端/日志可见性仍只是数据协议层补齐，尚未完成独立 GUI 展示或观测面板区分。

验证说明：
- `vitest run packages/core/src/agent/tool-agent/tool-agent.test.ts packages/core/src/api/ws-server.test.ts`：2 文件、22 测试通过。
- `corepack pnpm build`：7 个 workspace 包编译通过。

---

### 通用智能体能力与增强 — 全 5 层实现

实现设计文档 `docs/GOALS/general-agent-capability-design.md` 的全部 5 层实施。

变更原因：通用智能体需要清晰的能力边界、任务状态、成长机制和可调度能力。

修改文件（22 个）：
- Create: `packages/core/src/tools/agent-capability.ts` / `agent-task.ts` / `agent-growth.ts` / `agent-resource.ts`（4 个工具文件）
- Create: `packages/core/src/agent/tool-agent/growth-reviewer.ts` / `task-archive.ts` / `capability-updater.ts`（3 个 ToolAgent）
- Create: `data/toolagents/growth-reviewer/` / `task-archive/` / `capability-updater/` 各含 config.json + prompt.md
- Create: `gui-v2/src/components/agent/CapabilityTab.tsx` / `TaskInboxTab.tsx` / `GrowthProposalsTab.tsx`
- Create: `gui-v2/src/stores/agentEnhancement.ts`
- Modify: `packages/shared/src/types.ts` — 新增 6 个 Agent 增强接口 + mapAgentStatusToGlobal 工具函数
- Modify: `packages/core/src/agent/paths.ts` — AgentPaths 5 getter + AgentFiles 9 方法
- Modify: `packages/core/src/agent/agent.ts` — 注册 10 个增强工具 + getTaskSummary() + getStatus 改进
- Modify: `packages/core/src/agent/butler.ts` — 新增 3 个 Butler 工具（find-agent/dispatch-task/review-proposals）
- Modify: `packages/core/src/api/ws-server.ts` — 新增 7 个 WS 端点
- Modify: `gui-v2/src/lib/types.ts` — 新增 Agent 增强前端类型
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 4 个 WS message handler
- Modify: `gui-v2/src/components/agent/AgentDetailPanel.tsx` — 新增 3 个 Tab（能力/任务/成长）

修改内容：
- 能力层：AgentCapabilityCard + capability.json + agent-get/update-capability 工具 + CapabilityUpdater ToolAgent
- 任务层：AgentTaskInboxItem + inbox.json + agent-task-accept/report/complete 工具 + TaskArchive ToolAgent
- 成长层：AgentReflectionRecord + AgentGrowthProposal + proposals/ + 4 个成长工具 + GrowthReviewer ToolAgent
- 资源层：agent-request-resource 工具（发送端）
- Butler 集成：butler-find-agent / butler-dispatch-task / butler-review-proposals
- 前端：能力卡 Tab / 任务收件箱 Tab / 成长建议 Tab + agentEnhancement store

验证说明：
- 全量构建（7 workspace 包）零错误
- vitest run: 51 文件、484 测试全部通过
- gui-v2 tsc --noEmit: 零类型错误

---

### 管家入口 Round 2: 前端聊天增强（TaskReceiptCard + ChatInputActions + 视觉优化）

依据 `docs/GOALS/frontend-butler-entry-polish-design.md` 和 Round 2 实施规格，在 Round 1 数据层和 TODOboard 已有基础上，补齐管家聊天区的任务回执卡片、输入快捷按钮和视觉优化。

变更原因：

- 前端 GlobalTodoPanel 已完成管家侧栏，但聊天区内仍缺少任务回执卡片和管家专属输入快捷动作。
- ChatHeader 和 ChatInput 需要接入管家视图特有的交互元素（派发/创建/摘要按钮、托管状态 chip）。
- 设置图标仍使用 emoji `⚙`，整体质感可提升。

修改文件：

- Create: `gui-v2/src/components/chat/TaskReceiptCard.tsx` — 可折叠任务回执卡片（标题/状态/摘要/下一步/产物）
- Create: `gui-v2/src/components/chat/ChatInputActions.tsx` — 管家输入快捷按钮（派发/创建/摘要，lucide 图标 + 下拉菜单）
- Modify: `gui-v2/src/lib/types.ts` — 新增 `TaskReceipt` 接口；`LogMessage.metadata` 从 `Record<string, unknown>` 改为带 `taskReceipt` 和 `cards` 的类型化结构
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `MessageBubble` 接入 `TaskReceiptCard`；`ChatInput` 底部左栏嵌入 `ChatInputActions`（管家视图）；`ChatHeader` 设置按钮 `⚙` → `<Settings>`（lucide）

修改内容：

- `TaskReceiptCard`：默认折叠显示标题+接受者+状态 badge，展开后显示摘要/下一步/产物列表。状态对应色：running=accent, waiting_user=warning, completed=success, failed=danger。
- `ChatInputActions`：管家视图下显示"派发"（Send 图标，弹出 Agent/Group 列表）、"创建"（Plus 图标，弹出新建 Agent/Group 选项）、"摘要"（BarChart3 图标，插入自然语言请求）。非管家视图返回 null。
- `ChatView` 聊天增强：`MessageBubble` 在非用户消息中检测 `msg.metadata?.taskReceipt` 并渲染卡片；管家视图下 ChatInput 左侧显示快捷按钮组。
- 视觉优化：设置按钮从 emoji `⚙` 替换为 lucide-react `Settings` 图标（16px）。

验证说明：

- `pnpm build`：7 个 workspace 包编译零错误。
- `pnpm test`：51 个测试文件、484 个测试通过（未新增后端测试）。
- `gui-v2 npx tsc --noEmit`：零类型错误。
- `gui-v2 npx vite build`：构建成功（预留 chunk/动态 import 警告与之前一致）。

---

## 2026-06-09

### TODOboard 全局与群组协作 — 三层架构实现

依据 `docs/GOALS/todoboard-global-group-design.md` 和 `docs/superpowers/specs/2026-06-09-todoboard-implementation-design.md`，完成 5 阶段实施：

**Phase 1: Global TODO 数据模型**
- 扩展 `@cobeing/shared/src/butler-bridge.ts` 中 `GlobalTodoItem` 类型：新增 `automationPolicy`、`continuationPolicy`、`progressSummary`、`internalBlocker`；`ExecutionRef` 改为 `id` + `todoIds[]` 结构
- 扩展 `TodoScope` 类型为 `"agent" | "group" | "global"`
- 重写 `packages/core/src/todo/global-store.ts`：新增 `add()`/`remove()` 替代 `create()`/`delete()`，新增 `getByExecutionRef()`、`getWaitingUser()`、`getStalled()`、`setStatus()`、`setBlocker()`、`clearBlocker()`、`addExecutionRef()`
- `runtime.ts`：构造函数初始化 `GlobalTodoStore` 实例（`data/coreagents/butler/global-todos.json`）
- 23 个 GlobalTodoStore 单元测试

**Phase 2: Butler 编排工具**
- 新建 `packages/core/src/todo/global-tools.ts`：5 个 Butler 专属工具（`global-todo-add`、`global-todo-list`、`global-todo-update`、`global-todo-link-execution`、`global-todo-continue`）
- `butler.ts`：注册 5 个工具，通过 `globalThis.__cobeing.runtime.globalTodoStore` 获取 Store 实例
- 工具层通过 `wsServer.broadcastGlobalTodoUpdate()` 广播变更事件

**Phase 3: 完成事件回传 + 状态同步**
- `GroupTodoScanner.complete()`：在依赖检查和 Memory Agent 之间注入 GlobalTodoStore 通知——查找引用了此 Group 的 Global TODO 并更新 `lastEvent` + `progressSummary`
- `ws-server.ts`：新增 `get_global_todos` WS 端点 + `broadcastGlobalTodoUpdate()` 方法
- 修复 `get_group_health`：`(g2 as any).groupTodoStore` → `this.groupManager?.getGroupTodoStore?.()`

**Phase 4: 自动续作 / 生成后续任务**
- 新建 `packages/core/src/todo/continuation-judgment.ts`：`runContinuationJudgment()` 通过轻量 LLM 调用判断续作决策（complete/wait_user/auto_generate/request_cross_layer），含高风险关键词自动降级 + `applyContinuationResult()` 执行决策
- `continuationPolicy` 支持 `maxDepth` 控制深度，`stopWhen` 条件停止

**Phase 5: 前端 UX**
- 新建 `gui-v2/src/components/todo/GlobalTodoPanel.tsx`：Butler 左侧栏面板（统计条 + 状态分组列表 + 阻塞标记）
- `Sidebar.tsx`：`activeView === "butler"` 时渲染 GlobalTodoPanel
- `ChatView.tsx`：独立 Agent 对话区上方嵌入 `TodoInline` 紧凑 TODO 横幅；群组中不显示
- `useWebSocket.ts`：处理 `global_todos` / `global_todo_updated` 事件
- `stores/todo.ts`：新增 `globalTodos` 状态 + `setGlobalTodos`
- `lib/types.ts`：新增 `GlobalTodoInfo` 前端类型

修改文件（共 16 个）：
- Modify: `packages/shared/src/butler-bridge.ts` — GlobalTodoItem 扩展
- Modify: `packages/core/src/todo/types.ts` — TodoScope 扩展
- Modify: `packages/core/src/todo/global-store.ts` — 全量重写
- Modify: `packages/core/src/todo/global-store.test.ts` — 适配新 API
- Modify: `packages/core/src/runtime.ts` — GlobalTodoStore 初始化
- Create: `packages/core/src/todo/global-tools.ts` — 5 个工具工厂
- Modify: `packages/core/src/agent/butler.ts` — 注册工具
- Modify: `packages/core/src/todo/group-scanner.ts` — 回传 + 续作回调
- Modify: `packages/core/src/api/ws-server.ts` — get_global_todos + broadcast + 修复 get_group_health
- Create: `packages/core/src/todo/continuation-judgment.ts` — 自动续作核心
- Create: `gui-v2/src/components/todo/GlobalTodoPanel.tsx` — Butler 侧栏
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — 集成 GlobalTodoPanel
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — TodoInline 嵌入
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 事件处理
- Modify: `gui-v2/src/stores/todo.ts` — globalTodos 状态
- Modify: `gui-v2/src/lib/types.ts` — GlobalTodoInfo 类型

验证：
- `vitest run`：51 个测试文件、484 个测试通过（新增 23 个 GlobalTodoStore 测试）
- `tsc -p packages/shared`、`packages/core`：零错误
- `tsc -p gui-v2`：零错误
- `vite build`：成功

---

### 审计修复：GROUP_MECHANICS_NOTICE 同步

变更原因：审计发现 `GROUP_MECHANICS_NOTICE` 仍将 `group-send` 描述为普通通信工具，未反映非阻塞旁路特性。

修改文件：
- Modify: `packages/core/src/conversation/prompt-builder.ts` — `GROUP_MECHANICS_NOTICE` 通信方式行更新为：明确 group-send 为非阻塞旁路消息，发送后默认继续工作；补充"不要只在最终回复里写 @mention"

验证说明：`pnpm build` 7 packages 零错误，`vitest run` 51 文件 477 测试全通过

---

### 管家入口 Round 1: 数据层 + 核心 Agent 过滤

依据 `docs/GOALS/butler-entry-bridge-design.md` 和 `docs/GOALS/frontend-butler-entry-polish-design.md` 设计文档，完成管家入口升级的第一层：建立前后端共享类型语言，创建三个后端 JSON 文件持久化 Store，并在前端实现核心 Agent（butler/host）过滤。

变更原因：

- CoBeing 产品定位要求管家成为用户入口，但 Butler 与 Group 之间缺少结构化数据层支撑任务托管、事件桥接和全局追踪。
- 前端 Agent/Group 列表中 butler 和 host 混入普通 Agent 展示，不符合"管家专用入口"和"群主不是普通 Agent"的产品边界。
- 共享类型是前后端的共同语言，必须先建立再推进后续 UI 和桥接工具。

修改文件：

- Create: `packages/shared/src/butler-bridge.ts` — 共享类型定义（ButlerTask, GlobalTodoItem, GroupButlerBinding, ButlerEscalationEvent, ButlerUserQuestion + 常量）
- Create: `packages/shared/src/butler-bridge.test.ts` — 6 个常量验证测试
- Modify: `packages/shared/src/index.ts` — 导出 butler-bridge.ts
- Create: `packages/core/src/todo/global-store.ts` — GlobalTodoStore（JSON 持久化 CRUD + 过滤查询）
- Create: `packages/core/src/todo/global-store.test.ts` — 16 个测试（CRUD/过滤/持久化往返）
- Create: `packages/core/src/butler/butler-task-store.ts` — ButlerTaskStore（CRUD + 状态机转换校验）
- Create: `packages/core/src/butler/butler-task-store.test.ts` — 16 个测试（CRUD/状态机/持久化）
- Create: `packages/core/src/butler/butler-binding-store.ts` — GroupButlerBindingStore（CRUD + 默认策略）
- Create: `packages/core/src/butler/butler-binding-store.test.ts` — 12 个测试（CRUD/默认值/过滤/持久化）
- Modify: `packages/core/src/index.ts` — 导出 3 个新 Store
- Create: `gui-v2/src/lib/coreAgents.ts` — CORE_AGENT_IDS / isCoreAgent() / getVisibleUserAgents()
- Modify: `gui-v2/src/lib/types.ts` — 新增 ButlerTaskSummary 前端类型
- Create: `gui-v2/src/stores/butlerTasks.ts` — 管家任务摘要 Zustand store（初始空状态占位）
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — Agent 列表和自动选择使用 getVisibleUserAgents 过滤
- Modify: `gui-v2/src/components/agent/AgentDetailPanel.tsx` — isCoreAgent 守卫，核心 Agent 不打开详情
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx` — 成员选择使用 getVisibleUserAgents 过滤
- Modify: `gui-v2/src/components/group/CreateGroupDialog.tsx` — 初始成员候选使用 getVisibleUserAgents 过滤

修改内容：

- 共享类型层：定义 5 个 interface（ButlerTask / GlobalTodoItem / GroupButlerBinding / ButlerEscalationEvent / ButlerUserQuestion）+ 3 个常量（DEFAULT_ESCALATION_POLICY / DEFAULT_ALLOWED_EVENTS / CORE_AGENT_IDS）
- 后端 Store：遵循现有 TodoStore JSON 持久化模式（原子写入 tmp+rename），ButlerTaskStore 含合法状态迁移校验
- 前端过滤：纯函数库 coreAgents.ts，仅 UI 层过滤不删除 store 数据；butlerTasks Zustand store 含 summary 派生计算

验证说明：

- `pnpm build`：7 个 workspace 包编译零错误。
- `pnpm test`：51 个测试文件、477 个测试通过（新增 ~50 个测试）。
- `gui-v2 npx tsc --noEmit`：零类型错误。
- `vitest run`：shared 6 tests / core 44 tests / 全量 477 tests 全部通过。

---

### 群组纯 Prompt 驱动协作 — prompt 层全面升级

变更原因：基于 `docs/GOALS/group-organization-prompt-driven-design.md` 确认的设计方向，
将群组协作从重协议模式升级为纯 prompt 驱动，重写群主职责、群组规则、Agent 行为边界和工具描述。

修改文件：
- Create: `packages/core/src/templates/host/HOST_JOB.md` — 群主核心职责模板（9 项职责 + 触发时机 + 判断框架 + 决策原则 + 输出规范）
- Modify: `packages/core/src/templates/group/GUIDE.md` — 重写群组规则模板（场景定义、协作风格、用户审批点、资源申请链、沟通规范、禁止行为清单）
- Modify: `packages/core/src/runtime.ts` — `ensureHostDir()` 从模板写入 HOST_JOB.md 到 `data/coreagents/host/JOB.md`
- Modify: `packages/core/src/conversation/prompt-builder.ts` — 重写 Agent 群组协作上下文：替换旧"协作规则+角色自适应+能力互补"三段为"6 步判断框架 + 需用户判断/协作/资源场景 + 禁止行为 + 协作消息规范"；群主职责段从模块化工作流升级为"工作管理+用户对接+资源与秩序"三板块；模块化协作提示从引用 INTERFACE/PLAN 改为引用 TODOboard
- Modify: `packages/core/src/tools/group-tools.ts` — 重写 group-send 工具 description：明确非阻塞旁路消息 + 使用场景 + 5 要素模板 + 与最终回复的区别
- Modify: `packages/core/src/group/workspace.ts` — `initialize()` 精简为仅自动创建 GUIDE.md + EXPERIENCE.md，其余 6 个工作区文件改为按需创建
- Modify: `packages/core/src/agent/butler.ts` — 群组创建时群主唤醒消息改为结构化 3 步指引（自我介绍+确认定位、说明成员能力、询问需求）
- Modify: `docs/项目信息/核心技术.md` — 新增"纯 Prompt 驱动的协作策略"章节
- Modify: `docs/项目信息/项目现状.md` — 更新 Group 描述为纯 prompt 驱动 + 轻结构承载
- Modify: `docs/项目信息/架构说明.md` — 补充 GUIDE.md/HOST_JOB.md 在 Group 架构中的位置

修改内容：
- 群主从"模块化工作流协调者（6 步流水线）"升级为"9 项职责的责任协调者"，明确与管家/成员/TODOboard 的关系边界
- Agent 群组上下文新增完整的 6 步判断框架（职责→信息→用户判断→协作→资源→交付）、禁止行为清单（8 项）、协作消息与最终回复的区别规范
- group-send 从"主动向群组发消息"升级为"非阻塞协作旁路消息"，附带 5 要素模板
- 工作区文件从 8 个自动创建精简为 2 个（GUIDE + EXPERIENCE），降低用户面对大量文档的负担
- 设计规格：`docs/superpowers/specs/2026-06-09-group-prompt-driven-implementation-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-09-group-prompt-driven-implementation.md`

验证说明：
- `pnpm build`：7 个 workspace 包编译零错误
- `vitest run`：51 文件 477 测试全通过

---

## 2026-06-08

### 核心 TODO / 群组唤醒闭环修复

围绕“核心功能与前端闭环实施计划”的 Group / TODO / WS 链路，补齐群组 TODO 在触发、完成和前端事件同步上的几个闭环断点。

问题描述：

- TODO 变更事件缺少稳定的 scope / agentId / groupId 上下文，前端在删除等事件上容易误判当前 TODO 面板是否需要刷新。
- 已触发但尚未完成的 `condition` TODO 会在同一 Agent 再次发言时重复触发。
- 已触发但尚未完成的 `0time` TODO 会在重建前被重复唤醒一次。
- 前端 WS、Host 管理工具、批量完成和验收通过等路径直接操作 `TodoStore.complete()` 时，会绕过 `GroupTodoScanner.complete()`，导致依赖通知、onComplete 动作链、工作区进度同步等群组副作用丢失。

根因分析：

- TODO mutation payload 之前把“任务本身”和“任务所在上下文”混在一起，删除事件尤其缺少可推断字段。
- `TodoStore.getConditionTodos()` 未排除已有 `triggeredAt` 的 pending 条目。
- `GroupTodoScanner.scanOnce()` 的 0time 待触发筛选使用了过宽条件。
- 多个完成入口没有统一走群组 scanner 的完成协议，而是直接写 TODO store。

修改文件：

- `CoBeing/packages/core/src/api/ws-server.ts`
- `CoBeing/packages/core/src/api/ws-server.test.ts`
- `CoBeing/packages/core/src/agent/agent.ts`
- `CoBeing/packages/core/src/agent/butler.ts`
- `CoBeing/packages/core/src/group/host-tools.ts`
- `CoBeing/packages/core/src/group/host-tools.test.ts`
- `CoBeing/packages/core/src/group/manager.ts`
- `CoBeing/packages/core/src/group/manager.test.ts`
- `CoBeing/packages/core/src/runtime.ts`
- `CoBeing/packages/core/src/todo/group-scanner.ts`
- `CoBeing/packages/core/src/todo/scanner.test.ts`
- `CoBeing/packages/core/src/todo/store.ts`
- `CoBeing/packages/core/src/todo/tools.ts`
- `CoBeing/packages/core/src/todo/tools.test.ts`
- `CoBeing/gui-v2/src/components/todo/TodoPanel.tsx`
- `CoBeing/gui-v2/src/hooks/useWebSocket.ts`
- `CoBeing/gui-v2/src/lib/types.ts`

修改内容：

- 新增 `buildTodoMutationPayload()` 契约测试，让 TODO added/completed/removed/status/batch 事件携带 `action`、`scope`、`agentId`、`groupId`。
- 前端 `useWebSocket` 将 TODO 变更作为带上下文的 activity/custom event 处理；`TodoPanel` 只在当前 agent/group scope 匹配时刷新。
- `condition` TODO 排除已触发待完成项，避免同一条件重复唤醒。
- `0time` TODO 对已触发待完成项直接进入过期重建，不再重复触发一次。
- `GroupManager.completeGroupTodo()` 统一封装群组 TODO 完成协议。
- WS `complete_todo`、`update_todo_status=completed`、`batch_complete_todo`，以及 Host 管理工具、TODO 批量完成/验收通过工具接入群组 scanner 完成路径。
- 新增测试覆盖群组上游 TODO 完成后通知下游依赖、TODO 工具 scanner 完成路径、Host 异步完成回调，以及重复触发防护。

验证说明：

- `vitest run`：47 个测试文件、427 个测试通过。
- `git diff --check`（`CoBeing/`）：通过；仅输出既有 CRLF 提示。
- `tsc -p packages/shared/tsconfig.json`、`packages/plugin-sdk/tsconfig.json`、`packages/providers/tsconfig.json`、`packages/channels/tsconfig.json`、`packages/core/tsconfig.json`、`packages/mcp-servers/qqbot/tsconfig.json`、`packages/mcp-servers/office/tsconfig.json`：均通过。
- `tsc -p gui-v2/tsconfig.json`：通过。
- `vite build`（`CoBeing/gui-v2`）：通过；保留既有 chunk 体积和动态 import 警告。
- `pnpm` 当前不在 PATH，本次使用本地 `node_modules/.bin/*.cmd` 执行等价验证。

---

### 新增核心技术说明文档

新增 `docs/项目信息/核心技术.md`，用于说明 CoBeing 的核心技术主张。该文档位于产品战略与架构说明之间，重点解释三层智能体设计、TODOboard 技术设想，以及群组驱动的多智能体协作技术。

变更原因：

- 现有 `产品战略.md` 偏产品定位，`架构说明.md` 偏代码事实，缺少一份解释“核心技术为什么这样设计”的中间层文档。
- 用户明确要求补充核心智能体、通用智能体、工具智能体三层设计，TODOboard 技术设想，以及群组驱动的多智能体合作技术。

修改内容：

- 新增 `docs/项目信息/核心技术.md`。
- 同步更新 `STRUCTURE.md` 文档目录树。
- 同步更新根 `CLAUDE.md` 文档目录树与文档同步规则。
- 同步更新 `CoBeing/CLAUDE.md` 文档目录树与相关文档维护规则。

文档口径：

- 将核心智能体定义为系统级角色，重点包括管家 Butler 与群主 Host。
- 将通用智能体定义为可长期定制、具备角色/职责/记忆/工具的工作个体。
- 将工具智能体定义为窄域、可复用、偏专业动作的能力单元。
- 将 TODOboard 标注为从 TODO 清单升级为任务状态协议、触发器和经验沉淀入口的技术设想。
- 将群组驱动协作作为重点，说明 Group 作为任务空间、上下文容器、唤醒系统、协作协议和经验沉淀单元的技术价值。

验证说明：

- 本次为文档-only 变更，未修改 `.ts` 源码。
- 未运行 `pnpm build` 或 `pnpm test`。

---

## 2026-06-07

### 文档体系清理与事实重建

针对旧版本文档过多、过时内容互相冲突的问题，完成一次文档系统重建。此次变更不修改源码，只基于代码库、`PROGRESS.md` 和子智能体审计结论重建当前事实文档。

问题描述：

- 旧文档将历史计划、已删除能力和部分未打通链路混写为当前能力。
- 旧 README/GOAL/STRUCTURE 仍包含旧 Agent 文件体系和“7 家原生 Provider”等不准确描述。
- `docs/项目信息/` 下的能力清单式文档数量过多，维护成本高，容易再次过期。

处理结果：

- 删除旧版冗余文档：后端能力清单、前端设计清单、测试清单、用户功能清单、启动命令、用户指南、待办、目标用户、闪光点、1.3 之后开发安排，以及 `docs/优势.md`、`docs/海报.md`、`docs/临时.txt`。
- 新增核心事实文档：
  - `docs/项目信息/项目现状.md`：说明当前已实现、部分实现和未产品化能力。
  - `docs/项目信息/架构说明.md`：说明 Runtime、Agent、Butler、Group、Tool、Memory、Plugin、MCP、GUI 架构。
  - `docs/项目信息/使用说明.md`：说明普通用户与进阶用户当前使用路径。
  - `docs/项目信息/当前待办.md`：保留当前有效待办，替代旧版大清单。
- 保留并继续使用 `docs/项目信息/产品战略.md` 作为产品战略入口。
- 重写 `README.md`、`GOAL.md`、`STRUCTURE.md`，删除旧 Agent 文件和夸大能力表述。
- 同步更新根 `CLAUDE.md` 与 `CoBeing/CLAUDE.md` 的文档目录和维护规则。

口径修正：

- 当前 Agent 文件体系为 `AGENTS.md`、`CHARACTER.md`、`JOB.md`、`MEMORY.md`、`EXPERIENCE.md`、`config.json`。
- 默认 Provider 只有 `deepseek`；其他 Provider 主要通过 `data/plugins/providers/` 数据插件扩展。
- MCP、插件 hook、prompt layer、投票、沙箱监控等能力标为基础设施存在或部分实现，不再写成完整成熟闭环。
- Market 官方认证、社区分级、管家自动挑选扩展是产品战略方向，不写成已落地功能。

验证说明：

- 本次为文档-only 变更，未修改 `.ts` 源码。
- 未运行 `pnpm build` 或 `pnpm test`。
- 已验证被删除的旧文档路径均不存在。
- 已扫描当前活跃入口文档与 `docs/项目信息/`，未发现旧 Agent 文件体系或旧能力清单文档的活跃引用；仅保留 `当前待办.md` 这一新文档名的正常引用。

---

## 2026-06-05

### Agent 核心文件重构 — 三方审计

对重构进行三个维度的独立审计：

- **源码过时引用审计**：扫描 packages/ 全部 .ts 文件，发现 1 处过时注释（group.ts:468 "SOUL"→"CHARACTER"），已修复。其余零残留引用。
- **前端+技能+数据审计**：扫描 gui-v2/src/、data/skills/、data/toolagents/、data/agents/ — 零过时引用。
- **一致性审计**：15 项全生命周期检查全部通过（创建流程→prompt 组装→运行时→模板文件→配置一致性）。

验证：`pnpm build` 零错误 · `pnpm test` 43 文件 403 测试全通过 · `gui-v2 tsc --noEmit` 零错误。

---

## 2026-06-04

### Agent 核心文件系统重构

对 Agent 核心文件系统进行全面重构，消除冗余，明确职责边界：

- **删除 4 个文件**：BOOTSTRAP.md（与 AGENTS.md 重叠）、SOUL.md（语言风格→CHARACTER，行为准则→AGENTS）、USER.md（→EXPERIENCE）、TOOLS.md（→EXPERIENCE）
- **重写 5 个文件**：
  - CHARACTER.md — 纯人物形象（背景+外观+语言风格）
  - JOB.md — 纯工作范式（思考方式+工作流程+决策原则+输出规范）
  - MEMORY.md — 条目式事件记录，仅独立工作使用
  - EXPERIENCE.md — 四维经验（技术技巧+工具心得+用户偏好+教训）
  - AGENTS.md — 新增行为准则（从 SOUL 迁移），显式标注 JOB/CHARACTER 分工
- **核心分工规则**：🔧 工作时遵循 JOB.md · 💬 回复时参考 CHARACTER.md

修改文件（共 35+ 个）：
- Delete: templates/agent/SOUL.md, BOOTSTRAP.md, USER.md, TOOLS.md
- Rewrite: templates/agent/CHARACTER.md, JOB.md, MEMORY.md, EXPERIENCE.md, AGENTS.md
- Modify: agent/paths.ts — 删除 4 个 getter + 8 个读写方法
- Modify: agent/agent.ts — experience-reflect 调用简化；CHARACTER name 提取兼容新旧格式
- Modify: agent/butler.ts — 删除 soul/bootstrap 参数；templateFiles→5 文件；modify-agent enum→CHARACTER/JOB
- Modify: api/ws-server.ts — 删除 soul/bootstrap 创建逻辑；templateFiles→5 文件
- Modify: agent/tool-agent/creator.ts — CreatorField→character|job；prompt 更新
- Modify: conversation/prompt-builder.ts — 删除 SOUL/BOOTSTRAP/USER 构建段；MemberProfile 删除 personality
- Modify: tools/experience-reflect.ts — 函数签名 3 参数→1 参数；删除 soul_update/tool_usage
- Modify: memory/memory-store.ts — MemoryTarget 删除 user/tools；全部 targets/labels/snapshots 更新
- Modify: group/group.ts — 删除 BOOTSTRAP 注入；getMemberProfiles 删除 SOUL 性格提取
- Modify: shared/constants.ts — MAX_MEMORY_CHARS 删除 user/tools
- Modify: config/default.json — memory.charLimits 删除 user/tools
- Modify: gui-v2/src/components/agent/AgentFilesTab.tsx — AGENT_FILES 列表→5 文件
- Modify: gui-v2/src/components/tutorial/TutorialOverlay.tsx — 更新教程文案
- Modify: data/skills/agent-creation/SKILL.md — 删除 SOUL/BOOTSTRAP 章节
- Modify: data/skills/meta-skills/learning-loop/SKILL.md — 更新经验写入目标
- Modify: data/agents/高三语文教师/* — 迁移旧文件内容到新结构，删除 4 个废弃文件
- Modify: packages/core/src/agent/paths.test.ts — 删除 6 个废弃测试
- Modify: packages/core/src/conversation/prompt-builder.test.ts — 删除/更新 5 个测试
- Modify: packages/core/src/integration.test.ts — 删除 4 个测试块
- Modify: packages/core/src/memory/memory-store.test.ts — user/tools→experience

验证结果：
- `pnpm build` — 全部 7 个 workspace 包编译零错误
- `pnpm test` — 全部 43 个测试文件 403 个测试通过
- `gui-v2 npx tsc --noEmit` — 前端零类型错误

### Task 11: 更新 constants.ts + config/default.json — 删除 user/tools charLimits

从 `MAX_MEMORY_CHARS` 常量和 `config/default.json` 的 `memory.charLimits` 中删除 `user: 2000` 和 `tools: 3000` 条目，与 Task 9（memory-store.ts 删除 user/tools 目标）保持一致。

修改文件：
- Modified: packages/shared/src/constants.ts — 删除 user/tools 条目
- Modified: config/default.json — 删除 user/tools 条目

### Task 7: 重写 experience-reflect.ts — 删除 soul/tools 参数

将 `makeExperienceReflectTool` 函数签名从 3 参数简化为 1 参数，删除 SOUL.md 和 TOOLS.md 写入能力，仅保留 EXPERIENCE.md 的经验记录功能。

修改文件：
- Modified: packages/core/src/tools/experience-reflect.ts

修改内容：
- 函数签名：`makeExperienceReflectTool(experienceFilePath)` — 仅 1 个参数（原为 3 个：experienceFilePath, soulFilePath, toolsFilePath）
- 删除参数：`soul_update`、`tool_usage`（及其子字段 scenario, tools, result）
- 删除：section 3（Soul update → SOUL.md）和 section 4（Tool strategy → TOOLS.md）
- 保留：Problem-Solution → EXPERIENCE.md（技术技巧）、Lesson → EXPERIENCE.md（教训）
- EXPERIENCE.md 模板简化：新增 `## 技术技巧` 和 `## 教训` 分类标题
- 调用方 agent.ts 无需修改（已仅传 1 个参数）

## 2026-06-03

### 提取 ToggleSwitch 为共享组件

将 SkillsTab.tsx / McpsTab.tsx / PluginsTab.tsx 中三份重复的 ToggleSwitch 函数提取为 `gui-v2/src/components/shared/ToggleSwitch.tsx` 共享组件，各 tab 文件改为从共享路径导入。

修改文件：
- Created: gui-v2/src/components/shared/ToggleSwitch.tsx
- Modified: gui-v2/src/components/extensions/SkillsTab.tsx
- Modified: gui-v2/src/components/extensions/McpsTab.tsx
- Modified: gui-v2/src/components/extensions/PluginsTab.tsx

修改内容：
- 在 `components/shared/` 下创建共享 `ToggleSwitch` 组件，导出为命名导出
- 三份 tab 文件中移除本地 `function ToggleSwitch(...)` 定义（各约 20 行）
- 三份 tab 文件添加 `import { ToggleSwitch } from "@/components/shared/ToggleSwitch"`
- TypeScript 类型检查通过（`npx tsc --noEmit` 无错误）

### 修复 McpsTab.tsx 三个 Bug

修复 MCP 服务器配置页的三个 bug：

1. **McpDetail 缺少 key prop** — 切换服务器时 React 复用组件实例，表单状态不更新
2. **deleteServer 发送 value: undefined** — JSON.stringify 自动删除 undefined 字段，导致后端收不到 value，无法删除服务器
3. **handleSave 展开整个 server 对象** — `{ ...server, transport }` 将 name、toolCount、enabled 等元数据字段也发送给后端

修改文件：
- Modified: gui-v2/src/components/extensions/McpsTab.tsx

修改内容：
- Bug 1: `<McpDetail>` 添加 `key={selected.name}` 强制 React 在切换服务器时重新挂载
- Bug 2: `deleteServer` 中 `value: undefined` → `value: null`
- Bug 3: `handleSave` 改为仅构建后端 schema 期望的字段（transport, command, url, env, args, headers）

## 2026-06-03

### 前端扩展系统重设计

对前端 GUI 进行大幅重组：
- 侧栏重排：管家→智能体→群组→仪表盘→扩展→设置，删除独立技能页
- 新增扩展页面：Tab 式 3 栏布局（技能/MCPs/插件）
- 技能 Tab：迁移 SkillCenter 功能，增加启用/禁用开关
- MCPs Tab：迁移 McpSection，改为列表+配置窗口模式
- 插件 Tab：全新组件，平铺列表+动态配置+功能开关
- 仪表盘：统一居中卡片设计，合并用量监控，删除工具排行
- 设置页精简：移除用量监控/MCP 服务器菜单项，关于页居中美化
- 版本号修复：get_config 新增 version 字段，关于页动态显示
- 后端：新增 toggle_plugin/update_plugin_config WS 端点，list_plugins 扩充 configSchema

修改文件：
- Create: gui-v2/src/components/extensions/{ExtensionsView,SkillsTab,McpsTab,PluginsTab}.tsx
- Create: gui-v2/src/stores/extensions.ts
- Modify: gui-v2/src/lib/types.ts, stores/settings.ts, stores/plugins.ts
- Modify: gui-v2/src/components/layout/{NavBar,MainContent}.tsx
- Modify: gui-v2/src/components/observability/DashboardView.tsx
- Modify: gui-v2/src/components/settings/SettingsView.tsx
- Modify: gui-v2/src/hooks/useKeyboardShortcuts.ts, hooks/useWebSocket.ts
- Modify: gui-v2/src/lib/ws-client.ts
- Modify: packages/core/src/api/ws-server.ts, packages/core/src/runtime.ts
- Delete: gui-v2/src/components/skill/SkillCenter.tsx, stores/skills.ts
- Delete: gui-v2/src/components/settings/{McpSection,UsageMonitor}.tsx, stores/usage.ts

## 2026-06-03

### 前端重设计 Task 7: PluginsTab — 插件管理页（全新组件）

**新增**：`gui-v2/src/components/extensions/PluginsTab.tsx` — 全新的插件管理标签页组件。

**组件结构**：
- `PluginsTab`（主组件）— 左右两栏布局：左栏插件列表（搜索过滤 + 开关），右栏插件详情和配置
- `ToggleSwitch` — 可复用的开关组件
- `PluginDetail` — 插件详情面板，支持 configSchema 表单渲染、功能开关、模型列表、以及无 schema 时的 JSON 原始编辑器
- `InfoBadge` — 信息展示徽章

**交互**：
- 列表项点击 → 右侧显示详情
- ToggleSwitch → 发送 `toggle_plugin` WS 命令并乐观更新
- 保存配置 → 发送 `update_plugin_config` WS 命令
- 搜索输入框实时过滤插件列表

**新增文件**：
- Create: `gui-v2/src/components/extensions/PluginsTab.tsx`

**验证**：tsc --noEmit 通过，无新增错误（预存错误 5 项来自其他文件）。

## 2026-06-03

### 前端重设计 Task 4: ExtensionsView 主容器 + Tab 栏 + 3 栏布局

**变更**：将 ExtensionsView 占位组件替换为完整的 Tab 栏 + 三栏布局实现。

**修改**：
- Modify: `gui-v2/src/components/extensions/ExtensionsView.tsx` — 从占位 `<div>` 替换为带 3 个 Tab（技能/MCPs/插件）的 Tab 栏 + 内容区，使用 `useExtensionsStore` 的 `activeTab` / `setActiveTab` 控制切换
- 引入 `SkillsTab`、`McpsTab`、`PluginsTab`（尚待 Task 5-7 创建）
- Tab 样式：`activeTab` 时 `border-accent text-accent`，非激活时 `border-transparent text-txt-muted`

**验证**：tsc 仅报 3 个预期错误（SkillsTab/McpsTab/PluginsTab 模块不存在）

## 2026-06-03

### 前端渲染错误修复（Zustand 反模式 + 全局变量不一致）

**问题 1**：设置界面和仪表盘渲染报错/空白。

**根因**：
1. Zustand store 中 `getProviders()` / `getChannels()` / `getExtensionsByType()` 每次调用返回新数组（`.filter()` / `.push()`），被 Zustand selector 误判为值变更，导致持续重渲染
2. `getExtensionsByType("settings-panel")` 作为 selector 每次返回新引用 → `useMemo` 永不过期 → 设置界面菜单反复重建
3. `disabled={!pluginsLoaded}` 加在 `<Select>` (Radix Select.Root) 上，Radix UI 不接收此 prop

**修复**：
- Modify: `gui-v2/src/stores/plugins.ts` — `providers`/`channels`/`extensionPlugins` 改为 `setPlugins()` 中预计算的静态切片；新增 `settingsPanels`/`dashboardCards`/`chatActions` 三个预计算切片，消除 `getExtensionsByType()` 方法
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — `s.getExtensionsByType()` → `s.settingsPanels`（稳定引用）
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx` — 移除 `<Select>` 上的 `disabled` prop，改为加载提示文字
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx` — 同上
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx` — 同上
- Modify: `gui-v2/src/components/settings/ProvidersSection.tsx` — `Object.entries()` 内联到 `useMemo` 回调，依赖从 `configEntries` 改为 `providers`
- Modify: `gui-v2/src/components/settings/ChannelsSection.tsx` — 同上

**问题 2**：仪表盘显示"暂无数据"。

**根因**：`__cobeingRuntime` 全局变量在 namespace 合并后失效。`runtime.ts` 将运行时存为 `__cobeing.runtime`，但 `ws-server.ts` / `butler.ts` / `group-scanner.ts` / `wake-system.ts` / `group-tools.ts` 共 5 个文件读的是 `__cobeingRuntime`（无点号，旧式全局）。

**修复**：
- Modify: 5 个文件，8 处引用 — `__cobeingRuntime` → `__cobeing?.runtime`（`?.` 可选链确保测试环境不崩溃）

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 4 Agent 并行审查 + 16 项修复

**审查来源**：对"插件→前端动态发现"全部变更进行 4 维度审查（安全/正确性/代码质量/集成边界），共发现 3 CRITICAL + 8 HIGH + 5 MEDIUM。

**CRITICAL 修复（3 项）**：
- Modify: `packages/core/src/api/ws-server.ts` — C1: `require()` → `await import()`（ESM 环境下 `require` 不可用）；C2: `instanceId` 路径穿越验证（正则 + `path.resolve` 双重防护）；C3: 自定义实例展平为顶级插件条目
- Modify: `gui-v2/src/stores/plugins.ts` — C3: `getModels()` 修复 `custom:*` ID 查找逻辑（三段式回退：精确→实例→父插件）

**HIGH 修复（8 项）**：
- Modify: `packages/core/src/api/ws-server.ts` — H1: `entry.dir` 路径穿越验证；H5: `pluginRegistry.plugins` null 守卫
- Modify: `data/plugins/providers/_custom/index.js` — H2: `apiKeyEnv` 格式验证 + `baseURL` HTTPS 验证
- Create: `data/plugins/_shared/instance-loader.js` — H6: 提取共享实例加载器（消除 ~60% 重复代码）
- Modify: `gui-v2/src/components/settings/ProvidersSection.tsx` — H3: 隐藏 `_pluginManaged` 条目的编辑/删除按钮
- Modify: `gui-v2/src/components/settings/ChannelsSection.tsx` — H3/H4: 同上 + 删除时发送 `unbind_channel`
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx` — H7: 合并 config providers（与其他 2 组件一致）
- Modify: 3 个 agent 组件 — H8: 检查 `pluginsStore.loaded` 状态

**MEDIUM 修复（5 项）**：
- Modify: `gui-v2/src/components/settings/ChannelsSection.tsx` — M1: Channel 密钥字段 `type="password"`
- Modify: `packages/core/src/api/ws-server.ts` — M2: `update_config` 拒绝对 `_pluginManaged` 条目的修改
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx` — M3: 切换 provider 不再清除 model
- Modify: `packages/core/src/api/ws-server.ts` — M4: `listPlugins()` 用 `this.dataRoot` 替代 `path.resolve("data")`
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — M5: 插件面板渲染从 `.map()` 反模式改为 `.find()` IIFE

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 其他变更

- Modify: `start.bat` — 移除 3 选 1 菜单（CLI/GUI/Both），直接启动 GUI；修复 stray `)` 语法错误（-71 行）
- Modify: `CoBeing/CLAUDE.md` — 新增"Bug 修复的相似性扫描"规则：每次修 bug 时主动搜索项目中所有相同模式并一并修复

### 插件→前端动态发现架构（主任务）

**原因**：后端插件系统成熟，但前端完全硬编码。`cobeingVersion >= 1.4.0` vs 实际 `1.3.1` 导致所有插件运行时被静默禁用。

**后端变更**：
- Modify: 10 个 `package.json` + `tauri.conf.json` — 版本 1.3.1 → 1.4.0
- Modify: `packages/core/src/api/ws-server.ts` — 新增 `list_plugins` + `add/remove/update_plugin_instance` 端点；`get_state` 扩充 `plugins`；`get_config` 合并插件数据；修复 `__cobeingUIExtensions` → `__cobeing.uiExtensions`
- Create: `data/plugins/providers/_custom/` — 自定义 Provider 插件（扫描 `instances/` 注册 OpenAI-compat providers）
- Create: `data/plugins/channels/_custom/` — 自定义 Channel 插件（同上模式）

**前端变更**：
- Create: `gui-v2/src/stores/plugins.ts` — Zustand 插件能力 Store
- Modify: `gui-v2/src/lib/types.ts` — 新增 `PluginInfo` / `PluginModelInfo`；`WsStatePayload` 扩充 `plugins`
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 连接时发送 `list_plugins` + 处理 `plugins` 响应
- Modify: `gui-v2/src/components/agent/CreateAgentDialog.tsx` — 删除 `CATALOG_MODELS` 硬编码（-63 行），改用动态数据
- Modify: `gui-v2/src/components/agent/AgentConfigTab.tsx` — 删除 `CATALOG_MODELS` 硬编码（-37 行）
- Modify: `gui-v2/src/components/group/GroupMembersTab.tsx` — 删除 `CATALOG_MODELS` 硬编码（-13 行）
- Modify: `gui-v2/src/components/settings/ProvidersSection.tsx` — 合并插件 providers 展示
- Modify: `gui-v2/src/components/settings/ChannelsSection.tsx` — 合并插件 channels 展示
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 追加插件 `settings-panel` 动态菜单；`SettingsSection` 类型扩展
- Modify: `gui-v2/src/stores/settings.ts` — `SettingsSection` 类型增加 `` `plugin:${string}` ``

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files), gui-v2 tsc --noEmit pass

---

## 2026-06-02

### Frontend: pluginsStore + WsStatePayload.plugins + useWebSocket list_plugins wiring

**描述**：前端新增 Zustand pluginsStore（含过滤访问器 getProviders/getChannels/getModels/getExtensionsByType 等），WsStatePayload 扩展 plugins 摘要字段，useWebSocket 在连接时发送 list_plugins 并将结果 populate 到 pluginsStore。

**修改文件**：
- Create: `gui-v2/src/stores/plugins.ts` — 新建 Zustand store，保存 PluginInfo[] 并提供 getProviders/getChannels/getModels/getChannelTypes/getExtensions/getExtensionsByType 过滤访问器
- Modify: `gui-v2/src/lib/types.ts` — 新增 PluginModelInfo/PluginInfo 接口，WsStatePayload 新增 plugins 字段
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 导入 usePluginsStore 和 PluginInfo，连接时发送 list_plugins，新增 "plugins" message handler 调用 setPlugins

### WS Server: list_plugins + instance management + get_state/get_config expansion

**描述**：在 ws-server.ts 中新增 4 个 WS 端点（list_plugins / add_plugin_instance / remove_plugin_instance / update_plugin_instance），扩展 get_state 返回 plugins 摘要，扩展 get_config 合并插件加载的 providers 和 channels。

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts`
  - 新增 `list_plugins` case — 调用 listPlugins() 返回所有已启用插件的完整能力信息（models, tools, extensions, custom instances）
  - 新增 `add_plugin_instance` / `remove_plugin_instance` / `update_plugin_instance` 三个 case — 管理 plugin instances/ 下的自定义实例 JSON 文件，支持 model-provider 实例创建后自动 rebuildProvider
  - 新增 `listPlugins()` 私有方法 — 从 pluginRegistry + pluginTools + uiExtensions + manifest/models.json/instances/ 多源组装 PluginInfo
  - 修改 `getState()` — 新增 plugins 字段（id, kind, enabled）
  - 修改 `get_config` case — 合并 getAllProviders()/getAllChannels() 到响应（标记 _pluginManaged: true）

### 5 维度审计修复（4 Agent 并行，共 26 项发现全修复）

**审计来源**：对 Provider 插件补全 + QQBot 插件化变更进行 5 维度审计（安全/正确性/代码质量/集成API/边界遗漏），共发现 3 CRITICAL + 8 HIGH + 15 MEDIUM。

**P0 — 功能性损坏修复（3 项）**：
- Modify: `data/plugins/channels/qqbot/index.js` — 移除 `intents: 0`，让默认 intents 生效（QQBot 之前连接成功但永不接收消息）
- Modify: `data/plugins/providers/deepseek/cobeing.plugin.json` — 修复 `main` 路径 `../../` → `../../../../`
- Modify: `packages/core/src/runtime.ts` — `startChannels()` Phase 1/2 增加 `this.router.bind()`，插件 channel bindTo 之前未注册到 Router

**P1 — 代码质量 + 可靠性修复（10 项）**：
- Create: `data/plugins/providers/_factory.js` — 抽取工厂函数，6 个 provider 插件从 ~60 行缩减至 ~15 行（消除 ~300 行重复代码）
- Modify: `data/plugins/providers/{zhipu,qwen,minimax,volcengine,moonshot,mimo}/index.js` — 全部重写为工厂模式
- Modify: `data/plugins/providers/qwen/index.js` — 修复 `capabilities()` 死条件分支（if/else 返回相同对象）
- Modify: `data/plugins/providers/_factory.js` — `listModels()` 增加 `console.warn` 日志；`chat()` 改为 IIFE 单例防 TOCTOU
- Delete: `packages/plugin-sdk/src/builtins/qqbot.ts` + dist 产物 — 死代码（manifest 已指向独立 index.js）
- Modify: `packages/plugin-sdk/src/builtins/deepseek.ts` — 增加已注册检查，跳过重复注册（原生 buildProviders 已覆盖）
- Modify: `packages/core/src/runtime.ts` — 移除未用 import `ButlerRegistry` + `getProvider`
- Modify: `packages/core/src/runtime.ts` — `getPluginBindTo()` 增加 `?.pop()` 可选链防护
- Modify: `packages/core/src/runtime.ts` — Phase 1 `startedIds.add(id)` 移到 `channel.start()` 之前（防 double-start）
- Modify: `packages/core/src/runtime.ts` — `stop()` 增加 `this.router.unbind()` + `this.channels = []` 清理

**P2 — 安全/架构增强（13 项）**：
- Modify: `packages/providers/src/base/provider-interface.ts` — `registerProvider()` 增加重复注册 `console.warn`
- Modify: `packages/channels/src/base/channel-interface.ts` — `registerChannel()` 增加重复注册 `console.warn`
- Modify: `packages/plugin-sdk/src/loader.ts` — `_loadPlugin()` 快照注册表前后差异并在失败时 warn
- Modify: `config/default.json` — 移除遗留 `mcpServers.qqbot` 空凭据配置
- Modify: `packages/core/src/runtime.ts` — butler 创建推迟到 `start()` 中 `loadAllPlugins()` 之后（支持插件 Provider）
- Modify: `packages/core/src/runtime.ts` — `_setupChannelOnMessage()` 增加消息内容截断(100KB) + 发送者名截断(64字符)
- Modify: `packages/core/src/runtime.ts` — `rebuildProvider()` 支持非 deepseek 插件 Provider 热重载
- Modify: `packages/core/src/runtime.ts` — `getConfig()` 增加 `pluginConfigs` 字段暴露 registry.json 配置
- Modify: `packages/core/src/runtime.ts` — `bootstrapRegistry()` Channel 插件默认 disabled（安全）
- Modify: `packages/core/src/runtime.ts` — `loadAllPlugins()` 增加 `cobeingVersion` 版本校验
- Modify: `packages/core/src/runtime.ts` — `loadAllPlugins()` 增加孤儿 registry 条目自动清理
- Modify: `packages/core/src/runtime.ts` — 14 个 `__cobeing*` 全局变量合并为单个 `__cobeing` 命名空间
- Modify: `packages/plugin-sdk/src/loader.ts` — `discoverSync()` 标记 `@deprecated`

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

## 2026-06-01 (Batch Fix 2)

### 8 项审计修复

**修复内容**：

| # | 严重度 | 描述 | 文件 |
|---|--------|------|------|
| 1 | CRITICAL | QQBot `intents: 0` 屏蔽所有消息 — 移除 `data/plugins/channels/qqbot/index.js` 中的 `intents: 0`，让 qqbot-gateway-client.ts 默认 intents 生效。`packages/plugin-sdk/src/builtins/qqbot.ts` 文件不存在，跳过。 | `data/plugins/channels/qqbot/index.js` |
| 2 | HIGH | Provider 注册表覆盖守卫 — `registerProvider()` 检测重复 ID 并 console.warn（保留覆盖以支持热重载） | `packages/providers/src/base/provider-interface.ts` |
| 3 | HIGH | Channel 注册表覆盖守卫 — `registerChannel()` 同 Fix 2 模式 | `packages/channels/src/base/channel-interface.ts` |
| 4 | MEDIUM | Plugin register() 部分失败检测 — `_loadPlugin()` 在 register() 前后快照 provider/channel 注册表，失败时计算差异并 warn 打印 | `packages/plugin-sdk/src/loader.ts` |
| 5 | MEDIUM | 移除遗留 QQBot MCP server 配置 — `config/default.json` 删除 `mcpServers.qqbot` 空凭据条目 | `config/default.json` |
| 6 | - | registry.json 无需修改（qqbot 已正确 disabled） | - |
| 7 | MEDIUM | DeepSeek 插件 manifest `main` 路径修复：`../../packages/...` → `../../../../packages/...`（2 层→4 层） | `data/plugins/providers/deepseek/cobeing.plugin.json` |
| 8 | LOW | `discoverSync()` 标记 @deprecated（runtime 未使用，仅测试引用） | `packages/plugin-sdk/src/loader.ts` |

**验证**：`pnpm build` 7 包全部通过。

---

## 2026-06-01

### Provider 插件补全 + QQBot 插件化

**变更原因**：Provider 去硬编码后仅创建了 zhipu 插件（且 disabled），其余 5 家缺失导致无法使用。QQBot 仍为原生实现（通过 config.channels 加载），需要改为插件加载。

**Provider 补全（5 家）**：
- Create: `data/plugins/providers/qwen/{cobeing.plugin.json,models.json,index.js}` — 通义千问插件
- Create: `data/plugins/providers/minimax/{cobeing.plugin.json,models.json,index.js}` — MiniMax 插件
- Create: `data/plugins/providers/volcengine/{cobeing.plugin.json,models.json,index.js}` — 豆包插件
- Create: `data/plugins/providers/moonshot/{cobeing.plugin.json,models.json,index.js}` — Moonshot 插件
- Create: `data/plugins/providers/mimo/{cobeing.plugin.json,models.json,index.js}` — MiMo 插件
- Modify: `data/plugins/registry.json` — 新增 5 个 provider 条目（默认 disabled）+ zhipu 启用

**QQBot 插件化**：
- Create: `data/plugins/channels/qqbot/index.js` — 独立插件（从 @cobeing/channels 创建 QQBotChannel）
- Modify: `data/plugins/channels/qqbot/cobeing.plugin.json` — main 指向独立 index.js
- Modify: `data/plugins/registry.json` — 新增 qqbot channel 条目（bindTo: butler, 默认 disabled）
- Modify: `config/default.json` — 删除 channels.qqbot 原生配置
- Modify: `packages/core/src/runtime.ts`:
  - 新增 `_pluginRegistry` 字段存储已解析注册表
  - 新增 `_setupChannelOnMessage()` — 提取消息处理管线（GUI 广播 + 群组审核 + Router）
  - `startChannels()` 重构为两阶段：config.channels → plugin-registered channels
  - 插件 channel 的 bindTo 从 registry.json config 读取
  - `loadAllPlugins()` 存储 registry 到字段

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 两轮多维度审计修复（共 32 项）

**第一轮审计（5 Agent 并行）**：
- 安全审计：2 CRITICAL（无进程隔离、tool:before 全封锁）+ 4 HIGH（消息篡改、globalThis 可写、Prompt 层覆盖、getConfig 泄露密钥）
- 架构审计：3 CRITICAL（agent:destroy 未 emit、message:send 崩溃向量、stop 全局泄漏）+ 4 HIGH + 5 MEDIUM + 4 LOW
- 正确性审计：6 BUG + 2 RACE + 9 EDGE（message:send 内容损坏、prompt 无截断、import 崩溃、register 无超时等）
- API 完整性审计：1 CRITICAL（agent:destroy 未 emit）+ 3 MEDIUM + 3 LOW
- 代码质量审计：3 CRITICAL（loader 重复代码、sleep 双重 emit、stop 泄漏）+ 5 HIGH + 6 MEDIUM + 2 LOW

**第一轮修复（17 项 CRITICAL + HIGH）**：
- Modify: `agent/agent.ts` — dispose() 新增 agent:destroy emit；stop() 新增 _stopping 守卫防 sleep 双重 emit；run() finally 检查 _stopping
- Modify: `plugin-sdk/src/hook-bus.ts` — message:send 增加 result.allow===false 检查 + content 验证，防止 {allow:false} 被当作消息内容
- Modify: `runtime.ts` — stop() 新增 7 个 plugin globalThis cleanup；getConfig() 脱敏 apiKey/secret/env/headers
- Modify: `conversation/conversation-loop.ts` — 两处 message:send emit 加 try/catch；hookBus/hookBus2/hookBus3 → 统一 hookBus
- Modify: `plugin-sdk/src/loader.ts` — 提取 _loadPlugin() 消除 DRY + import 失败 skip + register() 30s timeout
- Modify: `plugin-sdk/src/prompt-layer-registry.ts` — 8000 字符截断 + provenance 标记 `## [Plugin: id]` + error logging
- Modify: `tools/executor.ts` — 空字符串 reason fallback 去重
- Modify: `data/plugins/providers/zhipu/index.js` — 懒初始化 + 缓存 provider + 从 models.json 读列表
- Delete: `runtime.ts` getProviderBaseURL() — 死代码移除

**第二轮审计（3 Agent 并行）**：
- 修复验证 Agent：✅ 10/10 修复正确，0 回归
- 代码质量 Agent：1 HIGH（dispose hook 竞态）+ 3 MEDIUM（loadOneByDir 静默失败、structuredClone、UIExtensionRegistry 死代码）
- 边界/遗漏 Agent：4 HIGH（plugin tools 永不被读取、__cobeingSkillRepo 未赋值、registerToolAgent 空操作、UIExtension 无验证）+ 5 MEDIUM + 5 LOW

**第二轮修复（15 项）**：
- Modify: `runtime.ts` — __cobeingSkillRepo 全局赋值；registerSkill 移除 optional chaining；registerToolAgent 存储到 __cobeingToolAgents Map；loadAllPlugins() 注入 plugin tools 到所有 Agent；structuredClone 替代 JSON roundtrip；registerUIExtension 增加 type/componentPath 验证；UIExtensionRegistry 实例化替代裸数组；bootstrap 重复 ID 警告
- Modify: `agent/agent.ts` — dispose() await hookBus.emit() 替代 fire-and-forget
- Modify: `plugin-sdk/src/loader.ts` — _loadPlugin catch 添加部分注册残留警告；clearTimeout 清理 dangling timer；loadOneByDir 失败时 log.warn
- Modify: `tools/executor.ts` — try/finally 确保 tool:after 在异常时也触发
- Modify: `conversation/conversation-loop.ts` — message:send 拦截响应包含具体 reason
- Modify: `api/ws-server.ts` — list_ui_extensions 使用 registry.list() 替代裸数组
- Modify: `plugin-sdk/src/hook-bus.ts` — 空字符串 content 防护 (result.content.length > 0)

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 插件系统全能力扩展 + Provider 去硬编码

**变更原因**：插件系统从 4 个注册方法扩展为全能力矩阵，原生代码仅保留 DeepSeek，其余 6 家 provider 全部移除并通过插件形式接入。

**Phase 1 — Provider 去硬编码**：
- Delete: `packages/providers/src/catalogs/{zhipu,qwen,minimax,volcengine,moonshot,mimo}.ts` — 6 个目录文件
- Delete: `packages/plugin-sdk/src/builtins/{zhipu,qwen,minimax,volcengine,moonshot,mimo}.ts` — 6 个内置插件包装器
- Delete: `data/plugins/providers/{zhipu,qwen,minimax,volcengine,moonshot,mimo}/` — 6 个清单目录
- Modify: `catalogs/index.ts` — PROVIDER_CATALOGS + PROVIDER_PRESETS 仅 deepseek
- Modify: `runtime.ts` — buildProviders() 仅 deepseek，rebuildProvider() 仅 deepseek，getProviderBaseURL() 仅 deepseek
- Create: `data/plugins/registry.json` — 插件注册表（enabled/disabled）
- Create: `data/plugins/providers/deepseek/models.json` — 模型自描述
- Create: `data/plugins/tools/` + `data/plugins/extensions/` + `.gitkeep`
- Modify: `plugin-sdk/src/loader.ts` — 新增 loadFromRegistry() + loadOneByDir() + loadModels()
- Modify: `plugin-sdk/src/types.ts` — 新增 PluginRegistryEntry/PluginRegistry/UIExtension 类型，PluginManifest 扩展 models/ui/extensions 字段
- Modify: `runtime.ts` — 新增 loadAllPlugins() 统一入口 + bootstrapRegistry()，pluginApi 扩展 _hookBus/onHook/registerPromptLayer/registerSkill/registerToolAgent/registerUIExtension/getConfig
- Modify: `config/default.json` — providers 仅 deepseek
- Modify: `plugin-sdk/src/index.ts` — 导出新类型和类

**Phase 2 — 全能力接口 + HookBus + 钩子埋点**：
- Create: `plugin-sdk/src/hook-bus.ts` — HookBus 类（notify/intercept/transform 三种语义，12 个事件）
- Create: `plugin-sdk/src/prompt-layer-registry.ts` — PromptLayerRegistry（priority 排序注入）
- Create: `plugin-sdk/src/ui-extension-registry.ts` — UIExtensionRegistry
- Modify: `plugin-sdk/src/types.ts` — CoBeingPluginApi 扩展 onHook/registerPromptLayer/registerSkill/registerToolAgent/registerUIExtension/getConfig
- Modify: `runtime.ts` — HookBus/PromptLayerRegistry/uiExtensions 实例化 + 全局暴露
- Modify: `agent/agent.ts` — emit agent:create(构造末) + agent:wake(run 首个 session) + agent:sleep(run finally + stop)
- Modify: `group/manager.ts` — emit group:create/destroy/archive
- Modify: `group/group.ts` — emit group:addMember/removeMember
- Modify: `tools/executor.ts` — emit tool:before(可拦截) + tool:after
- Modify: `conversation/prompt-builder.ts` — 插件 Prompt 层注入到 buildSystemPromptFromFiles
- Modify: `conversation/conversation-loop.ts` — emit message:receive + message:send(可修改/拦截)
- Modify: `api/ws-server.ts` — 新增 list_ui_extensions WS 命令

**Phase 3 — 示例插件**：
- Create: `data/plugins/providers/zhipu/` — 完整智谱插件（cobeing.plugin.json + models.json + index.js），默认 disabled
- Modify: `data/plugins/registry.json` — 注册 zhipu 为 disabled

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 文档全部移至工作区根目录

**变更原因**：将项目文档与代码分离。所有 .md 文档（GOAL/README/STRUCTURE/PROGRESS-*）及 docs/ 目录从 CoBeing/ 移至工作区根目录 D:\agent-codes\，仅 CLAUDE.md 保留在项目内。

**修改文件**：
- Move: `CoBeing/GOAL.md`, `CoBeing/README.md`, `CoBeing/STRUCTURE.md`, `CoBeing/PROGRESS.md`, `CoBeing/PROGRESS-LITE.md`, `CoBeing/PROGRESS-VERSION.md` → `D:\agent-codes\`
- Move: `CoBeing/docs/` → `D:\agent-codes\docs\`（合并）
- Modify: `D:\agent-codes\CLAUDE.md` — 更新目录结构树 + 所有文档路径引用
- Modify: `CoBeing/CLAUDE.md` — 更新文档目录结构章节 + 模板/skills 路径
- Delete: `CoBeing/file`, `CoBeing/PLAN-STATUS.md`, `CoBeing/_update_structure.cjs`, root `file`/`packages` 共 5 个孤儿文件

### 模板迁移至 packages/core/src/templates/

**变更原因**：模板文件属于核心运行时逻辑，不应放在 config/ 中。移入 packages/core/src/templates/，分为 agent/（9 个）和 group/（8 个）子目录，消除 core 包对 config/ 目录的路径耦合。

**修改文件**：
- Move: `config/templates/*.md` → `packages/core/src/templates/agent/`（9 个 Agent 模板）
- Move: `config/templates/groups/*.md` → `packages/core/src/templates/group/`（8 个群组模板）
- Modify: `packages/core/src/group/workspace.ts` — GROUPS_TEMPLATES_DIR 路径更新
- Modify: `packages/core/src/agent/butler.ts` — templatesDir 路径更新
- Modify: `packages/core/src/api/ws-server.ts` — templatesDir 路径更新
- Delete: `config/templates/` 目录

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 数据目录重构：data/ 7 分类结构

**变更原因**：统一 data/ 下所有持久化数据，建立 agents / groups / coreagents / tools / toolagents / skills / plugins 7 个分类目录。管家和群主从 data/agents/ 移至 data/coreagents/，全局 skills/ 和 plugins/ 从根目录移入 data/。

**新结构**：
- `data/coreagents/` — 管家和群主（AgentPaths.forAgent 自动路由）
- `data/agents/` — 通用智能体（不变）
- `data/groups/` — 群组（不变）
- `data/tools/` — 工具数据（预创建）
- `data/toolagents/` — 工具智能体数据（预创建）
- `data/skills/` — 全局技能仓库（从根目录移入）
- `data/plugins/` — 插件清单（从根目录移入）

**修改文件**：
- Modify: `packages/core/src/agent/paths.ts` — forAgent() 按 agentId 路由 butler/host → coreagents/
- Modify: `packages/core/src/agent/butler-registry.ts` — dataRoot/butler → dataRoot/coreagents/butler
- Modify: `packages/core/src/vote/store.ts` — dataRoot/host → dataRoot/coreagents/host
- Modify: `packages/core/src/runtime.ts` — 新增 ensureDataDirs() 7 目录初始化；skills/plugins/prompts 路径更新
- Modify: `packages/core/src/todo/scanner.ts` — 扫描 agents/ + coreagents/ 双目录
- Modify: `packages/core/src/config/config-loader.ts` — skillsDir/promptsDir 默认值
- Modify: `packages/shared/src/fs-utils.ts` — cleanupPendingDeletions 增加 coreagents
- Modify: `packages/shared/src/master-registry.ts` — orphan 清理 + 系统 agent 路径更新
- Modify: `config/default.json` — skillsDir/promptsDir 指向 data/ 子目录
- Move: `skills/`, `plugins/`, `prompts/` → `data/skills/`, `data/plugins/`, `data/prompts/`

**验证**：pnpm build 7pkgs pass, pnpm test 417 pass (43 files)

### 清理 SubAgentSpawner + 新增 AgentCreator ToolAgent

**变更原因**：SubAgentSpawner 的 `spawn()` 方法无人调用（死代码），`spawnForJSON()` 走 `new Agent() + ConversationLoop` 重型路径只为生成 JSON 输出，严重过度设计。且"子智能体"概念已被 ToolAgent 体系（CloneAgent）覆盖。新建轻量 `creator.ts` ToolAgent，直接 `provider.chat()` 调用，被管家/前端创建 Agent 时使用。

**修改文件**：
- Create: `packages/core/src/agent/tool-agent/creator.ts` — AgentCreator ToolAgent，直接 LLM 调用生成 SOUL/CHARACTER/JOB/BOOTSTRAP 内容
- Delete: `packages/core/src/agent/spawner.ts` — 整个文件删除
- Modify: `packages/core/src/agent/butler.ts` — `butler-create-agent` 中 SubAgentSpawner → runAgentCreator
- Modify: `packages/core/src/api/ws-server.ts` — `create_agent` 中 SubAgentSpawner → runAgentCreator
- Modify: `packages/core/src/agent/agent.ts` — 移除 `_spawner` 字段 / `get spawner()` 访问器 / SubAgentSpawner import
- Modify: `packages/core/src/index.ts` — 移除 SubAgentSpawner 导出，新增 runAgentCreator 导出

**验证**：pnpm build 7pkgs pass

### 文档系统全面审计与同步

**变更原因**：全项目文档审计发现大量文档落后于代码实际状态——过时的 Provider/Channel 列表、错误的测试计数、缺失的组件/模块、已删除文件的残留引用等。

**修改文件**：
- Delete: `PACKAGE-GUIDE.md` — v1.1 打包指南，完全过时（引用已删除的 prompts/cobeing/sandbox 目录、旧 registry 格式、旧 Channel 列表）
- Modify: `STRUCTURE.md` — 修正 providers/ 节（移除已删除的 anthropic/gemini/grok/siliconflow/openai，新增 custom/ + mimo）；修正 channels/ 节（仅保留 qq/ 子目录）；扩展 plugin-sdk/ 节（新增 loader/loader.test/builtins 8 文件）；移除 group/review-pipeline.ts（已迁移到 tool-agent/review.ts）；修正 shared/ 节（新增 master-registry/constants/review）；权限 4 级→5 级；测试 288→417（37→43 文件）；代码规模更新
- Modify: `README.md` — Provider 10+→7 家（移除 Anthropic/OpenAI/Gemini/Grok/SiliconFlow，新增 MiMo）；Channel 4→1（仅 QQ Bot）；项目结构新增 plugin-sdk + mcp-servers；移除 CLI 模式；.env 示例更新
- Modify: `GOAL.md` — Provider 11→7 家；权限 4→5 级；Channel 4→1；"尚未实现"节更新（移除已完成的 ToolAgent/前端增强/TODO 功能）
- Modify: `docs/项目信息/后端能力清单.md` — 包数 5→6；测试 402→417（36→43 文件）；Provider 9→7 家；Channel 精简；权限 5 级新描述；启动流程更新
- Modify: `docs/项目信息/测试清单.md` — catalogs 测试名更新（移除 Anthropic/OpenAI/Gemini）
- Modify: `docs/项目信息/用户功能清单.md` — Provider 11→7 家；Channel 4→1；主题 Tokyo Night→6 套主题系统；新增仪表盘/搜索/导出功能
- Modify: `docs/项目信息/用户指南.md` — Provider 表 11→7 家；Channel 表精简；主题描述更新
- Modify: `docs/项目信息/前端设计清单.md` — 组件数 40→70；新增 observability/todo/tutorial/sandbox 组件节；stores 表 8→13；主题 Tokyo Night→CSS 变量令牌系统
- Modify: `docs/项目信息/启动命令.md` — 移除 start-gui.bat；移除 CLI 模式；测试 147→417
- Modify: `docs/项目信息/待办.md` — 测试 282→417；Provider 11→7 家；Channel 列表更新

