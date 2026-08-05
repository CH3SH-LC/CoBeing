# CoBeing 开发进度（精简版）

> 标签：[New Feature] 新功能 / [Debug] 修复 / [Change] 变更
> 详细记录见 PROGRESS.md

- [Change] 人味分级与对话式产品化专项（574 tests 全绿 + 构建通过）：①**真人模拟调研**（docs/调研/真人说话模拟调研.md——口语特征/anti-AI-slop/多 Agent 框架对比/26 条表达规范草案，结论"人味=说话方式而非身份"）；②**CHARACTER 重构**：执行型 Agent 抛弃角色——模板 CHARACTER.md→EXPRESSION.md（人味表达规范），prompt-builder 优先 EXPRESSION/旧数据兼容（butler 保留人格），Creator 改生成表达规范，host 同走表达规范；③**用户唤醒机制**：群组 agent 平时消息不通知不计未读（低打扰），仅 @用户（@用户/@主人/@老板/@user）时唤醒+通知，后端 parseMentions 支持 2 字符别名；④**多轮交互闭环**：管家 JOB.md 重写为「澄清→推进→确认点→继续」（确认点必须停下等用户，任务置 waiting_user），群组提示词新增 @用户 唤醒机制（路线 A 经管家收束 / 路线 B 用户进群组回复），HOST_JOB.md 同步；⑤**对话式首启**：删除问卷弹窗，教程后管家对话式收集用户信息+对管家的喜好，新增 butler-list-personas/set-persona/update-style 三工具（persona-utils 与 WS 共用，dry-run 修复），JOB.md 首启对话范式
- [Change] 清理遗留测试群组「塔防游戏开发组」（真实验证时发现仍在低频自触发）：TODO 全部完成后 scanner 已自然停止；归档处理——产物 plants-vs-zombies.html（27KB）保留到 data/archives/、全量数据打包 data/archives/塔防游戏开发组.zip、registry 标记 archived 后删除原目录；重启验证：群组不恢复（0 groups）、观察窗口 0 次唤醒/扫描事件；顺带清理 destroy 残留的 .deleted 目录（曾阻塞 pre-startup cleanup 导致 core 启动中断）
- [Debug] PVZ 真实测试复盘修复（6 轮迭代后**全部通过**）：①群组 TODO 0time 无限重建（318 条重复刷屏）→ 已触发即保持 pending + 10 分钟低频重触发；②ConversationLoop 无工具调用即结束 → 群组工作推回（承诺/空响应/思考轮强制继续，上限 2 次/run，run 重置）；③bash 沙箱基础设施故障 → 本地降级；④WS pong 超时 20s 误杀静默客户端（心跳 30s）→ 仅 ping 后武装；⑤group-memory-search/TODO store 群组级失效 → ToolContext groupId 注入 + 全局解析；⑥工作目录提示词（相对路径、禁绝对路径，path escapes 归零）；⑦上下文瘦身（wake 窗口 60/工具结果 8K 截断）；⑧**最终根因：provider max_tokens=4096 截断大参数 write-file 调用 → 模型无限"思考"**，修复为 8192 + 分块写入指导 + length 截断输出部分调用。全量 535 测试全绿；第 7 轮测试 exit 0：产出 plants-vs-zombies.html（9.2KB 完整可运行：阳光/3 植物/2 僵尸/波次/胜负/Canvas），回执 6 次、管家 40 工具事件
- [Change] 整理 v1.3.1 之后全部更新为 v1.4.0 发布记录补入 PROGRESS-VERSION.md（按 10 里程碑：插件系统/扩展重设计/重构/TODOboard/管家能力/GUI A 方案/稳定性大修/重构/Market/管家产品化/GUI 清理+真实测试）
- [New Feature] 专项三合一：①数据清除（删用户 Agent/群组/观测/管家记忆，保留系统核心）；②GUI 全局美观化（4 审计代理 + 3 修复代理全量整改 ~60 组件：面板/任务/浮层/独立页/chat，字号≥14px、留白≥20px、层次化、空态图标化、tab/按钮/列表行统一；**修复浏览器模式启动崩溃 P0**：useTray 直调 Tauri API 无守卫导致白屏，新增 isTauri() 守卫 + tray emit 守卫；**修复技能/@提及弹窗被 overflow-hidden 裁剪 P0**；样式契约测试 16→66 文件）；③真实测试（新增 scripts/real-test-pvz.ts，WS 驱动与管家对话制作植物大战僵尸 demo，4 轮验证发现并修复 5 个真实 bug：group-send reviewerCfg undefined 崩溃、沙箱构建路径硬编码、镜像依赖链缺失、dockerCmd 30s 超时、Dockerfile.base useradd UID 冲突；修复后管家环节全绿 + 群组协作真实产出视觉设计方案.md/visual_draw.js + 审核管道 + wake 143 次调度；残余环境阻塞：Docker Hub 网络不稳定 + LLM 偶发中断，demo HTML 15 分钟窗口内未完成）
- [Debug] 修复 start.bat 端口清理失效：kill-cobeing-port.ps1 弃用 Start-Job+netstat（本机 15s 超时跳过导致旧进程残留、新 core EADDRINUSE、WS 就绪误判连旧进程），改用 Get-NetTCPConnection 同步查询 + 验证 + exit 码；start.bat 改为 `start /D "%ROOT%" cmd /k "call pnpm dev"` 消除嵌套引号 + kill 失败显式 WARN。实测：杀残留进程瞬间生效，端到端重跑 GUI 与 core 建立 ESTABLISHED 连接
- [New Feature] GUI 未接入能力清理：孤儿组件接入主视图（AgentDetailPanel 时间线 tab / GroupDetailPanel 健康 tab / SettingsView 唤醒队列 / Dashboard 活跃度柱状图）；技能执行真实链路（SkillsTab 任务输入→execute_skill→结果展示，修复无 onClick 按钮）；沙箱监控真实指标（后端 docker stats 采集 + 前端不可用时不展示假数据）；通知音效真实化（lib/notify.ts Web Audio 提示音 + 系统通知 + 非当前会话才触发）；回执卡片状态流转（updateTaskReceipt 刷新已渲染卡片）+ 群组派发回执展示；设置菜单分组标题美化（63 files / 568 tests 全绿 + 全量构建通过）
- [New Feature] 管家入口产品化四阶段全部实施：阶段A 转接真实化（butler_task_updated 结构化广播 + 前端 handler/回执卡片首次点亮 + 派发菜单结构化 + dispatch_task 支持群组）；阶段B 首次问卷（OnboardingOverlay 兴趣问卷 → Creator 生成初始 Agent + Market 官方推荐 + 欢迎消息）；阶段C 管家模板+风格（ensureButlerDir 文件体系 + 固定 prompt→文件 prompt + 4 人格模板 + butler_set_persona/update_style + GUI 管家形象区）；阶段D 低打扰纪律入 JOB.md（63 files / 565 tests 全绿 + 管家冒烟 19/19 + Market 回归 25/25）
- [Change] 管家入口产品化研究完成：盘点确认转接断链（butler_task_updated 前端零消费/回执卡片永不渲染/butlerTasks 死代码）、管家无配置载体（固定 prompt/无模板）、零引导零问卷；产出 docs/superpowers/specs/2026-08-04-butler-entry-productization-research.md（阶段 A 转接真实化优先）
- [Change] 记录 GUI 未接入能力清理问题复查确认（技能执行按钮/WakeQueue/GroupHealth/AgentTimeline/沙箱指标/通知音效仍待接入或删除）；启动管家入口产品化专项研究
- [New Feature] Market 分级机制落地：packages/core/src/market/（types/catalog/installer/tools/bundled 4 内置资源/25 测试）+ 5 个 WS 命令 + Butler 推荐/安装工具 + GUI Market Tab（分层过滤/依赖树/社区确认流）；根 vitest 配置纳入 gui-v2 测试（61 files / 546 tests 全绿 + 冒烟 25/25）
- [Change] 重构前端 ChatView.tsx（646→68 行）提取 7 子组件 + useWebSocket.ts（759→104 行）71 种消息 handler 拆分到 ws-handlers/；修复 3 预存类型错误（gui-v2 build + 19 tests 全绿）
- [Debug] 修复 8 个僵尸全局变量（__cobeingHookBus 等）从未写入导致插件 hook/PromptLayer/投票静默失效：runtime 构造函数补齐兼容别名 + 新增 5 聚焦测试（502 tests 全绿）
- [Change] 重构 ws-server.ts（3111→571 行）：68 个 WS 命令 handler 按域拆分到 api/handlers/ 11 个模块 + security/types/capability/parsing 叶子模块，巨型 switch 改为命令注册表分发（行为不变，497 tests 全绿）
- [Change] 重构 butler.ts：24 个 Butler 工具工厂函数 + 2 辅助函数按域拆分到 agent/butler/tools/ 下 8 个模块，ButlerAgent 类不动（行为不变，497 测试全绿）
- [Change] 重构 runtime.ts：start()/stop() 拆分为职责清晰的私有辅助方法，收敛 wsServer 8 个 setter 到 configureWSServer()，ensureSandboxConfig 移至 runtime/sandbox-helper.ts（行为不变，497 测试全绿）
- [Debug] 修复管家页面发送消息时整体上浮：scrollIntoView 改为容器 scrollTo 防止向上传播到父级 overflow:hidden 容器；handleSend 前 blur 聚焦元素避免 WebView2 再滚动

