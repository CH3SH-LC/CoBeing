# CoBeing 开发进度（精简版）

> 标签：[New Feature] 新功能 / [Debug] 修复 / [Change] 变更
> 详细记录见 PROGRESS.md

---

## 2026-05-25

### 第二轮深度审计修复（P0+P1 共 12 项）

- [Debug] P0#1: bash.ts 命令注入硬化 — 新增 shell 元字符转义 + shellArgs 数组模式备选
- [Debug] P0#2: Tauri CSP 启用 — `"csp": null` → `default-src 'self'` 策略；TutorialOverlay `dangerouslySetInnerHTML` → FormattedText/SafeContent React 组件
- [Debug] P0#3: WS 频率限制 + 消息体积 — maxPayload 1MB + 每连接 60条/60秒 + send_message 2秒冷却
- [Debug] P0#4: secret-store KDF 升级 — 单次 SHA-256 → PBKDF2 (100K 迭代 SHA-512)；解密失败返回空串；密钥文件 chmod 600
- [Debug] P1#1: workspace.ts 原子写入 — atomicWrite/atomicAppend 替换 writeFileSync，消除 appendExperience/appendProgressEntry 读-改-写竞态
- [Debug] P1#2: WakeSystem dispose() — 新增 dispose() 清理定时器/队列/处理集合 + _disposed 守卫；Group.dispose() 调用
- [Debug] P1#3: WebSocket 心跳 — 服务端 30s ping + 10s pong 超时 → terminate
- [Debug] P1#4: LLM 熔断器 — conversation-loop.ts 静态 circuit breaker (3次失败→60s断路)
- [Debug] P1#5: 无界集合修剪 — eventHistory ≤1000 / processedMsgIds ≤5000 / sessionLoops 1h 空闲清理
- [New Feature] 共享常量文件 — packages/shared/src/constants.ts (DEFAULT_PROVIDER/MODEL/PORT 等)，6 个消费文件更新
- [Debug] 路径包含性检查 — read-file/write-file/edit-file 增加 path.relative() 逃逸检测 + realpath 符号链接解析
- [Debug] WS 输入校验 — agent/group 名称 ≥64字符+字符白名单；消息内容≥100KB

### 五维度审计修复（11 项）

- [Debug] 审计修复 #1: `__cobeingGetProvider` 全局未赋值 — runtime.ts 构造函数中赋值 `(globalThis as any).__cobeingGetProvider = (id) => this.providers.get(id)`，修复 wake-system.ts / group-scanner.ts 判断系统静默失效
- [Debug] 审计修复 #2: 插件 `registerTool()` / `registerMemoryBackend()` 空桩 — runtime.ts 实现全局注册表 (__cobeingPluginTools / __cobeingPluginMemoryBackends)，插件可注册工具和记忆后端
- [Debug] 审计修复 #3: `readMasterRegistry()` 损坏时返回空导致数据丢失 — master-registry.ts 损坏时重命名为 .corrupted 备份而非返回空 registry
- [Debug] 审计修复 #4: `buildProviders()` 绕过 PluginLoader — 新增 `loadProviderPlugins()` async 方法，start() 中调用，实际执行插件 register()
- [Debug] 审计修复 #5: 通道消息绕过群组审核 — startChannels() 群组绑定时注入 runReviewAgent 审核管道
- [Debug] 审计修复 #6: 权限模式名不一致 — base.ts 默认值 "workspace-write"→"workspace-readwrite"；executor.ts 传递真实权限模式；新增 PermissionEnforcer.mode getter；前端 2 组件更新为新 5 级体系
- [Debug] 审计修复 #7: 只读模式白名单含 Remove-Item — bash-classifier.ts 移除 Copy-Item/Move-Item/New-Item/Remove-Item，只保留 Test-Path/Get-* 等安全 cmdlet
- [Debug] 审计修复 #8: 工作区绑定未阻止根目录 — ws-server.ts FORBIDDEN 新增 `/^\/$/` 和 `/^[A-Z]:\\$/i`
- [Debug] 审计修复 #9: ToolAgent 无超时保护 — base.ts 兜底 AbortSignal.timeout(120s)，双重 abort 检查
- [Debug] 审计修复 #10: 时间衰减主导记忆搜索 — sqlite-adapter.ts ageFactor 保留 30% 基础分；halfLifeDays=0 防御；空查询返回 []；LIKE 回退用 Jaccard 替代无意义的长度比
- [Debug] 审计修复 #11（中优先级）: start.bat 始终构建（/fast 跳过）；wake-system.ts / group-scanner.ts deeepseek 硬编码改为 fallback 到首个可用 provider；bash-classifier.ts 新增相对路径逃逸检测；memory-store.ts lazy init 失败自动重试；group-tools.ts runReviewAgent 加 try/catch；memory-tool.ts feedback_action 校验

