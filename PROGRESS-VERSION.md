# CoBeing 版本发布记录

> 仅在新版本发布时维护。日常进度记录见 PROGRESS.md 和 PROGRESS-LITE.md。

---

## v1.4.0 (2026-06-03 ~ 2026-08-04)

> 整理 v1.3.1 之后（2026-06-01 ~ 2026-08-04）的全部开发工作，按里程碑组织。代码版本号自 2026-06-03 起统一为 1.4.0；本条目为发布记录整理，尚未产出发布包（releases/ 最新仍为 v1.3.1）。

### 插件系统全能力（2026-06-01 ~ 06-03）
- **插件系统扩展为全能力矩阵**：Provider 去硬编码（原生仅保留 DeepSeek，其余 6 家全部改为插件）；新增 HookBus（12 事件，notify/intercept/transform 三语义）、PromptLayerRegistry、UIExtensionRegistry；Agent/Group/Tool/Message 全生命周期钩子埋点；plugin-sdk types/loader 大幅扩展；registry.json 驱动插件加载；models.json 模型自描述
- **5 家 Provider 插件补全**：qwen / minimax / volcengine（豆包）/ moonshot / mimo（各含 manifest + models.json + index.js，默认 disabled）
- **QQBot 插件化**：独立插件 index.js，移除 config.channels 原生配置
- **插件→前端动态发现**：前端 pluginsStore；list_plugins / add_plugin_instance / remove_plugin_instance / update_plugin_instance 4 个 WS 端点；get_state/get_config 扩充插件数据；删除 3 处 CATALOG_MODELS 硬编码改用动态模型数据；_custom Provider/Channel 内置插件
- **两轮 5 维度审计修复 32 项**（安全/架构/正确性/API 完整性/代码质量）：message:send 拦截、agent:destroy 事件、stop() 全局清理、getConfig 密钥脱敏、prompt 截断 + provenance、插件 tools 注入全部 Agent、dispose 竞态等
- **4 Agent 并行审查 + 16 项修复**（CRITICAL：require→await import、instanceId 路径穿越、自定义实例展平）
- 版本统一 1.4.0（10 个 package.json + tauri.conf.json）

### 前端扩展系统重设计 + 基础架构重构（2026-06-03 ~ 06-04）
- 前端扩展系统重设计：侧栏重排（管家→智能体→群组→仪表盘→扩展→设置）、扩展页三 Tab（技能/MCP/插件）、仪表盘居中卡片、设置页精简、关于页动态版本号
- 后端新增 toggle_plugin / update_plugin_config WS 端点
- Agent 核心文件系统重构：删除 BOOTSTRAP/SOUL/USER/TOOLS，重写 CHARACTER/JOB/MEMORY/EXPERIENCE/AGENTS，明确 CHARACTER（人物形象+语言风格）与 JOB（工作范式+方法论）职责分离（35+ 文件，403 测试通过）
- 数据目录重构为 7 分类（agents/groups/coreagents/tools/toolagents/skills/plugins）；模板迁移至 packages/core/src/templates/；清理 SubAgentSpawner → 新增 AgentCreator ToolAgent
- 文档全部移至工作区根目录 D:\agent-codes\，项目内仅保留 CLAUDE.md

### TODOboard 三层架构 + 管家入口数据层（2026-06-08 ~ 06-09）
- 核心 TODO/群组唤醒闭环修复：TODO 事件携带 scope/agentId/groupId 上下文、condition/0time 重复触发防护、各完成入口统一走群组 scanner 完成协议
- TODOboard 三层架构：GlobalTodoItem 扩展 + GlobalTodoStore 重写（23 测试）、Butler 5 个编排工具（global-todo-*）、完成事件回传、自动续作核心（continuation-judgment）、前端 Butler 侧栏 GlobalTodoPanel + Agent 对话区 TODO 横幅
- 管家入口 Round 1 数据层：butler-bridge.ts 共享类型（5 interface + 3 常量）、GlobalTodoStore / ButlerTaskStore / GroupButlerBindingStore 三个 JSON Store
- 群组纯 Prompt 驱动协作升级：HOST_JOB.md 群主职责、GUIDE.md 重写、Agent 6 步判断框架、group-send 改为非阻塞旁路语义、工作区初始化为 2 文件

