# CoBeing v2 项目指令（CoBeing-v2 工程）

> 版本：2026-08-20 建立
> 定位：CoBeing 2.0.0 全新架构重写工程，与 v1（`D:\agent-codes\CoBeing\`）物理隔离。

---

## ⛔ 铁律：纯HI 目录永久只读

**`CoBeing-v2/docs/纯HI/` 是用户独有的架构设计权威源，永久禁止任何更改**——包括创建、修改、删除、重命名其中的任何文件。

- 只允许**读取**本目录。
- 所有整合、衍生、设计产出一律写入 `CoBeing-v2/docs/` 下的其他位置（如规格文档、设计文档），绝不写入纯HI。
- 纯HI 权威源文件：`使用方式.md`、`思考2.0.md`、`管家.md`（用户可能继续新增）。
- 与纯HI 冲突时，以纯HI 为准；整合基线文档必须同步更新。

---

## 工程定位

- **完全抛弃 v1 硬架构**（CoBeingRuntime 单体内核、全局命名空间依赖、monorepo/GUI 一体化），从零设计。
- **技术基调**：参考 dsh 工程机制——
  1. 插件化：非必须功能插件化，核心保持干净
  2. 热重载与隔离：插件崩溃不影响全局，其余功能正常
  3. 调度器：工具执行/并发仲裁
  4. 可重建日志：对话列表 append-only 事件日志
  5. 死亡 = 工作区隔离
  6. 原体：工作智能体【原体】规格严格参照 dsh 极简模式
- **GUI**：必须有、是主要入口；严格拒绝浏览器前端，采用 Tauri 原生桌面。

## 关键定稿规则（摘要；详见规格基线文档）

- 主对话窗口是**唯一非群组特例**；群组 label ≥ 3（user + butler + ≥1 工作智能体）；无群主。
- 群组随任务生灭：管家决定复用/新建；完成判定链 = 工作完成 → 管家回报 → 用户验收 → 用户告知成功 → 归档死亡。
- 上下文：公共（对话列表，逻辑顺序，dsh 可重建）+ 私密（思考、write 过程）；**共享 = 落盘即共享**（群组空间文件可被 read），思考 = 不落盘即私有；私密膨胀用【压缩】，公共超长走全量压缩流程（总结→压缩→管家重启工作）。
- 唤醒：mention 协议（数组多人 / @all / 必须附任务说明 / 忙碌 flag 排队 / 失败反馈调用者）；mention user 为软约束（直连，管家不唤醒）；mention butler 由管家分析并转述。
- 智能体是组织形式、**按群组实例化**：同名智能体跨群组 = 完全独立上下文、直接并发；**人格记忆共享、上下文不共享**；智能体没有自己的空间（记忆存取交给工具/工具智能体）。
- 管家：唯一人格化；不完成具体工作；**对所有文件只读**；创造智能体需用户批准、毁灭需明确点击确认（销毁 = 清人格经验 + 注销数据库条目 + 保留历史记录）；创建智能体遵循通用性 > 专业性。
- 管家上下文：**双实例独立**——主窗口与群组窗口互不干扰；群组内被 mention 时组装方式同工作智能体，经工具消息回主窗口；主窗口每 100k token 归档记忆 + 压缩。
- 工具智能体：【记忆】（信息提取统一入口——优化内容全量注入其上下文：自适 scope + 提炼要点 + 条目格式）、【压缩】（分段/全量压缩）、【诚实】（**2026-08-25 新增：发言真实性审查**——无长期上下文（不读写经验档案，每次独立审查）；输入 claim+evidence（待审查发言 + 该智能体最近工具记录）→ LLM 按 HONESTY_INSTRUCTION 判 `{"pass":bool,"reason":...}`；只查"声称完成的工作是否真实（是否真的调用工具生成产物）"，不评价效果好坏；工作智能体 reply 发言与 group-speak 发言前均经其审查，不通过 → 不发布 + 反馈继续真实工作（上限 3 次），butler 不审查）；发现方式同 tool。
- 数据：名录数据库（管家工具副职责编辑）+ 默认群组空间 `<注册位置>/data/group/<群组名>/`；无明确需求禁止全量访问群组；管家可为群组内智能体附加细化权限。

## 文档体系

| 文档 | 角色 |
|---|---|
| `docs/纯HI/` | 权威源（只读，禁止更改） |
| `docs/v2-使用场景与功能规格-v0.3.md` | 规格基线（随纯HI 更新） |
| `docs/v2-原体规格-v0.2.md` | 原体设计（工作智能体最小内核） |
| `docs/v2-架构设计-v0.1.md` | 架构设计（事件日志/调度器/插件化隔离） |
| `docs/v2-经验总结方案-v0.1.md` | 经验总结方案（v0.1.1：自适 scope / 四触发 / 画像合并 / 注入 / 执行收敛经工具智能体【记忆】） |
| `docs/v2-手机端与远程互联方案-v1.md` | 手机端与远程互联方案（v1：WS 传输契约 cobeing-ws/1 / remote.* 方法 / 面板 manifest / cloudflared 三层 / 国内 DNS 污染处置） |
| `docs/v2-群组偷懒根因与dsh对照修复方案.md` | **群组智能体"偷懒"根因 + 修复（2026-08-25：6 层根因 + dsh 结构性循环对照 + 5 项结构性修复**已全部实施并真实验证**（默认唤醒/任务锚点保留/诚实规则 2 修正+本轮证据切分/去"否则 reply"+工具面收敛/轻量 goal 化 kind=process 续轮 + maxTokens 8192；另修 CLI 启动竞态）；新增 scripts/verify-group-wake.mjs 真实 E2E 12/12）** |
| `docs/使用指南.md` | **最终用户使用指南（2026-08-25 随 v2.0.0 发布：安装/API Key 配置/三视图/建群任务/手机连接/FAQ/数据隐私）** |
| `docs/information/2026-08-24-research-agent-experience.md` | 经验总结调研报告（25 来源；web_search 故障如实标注，中文社区维度受阻） |
| 根目录 `PROGRESS.md` / `PROGRESS-LITE.md` / `STRUCTURE.md` | 工作区变更记录（v2 变更同步更新） |

## 代码结构（2026-08-23 全量工作落地；2026-08-23 GUI MVP 落地）

- `packages/types`：事件模型（10 类可重建事件 + SessionEventInput）、实体（AgentDef/GroupMeta 等）、工具契约（ToolDef/ToolRunContext/PathGuardLike 含 assertWrite）。
- `packages/core`：内核——
  - 插件框架（自研 effect 模型：EventBus/Fiber/PluginManager，注册皆 effect、失败回滚、热重载）；
  - 事件日志（JSONL append-only + 内存缓存 readCached + cleanup 30 天保留 + 投影动态重建，compaction 遮蔽）；
  - 调度器（dsh 六语义移植）；
  - 默认工具（原体规格 §3：7 个 + 管家专属）：str-replace-editor（view offset/limit 分页 + **footer 续读指引**（Showing lines X-Y of N. Use offset=Y to continue）/ create / **write 全量覆盖** / str_replace / insert；写走 assertWrite；支持相对路径；**fs 观察策略**：view 记版本 token → 写前 FS_NOT_OBSERVED/FS_STALE_VERSION 拒绝 + re-read 提示，per group/agent 隔离）/ persistent-bash（**node-pty 真实持久会话**：Windows powershell ConPTY；标记行独立提交防语法错误挂起；kill 绕过 node-pty 5s fork 超时；**描述标注 Windows/PowerShell 环境**（不支持 &&，用 ; / 换行））/ **glob-files（dsh glob：模式找文件，无斜杠匹配任意深度 basename，跳过 node_modules/.git，上限 100）** / **grep-files（dsh grep：正则内容搜索，`相对路径:行号:内容`，include/path 过滤，上限 250）** / **todo-list（dsh todo_write：结构化任务清单，per 群组/智能体 隔离，**todo/write 事件整表落窗口日志，last-write-wins 重启恢复**；**add 防重复**：相同未完成内容拒绝重复添加防空转刷屏）** / group-speak / call-tool-agent + butler-relay + 记忆/压缩/诚实半硬编码；**管家专属工具**（butler-tools.ts：list-groups / create-group / ask-user，仅主窗口但丁可调，ask-user 触发 GUI 确认卡片）；
  - 权限（PathGuard 两级 readonly/readwrite + 细粒度 AccessRule；管家全只读）；
  - LLM 网关（串行队列/RPM/超时/重试 + **DeepSeek 真实 provider**（fetch，DEEPSEEK_API_KEY）+ MockProvider 可编程）；
  - 运行时：AgentInstance（原体循环 + denyTools + compaction 摘要注入 + **组装前缀稳定**（输出协议/工具清单在 system 冻结段，字典序）+ **request/header 变化才追加**（system+tools 完整头）+ **request/error 结构化落盘** + parseModelOutput 平衡括号/嵌套/空对象回退 + **onTurnComplete 轮次完成钩子**（主窗口但丁每轮后自动压缩检查）+ **经验自动注入**（user 动态区 [我的经验档案]：画像+最近条目，system 前缀不变）+ **完成纪律「任务完成后调用【记忆】总结」**）、GroupRuntime、**ButlerRuntime 真实归档**（总结→80k 字符/段压缩→compaction，阈值可配默认 100k；**summarizeArchive 归档总结经【记忆】总结并写档案一体**）、butler-persona（但丁人格 + 主窗口协议）、**ExperienceService 经验总结服务（方案 v0.1.1）**——**自适 scope**（自身定义：名录 name/role/tools/basePrompt，但丁用管家人格 + 既有画像，思考2.0 #24 落地）/ **memoryAgentInstruction**（【记忆】工具智能体完整方法论指令：角色定位 + 提炼要点 + 条目格式 + 自适 scope）/ **画像合并**（普通条目 >50 → 旧一半+旧画像 LLM 合并为 profile 重写，有界）/ contextBlock 注入块（画像 ≤800 字符 + 最近 6 条 ≤300 字符）/ **memberMaterial**（模块级导出：成员素材组装，与总结执行解耦）/ info（**v0.1.1 起删除 summarize/summarizeScopedText/summarizeGroupMember/summarizeTurn 直调——总结统一由【记忆】执行**）；
  - Kernel：主窗口但丁循环（mainWindowSpeak D11 路由）、**主窗口会话化（新对话窗口）**——newButlerConversation（当前日志完整归档 data/butler/conversations/conv-<ts>.jsonl + 重建空会话 + 归档前经【记忆】总结写经验档案（自适 scope 在【记忆】上下文）+ 主窗口 todo 清空落空表）、listButlerConversations（当前+历史，conversations.json 元数据）、butlerConversationProjection（历史只读投影）、butlerContextInfo（估算 token/阈值）、isButlerBusy（工作中拒绝开新对话）、**经验接线（v0.1.1 统一入口 runMemoryAgent → 工具智能体【记忆】）**——butler 实例 experience 注入 + 归档总结经 runMemoryAgent('butler',…,'main-window-archive')、makeAgentFor 工作智能体注入 experience + onTurnComplete 轮次节流总结（每 5 轮且有活动，水位追踪，fire-and-forget，memberMaterial→runMemoryAgent）、archiveGroup 归档前成员经验总结（memberMaterial→runMemoryAgent，source=group:<名>，容错）、call-tool-agent save→runMemoryAgent、experienceInfo、群组生命周期（归档死亡 + 复用建议 + 同名重建日志隔离）、mockResponder/butlerArchiveThresholdTokens/experienceTurnEvery 配置、**remoteControl（方案 v1）**——RemoteControlService（面板注册器 + quick 面板：截屏/锁屏/睡眠/媒体键/剪贴板；文件 root 白名单浏览/下载/上传 ≤20MB；PowerShell 执行注入）接 KernelOptions.remoteRoots。
- `packages/bridge`：**桥协议**——JSON-RPC 2.0 over stdio（BridgeServer transport 无关，**37 方法**：+ butler/newConversation · butler/listConversations · butler/conversationProjection · experience/info · **experience/entries · experience/search（2026-08-25 记忆面板）** · **group/status（2026-08-25 群组工作状态：成员忙碌/任务摘要/最近活动）** · **remote/\* 11 方法**（info/panels/invoke/screenshot/clipboard/media/power/roots/listFiles/download/upload）；BridgeProjection 增 context 估算 token/阈值 + **公共消息 ts 时间戳**）+ CLI bin `cobeing-kernel`（--data / **--remote-port**（0=随机）/ --remote-token / --remote-root，token 持久化 dataRoot/remote.token，DEEPSEEK_API_KEY 自动接真实 provider，notify 通知，stop 自然退出；**远程模式下 stdin EOF 不自动停止内核**——2026-08-25 修复：网络服务器不因 stdin 关闭自杀）；**remote.ts RemoteServer（方案 v1）**——ws 包 WS 服务器（127.0.0.1 绑定）：首帧 auth token 鉴权（未鉴权一律 -32001）→ 复用 BridgeServer（transport 无关）+ hello（protocol cobeing-ws/1）+ notify 广播全双工（CLI notifyUser stdout+WS 双发）。
- `scripts/smoke-cli.mjs`：真实子进程冒烟（7 通道）。
- `scripts/verify-real-llm.mjs`：DeepSeek 真实调用定向验证（真实 key 场景 + 无效 key 401 错误面，key 仅环境变量不落盘）。
- `scripts/verify-conversation.mjs`：**真实 DeepSeek 新对话窗口链路验证**（记忆延续→归档→历史回看→新会话归零继续工作→context 可见性）。
- `scripts/verify-experience.mjs`：**真实 DeepSeek 经验总结端到端验证**（但丁归档自适总结写管家经验档案 → writer 真实工具任务 → 群组归档成员经验沉淀 → experience/info）。
- `scripts/verify-remote.mjs`：**远程互联本地 WS E2E（方案 v1）**——CLI 子进程真实起内核 + 真实 WS 客户端 11 通道（错 token 拒/鉴权/hello/ping/remote 方法/主对话投影/notify 广播/文件/未鉴权拒）。
- `scripts/verify-tunnel.mjs`：**cloudflared 隧道外网 E2E（方案 v1）**——quick tunnel → wss 经 Cloudflare 边缘全链路 9 通道；内置 DoH 回退（本机 DNS 污染时阿里 223.5.5.5 解析 + lookup/SNI 直连）。
- `scripts/verify-mobile-chat.mjs`：**手机端对话链路真实 E2E（方案 v1，真实 DeepSeek）**——模拟手机端请求序列：auth/hello → butler/conversationProjection → mainWindowSpeak 快速返回（<5s，非等待回合）→ 轮询投影直到但丁真实回复 → 会话列表（6 通道）。
- `scripts/verify-sync.mjs`：**实时同步 + 群组恢复真实 E2E（方案 v1 实时同步协议）**——名录校验拒绝未注册成员建群 → 智能体/群组/发言/回复各域 update 广播双向实时推送 → **停内核重启 → working 群组恢复显示 + 投影历史保留 + 恢复后群组可继续工作**（14 通道）。
- `scripts/verify-honesty.mjs`：**【诚实】发言真实性审查真实 LLM 验证（2026-08-25，7 通道）**——声称完成但无工具证据 → pass=false（幻觉拦截）/ 声称完成 + 写文件成功 → pass=true + kind=completion / 过程性汇报 + 成功工具记录 → pass=true + kind=process / 声称完成但工具全失败 → pass=false / **过程性汇报 + 0 成功工具记录 → pass=false（修复 3：只说不做拦截）**。
- `scripts/verify-group-wake.mjs`：**群组默认唤醒真实 E2E（2026-08-25 新增，12 通道，真实 DeepSeek）**——用户发言**不带 mention** → 默认 @all 唤醒 → waker 真实工具调用（str-replace-editor + persistent-bash）→ hello.txt 落盘验证 → 完成汇报经【诚实】放行 → 无 TOOL_DENIED/request-error/异常（修复 1/2/3/4 端到端）。
- `scripts/build-kernel-dist.mjs`：**内核发布打包（2026-08-25 新增，任务 5）**——esbuild bundle bridge CLI → kernel.mjs（external node-pty/ws）+ 复制 node-pty 原生模块 + Node 便携运行时 node.exe → `gui/src-tauri/resources/kernel/`（Tauri bundle.resources 随包）；内置打包后内核冒烟（listening 验证）。
- `scripts/verify-pvz-e2e.mjs`：**用户视角全流程真实 E2E（2026-08-25，32 通道，真实 DeepSeek ~47s）**——模拟手机端交互面：auth/hello → 创建 game-dev（maxTokens 8192）→ 建群 → 发言下发 PvZ 任务（mention+任务说明）→ **game-dev 真实开发（todo-list + str-replace-editor 分块写，15 次工具调用）→ 产物 index.html（9.1KB Canvas/交互/僵尸/胜负判定）+ node --check 通过** → 完成报告 → group/status → 归档（成员经验沉淀）→ 主窗口对话（但丁真实回复+新对话归档）→ **重启恢复**（归档群组不恢复+名录/经验/索引保留）→ 异常扫描（投影失败/工具错误率/request-error 全无）；产物复制 `releases/pvz-e2e-artifact/index.html`。
- `scripts/remote.ps1`：**远程互联启动器（方案 v1）**——LAN/quick tunnel 双模式（tunnel 强制 --protocol http2 兼容国内网络/代理环境）；.env 自动加载；**连接信息底部高亮区块 + 落盘 data/remote.info.txt**（地址/Token 直接复制）；cloudflared 日志重定向自动抓取隧道 URL；cloudflared 缺失自动下载 tools/；Ctrl+C 清理子进程（UTF-8 BOM 编码，PS 5.1 兼容）。
- `mobile/`：**手机端 app（方案 v1，Capacitor 6 + React 19 + Vite 5 独立工程）**——src/rpc.ts（WS JSON-RPC 客户端 cobeing-ws/1：auth→hello→connected / 30s 超时 / 断线指数退避重连 1s→30s / 可注入 fake WebSocket 测试）+ 六视图（ChatView 投影+发送+新对话+会话历史+确认卡；GroupsView 列表+投影+mention chips+任务说明+归档+新建+**工作状态条（成员忙碌标记+当前任务）**；AgentsView 名录+创建向导+待批准确认/拒绝+**记忆面板（experience/entries+search 检索）**；ConsoleView 面板 manifest 泛化渲染+截屏查看+文件浏览/下载（@capacitor/filesystem 存设备文档）/上传；SettingsView 多连接配置+状态+关于+**检查更新（2026-08-25：GitHub 正式版 + APK 资产 + 版本比较 → 下载 APK 到 cache → ApkInstaller 原生安装）**）+ 通知横幅+震动 + **实时同步（方案 v1 update 协议）**——App 级 onNotify 消费 update 事件 → lastUpdate context → 三视图按 scope 即时刷新（butler/group/groups/agents，不依赖轮询）+ **视觉完善（2026-08-25）**——消息头像（角色首字+确定性取色）/日期分隔（今天/昨天/M月D日）+HH:MM 时间戳（PublicMessage 全链路 +ts）/加载骨架屏（MessageSkeleton）/断线连接横幅（重连按钮）/毛玻璃 tabbar+composer/气泡渐变+入场动画/chip-busy 脉冲 + 樱花薄荷主题移动端适配（44px 触控/底部 Tab；**对话输入条 .composer 为 fixed 悬浮底部 Tab 上方**——流内元素会被 fixed tabbar 完全盖住，真机暴露已修）+ **update.ts（GitHub 自动更新，2026-08-25：checkMobileUpdate/pickMobileRelease/isNewerVersion/downloadApk（fetch→base64→Filesystem cache）/installApk（Capacitor 插件 ApkInstaller））** + ChatView.spec.tsx（3 项：输入条渲染/发送/历史只读）+ MessageList.spec.tsx（6 项：骨架屏/空态/头像/日期分隔/时间戳）+ **update.spec.ts（7 项：版本比较/资产挑选/更新检查成功与失败面）**；android/（cap add 生成，gradlew assembleDebug 产 APK com.cobeing.mobile targetSdk34；**ApkInstallerPlugin.java（2026-08-25：FileProvider + ACTION_VIEW 安装 APK，cache 相对路径防穿越校验）+ AndroidManifest REQUEST_INSTALL_PACKAGES 权限**）；测试 22 项。
- `gui/`：**Tauri 2 原生桌面 GUI（MVP 三界面，2026-08-23 落地）**——
  - `src/`：React 19 + TS + Vite 7。`rpc.ts`（JSON-RPC client：invoke rpc_call + **26 方法封装**（含 experienceInfo/experienceEntries/experienceSearch/groupStatus）+ jsonrpc-notify/kernel-exited 事件）；`theme.css`/`styles.css`（樱花薄荷糖果色 token + 三卡片层次布局，遵循用户 UI 偏好）；`App.tsx`（主对话/群组/智能体/**设置**四视图导航 + 内核状态灯 + **全局 KernelUpdateCtx**：订阅内核 update 广播，不随视图切换卸载，四视图按 scope 实时刷新）；`views/`（MainChatView 轮询 butlerProjection + 通知流 + **会话管理**（新对话按钮两段确认 / 会话列表当前+历史 / 历史只读回看返回 / 上下文进度 badge `上下文 12.3k / 100.0k`）+ **ask-user 确认卡片**（点击回传「【确认答复】选项」）；GroupsView 群列表/投影/mention+任务说明/新建/归档确认 + update 实时刷新 + **成员忙碌标记（⏳ chip，2s 轮询 group/status）+ 最近活动 + 任务摘要**；AgentsView 名录/创建向导/待批准队列/销毁确认 + update 实时刷新 + **记忆面板（经验档案 N 条 + 关键词检索 + 条目列表）**；**SettingsView（2026-08-26，设置界面）**——**模型配置卡片**（API Key/Base URL/模型名 → `settings.ts` → Rust get/save_model_config → `<dataRoot>/model-config.json`，保存后重启生效）+ **检查更新卡片**（内嵌 GitHub 自动更新：check_update → download_installer → launch_installer，原顶栏按钮与 UpdateModal 移除）+ 关于）；`settings.ts`（模型配置 invoke 封装）+ `update.ts`（**GitHub 自动更新，2026-08-25**：check_update（GitHub API 正式版 + setup.exe 资产 + 版本比较）→ download_installer（Rust 流式下载到 app data updates/，update-progress 事件进度条）→ launch_installer（启动 NSIS 安装器））；`e2e.ts` + `E2EPanel`（**9 步自检** + 布局测量 + confirmSeen 观察 + **模型配置读写往返**（get→save→get→还原），`#e2e` 或 `VITE_E2E=1` 启用，报告落盘 `e2e-report.json`）；测试 41 项（rpc/update/settings/e2e/MessageList/MainChatView/SettingsView）。
  - `src-tauri/`：`kernel_bridge.rs`（纯 Rust 可测内核桥：spawn 内核子进程 + stdio JSON-RPC 行协议按 id 路由/notify/60s 超时/优雅 stop；8 项集成测试，假内核脚本 fixtures）；`update.rs`（**GitHub 自动更新，2026-08-25**：fetch_releases（ureq 3，10s 连接/15s 全局超时）→ pick_desktop_release（跳过 prerelease，匹配 setup.exe）→ is_newer_version（主次补丁数字段比较）→ download_installer（流式下载 + update-progress 事件 + 文件名净化防穿越）→ launch_installer（NSIS /S 静默安装）；4 项单测）；`model_config.rs`（**模型配置，2026-08-26**：get/save_model_config 命令读写 `<dataRoot>/model-config.json`（api_key/base_url/model，原子写+容错读）；5 项单测）；`lib.rs`（setup 拉起内核 `node tsx cli.ts --data <dataRoot>`，路径 `COBEING_V2_ROOT`/`COBEING_DATA_ROOT` 环境变量优先；命令 rpc_call/get_kernel_status/e2e_report/**check_update/download_installer/launch_installer/get_model_config/save_model_config**；事件 jsonrpc-notify/kernel-exited；ExitRequested 优雅 stop）。
  - 启动：双击根目录 `start.bat` 一键启动（环境检查/依赖安装/端口提示；自动读取同目录 `.env` 的 DEEPSEEK_API_KEY——系统环境变量优先，`.env` 被 .gitignore 忽略）；或 `cd gui && pnpm tauri dev`（GUI 自动拉起内核，dev 模式 node+tsx）；**发布打包（2026-08-25 完成，任务 5）**——`scripts/build-kernel-dist.mjs` 生成内核资源（Node 便携运行时 node.exe + esbuild bundle kernel.mjs + node-pty/ws 原生模块 → gui/src-tauri/resources/kernel/，含打包后内核冒烟）→ `cd gui && pnpm tauri build` 出 NSIS 安装包（**内置内核免装 Node**）；lib.rs 发布模式：resource_dir 双候选探测（resources/kernel）+ **portable_path 剥离 `\\?\` verbatim 前缀**（Node 无法解析 verbatim 脚本路径，lstat 'D:' 崩）+ 数据目录 release 用 `%APPDATA%\com.cobeing.v2`（COBEING_DATA_ROOT 优先）+ 启动诊断 kernel-launch.log。
  - 远程互联：双击 `start-remote.bat`（菜单 1 局域网 / 2 外网隧道，调用 `scripts/remote.ps1`，打印地址+Token）；APK 打包 `scripts/build-apk.ps1` → `releases/CoBeing-mobile-v2.0.2-debug.apk`（拷贝手机直接安装）。
- 状态：typecheck ✅ / **207 tests** ✅（2026-08-25：**群组偷懒 5 项结构性修复实施**——①群组默认唤醒（mention 空→@all，group.ts + GUI/mobile 提示）②任务锚点保留（agent-loop anchorTask 跨轮保留 + renderPublic 渲染 [任务:...]）③诚实规则 2 修正（过程性发言须 ≥1 条 [ok] 成功工具调用，"只说不做"拦截；证据按本轮唤醒切分 seq>wakeStartSeq）④去"否则 reply"协议 + worker denyTools 收敛 4 协调工具 ⑤群组任务轻量 goal 化（诚实 verdict 增 kind=completion/process/other——过程性发言有工具证据→进展发布后继续回合【继续工作】反馈，受 maxToolRounds 兜底非硬闸）+ GUI maxTokens 默认 8192；**另修 CLI 启动竞态**（cli.ts 先 kernel.start 再开远程 WS，防客户端在群组恢复前 listGroups 空）；**verify-group-wake 新增 12/12**（不带 mention 默认唤醒并真实写文件）+ verify-honesty 7/7（含只说不做拦截 + kind 分类）+ verify-pvz-e2e 32/32 + verify-sync 14/14（并发复验）+ verify-remote 11/11 + verify-mobile-chat 6/6；2026-08-24：基础编程工具面 + dsh 第二轮对照优化 + 主窗口会话化 + **经验总结方案**（前缀稳定/完整 header/freshness/request-error/结果分级/view footer 续读/todo 持久化/onTurnComplete 钩子/新对话窗口/历史回看/ExperienceService 自适总结·画像合并·成员与轮次总结·经验注入 + v0.1.1 执行收敛——信息提取统一经工具智能体【记忆】）+ **手机端与远程互联 v1**（RemoteControlService 12 项：面板/动作/脚本断言/文件安全/真实截屏/真实剪贴板；RemoteServer 6 项：鉴权/hello/广播/panels/stop/host 0.0.0.0）+ **实时同步协议 + 群组恢复**（2026-08-25：NotifyPayload +update 事件（scope butler/group/groups/agents）；kernel start() restoreWorkingGroups 重启恢复 working 群组 + createGroup 名录校验（未注册成员明确报错）+ makeAgentFor 已销毁成员返回 null；内核 10 变更点 emitUpdate 广播；GUI App 全局 KernelUpdateCtx 三视图实时刷新；mobile App 级 lastUpdate context 三视图实时刷新；core 测试 +6）+ **三域体验升级（2026-08-25 目标 1-3）**——①手机端视觉：消息头像/日期分隔+时间戳（PublicMessage 全链路 +ts）/骨架屏/连接横幅/毛玻璃 tabbar+composer（mobile 测试 9→15）②群组工作状态：kernel groupStatus（成员忙碌标记+任务摘要+最近活动）+ 桥 group/status + speakToGroup 带 task 自动更新任务摘要持久化（groups update kind=task）+ GUI/手机忙碌成员 ⏳ 展示（kernel+3/bridge+3）③记忆检索：ExperienceStore.search 关键词检索 + 桥 experience/entries+experience/search + GUI/手机智能体记忆面板 + call-tool-agent recall keyword（experience+1/kernel+2）④**CLI 远程模式 stdin EOF 自杀修复**：远程模式（--remote-port）不再因 stdin 关闭自动 kernel.stop（网络服务器不自杀），verify-sync 重启恢复由 3 失败 → 14/14 全绿）+ **【诚实】工具智能体 + 发言真实性审查（2026-08-25，目标任务 4）**——①【诚实】注册（无长期上下文，claim+evidence → pass/reason，只查真实工作不评价效果）；AgentInstance reply 发言前 vetting（拒绝→不发布+反馈继续，上限 3）+ group-speak 工具 vetting（HONESTY_REJECTED）+ kernel runHonestyAgent（butler 不审查）②真实 E2E 发现修复：提前 reply 结束回合（回合纪律：未完成不得 reply + 分块写入纪律 + persistent-bash 描述标注 PowerShell）+ **截断 JSON 当发言发布**（parseModelOutput 截断检测 looksLikeTruncatedToolJson → truncated 不发布反馈分块写）+ todo-list add 防重复（相同未完成内容拒绝重复添加）③**verify-honesty 4/4（真实 LLM）+ verify-pvz-e2e 32/32（用户视角全流程：创建智能体→建群→PvZ 开发任务→game-dev 真实工具调用 15 次→产物 index.html 9.1KB Canvas/交互/胜负判定 + node --check→完成报告→归档记忆→重启恢复→异常扫描全无，46.8s）**；core 197→201/201） / **CLI 冒烟 7/7** ✅ / **DeepSeek 真实调用验证 ✅**（2026-08-23 临时 key 实测；2026-08-24 verify-coding-tools 端到端编程任务全绿；**verify-conversation 新对话窗口链路全绿**；**verify-experience 经验总结链路全绿 10.0s**——但丁归档经【记忆】自适总结 + 群组归档成员经验沉淀（方法论注入生效：writer 总结出"记录完整路径与字符数""type 验证为有效自我检查"）；**verify-mobile-chat 手机端对话链路全绿 6/6**——模拟手机端请求序列（auth/hello/初始投影/mainWindowSpeak 快速返回/真实 DeepSeek 但丁回复/会话列表））/ **实时同步真实 E2E ✅（2026-08-25 verify-sync 14/14）**——名录校验拒绝未注册成员建群 + 智能体/群组/发言/回复 update 广播双向实时推送 + 停内核重启 → working 群组恢复显示/投影历史保留/恢复后群组可继续工作（**CLI 远程模式 stdin EOF 修复后全绿**）/ **诚实审查真实 E2E ✅（2026-08-25 verify-honesty 7/7）**——幻觉拦截/真实放行+kind 分类/过程不误伤/全失败拦截/**只说不做拦截** / **群组默认唤醒真实 E2E ✅（2026-08-25 verify-group-wake 12/12，新增）**——不带 mention 的群组发言默认唤醒并真实工作（写文件落盘 + 完成汇报经【诚实】放行）/ **用户视角 PvZ 全流程真实 E2E ✅（2026-08-25 verify-pvz-e2e 32/32，41.4s）**——game-dev 真实开发产物 index.html 7.1KB（Canvas+交互+僵尸+胜负判定）node --check 通过 + 归档记忆 + 重启恢复 + 异常扫描全无 / **远程互联真实验证 ✅（2026-08-24）**——本地 WS E2E 11/11 + **cloudflared 隧道外网 E2E 9/9**（wss 经 Cloudflare 边缘全链路 + notify 主动推送双向不阻塞）+ remote.ps1 LAN 冒烟真实 WS auth 通过（**LAN 路径修复**：--remote-host 0.0.0.0 绑定 + 防火墙放行 + 物理网卡 IP 优先，真实局域网 IP 连接通过）+ **APK 构建成功**（3.85MB com.cobeing.mobile targetSdk34 + aapt 校验）+ **手机端对话输入条修复**（2026-08-24 真机暴露：.composer 流内元素被 fixed 底部 Tab 完全盖住 → 改 fixed 悬浮 Tab 上方；mobile 测试 6→9/9 + verify-mobile-chat 6/6 + APK 重建 releases\CoBeing-mobile-v2.0.0-alpha-debug.apk）/ **GUI ✅**（2026-08-23：前端 20/20 + Rust 8/8 + tauri dev 真实启动 E2E 7/7 + 确认卡片真实渲染 confirmSeen=True + 内核 81/81；2026-08-24：前端 24/24 + E2E 8/8 含新对话窗口步骤；2026-08-24 经验：前端 25/25；2026-08-25 群组工作状态：前端 25/25）。待办：GUI 通知与归档检索（二期）、经验检索升级与 experience/write 事件（方案二期）、CSP 收紧、SQLite 迁移（随 GUI）、plan mode/jobs/呈现 render intent（dsh 对照诊断 P2）、**群组任务完整 goal-round-driver 迁移（blocked 阈值门/todo 完成度检查/跨回合自动续轮，二期）**、**手机端真机验证（用户）**——APK 安装 + LAN/隧道实测 + 对话（输入条已修复，重装新 APK）+ **实时同步真机复验**（手机发消息电脑即时收到/电脑回复手机即时出现/重启后群组恢复显示）+ **新 APK 视觉/群组状态/记忆面板复验**；**手机端二期**——原生通知（LocalNotifications）、files 面板化、系统监控 display 控件、Cloudflare Access 接入、大文件分块传输、电脑→手机双向请求。

## 执行纪律

1. 每次代码/文档变更后，同步更新工作区根 `PROGRESS.md`、`PROGRESS-LITE.md`、`STRUCTURE.md`。
2. 文档必须与代码实际状态一致，禁止幻觉内容。
3. 代码变更必须真实验证（禁止仅以单元测试代替）。
4. 设计文档落盘前，先对照纯HI 检查是否有冲突或遗漏。
5. **打包纪律（2026-08-25）**：功能/修复确认无误后，必须按更新内容重新打包**电脑端与手机端**安装包并发布 GitHub Release——电脑端：`scripts/build-kernel-dist.mjs`（内核资源）→ `cd gui && pnpm tauri build`（NSIS 安装包）；手机端：`scripts/build-apk.ps1`（APK）。两者产物上传至 https://github.com/CH3SH-LC/CoBeing 的对应版本 Release（资产命名沿用 `CoBeing.v2_<版本>_x64-setup.exe` 与 `CoBeing-mobile-<版本>-debug.apk`），发布后更新 `docs/使用指南.md` 与 PROGRESS 版本记录。