---

## 2026-07-09

- [Debug] 强制禁止群主自己执行工作：运行时移除 8 个执行工具 + 修复 config.json + 强化 systemPrompt/HOST_JOB.md
- [Debug] 修复 @mention 上拉框显示在输入框后面：拆分为外层 relative + 内层 overflow-hidden，弹窗移至外层不受裁剪 + z-index z-10→z-50
- [Debug] 修复 user/TODOboard 消息泄漏到前端：ws-server setOnMessageBroadcast 过滤 user/TODOboard/system 消息；前端 group_message 处理器增加防御性过滤
- [Debug] 修复管家界面输入框导致页面上浮错位：textarea 移除 flex-1，添加显式 rows/minHeight/maxHeight
- [Debug] 修复 GroupChatView 输入框同类问题（flex-1 textarea 布局重算）
- [Debug] 修复长任务后"正在回答"卡死：agent_completed/agent_error 增加安全网 finalizeStream，WS 断连后仍可清除等待状态
- [Debug] 修复长任务中工具调用前文本丢失：startWaiting 用 finalizeStream 保存未完成流式内容（替代 finishWaiting 直接丢弃）
- [Debug] finalizeStream 增加去重守卫，防止 agent_response 延迟到达时产生重复消息
- [Debug] 修复 capturedTools 可能为 undefined 的 TypeScript 错误
- [Debug] 第二轮修复：真正根因 — AppLayout h-screen→h-full 消除 Tauri WebView2 视口计算偏差；html/body 加 overscroll-behavior:none
- [Debug] 第二轮修复：agent_response 从 sendToClient 改为 broadcast，确保 WS 重连后不丢失最终响应文本
- [Debug] 第二轮修复：loadFromCurrent 增强合并 — waiting 活跃时保留内存消息 + 自动清除已完成会话的 waiting
- [Debug] 第二轮修复：startWaiting 安全超时从 300s 降至 60s（loadFromCurrent 已能兜底）
- [Build] pnpm build（backend + frontend）全部通过
- [Build] pnpm build 通过