### 管家 / 通用智能体能力（2026-06-10）
- 非 Market 审查 P0/P1 后端闭环：ButlerTaskStore / GroupButlerBindingStore 挂入运行时、Butler tracked dispatch 写 Global TODO + ButlerTask + Agent inbox / Group TODO、WS find_agent / dispatch_task 由占位改为真实操作、新 Agent 自动生成默认能力卡
- ToolAgent 标准化：统一 ToolAgentSpec、creator 纳入 ToolAgent 类型并支持群组草案生成、Memory ToolAgent 返回 MEMORY.md 修改建议
- 通用智能体能力与增强全 5 层：能力画像（CapabilityCard/capability.json）+ 任务收件箱（inbox.json）+ 成长建议（proposals/）+ 资源请求 + GrowthReviewer / TaskArchive / CapabilityUpdater 三个 ToolAgent + 前端 3 Tab
- 管家入口 Round 2 聊天增强：TaskReceiptCard 可折叠任务回执卡片 + ChatInputActions 派发/创建/摘要快捷按钮 + 设置图标 ⚙→lucide Settings

### GUI A 方案优化与稳定性（2026-06-11 ~ 06-12）
- 个人资料设置（昵称/首字/Emoji/图片头像）、共享聊天头像与消息气泡框架、真实单聊/群聊显示头像（用户右、智能体左）、用户气泡显示个人昵称
- 主题系统：导入校验补齐 chat.* 气泡 token；默认樱花薄荷主题层次增强（渐变背景 + 糖果色气泡）；新增 executive-workbench 工作台主题
- better-sqlite3 Node 24 原生绑定恢复（^11→^12.10.0）+ Memory/Group/Observability SQLite 降级路径兜底
- 修复全局任务/侧栏 `\uXXXX` 字面量显示；主题加载 cache:no-store + 内置主题优先于本地旧自定义主题

### 聊天 / 群组稳定性大修（2026-07-08 ~ 07-09）
- 第一批 5 项：智能体回复正确停止与记录、工具调用计数去重、新对话仅清当前会话、侧栏导航切换、群组模型配置 Dialog 遮挡（z-50→z-[60]）
- 第二批 5 项：group-send 工具可用（构造函数直接注册）、全局任务精简显示、群组创建/系统消息不外显、TODOboard 触发不外显、对话未读徽章
- 第三批 4 项：消息去重（同内容 2s 内）、群主不自执行（移除 8 个执行工具 + 强化 systemPrompt/HOST_JOB.md）、上滚不自动回滚、group-send 协调者绕过成员检查
- 管家 / 长任务稳定性：流式回复丢失（startWaiting 先 finalizeStream 保存）、"正在回答"卡死（agent_completed 安全网）、页面整体上浮（h-screen→h-full + overscroll-behavior:none）、@提及弹窗被 overflow-hidden 裁剪

### 前端与后端重构（2026-08-01）
- ChatView.tsx 646→68 行拆分 7 个子组件；useWebSocket.ts 759→104 行，71 种 WS 消息 handler 拆分到 ws-handlers/
- 修复 8 个僵尸全局变量（__cobeingHookBus 等从未被写入 → 插件 hook / PromptLayer / 投票静默失效）
- ws-server.ts 3111→571 行：68 个 WS 命令 handler 按域拆分到 api/handlers/ 11 个模块 + 命令注册表分发
- butler.ts 24 个工具工厂函数按域拆分到 agent/butler/tools/ 8 个模块（1428→150 行）
- runtime.ts start()/stop() 拆分为职责清晰的私有辅助方法 + 收敛 wsServer 8 个 setter

### Market 分级机制（2026-08-03）
- 新增 packages/core/src/market/：MarketCatalog（official/certified/community/local 四层信任分级扫描）、MarketInstaller（依赖树 + 社区确认门禁 + 拓扑安装 + 路径穿越防护 + 幂等）、butler-market-recommend / butler-market-install 工具
- 4 个内置示例资源（official 旅行规划 skill/agent/group 依赖链 + community 记账小助手演示门禁）
- 5 个 WS 命令（market_list / get / install / uninstall / installed）+ 前端 Market Tab（类型/信任分级过滤、递归依赖树、社区确认流、安装状态机）
- 根 vitest 配置纳入 gui-v2 测试；25 项市场 WS 冒烟通过