### 方案 10 — 插件系统
- [New Feature] 方案 10: 插件系统 — 新建 @cobeing/plugin-sdk 包，PluginLoader + 7 provider + 1 channel 内置插件包装器，runtime.ts 改为插件架构加载，417 tests pass
- [New Feature] 方案 10: 插件 SDK 类型定义 — types.ts（CoBeingPlugin / CoBeingPluginApi / 4 种插件接口 / PluginManifest），tsc 编译通过
- [New Feature] 方案 10: @cobeing/plugin-sdk 包脚手架 — 新建 packages/plugin-sdk，workspace 依赖 shared/providers/channels，tsc 编译通过

### 方案 8 — HRR 多策略记忆检索
- [New Feature] 方案 8 Task 7 Tests: sqlite-adapter 多策略搜索 + trust feedback 测试（9 tests）+ hrr.test.ts（6 tests），417/417 pass
- [New Feature] 方案 8 Task 7: runtime.ts 切换插件架构 — 扫描 plugins/providers/ 清单 + 自动发现 + 全局 registerProvider() 注册，416/417 tests pass
- [New Feature] 方案 8 Task 6: hrr.ts 桩 — HrrEncoder 接口 + StubHrrEncoder Phase 2 桩（dim=1024，全部方法 stub）
- [New Feature] 方案 8 Task 5: memory-feedback 工具动作 — feedback action + feedback_action 参数，searchAndFeedback 信任分调整 — SqliteAdapter + MemoryStore feedback 方法 + add() 重复降分 + reflectFromHistory() 加分（402 tests pass）
- [Debug] 方案 8: SQLite 适配器三修复 — NULL trust 防御 (`?? 0.5`)、批量 UPDATE 替代逐条写入、`halfLifeDays ?? 30` 允许 0 值
- [New Feature] 方案 8 Phase 1 (Tasks 1-3): schema 迁移 + Jaccard/temporal decay + searchEntries 三阶段评分管道重写（13 tests pass）

### 方案 5 — 权限分级免审批 + 工作区绑定
- [New Feature] 方案 5: 5 级权限（ReadOnly→FullAccess）+ bash 命令动态分级器 + Agent 多工作区绑定 + add/remove/list_binding WS 命令，19 tests pass
- [New Feature] 方案 5 Task 12: WorkspaceBindingSection 组件 — 展示 Agent 工作区绑定列表 + 添加/移除外部目录绑定 UI

### 方案 3 — 工具智能体系统
- [New Feature] 方案 3: 4 种 ToolAgent（审查/判断/复制/记忆），独立 LLM 循环，用完即毁 + 15 单元测试
- [New Feature] 方案 3 Task 7: tool-agent.test.ts — 15 个单元测试覆盖 base/judgment/review/memory，全部通过

### 方案 2 — 高效工具设计
- [New Feature] 方案 2 Task 3 (bash): 16384 字节输出截断保护 + bash.test.ts（4 tests pass）
- [Debug] 方案 2: grep 代码质量修复 — line-byline .trim() 移除 + multiline g flag 去重 + -- separator 测试
- [Debug] 方案 2: grep 上下文模式修复 — 输出前缀 dash→colon、删除错误 remaining 计数、searchDir→baseDir 双重拼接修复
- [New Feature] 方案 2 Task 2 (grep): 完整重写 — output_mode/files_with_matches/count + head_limit/offset 分页 + -A/-B/-C 上下文 + multiline dotAll + -i/-n 控制，18 tests pass
- [Debug] 方案 2 Task 1 (edit-file) 代码质量修复: replaceAll → shouldReplaceAll + 2 测试（长字符串截断 + 文件不存在），8 tests pass
- [New Feature] 方案 2 Task 1 (edit-file): replace_all 参数 + old/new 相等检查 + 英文错误消息 + 结构化输出，6 tests pass

### 方案 9 — 记忆安全 + 中英文注入防御
- [New Feature] 方案 9: security-scan.ts 扩充至 13EN+18CN+混合检测+围栏函数，write-file/memory-store 接入
- [New Feature] 方案 9 Task 1: 26 个 scanContent 威胁检测测试 — 英文/中文/混合/隐形字符全覆盖