## 2026-07-08

- [Debug] 修复管家长工作/说到一半回复丢失：startWaiting 重置前先 finalizeStream 保存未完成流式内容；ChatInput/GroupChatInput 等待中禁用发送按钮
- [Debug] 修复用户消息重复显示为智能体气泡：addMessage 增加同内容+同方向+2s 内去重
- [Debug] 修复聊天窗口上滚后自动回滚：MessageList 增加 userScrolledUp 检测，手动上滚时不自动滚动
- [Debug] 杜绝群主自己执行工作：移除 host 执行工具，强化 systemPrompt + JOB.md 禁止执行
- [Debug] 修复 group-send 依旧报错：ensureGroupMember 允许 butler/host 绕过成员检查
- [Debug] pnpm build + pnpm test（54 files, 497 tests）全部通过

- [Debug] 修复 group-send 工具不可用：ButlerAgent 构造函数直接注册 makeGroupSendTool
- [Debug] 修复全局任务显示过多细节：GlobalTodoPanel 简化为仅显示标题+状态+指派
- [Debug] 修复群组创建系统消息外显：group_message handler 过滤 fromAgentId === "system"
- [Debug] 修复 TODOboard 触发在对话中外显：移除 runtime.ts logMessage，agent_started 过滤 source "TODOboard"
- [New Feature] 对话未读消息徽章：Sidebar 的 AgentList/GroupList 读取 unreadCounts 渲染数字徽章
- [Debug] 第一批 5 项修复（见上）+ 第二批 5 项修复，pnpm build + test（54 files, 497 tests）全部通过