### 管家入口产品化（2026-08-04）
- 阶段 A 转接真实化：butler_task_updated 结构化广播 + 前端 handler、TaskReceiptCard 首次真实点亮、派发菜单结构化 dispatch_task（支持 Agent/Group）
- 阶段 B 首次问卷：OnboardingOverlay 兴趣问卷 → Creator 生成 1-2 个初始 Agent + Market 官方推荐 + 管家欢迎消息
- 阶段 C 管家模板 + 风格：ensureButlerDir 文件体系、固定 prompt → 文件 prompt（EXPERIENCE/记忆实时进 prompt）、4 人格模板（亲密朋友/专业秘书/学习陪伴/家庭助理）、butler_set_persona / butler_update_style + GUI 管家形象区
- 阶段 D 低打扰：推荐纪律写入 JOB.md（官方/认证轻量提示每会话 ≤1 次、社区需 confirmed、本地已有能力时闭嘴）
- 管家冒烟 19/19 + Market 回归 25/25；65 测试新增（runtime 9 + dispatch 10）

### GUI 能力清理、美观化与真实测试（2026-08-04）
- GUI 未接入能力清理：孤儿组件接入主视图（Agent 时间线 / 群组健康 / 唤醒队列 / 仪表盘活跃度柱状图）、技能执行真实链路（execute_skill）、沙箱监控真实指标（docker stats）、通知音效真实化（Web Audio + 系统通知）、回执卡片状态流转 + 群组派发回执
- GUI 全局美观化：4 审计 + 3 修复代理全量整改 ~60 组件（字号≥14px、留白≥20px、层次化、空态图标化、tab/按钮/列表行统一）；修复浏览器模式启动崩溃 P0（isTauri 守卫）
- 真实测试：与管家对话制作植物大战僵尸 demo，4 轮验证发现并修复 5 个真实 bug（reviewerCfg undefined 崩溃、沙箱镜像构建路径硬编码、镜像依赖链缺失、dockerCmd 30s 超时、Dockerfile.base UID 冲突）
- 修复 start.bat 端口清理失效（kill-cobeing-port.ps1 弃用 Start-Job+netstat，改用 Get-NetTCPConnection 同步查询）

---

## v1.3.1 (2026-05-26)

### 韧性修复
- **预启动残留清理机制**：三层防护彻底解决 Windows 删除文件残留（start.bat PowerShell 预清理 → 构造函数第一行 SQLite 连接前清理 → cleanupOrphanDirectories 防御纵深）
- **Agent 执行超时保护**：5 分钟兜底超时，防止 LLM 挂起时 WakeSystem 永久阻塞
- **WS 离线窗口冻结修复（第二轮）**：5s 离线宽限期 + pong 超时检测（5s 无响应→主动重连）+ 心跳不排队 + 重连加速（500ms→10s max）
- **`_abortController` per-session 隔离**：单字段→Map<string, AbortController>，修复多 session 并发 abort 竞态
- **`getStatus()` 恢复 "error" 状态返回**：新增 `_errorFlag` 追踪，启动新 run 时清除
- **`processingAgents` 参数透传**：wakeQueue.updateQueue 签名增加参数，防止活跃状态丢失

### 架构改进
- **Agent 并发架构重构**：全局 `_status` 互斥锁替换为 `_activeSessions: Set<string>`，支持多群组 + 独立对话并发
- **WakeSystem 跨群组并发**：忙碌检查仅限同群组 session，同一 Agent 在 groupA + groupB + main 三线并行
- **WebView2 后台节流抑制**：`--disable-background-timer-throttling` + `--disable-features=CalculateNativeWinOcclusion` 禁止 Windows 降级
- **仪表盘 Agent 来源修复**：`getActiveSessions()` → groupId 提取 → 前端正确区分群组活跃 vs 独立任务
- **Agent workspace 外部绑定**：butler/WS 路径 `bind_workspace` → `add_binding/remove_binding/list_bindings`

### 安全与稳定性
- **WS 连接稳定性**：应用层心跳 + visibility API + Tauri onFocusChanged + 指数退避重连（2s→30s max）
- **Agent 群组回复失败修复**：WakeSystem 增加 `agent.getStatus()` 检查，忙碌时自动重新入队（上限 10 次）
- **群组创建强化用户决策制**：4 步用户对接指引 + "用户为上"规则 + 群主职责"首要原则：用户决策制"
- **butler.ts 删除路径补齐**：新增 config.json rename 兜底防幽灵复活（对齐 ws-server/manager 逻辑）
- **Tauri onFocusChanged 泄漏修复**：对象包装器替代裸变量防解绑失效

### 工具增强
- **Agent workspace 外部绑定（bind）**：Agent 可 bind 到任意外部项目目录，工具自动指向外部目录