### 方案 4 — GUIDE.md + EXPERIENCE.md 分离 + 概要机制
- [New Feature] 方案 4 Task 6: EXPERIENCE.md 模板更新 + 6 单元测试 — extractExperienceSummary (4) + maintainExperienceSummarySync (2)，模板加入概要标记
- [New Feature] 方案 4 Task 5: appendExperience 接入 maintainExperienceSummarySync — AgentFiles/GroupWorkspace 追加经验时自动维护概要区
- [New Feature] 方案 4 Task 3: extractExperienceSummary + maintainExperienceSummarySync — 概要区提取/维护工具函数
- [New Feature] 方案 4 Task 2: GUIDE.md 注入到 createGroupLoop volatile — Agent 群组对话时自动注入群组规则（≤4000 字符）
- [New Feature] 方案 4 Task 4: MemoryStore.formatForSystemPrompt 对 experience 目标使用 extractExperienceSummary（≤1500 字符），标签改为"工作经验概要"
- [New Feature] 方案 4 Task 1: GUIDE.md 模板创建 + GroupWorkspace 添加 guide 路径/readGuide()/writeGuide() + 群组初始化自动写入

### 方案 1 — 精确 System Prompt
- [Change] 方案 1 Step 5: 新增 buildStaticLayer（6 tests）+ GROUP_MECHANICS_NOTICE（2 tests），更新排序断言，修复过时文件头注释
- [Change] 方案 1 Step 3: buildStaticLayer() 集成到 buildSystemPromptFromFiles 头部，后续节编号 +1
- [Change] 方案 1 Step 2: buildStaticLayer() 集成到 buildCacheablePrompt sharedPrefix — 纯 AGENTS.md → STATIC 层 + AGENTS.md
- [Change] 方案 1 Step 4: GROUP_MECHANICS_NOTICE 注入 createGroupLoop — sharedPrefix 和 agentPrefix 之间注入群组机制说明
- [New Feature] 方案 1 Step 1: 新增 buildStaticLayer() + GROUP_MECHANICS_NOTICE 到 prompt-builder.ts

### 其他修复
- [Debug] 全项目五领域审计修复：C1 __cobeingObsDb / H1 符号链接逃逸 / H2 iptables 白名单 / H3 安全扫描扩展 / M2 bind_workspace 校验 / M5 readonly 模式 / M6 sandbox start / M7 缺失 WS 事件 / M8 WakeQueueSection / M9 WAL checkpoint
- [Change] 文档系统审计修复：后端能力清单 / 测试清单重写 / 待办标记已完成 / STRUCTURE.md 陈旧条目清理 + 缺失文件补全
- [Debug] 修复 start.bat 端口检查卡死：netstat 无 -p TCP + 无超时 → TCP 限定 + 15s 超时
- [Debug] 修复 start.bat `echo.` 语法错误 + CMD 块解析器将 echo 行内 `()` 误读为代码块边界
- [Debug] 修复 PowerShell $pid 变量冲突导致端口清理静默失败 → $procId

## 2026-05-21

- [Debug] 修复 Reviewer Agent 孤儿清理导致原生崩溃（STATUS_STACK_BUFFER_OVERRUN）：config.json 未写 + 未注册 → 收养而非删除
- [Debug] 修复 start.bat 端口清理不彻底：taskkill 缺 /T → 子进程残留

## 2026-05-20

- [Change] 架构整理：删除 44 项冗余（空目录/残留 dist/临时文件），消除 agent↔group 循环依赖，ws-server.ts 模块化
- [New Feature] 群组模板系统：7 个群组工作空间文件改为模板驱动（支持占位符替换）

## 2026-05-19

- [Debug] 修复模块化工作流竞态条件 + _onMessage 接线缺失 + 参数校验
- [New Feature] 模块化并行工作流：WakeSystem 并行入队、阶段驱动 PLAN.md、TODO 三种触发模式（time/0time/condition）
- [New Feature] 群组模块化接口系统（INTERFACE.md）：接口登记表 + 自动注入上下文
- [Debug] 修复 saveGroup 漏 reviewer 字段 + emitReviewLog 回调缺失
- [New Feature] 群组消息审核系统：Reviewer Agent 管道，消息发布前审核（最多 3 轮迭代）

## 2026-05-18

- [New Feature] 审核日志 WS 广播 + 前端 useWebSocket 处理（pending/passed/failed_override）
- [New Feature] 审核反馈自动经验注入：不通过时写入 Agent MEMORY.md
- [New Feature] group-send 审核拦截：消息发送前自动经 Reviewer 审查
- [New Feature] 群组自动创建/销毁 Reviewer Agent
- [New Feature] 审核管道核心逻辑（review-pipeline.ts）+ WakeSession 轨迹记录