- [Debug] 修复智能体回复完毕不能正确停止/记录：finalizeStream 等待状态清除逻辑修正，agent_completed 增加 finishWaiting 安全网
- [Debug] 修复智能体工具调用次数显示不准：addToolEvent 按 toolName 去重 start 事件，ToolCallsGroup 增加 useMemo 去重显示
- [Debug] 修复新对话清除所有页面对话：startNewConversation 改为仅清空当前对话，后端 clear_chat_current 支持指定 conversationId
- [Debug] 修复侧栏图标点击不切换主视图：MainContent 引入 getVisibleUserAgents 过滤 butler/host 核心 Agent
- [Debug] 修复群组模型配置 Dialog 被 Sheet 遮挡：dialog.tsx z-index z-50→z-[60]；模型配置文字改为 button 元素
- [Debug] pnpm build + pnpm test（54 files, 497 tests）全部通过

## 2026-06-12

- [Debug] 修复管家全局任务显示 literal `\u...` 的问题：全局任务和侧栏文案改为字符串表达式渲染，新增核心界面 JSX 转义审计；主题加载改为 `cache: "no-store"` 并保证内置主题 ID 不被本地旧自定义主题覆盖。3 个前端测试文件 10 测试、`tsc --noEmit`、`vite build`、`pnpm build` 通过。
- [Change] 增强默认樱花薄荷主题层次：背景从纯白改为浅樱粉/薄荷渐变，面板保持奶白半透明，用户/智能体气泡改为更明显的樱花糖粉和薄荷糖绿，并补充主题层次回归测试。

## 2026-06-11

- [Change] GUI A 方案前端优化：新增个人资料设置（昵称/首字/Emoji/图片头像）、共享聊天头像与消息气泡框架；真实单聊/群聊显示用户右侧头像和智能体左侧头像，用户气泡显示个人昵称；主题导入校验补齐 `chat.*` 气泡 token，默认樱花薄荷保留，新增 B 方案 `executive-workbench` 工作台主题；能力/任务/成长页视觉升级。`tsc`、2 个前端测试文件 12 测试、`vite build` 通过，本地主题资源 HTTP 校验通过。
- [Debug] 修复 GUI 管家页导航渲染错误：`Sidebar` 不再在管家视图提前 return 后跳过后续 hooks，管家/智能体/群组/设置切换时 hook 顺序保持稳定；gui-v2 build 与全量 `pnpm test` 通过。
- [Debug] 恢复真实 `better-sqlite3` 原生路径：`@cobeing/core` 升级到 `better-sqlite3@12.10.0` 并在 Node 24.13.0 下生成 `better_sqlite3.node`；最小 SQLite 打开验证通过，Memory/Group 相关 62 测试通过，`pnpm test` 54 文件 497 测试通过，`pnpm build` 通过。
- [Debug] 修复 `better-sqlite3` 原生 binding 缺失导致 Runtime 启动崩溃：ObservabilityDB 改为文件型 fallback，Memory/Group SQLite 入口补齐降级；同时优化 Windows bash 执行与 Group 删除 busy-wait。`pnpm test` 54 文件 497 测试通过，`pnpm build` 通过。

## 2026-06-10

