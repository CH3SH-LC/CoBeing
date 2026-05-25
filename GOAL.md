# CoBeing 项目愿景

> 最后更新：2026-05-08

---

## 一句话定位

**多智能体协作框架 — 让 AI Agents 组队干活。**

CoBeing 不是一个聊天机器人。它是一个让多个 AI Agent 以群组形式协作完成复杂任务的平台。用户通过自然语言与管家交互，管家管理 Agent 生命周期和群组协作。

---

## 核心设计原则

### 1. Agent 不是"助手"，是"队友"

每个 Agent 是有独立人格和判断力的个体，不是无脑执行工具。

- **SOUL.md** — 性格特质：怎么说话、怎么做事、边界在哪
- **CHARACTER.md** — 人物描写：姓名、背景、个性、口癖
- **JOB.md** — 工作职责：擅长什么、怎么判断、怎么工作
- 这些文件由 Agent 自我更新，在使用中成长

Agent 在群组中能主动求助、汇报进度、贡献经验，而非被动响应 @mention。

### 2. 群组是核心协作单元

群组是"项目工作组"而非"讨论组"，长期存在：

- 群主（Host Agent）负责任务分解、进度跟踪、协调仲裁
- 群成员通过 `group-send` 主动沟通，通过 `group-update-progress` 同步进度
- 子任务支持父子层级和依赖关系，上游完成自动触发下游
- 分歧通过投票表决解决，平局由群主仲裁
- 关键决策和经验沉淀到群组 EXPERIENCE.md，跨 Agent 共享

### 3. 管家是用户的第一联系人

用户不需要直接管理技术细节。管家（Butler Agent）是：

- 用户的首个对话入口 — 像朋友一样聊天，不啰嗦
- Agent 生命周期管理者 — 创建、配置、销毁
- 群组组织者 — 分析需求、推荐 Agent、组建团队
- 自然语言界面 — "帮我创建一个前端团队" 而不是填写表单

### 4. 本地优先，隐私第一

- 所有数据存储在本地 `data/` 目录，不上传任何云端
- API Key 加密存储（AES-256-GCM），WebSocket 仅绑定 localhost
- 沙箱执行（Docker）提供文件系统和网络隔离
- 可选本地模型（GGUF）做消息初筛，不需外部 API

### 5. 厂商无关，自由选择

支持 11 家 LLM 厂商，OpenAI-compatible 协议统一接入：

- Anthropic / OpenAI / Google Gemini / DeepSeek
- 智谱 GLM / 通义千问 / MiniMax / 豆包 / Grok / Moonshot / SiliconFlow
- 每个 Agent 可独立配置 Provider 和 Model
- 运行时热重载 Provider 配置

---

## 能力全景

### 已实现的核心能力

**Agent 系统**
- 完整的 Agent 生命周期（创建→运行→销毁）
- 自治文件系统（8 个核心文件 + 记忆目录）
- 系统 Prompt 分文件构建链（SOUL→BOOTSTRAP→role→AGENTS→USER→EXPERIENCE→MEMORY）
- 子智能体临时创建（SubAgentSpawner）
- 事件总线（Agent 间通过 @mention 通信）

**群组协作**
- GroupContextV2 tag-based 消息隔离（main 频道 + 私有讨论）
- WakeSystem 事件驱动唤醒队列（@mention → 入队 → 三层上下文 → 回复写回）
- 群主 Host Agent（任务分解、进度总结、决策记录、仲裁）
- 群组工作空间（TASK.md / PLAN.md / PROGRESS.md / MEMBERS.md / STRUCTURE.md）
- 依赖管理（子任务 dependsOn，上游完成自动通知下游）
- 投票表决（vote-create / cast / result，过半通过，平局仲裁）
- 经验沉淀（group-experience-add / summarize，跨 Agent 共享）
- Screener（可选双模型初筛，轻量 LLM 判断是否需要唤醒主模型）

**工具系统**
- 内置工具：bash / read-file / write-file / edit-file / glob / grep / web-fetch
- 群组工具：group-members / talk-* / group-send / group-update-progress
- TODO 工具：todo-add / list / complete / remove / review（支持 Agent 级和群组级）
- 投票工具：vote-create / cast / result
- 记忆工具：memory（add / replace / remove / read）
- 技能工具：skill-execute / list / create
- MCP 工具：mcp-discover / mcp-register
- 4 级权限系统：full-access / workspace-write / read-only / ask

**TODO 驱动自动化**
- Agent 级和群组级 TODO 列表
- 时间触发唤醒 + 逾期检测
- 依赖触发链（上游完成自动通知下游）
- 交付物验收（approve / rework）

**记忆与经验**
- 4 目标分层存储（memory / experience / user / tools），各自独立字符上限
- SQLite FTS5 全文搜索（CJK 分词）
- 冻结快照（会话内 system prompt 稳定）
- 安全扫描（prompt 注入 / 数据泄露 / 隐形字符检测）
- 原子文件操作（临时文件 + rename）
- 自动经验反思（LLM 提取问题-解决方案对）