## 2026-05-13

- [Change] 开源发布准备：精简 Provider（7 家）+ Channel（仅 qqbot）+ 教程优化 + v1.2.0 打包
- [Change] 智能体群组发言规范：禁止意图声明，强制发言前自检
- [Change] 樱花薄荷默认主题颜色锤炼（多轮迭代优化配色）

## 2026-05-12

- [New Feature] 主题系统重设计：3 浅色（樱花薄荷/晨曦琥珀/薰衣草雨）+ 3 深色（墨夜翡翠/子夜紫晶/熔岩暗金）
- [Debug] 修复浅色主题气泡无区别 + 基底过深
- [Change] 所有硬编码颜色迁移至主题 CSS 变量（15 个文件）
- [Debug] 补充修复：Tailwind 默认调色板 → 主题 token
- [Debug] 修复群组气泡样式与 Agent 气泡不一致
- [Debug] 修复侧栏切换视图时第二栏状态不同步
- [Change] 智能体/群组列表按最近发言时间排序
- [Change] 群组主窗口 / 仪表盘 / 设置界面美化（10 个文件）

## 2026-05-11

- [New Feature] Master Registry：统一 Agent/Group 注册表（registry.json），优先级 registry > 文件系统
- [Debug] 修复 addMember/removeMember 后 config.json 不持久化 → 重启丢失成员
- [Debug] 修复幽灵群组再次出现：内容级验证 + delete fallback 重命名
- [Change] WakeSystem 连发模式：fire-and-forget + _processingAgents Set 支持并发
- [Debug] 修复启动时版本不稳定（僵尸进程 + 跳过编译 + tsbuildinfo 缓存）
- [Debug] 修复先关终端导致对话数据丢失（shutdown 顺序竞态）
- [Debug] 修复无法销毁群组/智能体（Windows SQLite WAL 文件锁 + 目录残留复活）
- [Change] WakeSystem 队列同步处理 → 定时独立触发（每群组独立定时器）

## 2026-05-10

- [Change] 前端工具调用气泡合并（可折叠 ToolCallsGroup）
- [New Feature] 群组工作区：Agent 在群组上下文中文件工具指向群组 workspace
- [Debug] 修复群组工作区审计发现 3 项问题
- [Debug] 修复幽灵群组反复出现（restoreGroups 自动复活孤儿目录）
- [Debug] 修复 TODOboard 逾期检测 + @mention 双写 @@ 符号

## 2026-05-09

- [Debug] 全链路修复：前端对话持久化 + Agent 署名 + 幽灵群组（14 项修复）
- [Debug] 修复 save_chat_current 创建幽灵群组目录 → 僵尸群组泄漏循环
- [Debug] 审计修复：currentLoaded 超时兜底 + 渠道消息署名 + GroupMessageBubble 默认值
- [Debug] 修复前端对话丢失 + Agent 消息署名显示 "Assistant"（第二轮）

## 2026-05-08