- [New Feature] 非 Market 审查 P0/P1 后端闭环：Runtime 挂载 ButlerTaskStore/GroupButlerBindingStore，Butler tracked dispatch 写 Global TODO + ButlerTask + Agent inbox/Group TODO，Agent task 状态同步全局账本，新 Agent 默认 capability.json，WS find_agent/dispatch_task 由占位改为真实操作；49 个聚焦测试与 pnpm build 通过；当时 GroupManager suite 仍受 better-sqlite3 原生 binding 缺失阻塞，已于 2026-06-11 修复。
- [New Feature] ToolAgent 标准化补齐：新增 ToolAgentSpec loader，creator 纳入 ToolAgent 类型并支持 Group 草案生成，Memory ToolAgent 返回 MEMORY.md 修改建议，create_group 接入 Creator 草案；相关 22 测试与 pnpm build 通过。
- [New Feature] 通用智能体能力与增强全 5 层实现：能力画像 (CapabilityCard/capability.json) + 任务收件箱 (TaskInbox/inbox.json) + 成长建议 (GrowthProposal/proposals/) + 资源请求 + GrowthReviewer/TaskArchive/CapabilityUpdater ToolAgent + Butler 能力派发 + 前端 3 Tab
- [New Feature] 管家入口 Round 2 聊天增强：TaskReceiptCard 可折叠任务回执卡片 + ChatInputActions 派发/创建/摘要快捷按钮（lucide 图标），ChatView 接入卡片和按钮，设置图标 ⚙→Settings
- [Change] LogMessage.metadata 类型化：Record<string, unknown> → { taskReceipt?, reviewOverridden?, cards? }，新增 TaskReceipt 接口

## 2026-06-09

- [New Feature] TODOboard 三层架构：GlobalTodoItem 扩展 + GlobalTodoStore 重写（23 tests），Butler 5 编排工具，完成回传链路，自动续作核心，前端 Butler 侧栏 GlobalTodoPanel + Agent 对话区 TODO 横幅。51 文件 484 测试通过。
- [Debug] 审计修复：GROUP_MECHANICS_NOTICE 同步 — group-send 通信方式行更新为非阻塞旁路描述，补充"不要只在最终回复写 @mention"
- [New Feature] 管家入口 Round 1 数据层：共享类型 butler-bridge.ts（5 interface + 3 常量），3 个后端 JSON Store（GlobalTodoStore/ButlerTaskStore/GroupButlerBindingStore），前端 coreAgents.ts 过滤 helper + butlerTasks Zustand store
- [Change] 前端核心 Agent 过滤：Sidebar/AgentDetailPanel/GroupMembersTab/CreateGroupDialog 使用 getVisibleUserAgents 和 isCoreAgent 过滤 butler/host，仅 UI 层过滤不删 store 数据
- [Change] 群组纯 prompt 驱动协作升级：新建 HOST_JOB.md（9 项群主职责模板）、重写 GUIDE.md（审批点+资源链+禁止行为）、重写 Agent 6 步判断框架、重写 group-send 为非阻塞旁路消息、弱化工作区初始化为 2 文件。477 测试通过。

## 2026-06-08

- [Debug] 修复核心 TODO / 群组唤醒闭环：TODO WS 事件携带 scope 上下文，防止 condition/0time 重复触发，并让群组 TODO 完成统一走 scanner 以保留依赖通知和 onComplete 链路。
- [Change] 新增核心技术说明文档：补充三层智能体、TODOboard 技术设想和群组驱动多智能体协作技术，并同步 STRUCTURE/CLAUDE 文档索引；本次未改源码，未运行 build/test。

## 2026-06-07

- [Change] 文档体系清理与事实重建：删除旧版能力清单式冗余文档，新增项目现状/架构说明/使用说明/当前待办，重写 README/GOAL/STRUCTURE 并同步 CLAUDE 规则；本次未改源码，未运行 build/test。

## 2026-06-05

- [Change] Agent 核心文件重构三方审计：源码过时引用 1 处（已修复）、前端+技能+数据零残留、15 项一致性检查全通过。403 测试通过。

## 2026-06-04