**技能系统**
- SKILL.md 格式定义技能
- SkillRepository 统一仓库（list / get / create / search / execute）
- Agent 级技能白名单（config.json skills 字段）
- 内置技能：code-review / project-planning / group-coordination / agent-creation

**LLM 网关**
- 并发控制 + RPM 限制 + 超时重试
- 每 chunk 流式超时检测
- 多 Provider 热重载

**沙箱**
- Docker 容器隔离执行
- ContainerPool 容器复用
- 多语言运行时自动检测（.py / .js / .ts / .go / .sh）
- 网络白名单模式（iptables 规则）
- 安全加固（noNewPrivileges / readOnlyRootfs / cap-drop ALL）

**MCP 集成**
- 标准 MCP 协议客户端（JSON-RPC 2.0）
- Stdio / HTTP 双传输模式
- 动态工具发现与注册（mcp-discover / mcp-register）
- 已有对接：QQ Bot

**多渠道通信**
- QQ（OneBot v11 / QQBot Gateway）
- Discord（Gateway + REST API）
- 企业微信（HTTP 回调）
- 飞书（HTTP Events + API）

**前端**
- React 19 + Tauri 2.0 桌面应用
- Agent/Group 管理界面
- 群组聊天视图
- TODO 面板
- 主题系统（暗色/亮色切换）
- MCP 配置 UI

### 已明确未实现的能力

**子智能体**（P4，等待实现）
- 并行 spawn / 超时控制 / 资源配额 / 重试机制
- 上下文继承 / 结果回流 / 兄弟通信
- DAG 任务编排 / 结果聚合 / 条件分支 / 流式管道
- Token 消耗统计 / 执行日志 / 成本预警

**TOOLS.md 动态更新**（P1）
- Agent 使用工具后自动生成工具策略条目

**前端增强**（P2.5）
- 群组聊天历史滚动加载与搜索
- Talk 子讨论结果回流可视化
- Screener 过滤统计
- Agent 状态追踪时间线

**安全加固剩余项**
- seccomp/apparmor profile
- 沙箱状态监控

---

## 用户模型

### 角色

- **用户** — 平台的最终使用者，通过 GUI 或 Channel 与系统交互。只需要 LLM API Key，不需要技术背景
- **管家 (Butler)** — 系统的内置管理者，用户的第一个对话入口。管理 Agent 生命周期和群组组织
- **Host Agent (群主)** — 每个群组的协调者，负责任务分解、进度跟踪、仲裁
- **普通 Agent** — 执行具体任务的 AI 角色，每个有独立 JOB 和 CHARACTER

### 使用流程

```
用户                          管家                        群组
 │                            │                          │
 ├─ "帮我写个快排" ───────────►│（直接完成）               │
 ├─ "创建一个前端专家" ──────►│（创建 Agent）             │
 ├─ "组建一个开发团队" ──────►│（分析需求→创建 Agent →   │
 │                            │  创建群组→启动协作）───────►│
 │                            │   群主分解任务 ──────────►│
 │                            │   Agent A ←→ Agent B     │
 │                            │   讨论→执行→汇报         │
 │                            │   群主审核→合并          │
 │◄─── 群组产出 ──────────────│◄─────────────────────────│
```

---

## 架构哲学

1. **Agent 自治** — 每个 Agent 有自己的文件系统、记忆、工具集和 LLM 配置。Agent 自我更新性格文件（SOUL/CHARACTER/JOB），在对话中学习成长
2. **协作由事件驱动** — 消息触发 @mention 检测，唤醒队列调度，回复写回上下文后检查新 mentions。无需轮训或同步等待
3. **三层上下文** — 每次唤醒包含工作区文档（TASK/PLAN/PROGRESS）→ 压缩历史 → 最近消息，确保 Agent 有足够信息做判断
4. **无侵入式设计** — Agent 不需要知道自己在"框架"中。它们只需要正常对话和使用工具。协作上下文通过 system prompt 自然注入
5. **Prompt 缓存友好** — system prompt 分为共享前缀（跨 Agent 一致）+ Agent 前缀（生命周期内不变）+ 易变（记忆快照 + 协作上下文），最大化缓存命中率
6. **功能即工具** — 所有能力都通过工具暴露给 Agent。新增功能 = 注册新工具 + 写入 config.json 白名单
7. **不追求完全自动化** — 群主仲裁、投票平局、任务验收需要人工确认。系统协助而非替代人类判断

---

## 非目标

- **不是 Agent 框架库** — CoBeing 是一个完整应用，不是给开发者集成到自己项目中的 SDK
- **不是 AI 聊天客户端** — 核心价值是多 Agent 协作，而非单轮对话体验
- **不是 SaaS/云服务** — 不提供托管服务，不上传用户数据
- **不是无代码平台** — 用户通过自然语言交互，但底层技术细节（LLM 配置、工具权限）仍需基本理解
- **不追求"全自动"** — 关键决策点保留人工介入（仲裁、验收），不在不可逆操作上做完全自动化