- [Debug] 修复创建群组时唤醒策略：先唤醒群主对接而非全部组员 + Agent stop() 无法截停
- [New Feature] 输入框增强：斜杠命令（/new /clear /bind 等）+ @成员选择弹窗
- [New Feature] 活跃 Agent 面板 + 唤醒队列移到仪表盘 + 长消息截断展开
- [Debug] 修复前端侧边栏同步 + 消息滚动优化（首次 instant 跳底）
- [Debug] 修复群组 Agent 回复串窗（agent_response 缺 groupId）
- [New Feature] Agent workspace 外部绑定（bind）：工具指向外部项目目录
- [New Feature] 管家删除 Agent/群组完整能力（级联除名 + 广播 + 影响摘要）
- [Debug] 修复核心 Agent 数据保护 + 删除残留清理（4 层防御）
- [Debug] 修复 start.bat 编码混乱（chcp 65001 + pnpm 不加 call）
- [Debug] P2 可用性审计：talk-close 白名单缺失 + 前端审美违规（ring-2/字号/硬编码色）
- [New Feature] P2.5 前端增强：对话搜索 + Agent 时间线 + 数据导出 + 侧边栏自动刷新
- [New Feature] P2.4 群组协作细化：talk-close 结果回流 + Screener 统计 + 群组健康面板
- [New Feature] P2.2 TODO 看板 + 批量操作 + 到期提醒（前后端）
- [New Feature] P2.3 元技能体系（cognitive-toolkit / collaboration-mindset / learning-loop）
- [Debug] 第二次审计：P1 全模块 6 项修复（archiveGroup/completeGroup/observability/cache tokens 等）
- [New Feature] P1.1 Agent 自我进化（experience-reflect 扩展 + Skill 列表感知）
- [New Feature] P1.3 群组生命周期管理（active→completed→archived 状态机）
- [New Feature] P1.2 管家多步推理（system prompt 增强 + butler-check-group）
- [New Feature] P1.4 可观测性基础设施（ObservabilityDB + 仪表盘 5 卡片）
- [Debug] P0 缺口修复（统一启动入口 + 消息状态追踪 + Provider 自动降级 + 群组历史分页）
- [Debug] 安全审计与修复（10 项：WS 绑定 localhost/API Key 掩码/流式超时/密钥盐/沙箱 iptables 等）
- [Debug] 安全审计第二轮（update_config API key 掩码保护 + 全局变量注册）
- [Debug] 修复 Windows EPERM 测试失败（SQLite 未 close 导致 rmSync 失败）
- [Debug] 功能完整性审计（butler 群组工具注入 + todo-review + 工具描述修正）
- [Debug] 第三轮审计：资源泄漏 + 前端问题（stop() 清理/MCP 关闭/消息队列上限/全局变量泄漏）
- [New Feature] Agent 协作意识（待办 #13）：上下文增强 + 活跃状态 + 能力互补提示
- [New Feature] 主动协作行为（待办 #14）：group-send / group-update-progress 工具
- [New Feature] 任务分解与分派（待办 #15）：父子层级 + 依赖管理 + 验收机制
- [New Feature] 冲突解决与共识机制（待办 #16）：投票系统（vote-create/cast/result）
- [New Feature] 知识共享与经验传递（待办 #17）：group-experience-add/summarize

## 2026-05-07

- [Change] 管家 Agent 生成能力增强 + 群主管理能力增强（butler-modify-agent + 4 个 host 工具）
- [Change] 错误信息硬编码返回 + 前端唤醒队列显示
- [Debug] 修复群组工具调用轮数限制：移除 config/default.json 的 20 轮硬限
- [Debug] 修复启动时自动唤醒不该唤醒的 Agent + 唤醒队列显示正在回答状态

## 2026-05-01

- [New Feature] 群组三层记忆架构（GroupDB + CompressedHistory + summarize-phase 工具）
- [New Feature] Office MCP 服务器：Word/Excel/PPT 三件套（32 个工具）
- [Change] MCP 架构重构：全局管理器 + 按需发现注册（mcp-discover/mcp-register）
- [New Feature] QQ Bot MCP 服务器增强：富媒体/群管理/事件网关（18 个工具）
- [New Feature] QQ Bot MCP 服务器：Agent 调用 QQ 操作工具（5 个基础工具）
- [Debug] TODOboard 触发链路修复（事件广播 + WakeSystem + todo-complete 传参）
- [Debug] TODOboard 触发续期（markTriggered 后移 + tool_event 流式）
- [Change] 待办文档审计：同步代码实际状态
- [Debug] 审计报告全部修复（ConversationLoop 重建优化 / agent-message 工厂化 / TODO 去重）
- [Debug] restoreAgents 默认工具缺失 + 群组工具注入缺失
- [Debug] 功能可访问性审计：Agent/群组工具缺口（6 个缺口修复）

## 2026-04-30

- [Debug] 修复特定 Agent 被 @mention 后无法回复（错误恢复 + 错误广播）
- [Debug] agent_started 广播中 @mention 列表过量（按通道去重）
- [Debug] 启动时 GUI 无法加载列表（二次修复：启动后主动广播状态）
- [Debug] 群组上下文污染：多群组唤醒时上下文相互覆盖（RunOptions 隔离）
- [Debug] @mention 触发链路在日志中不显示（WakeSystem 广播 agent_started/completed）
- [Debug] restoreGroups 阻塞启动 + @mention 误匹配（pause/resume + 正则最少 3 字符）
- [Change] 日志活动项格式升级（结构化字段 + 准确渲染）
- [Debug] 群组 @mention 循环唤醒导致消息泛滥（队列去重 + appendSilent + @all 处理）
- [Change] 活动日志功能扩展（工具调用组/文件变更/TODO 变更）
- [Debug] 活动日志无法正常显示（改用 Zustand store 持久化）
- [Debug] 启动时智能体/群组列表偶现为空（端口探测 + 空状态自动重试）
