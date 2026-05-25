# CoBeing 版本发布记录

> 仅在新版本发布时维护。日常进度记录见 PROGRESS.md 和 PROGRESS-LITE.md。

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