- [Change] Agent 核心文件系统重构：删除 BOOTSTRAP/SOUL/USER/TOOLS (4文件)，重写 CHARACTER/JOB/MEMORY/EXPERIENCE/AGENTS (5文件)，明确 CHARACTER(人物形象+语言风格)与 JOB(工作范式+方法论)职责分离。35+ 文件变更，403 测试通过，build+tsc 零错误。
- [Change] Task 11: 从 constants.ts 和 config/default.json 的 memory.charLimits 中删除 user/tools 条目
- [Change] Task 7: 重写 experience-reflect.ts — 签名从 3 参数简化为 1 参数，删除 soul/tools 参数和 SOUL.md/TOOLS.md 写入能力，仅保留 EXPERIENCE.md 经验记录

## 2026-06-03

### 前端扩展系统重设计 + 审计修复 + 数据清理

- [Change] 前端扩展系统重设计：新增扩展页面(技能/MCPs/插件三Tab)、侧栏重排(管家→智能体→群组→仪表盘→扩展→设置)、仪表盘居中卡片、设置页精简、关于页动态版本号
- [New Feature] 扩展页面：ExtensionsView Tab容器 + SkillsTab(迁移原SkillCenter+开关) + McpsTab(迁移原McpSection+列表窗口) + PluginsTab(平铺列表+configSchema驱动配置+功能开关)
- [New Feature] 后端新增 toggle_plugin/update_plugin_config WS端点，list_plugins扩充configSchema，get_config新增version字段
- [Debug] 版本号修复：AboutSection从硬编码0.1.0改为动态读取package.json
- [Change] 仪表盘：全部卡片统一居中设计，合并用量监控卡片，删除工具排行
- [Change] 设置页：删除用量监控/MCP服务器菜单项(移至扩展页/仪表盘)
- [Debug] 4维度审计20项(4CRITICAL+8HIGH+8MEDIUM)全部修复：PluginDetail/McpDetail缺key、deleteServer undefined→null、handleSave全量展开、过期闭包3处、ToggleSwitch三重重复
- [Debug] P1审计修复8项：SearchInput提取共享组件、useMemo/useCallback优化、硬编码色值→CSS变量、PluginInfo类型统一、pluginId输入校验、registry原子写入、运行时内存同步、dataRoot路径统一
- [Change] ToolAgent配置外置：4个ToolAgent(review/judgment/clone/memory)的config.json+prompt.md从源码移至data/toolagents/，base.ts新增loadToolAgentData()
- [Debug] 测试残留修复：three-layer-memory.test.ts的TEST_DIR从data/test-three-layer改为os.tmpdir()
- [Change] data/目录清理：删除test-three-layer/_to_delete/agents旧副本/skills/examples/已删除群组
- [Change] ToggleSwitch提取为shared/ToggleSwitch.tsx共享组件，SearchInput提取为shared/SearchInput.tsx
- [Change] 侧栏重排NavBar+MainContent：删除skills view，新增extensions view

### 待解决：经验提取系统冗余

- ⚠️ experience-reflect工具(旧) vs Memory ToolAgent(新) — 两个系统做经验提取，后者已覆盖核心功能但缺少SOUL.md/TOOLS.md写入能力。data/prompts/experience-reflect.md是旧系统残留，加载路径仍有CWD依赖。需合并后删除旧系统+data/prompts/目录。

---

- [Change] 提取 ToggleSwitch 为共享组件：从 SkillsTab/McpsTab/PluginsTab 三份重复中抽离至 components/shared/ToggleSwitch.tsx
- [Debug] 修复 McpsTab 三个 bug：缺少 key prop / value:undefined 被 JSON.stringify 剥离 / handleSave 泄露元数据字段
- [Change] 前端扩展系统重设计：新增扩展页面(技能/MCPs/插件)、仪表盘居中卡片、设置页精简、关于页美化
- [Change] 侧栏重排：管家→智能体→群组→仪表盘→扩展→设置
- [New Feature] 插件 Tab：可视化配置(启用/功能开关/自定义参数)
- [Debug] 版本号修复：从硬编码 0.1.0 改为动态读取 package.json
- [New Feature] 后端新增 toggle_plugin/update_plugin_config WS 端点
- [Change] Task 11: 清理旧文件(SkillCenter/skills/McpSection/UsageMonitor/usage) + 最终验证(全量构建+417测试+tsc零错误)
- [New Feature] Task 7: 创建 PluginsTab 插件管理页组件（搜索/开关/详情/配置表单/乐观更新）


