# CoBeing 版本发布记录

> 仅在新版本发布时维护。日常进度记录见 PROGRESS.md 和 PROGRESS-LITE.md。

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