---

## v1.3.0 (2026-05-25)

### 新功能
- **插件系统（方案 10）**：`@cobeing/plugin-sdk` 包，PluginLoader 自动发现与加载，7 provider + 1 channel 内置插件包装器，附录插件清单
- **HRR 多策略记忆检索（方案 8）**：FTS5 + Jaccard + 时间衰减 + 信任反馈四阶段搜索评分管道，memory-feedback 工具动作
- **5 级权限体系（方案 5）**：ReadOnly → WorkspaceReadWrite → WorkspaceAccess → BasicAccess → FullAccess，bash 命令动态分级器，Agent 多工作区绑定
- **4 种 ToolAgent（方案 3）**：ReviewAgent（群组审核）/ JudgmentAgent（唤醒判断）/ CloneAgent（并行子任务）/ MemoryAgent（经验提取），独立 LLM 循环
- **bash 工具增强（方案 2）**：16384 字节输出截断保护，完整 grep 重写（output_mode / head_limit / 上下文 / multiline）
- **提示注入防御（方案 9）**：13EN+18CN+混合检测，围栏函数，write-file/memory-store 接入
- **GUIDE.md + EXPERIENCE.md 分离（方案 4）**：概要机制，群组对话自动注入指南，经验概要提取
- **精确 System Prompt（方案 1）**：分层 prompt 构建（STATIC / AGENT / VOLATILE），群组机制自动注入
- **共享常量文件**：DEFAULT_PROVIDER / DEFAULT_MODEL / MAX_* 等集中管理

### 安全加固
- CSP 启用（`default-src 'self'`），移除 `dangerouslySetInnerHTML`
- WebSocket 频率限制 + 消息体积限制 + 心跳机制
- 密钥 KDF 升级至 PBKDF2（100K 迭代 SHA-512），密钥文件 chmod 600
- bash 命令注入防御（shell 元字符转义）
- 路径包含性检查（read/write/edit-file 防逃逸 + 符号链接解析）
- 输入校验（名称长度 + 字符白名单）
- 只读模式白名单清理（移除 Remove-Item 等破坏性 cmdlet）
- 工作区绑定阻止根目录绑定

### 韧性改进
- WakeSystem dispose() 定时器清理
- LLM 熔断器（3次失败→60s 断路）
- `appendExperience` 原子写入（消除竞态）
- eventHistory / processedMsgIds / sessionLoops 上限修剪
- MemoryStore lazy init 失败自动重试
- ToolAgent 超时保护（120s 兜底）
- `readMasterRegistry()` 损坏时备份而非清空
- 通道消息注入群组审核管道
- 进程级 unhandledRejection / uncaughtException 处理器

### Bug 修复
- `__cobeingGetProvider` 全局未赋值 → 判断系统静默失效
- `registerTool()` / `registerMemoryBackend()` 空桩 → 全局注册表
- `buildProviders()` 绕过 PluginLoader → 异步加载 Provider 插件
- 权限模式名不一致（workspace-write vs workspace-readwrite）
- 时间衰减主导搜索 → 保留 30% 基础分
- `start.bat` 始终构建（`/fast` 跳过）
- 硬编码 deepseek → 自动 fallback 首个可用 provider
- 相对路径逃逸检测
- `feedback_action` 值校验

### 架构
- `packages/shared/src/constants.ts` — 集中化常量管理
- `PermissionEnforcer.mode` getter — 对外访问器
- 前端权限更新为 5 级新体系

---

## v1.2.0 (2026-05-13)

## v1.2.0 (2026-05-13)

- 精简 LLM Provider 列表（7 家厂商：DeepSeek / 智谱 / 通义千问 / MiniMax / 豆包 / Moonshot / MiMo）
- 精简 Channel 代码（仅保留 QQ Bot）
- 移除首次运行强制配置 .env 的要求
- 新手教程优化（"按需连接 LLM"引导）
- 预构建发布包（含 dist 不含 node_modules，8.9 MB）

---

## v1.1.1 (2026-05-08)

- 首个稳定版本
- 完整 Agent 生命周期管理
- 群组协作（WakeSystem + 三层记忆架构 + 审核管道）
- TODO 驱动自动化（三种触发模式 + 父子层级 + 依赖管理）
- 投票系统 + 经验沉淀
- 6 主题系统 + 仪表盘
- Office MCP 服务器（32 个办公工具）
- QQ Bot MCP 服务器（18 个工具）