- [Debug] 修复前端渲染错误：Zustand store 方法每次返回新数组导致持续重渲染 → 改为预计算静态切片（providers/channels/settingsPanels/dashboardCards/chatActions）
- [Debug] 修复仪表盘"暂无数据"：__cobeingRuntime 全局变量在 namespace 合并后失效 → 5 文件 8 处改为 __cobeing?.runtime
- [Debug] 修复 Radix UI Select.Root 不接收 disabled prop → 3 组件移除 disabled，改为加载提示
- [Debug] 修复 Object.entries() 作为 useMemo 依赖导致 memo 永不过期 → 内联到 useMemo 回调
- [Debug] 4 维度审查 16 项修复：3 CRITICAL（require→import/路径穿越/实例展平）+ 8 HIGH + 5 MEDIUM
- [New Feature] 创建 _shared/instance-loader.js 共享实例加载器（_custom 插件 60% 代码缩减）
- [Change] start.bat 精简：移除 CLI/Both 模式，直接启动 GUI（-71 行）；修复 stray ) 语法错误
- [Change] CLAUDE.md 新增"Bug 修复的相似性扫描"规则

### 插件→前端动态发现架构（06-02 ~ 06-03）

- [Change] 版本统一至 1.4.0：10 个 package.json + tauri.conf.json 版本号同步，插件 cobeingVersion >=1.4.0 校验通过
- [Debug] 修复 list_ui_extensions 全局变量不匹配：__cobeingUIExtensions → __cobeing.uiExtensions
- [New Feature] 前端新增 pluginsStore + WsStatePayload.plugins + useWebSocket list_plugins 对接，支持前端获取插件能力数据
- [New Feature] ws-server 新增 4 WS 端点：list_plugins / add_plugin_instance / remove_plugin_instance / update_plugin_instance，支持插件能力查询和自定义实例管理
- [Change] get_state 新增 plugins 字段（id, kind, enabled）；get_config 合并插件 providers/channels 到响应
- [New Feature] 创建 _custom Provider 和 _custom Channel 内置插件：扫描 instances/ 目录注册用户自定义 provider/channel
- [Change] 删除前端 3 处重复 CATALOG_MODELS 硬编码（CreateAgentDialog/AgentConfigTab/GroupMembersTab），改用 pluginsStore 动态数据
- [Change] ProvidersSection/ChannelsSection 合并插件数据展示；SettingsView 追加插件 settings-panel 动态菜单；SettingsSection 类型扩展
- [Debug] P0 修复 3 项：QQBot intents:0 → 移除、DeepSeek manifest 路径修复、插件 channel bindTo 注册到 Router
- [Debug] P1 修复 10 项：Provider 工厂函数消除 ~300 行重复、qwen capabilities 死分支修复、listModels 日志、IIFE 单例、删除 dead builtins/qqbot.ts、deepseek 双重注册守卫、未用 import 清理、getPluginBindTo Crash 防护、Phase1 double-start 修复、stop() router 清理
- [Change] P2 增强 13 项：Provider/Channel 注册表覆写告警、loader 部分失败检测、移除 legacy MCP qqbot 配置、butler 延迟创建支持插件 Provider、消息内容截断 100KB、rebuildProvider 通用化、getConfig 暴露 pluginConfigs、bootstrap Channel 默认 disabled、cobeingVersion 校验、孤儿 registry 清理、globalThis 合并为 __cobeing 命名空间、discoverSync @deprecated
- [Change] Provider 插件补全：创建 qwen/minimax/volcengine/moonshot/mimo 5 家缺失的插件（各含 manifest + models.json + index.js），注册到 registry.json（默认 disabled）；zhipu 启用
- [Change] QQBot 插件化：创建独立插件 index.js，移除 config.channels 原生配置，startChannels() 重构为 config + plugin 两阶段启动，插件 channel bindTo 从 registry.json 读取
- [Debug] 第一轮审计修复 17 项：agent:destroy emit + sleep 双重 emit 防 + message:send 损坏修复 + stop() 全局泄漏清理 + getConfig 脱敏 + loader DRY/timeout/try-catch + prompt 截断/provenance + zhipu 示例修复 + 死代码删除
- [Debug] 第二轮审计修复 15 项：plugin tools 注入 Agent + SkillRepo 赋值 + toolAgent 存储 + dispose await + tool:after 异常触发 + message:send 原因透传 + UIExtensionRegistry 启用 + structuredClone + 空消息防护 + timer 清理 + 注册验证

- [Change] 插件系统全能力扩展 + Provider 去硬编码：原生仅保留 DeepSeek，其余 6 家→插件；HookBus(12事件+3语义) + PromptLayerRegistry + UIExtensionRegistry；Agent/Group/Tool/Message 全生命周期钩子埋点；plugin-sdk types/loader 大幅扩展；registry.json 驱动插件加载；models.json 自描述模型；智谱示例插件
- [Change] buildProviders/rebuildProvider/getProviderBaseURL 仅 deepseek；config/default.json providers 仅 deepseek；catalogs 删 6 文件；builtins 删 6 文件；plugin dirs 删 6 目录

---

---

- [Change] 文档全部移至工作区根目录：GOAL/README/STRUCTURE/PROGRESS/docs 从 CoBeing/ 移出，项目内仅保留 CLAUDE.md，清理 5 个孤儿文件
- [Change] 模板迁移至 packages/core/src/templates/：分 agent/（9）+ group/（8），消除 core 对 config/ 的路径耦合
- [Change] 数据目录重构：data/ 建立 7 分类（agents/groups/coreagents/tools/toolagents/skills/plugins），管家群主迁至 coreagents/，skills/plugins 从根目录移入 data/，扫描器和孤儿清理同步适配
- [Change] 清理 SubAgentSpawner + 新增 AgentCreator ToolAgent：删除 spawner.ts，新建 creator.ts 轻量替代，butler/WS 改用 runAgentCreator 直接 LLM 调用生成 Agent 核心文件
- [Change] 文档系统全面审计与同步：删除过时 PACKAGE-GUIDE.md；修正 STRUCTURE/README/GOAL 及 7 个 docs/项目信息/ 文件中的 Provider 列表(11→7家)、Channel 列表(4→1)、测试计数(→417)、权限体系(4→5级)、组件清单(40→70)等过时信息

---

- [Debug] 预启动残留清理机制（第五轮）：新增 cleanupPendingDeletions() 在 SQLite 连接前强制清理标记目录；start.bat 增加 PowerShell 预启动清理脚本；butler.ts 补齐 config.json rename 兜底。三层防护彻底解决 Windows 删除文件残留
- [Debug] 删除文件残留深度修复：新增 rmDirForce（3 轮重试+rename兜底+事后验证+失败抛异常），替代所有删除路径的 rmDirRecursive；覆盖 ws-server destroy_agent/GroupManager.delete/archiveGroup/butler destroy-agent 共 4 处
- [Debug] Agent 执行超时保护：agent.run() 新增 5 分钟兜底超时(setTimeout → abort)，超时返回取消消息确保 WakeSystem 不被永久阻塞
- [Debug] WS 离线窗口冻结深度修复（第二轮）：ws-client.ts 增加 5s 离线宽限期(期內重连不展示离线)、客户端 pong 超时检测(5s 无响应→强制重连)、心跳 ping 不排队(避免速率预算浪费)、重连加速(500ms→10s max)；ChatView/GroupChatView 离线时不禁用输入框(消息排队)；ws-server pong 超时 10s→20s
- [Debug] _abortController 竞态审计修复：单字段→Map<string, AbortController> per-session 隔离，stop() 遍历 abort 所有活跃 session
- [Debug] getStatus() 死分支审计修复：新增 _errorFlag 追踪，恢复 "error" 状态返回，启动新 run 时清除
- [Debug] processingAgents 丢失审计修复：wakeQueue.updateQueue 签名增加 processingAgents 参数，WS handler 透传
- [Debug] Tauri onFocusChanged 泄漏审计修复：ws-client.ts 用对象包装器(tauriRef)替代裸变量，避免异步 resolve 时解绑失效

