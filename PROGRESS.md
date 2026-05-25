# CoBeing 开发进度记录

## 2026-05-25

### 新增：权限分级免审批 + 工作区绑定（方案 5 / 窗口 A）

**变更原因**：将现有 4 级权限体系（full-access/workspace-write/read-only/ask）替换为 5 级免审批体系，新增 bash 命令动态分级器，支持多工作区绑定。Spec: `docs/superpowers/specs/2026-05-25-permission-system-redesign-design.md`，Plan: `docs/superpowers/plans/2026-05-25-permission-system-redesign.md`

**5 级权限**：ReadOnly → WorkspaceReadWrite → WorkspaceAccess → BasicAccess → FullAccess
**Bash 分级器**：正则匹配 — 极端危险(仅FullAccess)/高危(BasicAccess+)/只读白名单/路径逃逸(BasicAccess+)/其余(WorkspaceReadWrite+)
**多绑定**：Agent 支持多个外部目录绑定（各自 readonly/readwrite 模式），前端用户手动管理

**新增文件（3 个）**：
- `packages/core/src/tools/bash-classifier.ts` — Bash 命令动态分级器（classifyBash 纯函数，正则逐层匹配）
- `packages/core/src/tools/bash-classifier.test.ts` — 10 tests（FullAccess/ReadOnly/极端危险/高危/路径逃逸/Windows/PowerShell）
- `gui-v2/src/components/settings/WorkspaceBindingSection.tsx` — 工作区绑定 UI 组件

**修改文件（10 个）**：
- `packages/shared/src/types.ts` — PermissionMode 5 值枚举 + WorkspaceBinding 接口 + AgentConfig.bindings
- `packages/shared/src/master-registry.ts` — migratePermissionMode() 旧→新自动迁移
- `packages/core/src/tools/permission.ts` — 全量重写：5 级检查 + 多绑定路径 + bash 委托分级器
- `packages/core/src/tools/permission.test.ts` — 全量重写：19 tests（5级+多绑定+allow/deny）
- `packages/core/src/tools/bash.ts` — 无需改动（分级委托在 PermissionEnforcer 层完成）
- `packages/core/src/agent/agent.ts` — _boundWorkspace→_bindings 数组 + addBinding/removeBinding/clearBindings/loadBindings + 4 处 PermissionEnforcer 构造更新
- `packages/core/src/runtime.ts` — 3 处启动点调用 migratePermissionMode() + 旧模式引用修复
- `packages/core/src/api/ws-server.ts` — bind_workspace 替换为 add_binding/remove_binding/list_bindings 三命令
- `gui-v2/src/lib/types.ts` — PermissionMode 同步 + WorkspaceBinding 类型 + AgentInfo.bindings
- `gui-v2/src/stores/agents.ts` — updateAgentBindings store 方法
- `gui-v2/src/hooks/useWebSocket.ts` — binding_added/removed/list 三个 WS 事件处理

**验证**: pnpm build 6pkgs pass, pnpm test 397 pass (41 files), gui-v2 tsc --noEmit pass

---

### 新增：工具智能体系统（方案 3）

**变更原因**：实现 4 种临时、非持久化的工具智能体，在需要时创建、用完即毁。所有 ToolAgent 使用独立的 Provider.chat() 循环，不依赖 Agent 类。

**4 种 ToolAgent**：
1. **审查（Review）** — 重构自 review-pipeline.ts，改为临时 ToolAgent 模式。每次 group-send 时创建，审查通过后销毁
2. **判断（Judgment）** — 群组中非显式 @host 的群主提及先经过判断，避免无效唤醒（15s 超时默认唤醒）
3. **复制（Clone）** — 母体通过 agent-clone 工具创建分身并行工作（最多 5 个），禁止递归克隆和群组消息
4. **记忆（Memory）** — 个人模式（Agent 完成唤醒后异步触发）和群组模式（phase completion 触发）自动提取经验

**新增文件（8 个）**：
- `packages/core/src/agent/tool-agent/types.ts` — ToolAgent 类型定义
- `packages/core/src/agent/tool-agent/base.ts` — 独立 LLM 工具循环（runToolAgent + collectResponse）
- `packages/core/src/agent/tool-agent/review.ts` — 审查智能体（runReviewAgent + parseReviewOutput）
- `packages/core/src/agent/tool-agent/judgment.ts` — 判断智能体（runJudgmentAgent + 超时保护）
- `packages/core/src/agent/tool-agent/clone.ts` — 复制智能体（runCloneAgent + 受限工具集）
- `packages/core/src/agent/tool-agent/memory.ts` — 记忆智能体（runMemoryAgent + 双模式解析）
- `packages/core/src/agent/tool-agent/tool-agent.test.ts` — 15 个单元测试
- `packages/core/src/tools/agent-clone.ts` — agent-clone 工具定义

**修改文件（8 个）**：
- `agent.ts` — 注册 agent-clone 工具；暴露 getToolRegistry()；run() 后异步触发个人记忆智能体
- `group-tools.ts` — 审核拦截从 reviewPipeline() 改为 runReviewAgent()
- `manager.ts` — 移除 createReviewerAgent() + 6 处 Reviewer 生命周期代码
- `group.ts` — 移除 reviewerAgent 属性
- `wake-system.ts` — enqueueMentionWithJudgment() 集成判断智能体
- `group-scanner.ts` — phase completion 触发群组记忆智能体
- `current-md.ts` — 新增 getRecent(n) 方法
- `config/default.json` — 新增 judgmentModel

**删除文件（1 个）**：
- `group/review-pipeline.ts` — 逻辑迁移到 tool-agent/review.ts

**验证**: pnpm build 6pkgs pass, pnpm test 397 pass (41 files)

---

### Task 12: 前端工作区绑定 UI 组件

**变更描述**：创建 WorkspaceBindingSection 组件，展示 Agent 工作区绑定列表并支持添加/移除外部目录绑定。

**修改**：
- `gui-v2/src/components/settings/WorkspaceBindingSection.tsx`（新建）：React 组件 —
  - 展示默认工作区（data/agents/{id}/workspace）为只读行
  - 列出所有 WorkspaceBinding，显示路径、模式（读写/只读）和移除按钮
  - 空状态提示"未绑定外部目录"
  - 添加绑定表单：路径输入框 + 模式下拉选择 + 确认/取消按钮
  - 通过 CustomEvent `ws-send` 发送 add_binding / remove_binding 命令
  - 使用 useAgentsStore (Zustand) 读取 agent.bindings 数据

**验证**: `npx tsc --noEmit` 零错误通过

### Task 7: Tool Agent 单元测试

**变更描述**：为 tool-agent 模块编写单元测试，覆盖 base.ts (runToolAgent)、judgment.ts (runJudgmentAgent)、review.ts (parseReviewOutput)、memory.ts (runMemoryAgent) 四个核心模块。

**修改**：
- `packages/core/src/agent/tool-agent/tool-agent.test.ts`（新建）：15 个测试 —
  - runToolAgent: LLM 文本返回、工具执行与结果汇总、maxIterations 上限、AbortSignal 中断
  - runJudgmentAgent: 超时返回 wake_host=true、wake_host=false 解析、非 JSON 输出默认唤醒
  - parseReviewOutput: 有效 JSON(pass=true/false)、解析失败默认 pass=true、从文本提取 JSON
  - runMemoryAgent: "Nothing to save" 空返回、个人记忆解析、群组记忆带 interfaceUpdates、解析失败空返回

**验证**: pnpm test 397/397 pass (41 files), 15/15 tool-agent tests pass

## 2026-05-25

### bash 工具输出截断 + 测试

**变更描述**：为 bash 工具添加 16384 字节输出截断保护，防止大输出撑爆上下文窗口。同时新增 bash 工具的测试文件。

**修改**：
- `packages/core/src/tools/bash.ts`：
  - 新增 `MAX_OUTPUT = 16384` 常量
  - `executeLocal` 函数：stdout 和 stderr 均检查长度，超过 16384 字节时截断并追加 `[output truncated — exceeded 16384 bytes]` 标记
- `packages/core/src/tools/bash.test.ts`（新建）：4 个测试 — 简单命令执行、错误命令返回、输出截断、短输出不截断

**验证**: pnpm test 360/360 pass (39 files), 4/4 bash tests pass

### grep 工具两个代码质量修复 + 新增测试

**问题描述**：
1. 第 147 行 line-by-line 模式 `.trim()` 破坏行尾空白信息 — 用户可能依赖前导/尾随空白进行视觉对齐或精确匹配
2. 第 133 行 multiline 模式重复追加 `g` flag — `regex.flags + "g"` 当原 flags 已含 `g` 时产生 `"sgg"`（Flags.toString 可能合并没有问题的 flags，但规范上属于重复声明）

**修复**：
- `packages/core/src/tools/grep.ts`：
  1. 第 147 行 `lines[i].trim()` → `lines[i]`（保留原始行内容）
  2. 第 133 行 `regex.flags + "g"` → `regex.flags.replace("g", "") + "g"`（先去重再追加）
- `packages/core/src/tools/grep.test.ts`：新增 `--` separator 测试（非相邻匹配组间分隔符）

**验证**: pnpm test (grep) 19/19 pass, pnpm build 7pkgs pass

### grep 上下文模式三处合规修复

**问题描述**：grep 工具的上下文模式（`-A`/`-B`/`-C`）存在 3 处与 spec 不一致的 bug：
1. 上下文模式输出行前缀使用 `file-lineNum:`（dash）而非 `file:lineNum:`（colon），与非上下文模式格式不一致
2. 上下文模式末尾的 `... and N more results` 计数错误 — 用 output 行数（含上下文行）减去 match entry 数，单位不匹配
3. 上下文模式文件路径用 `searchDir`（已拼接 `path` 参数的目录）而非 `baseDir`（workingDir）解析，当用户传 `path: "subdir"` 时产生双重拼接 `workingDir/subdir/subdir/foo.ts`

**根因**：
1. 第 268 行 `file-${lineNum}:` 应为 `${file}:${lineNum}:`
2. 第 277-282 行 `outputCount` 统计的是输出行数（含上下文行），而 `entries.length` 是 match entry 数，二者单位不同
3. 第 240 行 `path.join(searchDir, file)` — `file` 路径相对于 `baseDir`，`collectMatches` 中 `relPath = path.relative(baseDir, fullPath)` 生成，因此应使用 `baseDir` 解析

**修复**：
- `packages/core/src/tools/grep.ts`：
  1. 第 267 行 `file-${lineNum}:` → `${file}:${lineNum}:`
  2. 删除第 277-282 行的错误 remaining 计算逻辑
  3. 第 239 行 `path.join(searchDir, file)` → `path.join(baseDir, file)`
  4. `buildContentWithContext` 签名移除 `searchDir` 参数，调用点同步更新

**验证**: pnpm test (grep) 18/18 pass, pnpm build 7pkgs pass

### Task 2 (grep 参数变更 + 条目收集重构 + 测试)

**变更原因**：方案 2 (tool enhancement) Task 2 — 完整重写 grep 工具以对齐 claw-code 的 grep 设计，新增输出模式、分页、上下文行、多行匹配等参数。

**修改文件**：
- `packages/core/src/tools/grep.ts` — 完整重写：参数 schema 新增 `glob`（替代 `include`，保留废弃别名）、`output_mode`（content/files_with_matches/count）、`head_limit`（默认 250，0=无限）、`offset`、`-A`/`-B`/`-C`（上下文行）、`multiline`（dotAll 模式）、`-i`（默认 true）、`-n`（默认 true）；execute 实现重构为收集 MatchEntry[] 再按 output_mode 分发到 4 个 builder；`collectMatches` 支持 line-by-line 和 multiline 两种模式；`buildContentOutput` / `buildFilesWithMatches` / `buildCountOutput` / `buildContentWithContext` 独立处理各输出模式的分页与截断
- `packages/core/src/tools/grep.test.ts` — 新建测试文件，18 个测试用例覆盖：content/files_with_matches/count 输出模式、head_limit/offset 分页截断、glob/include 过滤及优先级、-n 行号隐藏、-i 大小写控制、-A/-B/-C 上下文行、multiline 跨行匹配

**验证**: pnpm test 355 pass (38 files), pnpm build 7pkgs pass

### 方案 9: 记忆安全 + 中英文注入防御

**变更原因**：依据综合调研方案 9，扩展现有 `memory/security-scan.ts`，新增中文恶意注入模式、英文威胁模式、混合语言攻击检测和上下文围栏函数。防止 LLM 将注入的记忆内容当作指令执行。

**修改文件**：
- `packages/core/src/memory/security-scan.ts` — THREAT_PATTERNS 5→13（新增 disregard rules, bypass restrictions, deception_hide, read_secrets, ssh_backdoor, ssh_access 等）；新增 CN_THREAT_PATTERNS（18 个中文模式：忽略指令/忘记身份/角色劫持/越狱/语境嵌套/假系统消息/数据泄露/后门/提权 等）；INVISIBLE_CHARS 5→14（新增双向文本控制符）；新增 MIXED_THREAT_PATTERN（中英文混合注入检测）；新增 `wrapMemoryContent()` 和 `stripMemoryContext()` 围栏函数
- `packages/core/src/tools/write-file.ts` — 导入 scanContent，写入 MEMORY.md/EXPERIENCE.md 前执行安全扫描，拒绝匹配威胁模式的内容
- `packages/core/src/memory/memory-store.ts` — 导入 wrapMemoryContent，`formatForSystemPrompt()` 返回前包裹 `<memory-context>` 标签和 `[System note]`
- `packages/core/src/index.ts` — 新增导出 wrapMemoryContent / stripMemoryContext

**验证**: pnpm build 6pkgs pass, pnpm test 335 pass (42 security-scan tests)

### Task 1 (edit-file 增强): 测试 + 实现 edit-file 工具功能升级

**变更原因**：方案 2 (tool enhancement) Task 1 — 增强 edit-file 工具以对齐 claw-code 的设计，添加 replace_all 参数、old/new 相同时的错误检查、改进错误消息、结构化输出格式。

**修改文件**：
- `packages/core/src/tools/edit-file.ts` — 新增 `replace_all` 参数（boolean, 默认 false）到参数 schema 和 execute 实现；新增 `old_string === new_string` 检查返回错误 "must be different"；升级 "not found" 错误消息为英文含指导提示；替换成功后输出结构化格式（`Edit applied to {relPath}\\n- occurrences: {N}\\n- old: {preview}\\n- new: {preview}`）；保留 `isProtectedPath` 逻辑和工具名称不变
- `packages/core/src/tools/edit-file.test.ts` — 新建测试文件，6 个测试用例：单次替换、replace_all 替换所有出现、old==new 拒绝、not found 错误消息、多出现无 replace_all 拒绝、输出包含 old/new 预览

### Task 1 (edit-file) 代码质量修复: 变量重命名 + 新增测试

**变更原因**：修复 3 个代码质量问题 — `replaceAll` 变量遮蔽 `String.prototype.replaceAll`；缺少长字符串预览截断测试；缺少文件不存在错误路径测试。

**修改文件**：
- `packages/core/src/tools/edit-file.ts` — `replaceAll` 变量重命名为 `shouldReplaceAll`（避免遮蔽原生方法），更新 4 处引用
- `packages/core/src/tools/edit-file.test.ts` — 新增 2 个测试：长字符串 >80 字符预览截断测试、文件不存在返回错误测试（共 8 个测试）

**验证**: 8 tests pass, pnpm build pass

### Task 1 (security-scan): 扩展 scanContent 测试（26 新测试用例）

**变更原因**：为 security-scan.ts 新增 26 个威胁检测测试用例，覆盖英文/中文/混合/隐形字符攻击模式。当前所有新测试预期失败，等待 Task 2 添加对应模式后通过。

**修改文件**：
- `packages/core/src/memory/security-scan.test.ts` — 新增 26 个 it 测试（6 英文模式 + 17 中文模式 + 1 混合 + 2 隐形字符），9 个已有测试保持通过

### Task 6: EXPERIENCE.md 模板更新 + 单元测试

**变更原因**：Task 3 添加了 `extractExperienceSummary` 和 `maintainExperienceSummarySync` 工具函数。Task 6 更新 EXPERIENCE.md 模板（个人和群组）加入概要标记区，并为两个工具函数各添加 4+2 共 6 个单元测试。

**修改文件**：
- `config/templates/EXPERIENCE.md` — 在标题后插入 `<!-- EXPERIENCE_SUMMARY_START/END -->` 概要标记和 `## 经验概要` 节
- `config/templates/groups/EXPERIENCE.md` — 同上，在描述行后插入概要标记
- `packages/core/src/conversation/prompt-builder.test.ts` — 新增 `extractExperienceSummary` describe（4 tests）和 `maintainExperienceSummarySync` describe（2 tests）；import 中新增导入两个函数

### Task 5: appendExperience 接入 maintainExperienceSummarySync

**变更原因**：Task 3 添加了 `maintainExperienceSummarySync()` 概要维护工具函数。Task 5 将其接入 `AgentFiles.appendExperience()` 和 `GroupWorkspace.appendExperience()`，使每次追加经验条目时自动更新 EXPERIENCE.md 的概要区。

**修改文件**：
- `packages/core/src/agent/paths.ts` — `AgentFiles.appendExperience()` 重构：新建文件时写入 SUMMARY_START/SUMMARY_END 标记和概要行；追加时先 appendFileSync 再调用 `maintainExperienceSummarySync()` 重写概要；新增 import `maintainExperienceSummarySync`
- `packages/core/src/group/workspace.ts` — `GroupWorkspace.appendExperience()` 重构：section header 未找到时追加到末尾；写入后调用 `maintainExperienceSummarySync()` 维护概要区；新增 import `maintainExperienceSummarySync`

### Task 3: extractExperienceSummary + maintainExperienceSummarySync 工具函数

**变更原因**：为 EXPERIENCE.md 概要机制新增两个工具函数。`extractExperienceSummary` 从 EXPERIENCE.md 中提取概要区（有标记→标记间内容，无标记→回退全量兼容旧文件，超长时倒序截断保留最新条目）。`maintainExperienceSummarySync` 在概要区最前面插入新摘要行（无标记→自动创建标记包裹现有内容）。

**修改文件**：
- `packages/core/src/conversation/prompt-builder.ts` — 新增 `EXPERIENCE_SUMMARY_START` / `EXPERIENCE_SUMMARY_END` 常量、`extractExperienceSummary()` 和 `maintainExperienceSummarySync()` 导出函数

### Task 2: GUIDE.md 注入到 createGroupLoop volatile

**变更原因**：Task 1 在 GroupWorkspace 中添加了 readGuide() 方法。Task 2 将其接入 Agent 的群组 loop，使 GUIDE.md 内容在 Agent 处于群组上下文时自动注入到 system prompt 的 volatile 层。

**修改文件**：
- `packages/core/src/agent/agent.ts` — `RunOptions` 接口新增 `guideContent?: string` 字段；`createGroupLoop` snapshot 类型扩展 `guideContent`；`promptBuilder` 闭包内组装群组 volatile（GUIDE.md 4000 字符截断 + 协作上下文）；`_groupContextSnapshots` Map 类型扩展；`getGroupLoop` 新增 `guideContent` 参数并写入 snapshot
- `packages/core/src/api/ws-server.ts` — `handleMessage` 中 `agent.run()` 传入 `guideContent: groupMatch ? this.groupManager?.get(gId)?.workspace.readGuide() ?? undefined : undefined`
- `packages/core/src/group/wake-system.ts` — 两处 `agent.run()`（正常唤醒 + 错误重试）传入 `guideContent: this.getGroup?.()?.workspace.readGuide() ?? undefined`

### System Prompt 三层架构 Step 4：GROUP_MECHANICS_NOTICE 注入到 createGroupLoop

**变更原因**：Step 1 定义了 `GROUP_MECHANICS_NOTICE` 常量，Step 4 将其接入 agent.ts 的群组 loop。群组 Agent 在 `_sharedPrefix` 和 `_agentPrefix` 之间注入群组机制说明，非群组 Agent 不注入。

**修改文件**：
- `packages/core/src/agent/agent.ts` — import 新增 `GROUP_MECHANICS_NOTICE`；`createGroupLoop` 的 promptBuilder 中 parts 数组从 `[_sharedPrefix, _agentPrefix]` 改为 `[_sharedPrefix, GROUP_MECHANICS_NOTICE, _agentPrefix]`；`createLoop`（非群组）保持不变

### System Prompt 三层架构 Step 1：新增 buildStaticLayer() + GROUP_MECHANICS_NOTICE

**变更原因**：参照 claw-code 的 SystemPromptBuilder 五层结构，为 CoBeing 新增所有 Agent 共享的静态行为约束层（身份声明/系统机制/行为约束/执行安全/说话方式）和群组环境机制说明常量。

**修改文件**：
- `packages/core/src/conversation/prompt-builder.ts` — 新增 `buildStaticLayer()` 纯函数（5 节硬编码常量）和 `GROUP_MECHANICS_NOTICE` 导出常量

### System Prompt 三层架构 Step 5：测试更新 + 排序断言修复

**变更原因**：Steps 1-4 完成了系统提示重组（新增 STATIC 层/GROUP_MECHANICS_NOTICE），Step 5 更新测试文件以验证新架构。

**修改文件**：
- `packages/core/src/conversation/prompt-builder.test.ts` — 新增 `buildStaticLayer`（6 测试）和 `GROUP_MECHANICS_NOTICE`（2 测试）describe 块；3 个已有测试更新排序断言以反映新 STATIC → AGENTS → SOUL 顺序；import 更新以包含新导出
- `packages/core/src/conversation/prompt-builder.ts` — 修复过时的文件头注释（前缀顺序缺少 STATIC 层）

### System Prompt 三层架构 Step 3：buildStaticLayer 集成到 buildSystemPromptFromFiles

**变更原因**：Step 1-2 添加了 `buildStaticLayer()` 并集成到 `buildCacheablePrompt()`，但 `buildSystemPromptFromFiles()`（非缓存路径，供 `conversation-loop.ts` 使用）尚未包含静态层。Step 3 将其注入为该函数的首个 prompt 组件，确保所有路径都包含 5-section 行为规则层。

**修改文件**：
- `packages/core/src/conversation/prompt-builder.ts` — `buildSystemPromptFromFiles` 开头新增 `parts.push(buildStaticLayer())`；所有后续节编号注释 +1（1→2, 2→3, ..., 7-10→8-11）

### System Prompt 三层架构 Step 2：buildStaticLayer 集成到 buildCacheablePrompt

**变更原因**：Step 1 添加了 `buildStaticLayer()` 纯函数但未集成。Step 2 将其接入 `buildCacheablePrompt()` 的 `sharedPrefix`，确保所有 Agent 的共享前缀包含 5-section 行为规则层，实现真正的跨 Agent 缓存命中。

**修改文件**：
- `packages/core/src/conversation/prompt-builder.ts` — `sharedPrefix` 构造从纯 `AGENTS.md` 改为 `buildStaticLayer() + AGENTS.md`；`CacheablePrompt.sharedPrefix` 和 `buildCacheablePrompt` 的 JSDoc 同步更新

### 审计修复：全项目五领域交叉审查（17 项修复）

**变更原因**：启动 5 个并行审查 Agent（安全/架构/文档/可访问性/前端）对项目进行全方位审计，发现 1 致命 + 7 高危 + 15 中危问题。本轮修复了所有可操作的代码和文档问题。

**代码修复（10 项）**：

1. **[CRITICAL] `__cobeingObsDb` 从未赋值** — `runtime.ts` 中 `ObservabilityDB` 创建后未暴露到 `globalThis`，导致 `get_agent_timeline` WS 处理器永远返回"未初始化"。修复：`runtime.ts:91` 新增 `(globalThis as any).__cobeingObsDb = this.observabilityDB`；`stop()` 中新增清理
2. **[HIGH] 符号链接攻击绕过工作区限制** — `permission.ts` 的 `isWithinWorkingDir` 用 `path.resolve()` 不解析符号链接。修复：新增 `fs.realpathSync()` 解析存在路径的符号链接后再检查边界
3. **[HIGH] iptables 白名单完全无效** — `container-pool.ts` 的 `applyWhitelistRules` 在容器内执行 `docker exec containerId sh -c "iptables..."`，但 `DOCKER-USER` 是宿主机链。修复：改为在宿主机上直接 `spawn("iptables", ...)` 执行规则
4. **[HIGH] 安全扫描仅限记忆写入** — `security-scan.ts` 的 `scanContent()` 只在 `memory-store.ts` 调用。修复：在 `ws-server.ts` 的 `send_message` 处理器和 `agent-message.ts` 的 `execute` 方法中新增安全扫描
5. **[MEDIUM] `bind_workspace` 可绑定任意系统路径** — 修复：新增双重校验（仅限 dataRoot 内 + 禁止直接绑定 Agent 数据目录）
6. **[MEDIUM] `readonly` 权限模式无效** — 无 toolConfig 时所有工具回退 `{ allowed: true }`。修复：在 `permission.ts` 中新增 read-only 模式显式拒绝写操作
7. **[MEDIUM] `sandbox_action` 缺少 "start" case** — 修复：新增 `case "start"` 分支
8. **[MEDIUM] `ObservabilityDB.close()` 缺少 WAL checkpoint** — 修复：参照其他 SQLite close 模式，新增 `wal_checkpoint(TRUNCATE)` + `journal_mode = DELETE`
9. **[MEDIUM] 前端缺少 5 个 WS 事件处理器** — `workspace_bound`/`channel_bound`/`channel_unbound`/`skill_created`/`sandbox_action_result` 均未处理。修复：`useWebSocket.ts` 新增 5 个 case，均带 emitActivity 日志
10. **[MEDIUM] WakeQueueSection 独立 getWsClient() 访问不存在全局变量** — 修复：改为模块级 `_wsClient` 引用 + `setWakeQueueWsClient` 导出

**文档修复（7 项）**：
- `docs/项目信息/后端能力清单.md` — Provider 11→7 家、packages 4→5、tests 281→282
- `docs/项目信息/测试清单.md` — 21 files/152 tests → 36 files/282 tests
- `docs/项目信息/待办.md` — 标记 10 个已完成功能（P2.1 搜索/时间线/导出/刷新、P2.2 看板/批量/提醒/截断、P2.3 元技能体系、P2.4 talk回流/screener统计/健康面板）
- `STRUCTURE.md` — 删除 start-gui.bat、更新 6 个主题名、修正 qq-client.ts 位置（office→qqbot）、新增 office-engine.ts、删除不存在的 data/models/、新增 registry.json+observability/、新增缺失的 gui-v2 组件文件、tests 281→282

**修改文件（17 个）**：
- Modify: `packages/core/src/runtime.ts` — C1: __cobeingObsDb 赋值+清理
- Modify: `packages/core/src/tools/permission.ts` — H1: realpath 符号链接防御 + M5: read-only 拒绝写
- Modify: `packages/core/src/tools/sandbox/container-pool.ts` — H2: 宿主机 iptables
- Modify: `packages/core/src/tools/agent-message.ts` — H3: 安全扫描
- Modify: `packages/core/src/observability/observability-db.ts` — M9: WAL checkpoint
- Modify: `packages/core/src/api/ws-server.ts` — H3: send_message 扫描 + M2: bind_workspace 校验 + M6: sandbox start
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — M7: 5 个 WS 事件处理器
- Modify: `gui-v2/src/components/settings/WakeQueueSection.tsx` — M8: getWsClient 修复
- Modify: `docs/项目信息/后端能力清单.md` — H5+M14
- Modify: `docs/项目信息/测试清单.md` — H6+M15
- Modify: `docs/项目信息/待办.md` — H7
- Modify: `STRUCTURE.md` — M13

**验证**: pnpm build 6pkgs pass, pnpm test 282 pass

---

### 修复：start.bat 端口检查卡死 + `echo.` 语法错误 + 代码块内 `echo (..)` 解析冲突

**问题 1**：运行 `start.bat` 后卡在 `[INFO] Checking for existing CoBeing process on port 18765...` 不再继续。

**问题 2**（后果）：修复问题 1 后，脚本能通过端口检查但于 `此时不应有 .。` 语法错误退出。

**问题 3**（根因）：修复 echo. 错误后，脚本仍然失败，根因是 CMD 的块解析器在括号代码块内会统计 `echo` 行中的 `(` 和 `)` 为代码块边界。`else` 代码块中 `echo [INFO] Using pre-built packages (dist/ found, skipping build).` 的 `)` 被误读为 `else` 块的闭合括号，导致其后的 `echo/` 出现在块外、`else` 块的真正 `)` 变为孤儿括号，触发 `此时不应有 .。` 错误。

**根因分析**：
1. 原 `kill-cobeing-port.ps1` 使用 `netstat -ano`（无 `-p TCP`），列出全部协议（TCP/UDP/TCPv6/UDPv6），在连接数多的系统上可能很慢
2. 脚本无超时机制 — 若 `netstat` 因网络堆栈问题挂起，则永久阻塞
3. 无进程占用端口时脚本无任何输出，用户无法判断是否已完成
4. 即使端口空闲也会启动 PowerShell（冷启动延迟 2-5 秒），使端口空闲的常见情况也变慢
5. **Windows 11 CMD 中 `echo.` 会查找名为 `echo` 的文件** → 查找失败抛 `此时不应有 .。` 语法错误（10 处 `echo.` → `echo/` 替换）
6. **CMD 块解析器将 `echo` 行内的 `()` 视为代码块边界** — 这是所有测试函数中一致复现的根本原因

**修改文件**：
- Modify: `start.bat` — 新增 `netstat -ano -p TCP | findstr` 快速预检查，仅端口被占用时才调用 PowerShell；端口空闲时直接跳过；全部 `echo.` 替换为 `echo/`（Windows 11 CMD 兼容性）；全部 `::` 注释替换为 `REM`（防御性）；移除 `else` 块内 echo 消息中的 `(` `)` 括号避免 CMD 块解析冲突
- Modify: `scripts/kill-cobeing-port.ps1` — `netstat` 加 `-p TCP` 限定 TCP 协议；新增 `Start-Job` + `Wait-Job -Timeout 15` 15 秒超时机制；新增"No process found"/"Port is now free"/超时警告等诊断输出；`Stop-Process` 加 try/catch；`$procId` 空值检查；最终端口状态确认

**修改内容摘要**：
1. **start.bat 预检查**：`netstat -ano -p TCP > tmp && findstr /C:":%PORT% " tmp` 临时文件方式替代管道，避免 CMD 管道生成子进程可能导致的解析问题
2. **kill-cobeing-port.ps1 超时保护**：netstat 调用包装在后台 Job 中，`Wait-Job -Timeout 15` 保证最多 15 秒后继续
3. **诊断输出**：每个分支都有 `Write-Host` 输出，用户可明确看到脚本执行到哪一步
4. **错误处理**：`Stop-Process` 包在 try/catch 中，防止权限不足导致脚本崩溃
5. **`echo.` → `echo/`**：Windows 11 CMD 中 `echo.` 会在当前目录查找名为 `echo` 的文件，10 处全部替换为 `echo/`
6. **`::` → `REM`**：`::` 是标签的语法糖，并非正式注释语法，10 处全部替换为 `REM`
7. **代码块内 echo 消息移除 `()`**：`Using pre-built packages (dist/ found, skipping build).` → `Using pre-built packages - dist/ found, skipping build.` — CMD 块解析器将 `echo` 行内的 `)` 误算为块闭合，导致后续 `)` 成为孤儿括号

---


### 修复：start.bat 端口清理脚本 PowerShell 变量冲突

**问题描述**：`scripts/kill-cobeing-port.ps1` 使用 `$pid` 作为变量名，但 `$pid` 是 PowerShell 内置只读自动变量（当前进程 ID）。每次执行时报 `SessionStateUnauthorizedAccessException: VariableNotWritable`，导致端口清理静默失败，旧进程残留占用端口 18765，后续启动失败（EADDRINUSE）。

**根因分析**：PowerShell 中 `$pid` 是自动变量，不可写入。脚本中 `$pid = $parts[-1]` 触发了只读变量写入错误，整个 kill 逻辑被跳过。

**修改文件**：
- Modify: `scripts/kill-cobeing-port.ps1` — 两处 `$pid` 变量重命名为 `$procId`，避免与 PowerShell 内置自动变量冲突

---

## 2026-05-21

### 修复：start.bat 无法正常运行 — 两项根因

**问题 1 — Reviewer Agent 孤儿清理导致原生崩溃**：

**问题描述**：运行 `start.bat` 后 `pnpm dev` 进程崩溃，退出码 `3221226505`（0xC0000409，Windows STATUS_STACK_BUFFER_OVERRUN）。日志显示 `cleanupOrphanDirectories` 试图删除 Reviewer Agent 目录，`rmDirRecursive` 失败（ENOTEMPTY），随后进程原生崩溃。

**根因分析**：
1. `GroupManager.createReviewerAgent()` 创建 Reviewer Agent 时未写入 `config.json`，也未调用 `addAgentToRegistry()` 将其加入持久化 `registry.json`
2. 启动序列中 `cleanupOrphanDirectories()` 发现 Reviewer Agent 目录不在 registry 中且无 `config.json` → 判定为孤儿 → 调用 `rmDirRecursive()` 删除
3. 此时 Reviewer Agent 的 `memory.db` 仍被 better-sqlite3 持有，`rmDirRecursive` 中的 rename/delete 操作与原生 addon 的文件访问冲突 → 触发 STATUS_STACK_BUFFER_OVERRUN 崩溃
4. 这是一个**每次启动都发生**的自我维持损坏循环

**修改文件**：
- Modify: `packages/core/src/group/manager.ts` — `createReviewerAgent()` 新增 `agent.files.writeConfig()` 持久化 config.json + `addAgentToRegistry()` 注册到 master registry；`delete()` 中销毁 Reviewer 时新增 `agent.dispose()` + `removeAgentFromRegistry()` + `rmDirRecursive()` 完整清理
- Modify: `packages/shared/src/master-registry.ts` — `cleanupOrphanDirectories()` 新增防御：无 config.json 但含 Agent 典型文件（CHARACTER.md / JOB.md / memory.db）的目录改为"收养"（生成最小 config.json + 加入 registry），而非直接删除

**问题 2 — start.bat 端口占用清理不彻底**：

**问题描述**：上次运行的 CoBeing 进程（或崩溃残留）占用端口 18765，`start.bat` 的 `taskkill` 无法清理，导致后续启动因 `EADDRINUSE` 失败。

**根因分析**：
1. `taskkill /F` 缺 `/T` 标志 — 仅杀父进程，子进程（tsx/node）残留并继续占用端口
2. 无二次验证 — kill 后不检查端口是否真正释放
3. `%~dp0` 包含尾部反斜杠（如 `D:\agent-codes\CoBeing\`），在 GUI 模式的嵌套引号 `cmd /k "cd /d "%ROOT%" && ..."` 中可能被误解析

**修改文件**：
- Modify: `start.bat` — taskkill 增加 `/T` 标志（杀进程树）；新增 double-check 循环（kill → 等待 → 再扫描 → 仍有则再 kill）；去除 `%ROOT%` 的尾部反斜杠

---

## 2026-05-20

### 架构整理：文件夹结构重组 + 架构优化

**变更原因**：全项目审计发现 5 个空目录、28 个残留 dist 文件、agent↔group 编译期循环依赖、butler 模块分裂、ws-server.ts 上帝文件（83KB）、根目录临时文件、docs/ 重复内容、陈旧 cobeing/ 目录等结构问题。用户要求高度模块化。

**Phase 1 — 清理**:
- Delete: `packages/core/src/{groups,permissions,sandbox,session,subagents}/` — 5 个空目录
- Delete: `temporary.txt`(102KB), `package.json.tmp`, `.npmrc.tmp`, `Local.lnk` — 根目录临时文件
- Delete: `cobeing/` — 陈旧目录（Dockerfile 已在 sandbox/）
- Delete: `data/groups/g1/`, `g2/` — 幽灵群组残留
- Delete: `docs/参考/` — 与 config/templates/ 重复的 7 个文件
- Delete: `docs/临时skill/` — 与 skills/ 重叠的 11 个 SKILL.md
- Delete: `docs/待办.md` — 保留 `docs/待办新.md` 作为唯一
- Delete: `packages/channels/dist/{discord,feishu,wecom}/` + `qq/{onebot-client,qq-channel}.*` — 16 个残留编译产物
- Delete: `packages/providers/dist/{anthropic,gemini}/` + `catalogs/{grok,openai,siliconflow}.*` — 12 个残留编译产物
- Modify: `providers/package.json` — 移除未使用的 `@anthropic-ai/sdk` 依赖
- Modify: `scripts/build-sandbox.sh` — 修复 Dockerfile 路径 `cobeing/sandbox/` → `sandbox/`

**Phase 2 — 消除循环依赖**:
- Modify: `agent/butler.ts:13` — `import { GroupManager }` → `import type { GroupManager }`
- Modify: `group/review-experience.ts:1` — `import { Agent }` → `import type { Agent }`
- Modify: `group/review-pipeline.ts:2` — `import { Agent }` → `import type { Agent }`
- `butler.test.ts` 保留值导入（测试需要 `new GroupManager()`）

**Phase 3 — 统一 butler 模块**:
- Move: `butler/registry.ts` → `agent/butler-registry.ts`
- Move: `butler/registry.test.ts` → `agent/butler-registry.test.ts`
- Modify: `ws-server.ts`, `butler.ts`, `index.ts`, `integration.test.ts`, `runtime.ts`, `workflow/engine.ts` — 更新 6 处导入路径
- Delete: `butler/` 目录

**Phase 4 — ws-server.ts 模块化**:
- Organize: `ws-server.ts` switch 语句按功能分区（State & Monitoring / Message Routing / Configuration / Agent Lifecycle / Group Lifecycle）
- Create: `api/handlers/` 目录（预留模块化 handler 文件）

**已删除清单汇总**：5 空目录 + 4 临时文件 + 1 陈旧目录 + 2 幽灵群组 + 3 docs 重复项 + 28 残留 dist 文件 + 1 旧 butler 目录 = **44 项清理**

**验证**: pnpm build 6pkgs pass, pnpm test 281 pass (1 flaky: Windows SQLite EBUSY)

---

### 新增：群组模板系统

**变更原因**：Agent 创建时从 `config/templates/` 读取模板文件，但群组创建时 7 个工作空间文件内容全部硬编码在 `workspace.ts` 中，无法独立编辑和定制。参照 Agent 模板系统，为群组建立对等的模板文件系统。

**新增文件**：
- Create: `config/templates/groups/MEMBERS.md` — 成员列表模板
- Create: `config/templates/groups/STRUCTURE.md` — 项目结构模板
- Create: `config/templates/groups/TASK.md` — 任务描述模板
- Create: `config/templates/groups/PROGRESS.md` — 工作日志模板
- Create: `config/templates/groups/PLAN.md` — 执行计划模板
- Create: `config/templates/groups/EXPERIENCE.md` — 协作经验模板
- Create: `config/templates/groups/INTERFACE.md` — 群组接口模板

**修改文件**：
- Modify: `packages/core/src/group/workspace.ts` — 新增 `resolveTemplate` 静态方法 + `GROUPS_TEMPLATES_DIR` 常量；7 个 write 方法重构为"模板优先 + 硬编码兜底"
- Modify: `STRUCTURE.md` — `config/templates/` 区块新增 `groups/` 子目录；`data/groups/` 区块补全 EXPERIENCE.md / INTERFACE.md

**设计**：7 个模板文件支持 `{{groupName}}`、`{{groupId}}`、`{{ownerName}}`、`{{memberList}}`、`{{datetime}}`、`{{date}}`、`{{time}}` 等占位符。模板文件不存在时自动回退到原有硬编码逻辑，零破坏。

**验证**: pnpm build 6pkgs pass, pnpm test 282 pass

---

## 2026-05-19

### 审计修复：模块化工作流 — 竞态 + _onMessage 接线 + 参数校验

**问题 1 (HIGH)**: `wake-system.ts` 中 `_processingAgents.add()` 在 `executeWake` 的 async 操作后才执行，存在竞态 → 移至 `_tickQueue` 同步位置
**问题 2 (HIGH)**: `manager.ts` 中 `_onMessage` 字段缺失，`setOnMessage` 不存储回调，`create/restore` 不接线 → 补充字段+存储+全部创建/恢复路径
**问题 3 (MED)**: `tools.ts` 中 triggerMode=time 缺 triggerAt 或 condition 缺 conditionType → 新增校验返回 error
**问题 4 (LOW)**: `workspace.ts` 中 appendProgressEntry 的 indexOf('\n') 边界 -1 → fallback
**问题 5 (LOW)**: `group-scanner.ts` 中 corrupt condition todo 可抛 TypeError → 双重 optional chain
**修改文件**: `wake-system.ts` / `manager.ts` / `tools.ts` / `workspace.ts` / `group-scanner.ts`
**验证**: pnpm build 6pkgs pass, pnpm test 282 pass

---

### 大更新：模块化并行工作流系统

**变更原因**：群组协作需要支持并行工作、阶段驱动、接口依赖联动和模块化意识。

**设计文档**: `docs/superpowers/specs/2026-05-19-modular-workflow-design.md`
**实施计划**: `docs/superpowers/plans/2026-05-19-modular-workflow-plan.md`

**核心变更**：

1. **WakeSystem 并行入队**: enqueueMention 允许 processing 中的 Agent 重新入队，其他 Agent 或 Host 可以在 Agent 工作时 @mention 它
2. **PLAN.md 重写**: 阶段驱动（含模块依赖表、阶段计划、自检、用户审核截断），删除预计时间
3. **PROGRESS.md 重写**: 时间优先工作日志（日期→时间→@谁+做了什么）。新增 appendProgressEntry 方法
4. **TODOboard 三种触发**: time（定时）/ 0time（扫描即触发）/ condition（目标 Agent 发言→检查条件）
5. **模板更新**: SOUL.md 协作方式、AGENTS.md 模块化规则、prompt-builder Host 模块化段

**修改文件（13个）**:
- Modify: `wake-system.ts` — processing Agent 重新入队
- Modify: `workspace.ts` — writePlan/writeProgress 模板重写 + appendProgressEntry
- Modify: `todo/types.ts` — TodoItem 新增 triggerMode/condition/groupId；status 新增 expired
- Modify: `todo/store.ts` — 新增 getZeroTimeTodos/getConditionTodos
- Modify: `todo/group-scanner.ts` — 0time 扫描+重建 / condition 触发 / formatConditionTriggerMessage
- Modify: `todo/tools.ts` — todo-add 支持 triggerMode/conditionType/targetAgents/check/onFail
- Modify: `host-tools.ts` — host-decompose-task 默认 0time，SubTask 扩展新字段
- Modify: `group.ts` — 新增 _onMessage 回调和 setOnMessage，postMessage 触发 condition 扫描
- Modify: `manager.ts` — 新增 setOnMessage 方法
- Modify: `ws-server.ts` — 集成 condition TODO 扫描回调
- Modify: `prompt-builder.ts` — 模块化协作提示 + Host 模块化工作流段
- Modify: `SOUL.md` — 新增协作方式段
- Modify: `AGENTS.md` — 新增模块化工作规则段

**验证**: pnpm build 6pkgs pass, pnpm test 282 pass

---

### 新增：群组模块化接口系统（INTERFACE.md）

**变更原因**：多智能体协作中，不同 Agent 产出之间联系弱，缺乏结构化接口文档。新增 INTERFACE.md 作为群组级接口登记表。

**设计文档**: `docs/superpowers/specs/2026-05-19-group-interface-md-design.md`
**实施计划**: `docs/superpowers/plans/2026-05-19-group-interface-md-plan.md`

**核心机制**：
- 每个群组自动创建 INTERFACE.md，初始含所有成员的空 `##` 章节
- 新增成员时自动追加章节（删除成员不删章节，保留遗留接口）
- Agent 群组唤醒时 INTERFACE.md 自动注入到上下文（紧跟 PROGRESS 之后）
- BOOTSTRAP 新增行为提醒 6-7：读 INTERFACE.md + 更新自己章节
- 接口格式：`- 位置/标识 — 关键参数 — 具体用途`（每行一个可直接操作的接口条目）

**修改文件**：
- Modify: `packages/core/src/group/workspace.ts` — 新增 readInterface / writeInterface / appendInterfaceSection；interface 路径加入 GroupWorkspacePaths；initialize 自动创建；getSummary / readFile / writeFile 增加 interface 支持
- Modify: `packages/core/src/group/group.ts` — addMember 末尾调用 appendInterfaceSection
- Modify: `packages/core/src/conversation/prompt-builder.ts` — GroupWorkspaceData 新增 interface 字段；GROUP_CONTEXT 新增"群组接口"段
- Modify: `packages/core/src/group/wake-system.ts` — 传递 interface 到 buildGroupCollaborationContext
- Modify: `packages/core/src/api/ws-server.ts` — 同上
- Modify: `config/templates/BOOTSTRAP.md` — 行为提醒新增第 6、7 条

**验证**: pnpm build 6pkgs pass, pnpm test 282 pass

---

### 审计修复：saveGroup 持久化 + emitReviewLog 回调

**问题 1**：`GroupManager.saveGroup()` 写 config.json 时漏掉 `reviewer` 字段 → 自定义配置无法持久化
**问题 2**：`group-tools.ts` 审核逻辑中未调用 `emitReviewLog` → 前端审核日志事件永不触发
**修改文件**：`manager.ts`（saveGroup 增加 reviewer）、`group-tools.ts`（三个审核分支加入 emitReviewLog）
**验证**: pnpm build pass, pnpm test 282 pass

---

### 大更新：群组消息审核系统（审核 Agent 管道）

**变更原因**：智能体在群组中可能未实际工作就汇报进度（偷懒/画饼）、工作方法不符合要求。引入群组级审核系统，每条发往群组的消息需经 Reviewer Agent 审查通过后方可发布。

**设计文档**: `docs/superpowers/specs/2026-05-18-group-message-review-design.md`
**实施计划**: `docs/superpowers/plans/2026-05-18-group-message-review-plan.md`

**核心流程**：
- Agent → group-send 工具 → [审核管道拦截] → Reviewer 审查 → 通过发布 / 不通过返回反馈
- 不通过时在同一唤醒周期内迭代修正（默认最多 3 轮）
- 轮次耗尽后强制发布，带 ⚠️ 标记
- 审核反馈自动写入 Agent 的 MEMORY.md 作为经验

**新增文件**：
- Create: `packages/shared/src/review.ts` — 审核相关类型（ReviewerConfig, AgentTrace, ReviewInput, ReviewResult, ReviewLogEvent）
- Create: `packages/core/src/agent/wake-session.ts` — WakeSession 轨迹记录器（thinking + toolCalls + finalMessage）
- Create: `packages/core/src/group/review-pipeline.ts` — 审核管道核心（组装 ReviewInput → 调用 Reviewer → 返回结果）
- Create: `packages/core/src/group/review-experience.ts` — 审核反馈自动经验注入

**修改文件**：
- Modify: `packages/shared/src/types.ts` — GroupConfig 新增 reviewer 字段；AgentConfig 新增 isReviewer 标记
- Modify: `packages/shared/src/index.ts` — 导出 review 模块
- Modify: `packages/core/src/agent/agent.ts` — 集成 WakeSession；新增 reviewOnce/buildReviewPrompt/parseReviewResult 方法
- Modify: `packages/core/src/agent/wake-session.ts` — WakeSession 类
- Modify: `packages/core/src/conversation/conversation-loop.ts` — 记录 thinking 和 toolCall 到 wakeSession
- Modify: `packages/core/src/group/group.ts` — 新增 reviewerAgent 引用、getRecentMessages/getMentionsFor、_onMessageBroadcast 回调
- Modify: `packages/core/src/group/manager.ts` — create/delete/archive/restore 自动管理 Reviewer Agent 生命周期
- Modify: `packages/core/src/agent/paths.ts` — AgentFiles 新增 appendMemoryIndex 方法
- Modify: `packages/core/src/tools/group-tools.ts` — group-send 增加审核拦截（动态 import 避免循环依赖）
- Modify: `packages/core/src/api/ws-server.ts` — 新增 emitReviewLog 广播；group_message 传递 metadata
- Modify: `packages/core/src/config/schema.ts` — AppConfig 和 groups[] 新增 reviewer 配置验证
- Modify: `packages/core/src/runtime.ts` — 传递 provider 给 GroupManager
- Modify: `config/default.json` — 新增 reviewer 默认配置（enabled: true, maxRounds: 3）
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 处理 review_log 事件 + group_message metadata
- Modify: `gui-v2/src/lib/types.ts` — LogMessage 新增 metadata 字段
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 显示 ⚠️ 审核覆盖标记

**验证**: pnpm build 6pkgs pass, pnpm test 282 pass, gui-v2 build pass

**Agent 可访问性**：
- 审核功能通过 group-send 工具自动生效，无需 Agent 主动配置
- Reviewer Agent 标记 isReviewer=true，WakeSystem 自动跳过其 @mention 唤醒
- 审核开关通过群组 config.json 的 reviewer.enabled 控制



### 新增：配置 Schema 验证 + 边界情况处理（Task 9 + 10）

**变更原因**：群组消息审核系统需要配置 schema 验证确保 reviewer 配置格式正确，以及边界情况处理确保系统健壮性。

**修改文件**：
- Modify: `packages/core/src/config/schema.ts` — 导入 ReviewerConfig 类型，在 AppConfig 中新增顶层 `reviewer` 字段（全局默认）和 `groups[].reviewer` 字段（群组级覆盖）
- Modify: `config/default.json` — 新增顶层 `reviewer` 默认配置（enabled: true, maxRounds: 3），位于 groups 上方
- Modify: `packages/core/src/group/review-pipeline.ts` — reviewPipeline 外围新增 try/catch，Reviewer LLM 调用失败时放行（pass: true），不阻塞消息发送

**已验证的已有逻辑**：
- `agent.ts reviewOnce()` — 已有 try/catch，LLM 调用失败返回 `{ pass: true, reason: '' }`
- `manager.ts create()` — 已有 `enabled !== false && maxRounds !== 0` 检查，maxRounds=0 等价关闭审核
- `manager.ts restoreGroup()` / `restoreGroups()` — 同样具备边界情况处理

**可访问性**：
- Agent: Reviewer Agent 创建逻辑已有 LLM 失败容错（agent.ts reviewOnce try/catch）
- 群组: 不创建 Reviewer、LLM 调用失败均已处理，不阻塞消息发送
- 前端: 配置项定义在 AppConfig 类型中，可被配置加载器读取

**验证**: pnpm build pass (6/6 packages)

### 新增：前端群组消息气泡审核状态标记（metadata 端到端流程修复）

**变更原因**：Task 8 — 当消息审核轮次耗尽强制发布时（reviewOverridden: true），需要在群组消息气泡上显示警告标记。原组件已添加 UI 标记代码，但 metadata 字段从未传递到前端。

**根因分析**：Group.postMessage 在 ctxV2 中存储了 metadata（含 reviewOverridden），但 WebSocket 广播 group_message 时未包含 metadata 字段，LogMessage 类型也无 metadata 字段，导致前端永远读不到。

**修改文件**：
- Modify: `packages/core/src/group/group.ts` — 添加 `_onMessageBroadcast` 回调和 `setOnMessageBroadcast` 方法；`postMessage` 中调用回调传递 metadata
- Modify: `packages/core/src/group/manager.ts` — 添加 `_onMessageBroadcast` 字段，`setOnMessageBroadcast` 传播到所有群组；新创建和恢复群组也传播
- Modify: `packages/core/src/api/ws-server.ts` — `setOnMessageBroadcast` 回调广播 `group_message` 包含 metadata；现有两处 `group_message` 广播也增加 `metadata: undefined`
- Modify: `gui-v2/src/lib/types.ts` — `LogMessage` 类型增加 `metadata?: Record<string, unknown>`
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `group_message` 处理器将 metadata 传入 `addMessage`
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 将 `(msg as any).metadata` 改为类型安全的 `msg.metadata`

**可访问性**：
- Agent: 无变更，仅前端视觉展示
- 群组: reviewOverridden 标记通过 WS group_message 广播到前端，气泡自动显示标记
- 前端: GroupMessageBubble 使用 `msg.metadata?.reviewOverridden` 安全读取

**验证**: pnpm build pass, gui-v2 build pass

## 2026-05-18

### 新增：前端日志事件 — 后端 WS 广播审核事件 + 前端 useWebSocket 处理

**变更原因**：群组消息审核系统的日志需要在前端日志面板中显示。审核过程中的三个事件（pending/passed/failed_override）需要通过 WS 广播到前端。

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts` — 导入 ReviewLogEvent 类型，新增 emitReviewLog 方法，使用 broadcast 广播 review_log 事件
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 review_log 消息分支，将审核事件映射为活动日志条目（⏳等待审核/✅审核通过/⛔审核拦截），显示 Agent 名称、群组名称、轮次和原因

**可访问性**：
- Agent: 无变更，仅影响 WS 广播层
- 群组: 审核事件自动通过 WS 广播到前端日志面板
- 前端: useWebSocket hook 适配完毕，审核事件通过 emitActivity 出现在活动日志面板

**验证**: pnpm build pass (6/6 packages), gui-v2 build pass

## 2026-05-18

### 新增：审核反馈经验自动注入

**变更原因**：当 Review Agent 判定消息不合格时，自动将审核反馈写入 Agent 的 MEMORY.md 作为经验沉淀，使 Agent 后续唤醒时能从历史审核意见中学习。

**修改文件**：
- Add: `packages/core/src/group/review-experience.ts` — injectReviewExperience 函数，将审核反馈格式化为标准条目后追加到 Agent 的 MEMORY.md
- Modify: `packages/core/src/agent/paths.ts` — AgentFiles 新增 appendMemoryIndex 方法
- Modify: `packages/core/src/tools/group-tools.ts` — 在审核不通过的两个分支（可重试 / 轮次耗尽）中调用 injectReviewExperience，并导入该函数

**可访问性**：
- Agent: 经验注入自动在审核流程中完成，Agent 层面无感；后续唤醒时 MEMORY.md 中会携带历史审核反馈
- 群组: 经验注入自动集成在审核拦截路径中
- 前端: 无前端变更

**验证**: pnpm build pass (6/6 packages)

## 2026-05-18

### 新增：group-send 审核拦截

**变更原因**：在 group-send 工具的消息发送路径中增加 reviewPipeline 前置审核。Agent 发送消息到群组时将先经过 Reviewer Agent 审核，审核通过才发布，不通过则返回反馈给 Agent 修正重试，轮次耗尽后强制发布。

**修改文件**：
- Modify: `packages/core/src/tools/group-tools.ts` — makeGroupSendTool 新增可选 getAgent 回调参数；execute 方法在 group.postMessage() 前插入 reviewPipeline 审核拦截逻辑；新增 Agent / AgentGetter 类型导入
- Modify: `packages/core/src/agent/agent.ts` — injectGroupTools 中传入 Agent 实例引用给 makeGroupSendTool

**可访问性**：
- Agent: group-send 工具所有 Agent 均可使用，审核在内部自动进行，Agent 层面无感
- 群组: 审核拦截自动集成在群组消息发送路径中
- 前端: 无前端变更（Task 7 会添加日志事件支持）

**验证**: pnpm build pass (6/6 packages)

### 新增：群组自动创建/销毁 Reviewer Agent

**变更原因**：每个群组创建时自动创建一个 Reviewer Agent，群组销毁时自动销毁，实现群组消息审核系统的 Agent 生命周期管理。

**修改文件**：
- Modify: `packages/shared/src/types.ts` — AgentConfig 新增 isReviewer 标记
- Modify: `packages/core/src/group/manager.ts` — GroupManager 新增 createReviewerAgent 私有方法；create() 中自动创建 Reviewer；delete()/archiveGroup() 中自动销毁；restoreGroups()/restoreGroup() 中自动恢复
- Modify: `packages/core/src/runtime.ts` — 传递 provider 解析函数给 GroupManager，使其能创建 Reviewer Agent

**验证**: pnpm build pass (6/6 packages)

### 新增：审核管道核心逻辑（review-pipeline）

**变更原因**：实现群组消息审核系统的核心审核管道。审核管道负责组装审核输入（Agent 工作轨迹、群组上下文、工作区文档）、调用 Reviewer Agent 的一次性审核调用、返回审核结果。

**修改文件**：
- Create: `packages/core/src/group/review-pipeline.ts` — reviewPipeline 函数，组装 ReviewInput 并调用 reviewer.reviewOnce
- Modify: `packages/core/src/agent/agent.ts` — 添加 reviewOnce 方法（无状态 LLM 调用）、buildReviewPrompt、parseReviewResult 私有方法
- Modify: `packages/core/src/group/group.ts` — 添加 reviewerAgent 属性、getRecentMessages 方法、getMentionsFor 方法
- Modify: `STRUCTURE.md` — 添加 review-pipeline.ts 条目

**验证**: pnpm build pass (6/6 packages)

### 新增：WakeSession 唤醒周期轨迹记录

**变更原因**：群组消息审核系统中，Reviewer 需要审查 Agent 在本次唤醒周期内的全部工作轨迹（思考过程、工具调用及结果、最终回复），需要实现轨迹记录器。

**修改文件**：
- Create: `packages/core/src/agent/wake-session.ts` — WakeSession 类，提供 recordThinking/recordToolCall/getTrace/reset 方法
- Modify: `packages/core/src/agent/agent.ts` — 导入 WakeSession，添加 wakeSession 属性，在 run() 群组模式下初始化并注入到 ConversationLoop
- Modify: `packages/core/src/conversation/conversation-loop.ts` — 导入 WakeSession 类型，添加 wakeSession 属性，在 LLM 内容/reasoning 分块时记录 thinking，在工具执行完成后记录 toolCall
- Modify: `STRUCTURE.md` — 添加 wake-session.ts 条目

**验证**: pnpm build pass (6/6 packages)

## 2026-05-13

### 开源发布准备：LLM Provider 精简 + Channel 精简 + 新手教程优化 + v1.2.0 打包

**变更原因**：根据 LLM 连接指南调研结果精简 Provider 列表，删除废弃厂商和 Channel 代码，移除首次运行强制配置 .env 的要求，优化新手教程设计，打包可直接运行的 release。

**修改文件**：
- Modify: `packages/providers/src/catalogs/index.ts` — 移除 3 个厂商、新增 MiMo、修正 MiniMax/Moonshot 的 baseURL
- Create: `packages/providers/src/catalogs/mimo.ts` — 小米 MiMo 模型目录（4 个模型）
- Delete: `packages/providers/src/catalogs/{openai,grok,siliconflow}.ts` — 废弃厂商目录
- Delete: `packages/providers/src/{anthropic,gemini}/` — 废弃 Provider 实现
- Modify: `packages/providers/src/index.ts` — 移除 AnthropicProvider/GeminiProvider 导出
- Modify: `packages/providers/src/catalogs/catalogs.test.ts` — 更新测试预期
- Modify: `packages/shared/src/types.ts` — ModelTag 新增 `"agent"`
- Modify: `packages/core/src/config/schema.ts` — Provider type 精简为仅 openai-compat；Channel type 精简为仅 qqbot
- Modify: `packages/core/src/config/config-loader.ts` — DEFAULT_CONFIG providers 精简为 7 家
- Modify: `packages/core/src/runtime.ts` — 移除 Anthropic/Gemini 实例化；createChannel 精简为仅 qqbot；channel imports 精简
- Modify: `packages/channels/src/index.ts` — 仅导出 QQBotChannel
- Delete: `packages/channels/src/{discord,wecom,feishu}/` + `qq/{qq-channel,onebot-client}.ts` — 废弃 Channel 代码
- Modify: `config/default.json` — providers 精简 + channels 仅保留 qqbot + mcpServers 移除 office
- Modify: `.env.example` — API Key 变量精简
- Modify: `start.bat` — 检测到预构建 dist/ 时跳过 build 步骤
- Modify: `gui-v2/src/components/tutorial/TutorialOverlay.tsx` — 步骤4改为"按需连接 LLM"，移除"至少配置一个Provider才能使用"；间距对齐聊天气泡（px-8→px-6）
- Modify: `gui-v2/src/components/settings/ProvidersSection.tsx` — PRESETS 更新为 7 家厂商，移除 anthropic/gemini 类型选项
- Create: `releases/CoBeing-github/SETUP.md` — 运行前提与安装指南
- Create: `releases/CoBeing-v1.2.0.zip` — 预构建发布包（8.9 MB，含 dist 不含 node_modules）

**验证**: pnpm build 7pkgs pass, pnpm test 282 pass, gui-v2 tsc --noEmit pass

### 优化：智能体群组发言规范 — 禁止意图声明

**变更原因**：智能体在群组中频繁使用"我马上去做"、"我接下来处理"等意图声明，造成无效噪音。需要强制每个智能体在群组中回复前先自问"我需要做什么吗？我做过了吗？"，并禁止宣布未完成的行动。

**修改文件**：
- Modify: `config/templates/AGENTS.md` — 群组行为区新增"发言前的自检"章节，两道自问题 + 禁止意图声明规则；在"何时沉默"补充"想宣布意图 → 去做，不要宣布"
- Modify: `config/templates/SOUL.md` — "怎么不要说话"新增群组禁止预告式发言
- Modify: `packages/core/src/conversation/prompt-builder.ts` — "协作规则"首条新增自问规则和禁止意图声明

**验证**: pnpm build pass

### 主题微调：樱花薄荷默认主题颜色锤炼

**变更原因**：多轮用户反馈驱动，迭代优化默认主题的配色细节。

**调整记录**：

1. **薄荷绿与樱花粉饱和度过低** → `msg-assistant` `#EDF8F2`→`#DEFFF2`，`msg-user` `#FFF0F4`→`#FFE4EC`（后调整为 `#FFE8EF`），色彩特征更明显
2. **智能体和群组中的 Agent 名字不突出** → ChatView / GroupMessageBubble / ThinkingBubble 中 Agent 名称：`text-xs font-medium` → `text-sm font-bold`
3. **用户气泡偏暗** → `msg-user` `#FFE4EC`→`#FFF2F6`→`#FFE8EF`，增加粉色饱和度
4. **工具调用粉紫色嵌在薄荷绿气泡里不协调** → `text-purple`→`text-success`；`msg-tool` `#FDF5FA`→`#ECFAF4`；`code-bg` 同步调整为绿色调
5. **工具调用的绿色偏灰** → 主题 `success` 色 `#10B981`→`#059669`（深翠绿），工具调用文字更醒目
6. **背景色改为纯白** → base gradient `#FFFAFC→#F8FDF9` → `#FFFFFF→#FFFFFF`

**修改文件**：
- Modify: `public/themes/sakura-mint.json` — 多次迭代更新 chat/surface/content 颜色
- Modify: `src/styles/globals.css` — @theme block 默认值同步
- Modify: `src/components/chat/ChatView.tsx` — Agent 名 text-sm+font-bold；ToolCallsGroup `text-purple`→`text-success`
- Modify: `src/components/chat/GroupMessageBubble.tsx` — Agent 名 text-sm+font-bold；GroupToolCalls `text-purple`→`text-success`
- Modify: `src/components/chat/GroupChatView.tsx` — ThinkingBubble Agent 名 text-sm+font-bold
- Sync: `dist/themes/` — 每轮同步

**验证**: gui-v2 npm run build pass

## 2026-05-12

### 重新设计主题系统：3 浅色 + 3 深色

**变更原因**：原有 5 个主题（aurora-light/sakura/ocean-breeze/aurora-dark/midnight-steel）区分度不足，默认主题未同时体现樱花粉和薄荷绿。重设计为 6 个视觉鲜明区分的主题。

**新主题清单**：

| 文件 | 名称 | 类型 | 强调色 | 基底 |
|------|------|------|--------|------|
| `sakura-mint` | 樱花薄荷 | 浅色 ⭐默认 | 樱花粉 #EC4899 | 浅粉 → 浅薄荷绿渐变 |
| `amber-dawn` | 晨曦琥珀 | 浅色 | 琥珀金 #D97706 | 暖奶油 → 蜜桃色渐变 |
| `lavender-rain` | 薰衣草雨 | 浅色 | 薰衣草紫 #7C3AED | 淡紫灰 → 冷灰渐变 |
| `ink-jade` | 墨夜翡翠 | 深色 | 翡翠绿 #34D399 | 墨蓝黑 → 深灰渐变 |
| `amethyst-night` | 子夜紫晶 | 深色 | 紫罗兰 #C084FC | 紫黑 → 深紫渐变 |
| `ember-gold` | 熔岩暗金 | 深色 | 赤铜金 #F97316 | 暖黑 → 棕黑渐变 |

**修改文件**：
- Create: `public/themes/sakura-mint.json`, `amber-dawn.json`, `lavender-rain.json`, `ink-jade.json`, `amethyst-night.json`, `ember-gold.json` — 6 个新主题 JSON
- Delete: `public/themes/aurora-light.json`, `sakura.json`, `ocean-breeze.json`, `aurora-dark.json`, `midnight-steel.json` — 旧主题
- Modify: `public/themes/manifest.json` — 更新为 6 个新 ID
- Modify: `src/stores/theme.ts` — 默认主题 `aurora-light` → `sakura-mint`
- Modify: `src/styles/globals.css` — @theme block 和 :root 默认值同步为樱花薄荷主题
- Sync: `dist/themes/` — 同步新文件，清理旧文件

**验证**: JSON 校验通过，tsc --noEmit 通过，旧主题引用清零

### 修复：浅色主题气泡无区别 + 基底过深

**问题描述**：3 个浅色主题的 `msg-assistant` 全为 `#ECFDF5`（薄荷绿），切换主题时 Agent 气泡视觉不变；基底颜色过深导致气泡对比度不足。

**修改内容**：
- 大幅提亮 3 个浅色主题的 base gradient 和 surface 色（`#FFF0F3` → `#FFFAFC` 级别），气泡浮起感更强
- 每个浅色主题的 `msg-user` / `msg-assistant` 使用主题专属分隔色：
  - 樱花薄荷：用户=樱花粉 `#FFF0F4` / Agent=薄荷绿 `#EDF8F2`
  - 晨曦琥珀：用户=暖奶油 `#FFF8ED` / Agent=天蓝 `#EEF4FF`
  - 薰衣草雨：用户=淡紫 `#F5F0FF` / Agent=薄荷 `#EDF8F4`
- 3 个深色主题的 `msg-assistant` 也同步调至主题专属深色

**修改文件**：
- Modify: `public/themes/sakura-mint.json` — 全色重新设计
- Modify: `public/themes/amber-dawn.json` — 全色重新设计
- Modify: `public/themes/lavender-rain.json` — 全色重新设计
- Modify: `public/themes/amethyst-night.json` — msg-assistant `#181E18` → `#1A1624`
- Modify: `public/themes/ember-gold.json` — msg-assistant `#182018` → `#1C1814`
- Modify: `src/styles/globals.css` — @theme/:root 默认值同步

**验证**: gui-v2 npm run build pass, pnpm test 282 pass

### 重构：所有硬编码颜色迁移至主题 CSS 变量

**变更原因**：前端多个组件中存在硬编码的十六进制颜色值（`#1A1B26`、`#f59e0b`、`#a78bfa` 等），无法随主题切换而变化，且违反"不硬编码颜色"的设计原则。

**新增 CSS 变量**：
- `--color-white`, `--color-warning-fg` — 语义色补充
- `--agent-0` ~ `--agent-9` — Agent 身份色板
- `--code-header-bg`, `--code-header-fg`, `--hljs-*` — 代码块/语法高亮变量

**修改文件（15 个）**：
- Modify: `gui-v2/src/styles/globals.css` — 新增变量定义 + hljs 迁移
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — ToolCallsGroup `#a78bfa` → `text-purple`
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — AGENT_COLORS → CSS vars; `#6EE7B7` → `var(--color-success)`; `#a78bfa` → `text-purple`
- Modify: `gui-v2/src/components/shared/CodeBlock.tsx` — `#282c34`/`#abb2bf` → CSS vars
- Modify: `gui-v2/src/components/settings/AgentTimeline.tsx` — `#f59e0b` → `var(--color-warning)`
- Modify: `gui-v2/src/components/settings/ChatSearch.tsx` — `#f59e0b`/`#d97706` → warning CSS vars
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — `#7AA2F7`/`#1A1B26` → `bg-accent text-white`
- Modify: `gui-v2/src/components/settings/ThemeSelector.tsx` — `#FFFFFF` → `var(--color-white)`
- Modify: `gui-v2/src/components/tutorial/TutorialOverlay.tsx` — 全套 Tokyo Night → 主题 token
- Modify: `gui-v2/src/components/todo/Clock.tsx` — `#fff` → `var(--color-white)`
- Modify: `gui-v2/src/components/todo/TodoStatusBadge.tsx` — 硬编码色 → warning/purple token
- Modify: `gui-v2/src/components/todo/TodoKanban.tsx` — 同上
- Modify: `gui-v2/src/components/todo/TodoItem.tsx` — `#f59e0b` → warning token
- Modify: `gui-v2/src/components/todo/TodoPanel.tsx` — `rgba(245,158,11,...)`/`#d97706` → warning CSS vars

**验证**: gui-v2 tsc --noEmit pass，grep 确认组件文件中零硬编码颜色残留

### 补充修复：Tailwind 默认调色板 → 主题 token

**问题描述**：初轮替换遗漏了使用 Tailwind 内置调色板的类名（`text-green-400`、`text-amber-400`、`bg-green/10`、`bg-black/10` 等），这些不映射到 @theme 变量，无法随主题切换。

**修改文件**：
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — ToolCallsGroup 详情面板 `bg-black/10` → `bg-hover`
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — 已完成徽章 `bg-green/10 text-green` → `bg-success/10 text-success`
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — @all 选项 `text-amber-400` → `text-warning`
- Modify: `gui-v2/src/components/group/GroupHealthPanel.tsx` — 阻塞时间 `text-amber-500` → `text-warning`
- Modify: `gui-v2/src/components/settings/UsageMonitor.tsx` — 6 处 Tailwind 色值（green-400/yellow-400/red-400）→ success/warning/danger

**验证**: gui-v2 tsc --noEmit pass，grep 确认所有 Tailwind 默认调色板 class 已清零



### 修复：群组气泡样式与 Agent 气泡不一致

**问题描述**：GroupMessageBubble 与 ChatView 的 MessageBubble 在圆角、内边距、最大宽度、水平偏移等方面不一致。

**根因**：GroupMessageBubble 使用 `rounded-xl` / `px-5 py-4` / `max-w-[72%]`，而 ChatView MessageBubble 使用 `rounded-2xl` / `padding: 16px 24px` / `max-w-[70%]`，且缺少 40px 水平偏移。

**修改文件**：
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 统一 rounded-2xl + 16px/24px padding + 70% max-width + 40px 偏移；talk summary 用主题 token 替换硬编码色值；系统消息对齐 ChatView 格式

**验证**: gui-v2 tsc --noEmit pass

### 修复：侧栏切换视图时第二栏（列表）状态不同步

**问题描述**：通过 NavBar 切换到智能体/群组视图时，第二栏（Sidebar）显示列表但无选中项，主窗口不加载内容，必须再手动点击列表项。

**根因分析**：
1. `NavBar.setActiveView()` 只切换视图类型，不自动选择首个项目
2. `MainContent` 的 useEffect 在 `activeConv` 为空时跳过自动选择逻辑
3. `selectedAgent`/`selectedGroup` 与 `activeConversation` 未在视图切换时联动

**修改文件**：
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — 新增 useEffect 自动选择首个项目；AgentList/GroupList 内部函数化

### 改进：智能体/群组列表按最近发言时间排序

**变更原因**：列表原按后端返回顺序（大致按创建时间）排列，不便于快速找到活跃对话。

**修改文件**：
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — AgentList/GroupList 按 `chatStore.messageStore` 中最新的消息时间戳降序排序，无消息的项排到末尾，同时间的按首字母

### 美化：群组主窗口 / 仪表盘 / 设置界面

**问题描述**：群组主窗口（GroupChatView）的输入框、思考指示器、工具调用展示均不如 Agent 聊天界面精致；仪表盘卡片使用了非标准主题 token（bg-surface-elevated、shadow-sm），与设计系统不一致。

**变更内容**：
1. GroupChatView：输入框改为居中 60% 宽度布局（对齐 ChatView）；新增 animated ping 思考指示器；新增 GroupThinkingBubble 组件
2. GroupMessageBubble：新增工具调用展示（GroupToolCalls 组件），对齐 Agent 聊天的 ToolCallsGroup
3. 仪表盘：TokenCard/LatencyCard/ToolRankCard/AgentActivityCard/DashboardView 统一使用 bg-surface + border-bdr/40 + var(--shadow-surface)，替换 bg-surface-elevated/shadow-sm 等非标准 token
4. 全局：修复 text-[9px]/text-[10px] 为 text-xs（TokenCard 日期标签、AgentActivityCard 计数标签）

**修改文件（10 个）**：
- Modify: `gui-v2/src/components/layout/Sidebar.tsx` — Bug 1/2 的 useEffect + 排序
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — 居中输入 + 动画思考气泡
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 工具调用展示 + ToolEvent 类型引入
- Modify: `gui-v2/src/components/observability/DashboardView.tsx` — token 标准化
- Modify: `gui-v2/src/components/observability/TokenCard.tsx` — token 标准化
- Modify: `gui-v2/src/components/observability/LatencyCard.tsx` — token 标准化
- Modify: `gui-v2/src/components/observability/ToolRankCard.tsx` — token 标准化
- Modify: `gui-v2/src/components/observability/AgentActivityCard.tsx` — token 标准化

**验证**: gui-v2 tsc --noEmit pass

## 2026-05-11

### 架构重构：Master Registry — 统一 Agent/Group 注册表

**变更原因**：Agent 恢复从 `AGENTS_REGISTRY.md` 读，群组恢复从 `data/groups/` 目录扫描——两个不对齐的注册源导致幽灵群组反复复活。用户要求建立统一 config，优先级 config > 文件系统。

**设计方案**：
- 新增 `data/registry.json` 作为单一真相源，记录所有 Agent/Group 的 id/name/role/members/status
- 启动时：读 registry → 按 registry 恢复 → 清理文件系统中不在 registry 的孤儿目录
- 首次启动：从现有文件系统自动生成 registry.json（迁移）
- 所有 CRUD：先更新 registry.json，再操作文件系统
- `data/agents/{id}/config.json` 保持不变（自治配置：provider/model/tools/skills）
- `data/groups/{id}/config.json` 降级为次要副本

**修改文件（8 个）**：
- Create: `packages/shared/src/master-registry.ts` — 类型定义 + read/write/add/remove/update 函数 + migrateFromFilesystem + cleanupOrphanDirectories
- Modify: `packages/shared/src/index.ts` — 导出新模块
- Modify: `packages/core/src/runtime.ts` — restoreAgents 改用 registry；start 中新增迁移 + 孤儿清理
- Modify: `packages/core/src/group/manager.ts` — restoreGroups 改用 registry（不再扫描目录）；create/delete/completeGroup/archiveGroup/restoreGroup 全部更新 registry
- Modify: `packages/core/src/api/ws-server.ts` — create/destroy agent/group + add/remove member 全部更新 registry
- Modify: `packages/core/src/agent/butler.ts` — butler-create/destroy-agent + butler-add-to-group 更新 registry
- Modify: `packages/core/src/group/host-tools.ts` — host-invite/remove-member 更新 registry

**优先级规则**：registry.json > 文件系统。启动时若 registry 有记录但目录/config 缺失，自动补齐。若目录存在但不在 registry 中 → 孤儿删除。

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：群组 addMember/removeMember 后 config.json 不持久化 → 重启丢失成员

**问题描述**：通过 butler 工具或 host 工具添加/移除群组成员后，重启应用成员变更丢失。

**根因分析**：
`group.addMember()` / `group.removeMember()` 仅修改内存中的 `this.config.members` 和 MEMBERS.md，但 3 个入口缺了 `saveGroup()` 调用：
- `butler-add-to-group` (butler.ts:575)
- `host-invite-member` (host-tools.ts:320)
- `host-remove-member` (host-tools.ts:363)
而 WS 路径（`add_group_member` / `remove_group_member`）有正确的 `saveGroup()`。
此外 `destroy_agent` 的级联除名（butler/WS 两处）也未保存群组 config.json。

**修改文件**：
- Modify: `packages/core/src/agent/butler.ts` — `butler-add-to-group` 新增 `groupManager.saveGroup()`；`butler-destroy-agent` 级联路径新增 `groupManager.saveGroup(g.id)`
- Modify: `packages/core/src/group/host-tools.ts` — `host-invite-member`、`host-remove-member` 新增 `gm.saveGroup()`
- Modify: `packages/core/src/api/ws-server.ts` — `destroy_agent` 级联路径新增 `this.groupManager.saveGroup(g.id)`

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：幽灵群组再次出现 — restoreGroups 内容级验证 + delete fallback 重命名

**问题描述**：幽灵群组 g2（显示为"b"）已修复两次（5/9、5/10）但仍出现在前端侧边栏。

**根因分析**：
1. g2 的 `config.json` 是旧 `restoreGroups()` 自动生成的（`{id:"g2", name:"b", members:[]}`），但两次手动清理都未成功删除
2. 现有三道防线全部被绕过：
   - `restoreGroups` 孤儿检测：g2 **有** config.json → 不是孤儿
   - `save_chat_current` 过滤：g2 **已注册**在 groupManager → 保存是正确行为
   - `delete()` fallback unlink：若 `unlinkSync` 也失败 → config.json 残留
3. **核心矛盾**：检测依赖 config.json 存在与否，但 g2 的 config.json 是旧 bug 产生的"合法伪装"

**修改文件**：
- Modify: `packages/core/src/group/manager.ts` — `restoreGroups()` 新增内容级幽灵检测：空成员 + 无 context.jsonl → 清理目录；`delete()` fallback 增加 rename 兜底（unlink 失败 → rename to .deleted）
- Modify: `packages/core/src/api/ws-server.ts` — `destroy_agent` fallback 同步增加 rename 兜底

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：WakeSystem 连发模式 + 审计修复 _processingAgents

**变更原因**：`_tickQueue` 仍检查 `if (this.processing) return`，导致上一个 Agent 不完成下一个不触发。用户设计是定时器每 10s 必取 1 个出队触发，不等待。

**修复**：
1. `_tickQueue` 从 `async` (await executeWake) 改为 `fire-and-forget`（不等待，不检查 processing）
2. `_currentProcessing: string | null` → `_processingAgents: Set<string>`（支持并发追踪）
3. `getQueue()` 新增 `processingAgents: string[]` 字段，前端可获知所有正在运行的 Agent
4. 移除 `processing` 字段和 `isProcessing` getter 中的 `processing` 检查
5. 向下游传递 `processingAgents`：Group.getWakeQueue → GroupManager.getAllWakeQueues → WS get_wake_queue / wake_queue_update

**修改文件**：
- Modify: `packages/core/src/group/wake-system.ts` — fire-and-forget _tickQueue；_processingAgents Set；清理 processing 字段
- Modify: `packages/core/src/group/group.ts` — getWakeQueue 返回类型对齐
- Modify: `packages/core/src/group/manager.ts` — getAllWakeQueues 传递 processingAgents
- Modify: `packages/core/src/api/ws-server.ts` — wake_queue_update + get_wake_queue 传递 processingAgents

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：启动时版本不稳定（僵尸进程 + 跳过编译 + tsbuildinfo 缓存）

**问题描述**：启动后有时运行新版代码，有时运行旧版，表现不一致。

**根因分析（3 项）**：
1. **僵尸进程**：之前启动的 Node 进程未完全退出，仍占用端口 18765。`start.bat` 端口探测认为服务已就绪 → GUI 连上运行旧代码的僵尸进程
2. **跳过编译**：`start.bat` 仅在 dist/ 不存在时构建，dist/ 存在时跳过 → 代码修改后重启不经 `pnpm build`，直接使用旧 dist
3. **tsbuildinfo 缓存**：`packages/shared/tsconfig.tsbuildinfo` 增量编译缓存可能让 tsc 跳过某些文件的重新编译

**修改文件**：
- Modify: `start.bat` — 启动前 `netstat` + `taskkill` 杀掉占用 18765 的旧进程；移除 dist 存在检查 → 每次启动强制 `pnpm build`
- Delete: `packages/shared/tsconfig.tsbuildinfo` — 删除增量编译缓存

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：先关终端导致对话数据丢失（shutdown 顺序竞态）

**问题描述**：先关窗口再关终端 → 数据正常；先关终端（自动关窗口）→ 对话丢失/幽灵群组。

**根因分析**：
1. `runtime.stop()` 原顺序：先 dispose Agent/Group → 最后关 WS
2. 先关终端 → SIGINT → `stop()` 立即 dispose → WS 关闭 → 窗口被迫关闭 → `beforeunload` 触发 → 但 `ws.connected` 已为 false → `save_chat_current` 静默丢弃
3. 反之先关窗口 → `beforeunload` 时 WS 仍在 → 保存成功

**修复**：
1. **Backend**: `wsServer.stop()` 改为异步 — 先广播 `server_shutting_down` 信号给所有客户端 → 等待 800ms → 再关闭 WS
2. **Backend**: `runtime.stop()` 重排顺序 — 先停 WS（触发前端 flush）→ 再停 Scanner/Channel/Agent/Group
3. **Frontend**: 新增 `server_shutting_down` 事件处理 — 收到信号立即 flush `save_chat_current`

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts` — `stop()` 改为 async，新增 shutdown 广播 + 800ms 等待
- Modify: `packages/core/src/runtime.ts` — `stop()` 重排顺序，WS 最先停止
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 `server_shutting_down` handler 立即 flush

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass, gui-v2 build pass

---

### 修复：无法销毁群组/智能体（Windows SQLite WAL 文件锁 + 目录残留复活）

**问题描述**：通过 UI 删除群组或 Agent 后，重启又出现。死去的群组轮流复活。

**根因分析**：
1. SQLite WAL 模式产生 `-wal` / `-shm` 文件，Windows 上 `close()` 后可能延迟释放
2. `rmDirRecursive` 删除 `-shm` 文件失败（EBUSY/EPERM）→ 整个目录残留
3. 目录中仍有 `config.json` → 下次 `restoreGroups()` 恢复为正式群组 → 永久复活循环
4. `Group.dispose()` 遗漏了 `agentMemories` 中每个 Agent 独立 SQLite 的关闭

**修改文件（5 个）**：
- Modify: `packages/core/src/group/group-db.ts` — `close()` 增加 `pragma wal_checkpoint(RESTART)` 强制 WAL 落盘释放文件
- Modify: `packages/core/src/group/agent-memory.ts` — `close()` 同上
- Modify: `packages/core/src/memory/sqlite-adapter.ts` — `close()` 同上（Agent memory.db）
- Modify: `packages/core/src/group/group.ts` — `dispose()` 新增遍历 `agentMemories` 逐个 close，再关闭 groupDb
- Modify: `packages/core/src/group/manager.ts` — `delete()` 中 `rmDirRecursive` 失败时，兜底删除 `config.json` 防止复活
- Modify: `packages/core/src/api/ws-server.ts` — `destroy_agent` 同上兜底
- Modify: `packages/shared/src/fs-utils.ts` — `rmDirRecursive` 升级为 Node.js 22+ `fs.rmSync({ maxRetries: 10, retryDelay: 300 })` 原生重试，手动重试作为兜底

**完整 SQLite 关闭清单**：
| 数据库 | 文件 | close() 调用者 | WAL checkpoint |
|--------|------|---------------|----------------|
| GroupDB | `data/groups/<id>/memory/group.db` | Group.dispose() | ✅ |
| GroupAgentMemory | `.../memory/{agentId}.db` | Group.dispose() → 遍历 agentMemories | ✅ |
| MemoryStore | `data/agents/<id>/memory/memory.db` | Agent.dispose() → MemoryStore.close() | ✅ |

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：WakeSystem 队列同步处理 → 定时独立触发 + 审计修复

**问题描述**：
1. `processQueue()` 使用 `while` 循环一口气串行处理全部排队 Agent，上一个不完成下一个不触发
2. 所有群组的队列看似"混在一起"（实际是每个 WakeSystem 独立队列被同步阻塞导致无法并发）
3. 触发间隔为 5 秒而非设计的 30 秒

**审计发现并修复 3 项**：
1. `evaluateForOwner` 向队列添加群主后未启动定时器 — 若队列原本为空，群主永久卡在队列中。修复：添加 `_ensureTimer()` 调用
2. `_tickQueue` 若 `executeWake` 意外抛异常，`processing` 永不重置 → 队列永久卡死。修复：加 `try/finally` 保护
3. `wakeDelayMs` 降为 10000（10 秒）

**设计方案**：
- `wakeDelayMs` 默认值从 5000 → 10000（10 秒）
- `processQueue()` 从 `while` 循环改为 `_tickQueue()` 定时模式：`setInterval` 每 10 秒取 1 个 Agent 出队唤醒
- 新增 `_ensureTimer()` / `_stopTimerIfIdle()` — 队列有项时自动启动定时器，空时自动停止
- `pause()` 清除定时器，`resume()` 恢复定时器
- 移除 `executeWake()` 内部的多余 `delay()`（定时器已保证间隔）
- **每个 WakeSystem（= 每个群组）拥有独立定时器**，不同群组并发运行、互不阻塞

**修改文件**：
- Modify: `packages/core/src/group/wake-system.ts` — 新增 `_wakeTimer` 字段、`_ensureTimer()`、`_stopTimerIfIdle()`、`_tickQueue()`；重写 `processQueue()` 为定时器启动入口；`wakeDelayMs` 默认 5000→30000；`pause()`/`resume()` 管理定时器；移除 `executeWake()` 内 delay 调用和 `delay()` 方法

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---



### 修复：PermissionEnforcer 默认 fallback 从 ask 改为 workspace-write

**问题描述**：PermissionEnforcer 路径修复后，部分 Agent 在群组中仍完全无法工作（不调用任何工具），而另一些正常。

**根因分析**：
Agent 创建的默认权限是 `{ mode: "workspace-write" }`，但 `getGroupLoop()`、`handleIncomingMessage()`、`rebuildExecutor()` 和构造函数中 `PermissionEnforcer` 的 fallback 是 `{ mode: "ask" }`。若 Agent 的 config.json 未显式设置 permissions 字段，Ask 模式无 allow 列表 → **所有工具被静默拒绝**。

**修改文件**：
- Modify: `packages/core/src/agent/agent.ts` — 5 处 `{ mode: "ask" }` → `{ mode: "workspace-write" }`（与 Agent 创建默认值对齐）

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass

---

### 修复：群组 Agent 工具调用全部被拒绝（PermissionEnforcer 路径解析不一致）

**问题描述**：群组中 Agent 被唤醒后不调用任何工具，直接回复"我要直接开始做了"，无任何文件变更。

**根因分析**：
1. `isWithinWorkingDir()` 中 `path.resolve(targetPath)` 相对于 CWD 解析路径，而工具端 `write-file`/`edit-file` 中 `path.resolve(context.workingDir, params.path)` 相对于 `workingDir` 解析
2. 两者解析出不同路径 → 当 LLM 传入相对路径（如 `"TASK.md"`）时，PermissionEnforcer 解析到 `<CWD>/TASK.md`，不匹配 `<CWD>/data/groups/<id>/workspace/` → 拒绝
3. 群组工作区功能将 PermissionEnforcer 的 `workingDir` 从 Agent 工作区改为 Group 工作区，但**此 bug 早在 Agent 工作区就已存在**
4. 此前 LLM 可能使用绝对路径恰好匹配了 Agent 工作区，但群组工作区是全新路径，绝对路径无法匹配 → **所有写入操作被拒** → Agent 反复收到"权限不足"后放弃，回复文本

**修改文件**：
- Modify: `packages/core/src/tools/permission.ts` — `isWithinWorkingDir()` 改为先 `path.resolve(workingDir)`，再以此为基准 `path.resolve(resolvedWorking, targetPath)`，与工具端路径解析逻辑对齐
- Modify: `packages/core/src/tools/permission.test.ts` — 新增相对路径测试（`"output.txt"` 应通过，`"../outside.txt"` 应拒绝）
- Modify: `packages/core/src/agent/agent.ts` — `clearGroupLoop()` 回退到原行为（仅清历史不删 loop），避免错误恢复路径丢失上下文

**验证**: pnpm build 6pkgs pass, pnpm test 282 tests pass, gui-v2 build pass

---

## 2026-05-10

### 优化：前端工具调用气泡合并

**变更原因**：Agent 对话窗口中每次工具调用渲染为独立卡片，多个工具调用占据大量屏幕空间，且显示在所有消息底部（与回复分离）。

**设计方案**：在 `LogMessage` 上新增 `toolCalls?: ToolEvent[]` 字段，`finalizeStream` 时捕获当前 `toolEvents` 并附加到助手消息上，在 `MessageBubble` 中渲染为可折叠的工具调用组（位于回复内容上方）。

**修改文件**：
- Modify: `gui-v2/src/lib/types.ts` — `LogMessage` 新增 `toolCalls?: ToolEvent[]`
- Modify: `gui-v2/src/stores/chat.ts` — `finalizeStream` 捕获 `toolEvents`，附到新消息的 `toolCalls` 字段，然后清空 `toolEvents`
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — 移除独立的 `toolEvents.map(ToolCallMessage)` 渲染；新增 `ToolCallsGroup` 组件（内联），显示"X/Y 次工具调用"折叠卡片，展开后列出每个工具名称+状态，点击单独展开查看参数和结果；移除 `ToolCallMessage` import 和 `toolEvents` store subscription

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

---

### 新功能：群组工作区 — Agent 在群组上下文中指向群组 workspace

**变更原因**：群组中 Agent 被 @mention 唤醒后，文件工具（bash/read-file/write-file/edit-file/glob/grep）的 workingDir 错误地指向 Agent 个人工作区（`data/agents/<id>/workspace/`），而非群组工作区（`data/groups/<id>/workspace/`）。

**设计方案**：让 Group 拥有与 Agent 完全对称的 workspace 机制（`_boundWorkspace` / `effectiveWorkspace` / `workspaceDir` / `setBoundWorkspace()`），通过 `RunOptions.workingDir` → `getGroupLoop()` → `createGroupLoop()` → `ConversationLoopConfig.workingDir` → `ToolExecutor.execute()` → 文件工具 `context.workingDir`。

**修改文件**：
- Modify: `packages/core/src/group/group.ts` — 新增 `_boundWorkspace`、`workspaceDir` getter、`effectiveWorkspace` getter、`boundWorkspace` getter、`setBoundWorkspace(dir)`；构造函数中 `fs.mkdirSync(workspaceDir)` 确保目录存在；新增 `import fs from "node:fs"`
- Modify: `packages/core/src/agent/agent.ts` — `RunOptions` 新增 `workingDir?: string`；`createGroupLoop()` 新增 `workingDir` 参数（取代硬编码 `this.effectiveWorkspace`）；`getGroupLoop()` 新增 `workingDir` 参数（用于 PermissionEnforcer 和传递给 createGroupLoop）；`run()` 传递 `options.workingDir`
- Modify: `packages/core/src/group/wake-system.ts` — `executeWake()` 正常执行和错误重试路径两处 `agent.run()` 新增 `workingDir: this.getGroup?.()?.effectiveWorkspace`
- Modify: `packages/core/src/api/ws-server.ts` — `send_message` 处理器群组路径 `agent.run()` 新增 `workingDir`

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

---

### 修复：群组工作区审计发现 3 项问题

**问题描述**：群组工作区功能审计发现 3 项关联问题。

**修改文件**：
- Modify: `packages/core/src/agent/butler.ts` — ButlerAgent ConversationLoop 硬编码 `this.paths.workspaceDir` → 改为 `this.effectiveWorkspace`（与 Agent.createLoop() 一致，支持 bind 后生效）
- Modify: `packages/core/src/agent/agent.ts` — `clearGroupLoop()` 改为 `delete` 整个 loop（含 snapshot），而非仅清空历史。下次 `getGroupLoop()` 重建时使用最新 workingDir，避免 bind/unbind 后复用旧 workingDir 的 loop
- Modify: `packages/core/src/group/manager.ts` — `restoreGroups()` 中的 GroupTodoScanner `onTrigger` 改为 `postMessage("@targetId message")` 模式，与 `create()` 路径一致。WakeSystem 负责传入正确的 workingDir，不再直接调用 `targetAgent.run(message)`

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass

---

### 修复：幽灵群组反复出现（restoreGroups 自动复活孤儿目录）

**问题描述**：幽灵群组（g1, g2）手动删除后反复出现。即使通过 UI 删除或手动清理，重启后仍出现在侧边栏。

**根因分析**：
1. `restoreGroups()` 扫描 `data/groups/` 时，对没有 `config.json` 的目录**自动创建配置**并注册为正式群组（manager.ts:333-341）
2. 历史上 `save_chat_current` 未校验注册状态时创建的幽灵目录（含 SQLite group.db），在 Windows 文件锁下 `rmDirRecursive` 删除失败，目录残留
3. 下次启动 → `restoreGroups()` 再次发现残留目录 → 自动生成 `config.json` → 复活为幽灵群组
4. 这是**自我维持的泄漏循环**：`restoreGroups` 是幽灵群组的复活引擎

**修改文件**：
- Modify: `packages/core/src/group/manager.ts` — `restoreGroups()` 遇到无 `config.json` 的目录时，改为**删除孤儿目录**（`rmDirRecursive`）并 `continue`，不再自动创建配置
- Modify: `packages/core/src/api/ws-server.ts` — `clear_chat_current` 处理器新增 Agent/Group 注册状态过滤，防止操作未注册的目录

**强制清理**：删除 g1/g2 的 `config.json`（SQLite 文件被运行中进程锁定无法删除），下次启动时 `restoreGroups()` 会自动清理残留目录。

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

---

### 修复：TODOboard 逾期检测 + @mention 双写 @@ 符号

**问题描述**：
1. TODOboard 逾期检测功能缺失：GroupTodoScanner 的 `formatTriggerMessage` 不含逾期状态信息，与 AgentTodoScanner 不一致；缺少显式的 `getOverdueTodos()` 方法
2. 群组输入框输入 `@` 触发上拉菜单后选择成员，插入 `@@agent` 多了一个 `@` 符号

**根因分析**：
1. GroupTodoScanner 未导入 `OVERDUE_THRESHOLD_MS`，触发消息中无"逾期: 是/否"和逾期时长计算。`getDueTodos()` 虽能返回逾期 TODO（`triggerAt <= now`），但缺少逾期优先排序和独立查询接口
2. `insertMention` 在已包含 `@` 的文本上直接追加 `@{agentId}`，导致 `@@agentId`

**修改文件**：
- Modify: `packages/core/src/todo/store.ts` — 新增 `getOverdueTodos(thresholdMs)` 显式逾期查询方法
- Modify: `packages/core/src/todo/scanner.ts` — `scanOnce()` 按 `triggerAt` 升序排列，逾期任务优先触发
- Modify: `packages/core/src/todo/group-scanner.ts` — 导入 `OVERDUE_THRESHOLD_MS`；`scanOnce()` 逾期优先排序；`formatTriggerMessage` 新增逾期检测行（"逾期: 是/否，已逾期 X 小时"）
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — `insertMention` 先用 `t.replace(/@$/, "")` 去掉末尾 `@` 再追加
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `insertMention` 同上防御性修复

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass

---

## 2026-05-09

### 全链路修复：前端对话持久化 + Agent 署名 + 幽灵群组

**问题描述**：
1. 用户对话关闭应用再打开后丢失
2. 前端 Agent 消息气泡署名显示 "Assistant" 而非 Agent 实际名称
3. 前端侧边栏出现注册表中不存在的幽灵群组（g1, b 等）

**涉及文件（8 个）**：
- `gui-v2/src/stores/chat.ts`
- `gui-v2/src/hooks/useChatPersistence.ts`
- `gui-v2/src/hooks/useWebSocket.ts`
- `gui-v2/src/components/chat/ChatView.tsx`
- `gui-v2/src/components/chat/GroupMessageBubble.tsx`
- `packages/core/src/api/ws-server.ts`
- `PROGRESS.md`

**修复清单（14 项）**：

| # | 问题 | 根因 | 修复 |
|---|------|------|------|
| 1 | 保存永不触发 | `loadFromCurrent` 在空 `chat_current` 时不设 `currentLoaded: true` | 始终设 `currentLoaded: true` |
| 2 | `currentLoaded` 死锁 | `chat_current` 响应永不返回时永久阻塞 | `_connected` 后 8s 强制置 true |
| 3 | 关闭时未保存 | 防抖 timer 被 cleanup 取消 | idle 立即保存 + `beforeunload` flush |
| 4 | 竞态覆盖新消息 | `loadFromCurrent` 全量替换 `messageStore` | 改为 merge（内存中已有的优先保留） |
| 5 | 旧消息方向反转 | `parseCurrentMd` 无 `direction` 保留逻辑 | `direction` 存在即保留原格式 |
| 6 | 旧消息缺 `senderId` | 修复前保存的消息无 `senderId` | `loadFromCurrent` backward-compat fixup |
| 7 | 旧消息缺 `senderName` | fixup 只补 `senderId` 未补 `senderName` | fixup 阶段从 agents snapshot 解析 `senderName` |
| 8 | UI 不重渲染 | `MessageBubble` 不订阅 agents store | 订阅 agents → agent 加载后自动重渲染 |
| 9 | 署名硬编码 "Assistant" | `MessageBubble` 无身份解析逻辑 | `getSenderDisplay(m, convId, agents)` 优先级链 |
| 10 | `senderId` 缺失 | `finalizeStream` 不设 `senderId`/`senderName` | 新增参数并写入消息 |
| 11 | 后端不传身份 | `agent_response` 只含 `content` | payload 增加 `agentId` + `agentName` |
| 12 | 前端丢弃身份 | `agent_response` handler 不传 `agentName` | 传给 `finalizeStream(content, agentId, agentName)` |
| 13 | 渠道消息显示"你" | `addMessage` 对所有 "in" 设 `senderId: "user"` | 有 `senderName` 时跳过 auto-set |
| 14 | 幽灵群组泄漏 | `save_chat_current` 无条件 `mkdir -p` | 仅已注册 Agent/Group 才保存；`get_chat_current` 同样过滤 |

**强制清理**：删除 `packages/*/dist/` + `gui-v2/dist/` + 僵尸群组目录 `data/groups/g1` `data/groups/g2`，全量重编译。

**验证**：`pnpm build` 6pkgs pass, `pnpm test` 281 tests pass, `gui-v2 build` pass

---

### 修复：save_chat_current 创建幽灵群组目录导致僵尸群组出现在前端

**问题描述**：前端显示注册表中不存在的群组。

**根因分析**：
1. `save_chat_current` 对 `messageStore` 中所有 key 无条件 `mkdir -p` 创建目录
2. 若 `messageStore` 含有已删除群组的残留 key（来自前次 `get_chat_current` 从磁盘加载的旧数据），则 `save_chat_current` 会重新创建 `data/groups/<ghostId>/memory/` 目录
3. 下次启动时 `restoreGroups()` 遍历 `data/groups/` 发现该目录 → 无 `config.json` 则自动生成 `{ id, name: dirName, members: [] }` → 注册为僵尸群组 → `get_state` 返回 → 前端侧边栏出现

**泄漏循环**：`get_chat_current` 加载磁盘残留 → 前端 `messageStore` 含 ghost key → `save_chat_current` 重建目录 → 重启 → `restoreGroups` 注册僵尸群组

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts` — `save_chat_current` 改为仅对 `agentRegistry` 或 `groupManager` 中已注册的 ID 保存（`!isAgent && !isGroup → continue`）；`get_chat_current` 同样仅对已注册的 Agent/Group 加载对话（`!agentRegistry?.get(name) → continue` / `!groupManager?.get(name) → continue`）

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass

### 审计修复：currentLoaded 超时兜底 + 渠道消息署名 + GroupMessageBubble 默认值

**审计发现**：
1. `currentLoaded` 无超时兜底 — 若 `chat_current` WS 响应永不返回，`useChatPersistence` 永久阻塞
2. 渠道消息（QQ/Discord）"in" 方向显示"你"而非外部发送者名称 — `getSenderDisplay` 忽略 `msg.senderName`
3. `GroupMessageBubble` 默认 senderId 为 `"assistant"` 字符串

**修改文件**：
- Modify: `gui-v2/src/stores/chat.ts` — `addMessage` auto-set senderId 改为仅当 direction="in" 且无 senderName 时才设 "user"（渠道消息已有 senderName 则跳过）
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `getSenderDisplay` 中 direction="in" 时返回 `msg.senderName || "你"`（渠道消息显示外部用户名）
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 默认 senderId `"assistant"` → `"unknown"`
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `_connected` handler 新增 8 秒超时兜底：若 `currentLoaded` 仍为 false 则强制置 true

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

### 修复：前端对话丢失 + Agent 消息署名显示 "Assistant"（第二轮修复）

**问题描述**：第一轮修复未生效，继续深入排查。

**第二轮根因分析**：

**Bug 1 补充根因 — 保存链路从未启动**：
1. `loadFromCurrent` 在 `chat_current` 返回空数据时不设置 `currentLoaded: true` → `useChatPersistence` 永远不触发保存
2. 防抖机制在 streaming 期间累积延迟，关闭窗口前若 WS 已断开则消息进 `pendingQueue` 永不 flush
3. 旧消息（修复前保存）缺少 `senderId`，`parseCurrentMd` 的 `direction && (senderId || fromAgentId)` 条件过多余 → 无 `senderId`/`fromAgentId` 的消息仍被误推断方向

**Bug 2 补充根因 — senderName 未被利用**：
1. 后端已发 `agentName` 但前端 `agent_response` 处理器只传 `agentId` 给 `finalizeStream`，未传 `agentName`
2. 旧消息加载后 `senderId` 缺失 → `getAgentName(undefined)` → 回退到 "Assistant"
3. `MessageBubble` 不使用 `msg.senderName` 字段（已有接口但从未赋值）

**第二轮修改文件**：
- Modify: `gui-v2/src/stores/chat.ts` — `loadFromCurrent` 改为总是设 `currentLoaded: true`（空数据也不例外）；对加载的消息做 backward-compat fixup（无 senderId → direction=in 设 "user"，direction=out 设 convId）；`finalizeStream` 新增第 3 参数 `senderName` 写入消息
- Modify: `gui-v2/src/hooks/useChatPersistence.ts` — 重写：streaming 时 300ms 防抖，idle 时立即保存（setTimeout 0）；`beforeunload` flush + unmount cleanup 中检查 `ws.connected` 后再保存
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — `getSenderDisplay()` 替代 `getAgentName()`：优先 `msg.senderName` → `msg.senderId` 查 store → `convId` 查 store → "Assistant"；`ThinkingBubble` 同用此逻辑
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `chat_current` 处理器总是调用 `loadFromCurrent`（不再仅在 conversations 非空时）；`agent_response` 处理器传 `p.agentName` 给 `finalizeStream`
- Modify: `packages/core/src/api/ws-server.ts` — `parseCurrentMd` 移除多余的 `(obj.senderId || fromAgentId)` 条件，仅判断 `direction` 存在即保留原格式

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

### 修复：前端对话丢失 + Agent 消息署名显示 "Assistant"（第一轮）

### 修复：创建群组时不唤醒组员，先唤醒群主对接 + Agent stop() 无法截停

**问题描述**：
1. 创建群组时所有组员被自动唤醒，应先唤醒群主与用户对接需求
2. Agent "停止" 按钮无法中断正在运行的 Agent，AbortSignal 仅在各轮之间检查，不传递给 Provider 的流式请求

**根因分析**：
1. 群组创建后未指定唤醒目标。butler-create-group / WS create_group 创建群组后无初始消息，后续用户消息中 @mention 直接唤醒组员
2. ConversationLoop.run() 中 AbortSignal 仅在每轮 for 循环开始处检查（conversation-loop.ts:125），但 LLM 流式调用（for await of provider.chat()）期间不检查。各 Provider 的 fetch() 也未接收 AbortSignal，导致 abort() 后 HTTP 连接继续直到流自然结束

**修改文件**：
- Modify: `packages/shared/src/types.ts` — ChatParams 新增 `abortSignal?: AbortSignal` 字段
- Modify: `packages/providers/src/openai-compat/openai-provider.ts` — fetch() 传入 `signal: params.abortSignal`
- Modify: `packages/providers/src/anthropic/anthropic-provider.ts` — 监听 abort 事件调用 `stream.abort()`；流迭代中检查 abort
- Modify: `packages/providers/src/gemini/gemini-provider.ts` — fetch() 传入 `signal: params.abortSignal`
- Modify: `packages/core/src/conversation/conversation-loop.ts` — provider.chat() 传入 `abortSignal`；工具执行前增加 abort 检查；catch 中检测 AbortError 返回 "[已停止]"
- Modify: `packages/core/src/api/ws-server.ts` — create_group 后 postMessage @host 唤醒群主
- Modify: `packages/core/src/agent/butler.ts` — makeCreateGroupTool 后 postMessage @host 唤醒群主

**修改内容摘要**：
1. **群组创建唤醒策略**：创建群组后发送 `@host 新群组"X"已创建，成员包括...请与用户对接` → 仅 host 被 WakeSystem 入队唤醒，组员不会被 @mention
2. **Stop 信号传递链路**：agent.stop() → abortController.abort() → ConversationLoop 传入 provider.chat(abortSignal) → fetch({ signal }) → HTTP 连接中断 → AbortError 被 catch 返回 "[已停止]"
3. **工具执行保护**：每轮工具循环中，每个工具执行前检查 `abortSignal?.aborted`，被停止时立即返回 "[已停止]"

**验证**: pnpm build 6pkgs pass, pnpm test 281 tests pass, gui-v2 build pass

### 输入框增强：斜杠命令 + @成员选择

**问题描述**：输入框缺少快捷操作入口。Agent 对话需手动输入命令，群组 @成员需记住 ID。

**修改文件**：
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — ChatInput 新增 `/` 斜杠命令检测 + 上拉菜单（/new /clear /bind /unbind /skills）；支持 ↑↓ 导航、Tab/Enter 填充、Esc 关闭
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — GroupChatInput 新增 `@` 字符检测 + 群组成员弹窗；自动过滤当前群组成员；支持 ↑↓ 选择、Tab 填充、双击选择、Esc 关闭

**使用方式**：
- **Agent 输入框**：输入 `/` → 弹出命令菜单 → ↑↓ 选择 → Tab/Enter 填充命令 → 继续输入参数
- **群组输入框**：输入 `@` → 弹出群组成员列表 → ↑↓ 选择 → Tab 填充 @agent 或双击直接插入

**验证**: gui-v2 build pass

**变更原因**：活跃 Agent 面板只能看不能停。Agent 卡住或长时间执行时无法从外部中断。

**实现方案**：
- Agent 新增 `_abortController`，`run()` / `handleIncomingMessage()` 执行前创建 AbortController
- Agent 新增 `stop()` 方法 → 触发 `abortController.abort()`
- ConversationLoop.run() 每轮工具循环前检查 `abortSignal?.aborted`，被停止时返回 `"[已停止]"`
- 新增 WS `stop_agent` 命令，前端 "停止" 按钮调用

**修改文件**：
- Modify: `packages/core/src/agent/agent.ts` — 新增 `_abortController` / `stop()` / run() 和 handleIncomingMessage() 注入 AbortSignal + finally 清理
- Modify: `packages/core/src/conversation/conversation-loop.ts` — run() 新增 `abortSignal?` 参数，每轮检查 abort
- Modify: `packages/core/src/api/ws-server.ts` — 新增 `stop_agent` WS 命令
- Modify: `gui-v2/src/components/observability/ActiveAgentsPanel.tsx` — ProcessingItem 新增红色 "停止" 按钮
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 `agent_stopped` 事件处理

**验证**: pnpm build pass, pnpm test pass, gui-v2 build pass

### 唤醒队列增强 + 移到仪表盘 + 消息截断

**变更原因**：
1. 唤醒队列只显示群组内排队的 Agent，直接对话/TODO 触发路径的活跃 Agent 不可见
2. 唤醒队列在设置深处，查看不便
3. 长消息气泡占满屏幕，没有截断展开机制

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts` — `get_wake_queue` 命令新增 `activeAgents` 字段（遍历 registry 收集 status !== "idle" 的 Agent）
- Modify: `gui-v2/src/stores/wakeQueue.ts` — 新增 `activeAgents` 数组和 `setActiveAgents` 方法
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `wake_queue_update` 事件处理 `activeAgents` 字段
- Create: `gui-v2/src/components/observability/ActiveAgentsPanel.tsx` — 统一活跃 Agent 面板（独立任务 + 群组队列 + 处理中），含 `TruncatedText` 截断组件
- Modify: `gui-v2/src/components/observability/DashboardView.tsx` — 嵌入 `ActiveAgentsPanel` 在仪表盘底部
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 移除 wakequeue 菜单项和渲染
- Modify: `gui-v2/src/stores/settings.ts` — 移除 `wakequeue` 类型
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 新增 `MessageContent` 组件：>400 字符自动截断，"展开全部"/"收起" 切换

**验证**: pnpm build 6pkgs pass, gui-v2 build pass

### 修复：前端侧边栏同步 + 消息滚动优化

**问题描述**：
1. 从智能体视图切换到群组视图时，右侧主窗口仍停留在智能体对话界面，只有点击具体群组才切换
2. 每次打开对话时全部历史消息从上到下滚动加载，窗口滑动很长时间

**根因分析**：
1. NavBar 切换 `activeView` 不切换 `activeConv`。`MainContent` 靠 `isGroupChat` 决定渲染哪个视图，切换 view 后 activeConv 仍是旧 ID → UI 不刷新
2. `scrollIntoView({ behavior: "smooth" })` 对每条消息触发平滑动画，首次加载大量历史时累积成超长滚动。组件跨对话复用时 `useRef` 不重置

**修改文件**：
- Modify: `gui-v2/src/components/layout/MainContent.tsx` — view 切换时自动同步 activeConv（agent↔group 自动选第一个）；ChatView/GroupChatView 加 `key={activeConv}` 强制切换对话时重挂载
- Modify: `gui-v2/src/components/chat/ChatView.tsx` — MessageList: 首次渲染 `instant` 跳底，后续新消息 `smooth`
- Modify: `gui-v2/src/components/chat/GroupChatView.tsx` — GroupMessageList: 同上

**验证**: gui-v2 build pass

### 修复：群组 Agent 回复串窗

**问题描述**：群组中 Agent 回复的消息偶尔出现在其他 Agent 的对话窗口或群组窗口中。

**根因分析**：
`agent_response` WS 事件的 payload 只有 `{ content: string }`，不含 `groupId`。前端收到后通过 `activeId`（当前活跃窗口）判断是否为群组响应。当用户切换到其他窗口时，`agent_response` 被误认为是当前窗口的回复，调用 `finalizeStream` 把内容写入了错误的对话。

**数据流对比**：
- `group_message` 事件：`{ groupId, fromAgentId, content }` → 始终路由到正确的 `messageStore[groupId]` ✅
- `agent_response`（修复前）：`{ content }` → 依赖 `activeConversation` 猜窗口 → 猜错就串窗 ❌
- `agent_response`（修复后）：`{ content, groupId }` → 有 groupId 就只清状态不写消息（群组消息由 group_message 负责） ✅

**修改文件**：
- Modify: `packages/core/src/api/ws-server.ts` — `agent_response` payload 新增 `groupId: groupMatch?.[1]`
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — `agent_response` 处理器改为以 `p.groupId` 判断是否为群组响应，不再依赖 `activeConversation`

**验证**: pnpm build pass, pnpm test pass, gui-v2 build pass

### 实现：Agent workspace 外部绑定（bind）

**变更原因**：Agent 只能在自己的 `data/agents/{id}/workspace/` 目录工作，无法直接操作外部项目目录。需要在操作外部项目时手动复制文件。

**设计方案**：
- Agent 新增 `_boundWorkspace` 字段和 `effectiveWorkspace` getter
- 绑定后文件工具（bash/read-file/write-file/edit-file）的 workingDir 自动指向绑定的外部目录
- 核心文件（SOUL.md / CHARACTER.md / JOB.md / memory.db）始终在原 `data/agents/{id}/` 目录
- 解绑后恢复默认 workspace

**修改文件**：
- Modify: `packages/core/src/agent/agent.ts` — 新增 `_boundWorkspace` 字段、`effectiveWorkspace` getter、`setBoundWorkspace(dir)` 方法、`rebuildExecutor()` 重建 PermissionEnforcer+ToolExecutor+ConversationLoop；`createLoop`/`createGroupLoop` 使用 `effectiveWorkspace`
- Modify: `packages/core/src/agent/butler.ts` — 新增 `butler-bind-workspace` 工具（agentId + path，传入空路径解绑）
- Modify: `packages/core/src/api/ws-server.ts` — 新增 `bind_workspace` WS 命令
- Modify: `packages/core/src/runtime.ts` — butler 白名单追加 `butler-bind-workspace`

**修改内容摘要**：
1. **绑定**：`agent.setBoundWorkspace("/path/to/project")` → ToolExecutor/ConversationLoop 重建，工具在外部目录执行
2. **解绑**：`agent.setBoundWorkspace(null)` → 恢复默认 `data/agents/{id}/workspace/`
3. **核心文件不变**：SOUL.md 等始终读写 `AgentPaths` 的路径，不受绑定影响
4. **目录自动创建**：绑定目录不存在时自动 `mkdir -p`

**验证**: pnpm build pass, pnpm test pass

### 增强：管家删除 Agent/群组完整能力

**变更原因**：删除 Agent 时未从所属群组级联除名、butler 工具路径缺广播通知、缺影响摘要。WS 路径同样缺少级联清理。

**缺口分析**（5 项）：
1. 删除 Agent 未从所属群组除名 → 群组残留已删除成员的引用
2. butler-destroy-agent 未广播事件 → 前端侧边栏不刷新
3. butler-destroy-group 未通知成员 → 群组成员不知道群组已解散
4. 删除前未返回影响摘要 → 管家不知道操作波及了什么
5. WS destroy_agent 也未做群组级联 → 与 butler 路径一致缺此能力

**修改文件**：
- Modify: `packages/core/src/group/manager.ts` — 新增 `getGroupsForAgent(agentId)` 查询 Agent 所属群组
- Modify: `packages/core/src/agent/butler.ts` — `makeDestroyAgentTool` 新增级联除名 + 广播 + 摘要（参数增加 groupManager）；`makeDestroyGroupTool` 新增解散通知 + 广播 + 成员摘要
- Modify: `packages/core/src/api/ws-server.ts` — `destroy_agent` 新增群组级联除名；`destroy_group` 新增解散通知

**修改内容摘要**：
1. **级联除名**：删除 Agent 前遍历所有群组 → removeMember + postMessage 通知
2. **解散通知**：删除群组前 postMessage 通知所有成员
3. **事件广播**：butler 工具路径与 WS 路径一致广播 agent_destroyed / group_destroyed
4. **影响摘要**：返回受影响群组列表（删除 Agent）或前成员列表（解散群组）

**验证**: pnpm build pass, pnpm test pass

### 修复：核心 Agent 数据保护 + 删除残留清理

**问题描述**：
1. butler-destroy-agent 工具可销毁管家和群主自身，且被删除 Agent 的数据库文件（memory.db、WAL、SHM）残留
2. write-file / edit-file 无跨 Agent 保护，Agent A 可覆盖 Agent B 的核心文件

**根因分析**：
1. **butler-destroy-agent vs WS destroy_agent 代码分叉**：WS 端有守卫（防删 butler/host）+ dispose() + rmDirRecursive，但 butler 工具端只有 registry.unregister()，未释放 SQLite 连接也未删除文件
2. **Windows 文件锁定**：SQLite WAL 文件在 close() 后可能延迟释放，fs.unlinkSync 直接抛 EPERM，无重试机制
3. **文件工具无跨 Agent 保护**：write-file/edit-file 通过 path.resolve + `../` 可以越界写到其他 Agent 目录

**修改文件**：
- Modify: `packages/shared/src/fs-utils.ts` — `rmDirRecursive` 文件/目录删除加 5 次重试（200ms 间隔），处理 EPERM/EBUSY/ENOTEMPTY
- Modify: `packages/core/src/agent/butler.ts` — `makeDestroyAgentTool` 新增：butler/host 守卫 + `agent.dispose()` 释放 SQLite + `rmDirRecursive` 清理数据目录；传入 dataRoot 参数
- Modify: `packages/core/src/tools/write-file.ts` — 新增 `isProtectedPath()` 检查，防止非 butler/host Agent 覆盖管家/群主文件
- Modify: `packages/core/src/tools/edit-file.ts` — 同上保护

**修改内容摘要**：
1. **防御层1 — 不能删除核心 Agent**：WS destroy_agent + butler-destroy-agent 双重守卫，拒绝删除 butler/host
2. **防御层2 — 删除时完整清理**：butler-destroy-agent 代理 agent.dispose() → rmDirRecursive，与 WS 路径对齐
3. **防御层3 — Windows 重试**：rmDirRecursive 每个文件/目录删除最多重试 5 次，间隔 200ms
4. **防御层4 — 文件工具保护**：write-file/edit-file 解析目标路径，拒绝非宿主 Agent 写 butler/host 目录

**验证**: pnpm build 6pkgs pass, pnpm test pass

### 修复：start.bat 编码混乱

**问题描述**：运行 start.bat 时出现 `'le'`、`'t'`、`'/d'` 等字符碎片被当作命令执行的错误，最终 "pnpm not found"。

**根因分析**：
1. `chcp 65001`（UTF-8 代码页）在部分 Windows 版本上导致 CMD 输出混乱，stdout 碎片被 shell 解析为命令
2. `pnpm`/`npm`/`npx` 是 `.cmd` 批处理包装脚本，不用 `call` 前缀会在执行后直接退出当前批处理

**修改文件**: `start.bat` — 移除 chcp 65001；全部 pnpm/npm/npx 加 call 前缀；localhost 改 127.0.0.1；移除中文标签防编码问题

### P2 可用性 + 前端审美审计

**可用性审计（Agent/群组可访问性）**：
1. **talk-close 白名单缺失** — butler tools 和 host config 白名单中缺少 talk-close，Agent 无法调用。修复：runtime.ts 两处白名单补全
2. 批量 TODO 工具 ✅ — todo-batch-complete/remove/update 已在 agent.ts 注册 + butler/host 白名单
3. 元技能 ✅ — skillsDir 默认 `./skills`，递归加载正确发现子技能
4. WS 命令 ✅ — 前端正确调用 get_agent_timeline/search_conversation/export_data 等

**前端审美审计（对照 user-ui-preferences.md）**：
1. **TodoItem 选中态用 ring-2** — 违规："不要使用 ring 轮廓线"。修复：改为 bg-accent/8 + 左侧 accent 边框
2. **TodoItem 勾号 text-[10px]** — 违规："禁止 10px 以下字号"。修复：改为 text-xs
3. **多个组件硬编码 #f59e0b / #8b5cf6** — TodoKanban 列头色、GroupHealthPanel 阻塞时间色。修复：Kanban 与 TodoStatusBadge 一致；阻塞时间改用 Tailwind text-amber-500

**修改文件**：
- `runtime.ts` — butler + host 白名单补全 talk-close
- `gui-v2/.../TodoItem.tsx` — ring-2 → bg-accent/8 + 左侧边框；text-[10px] → text-xs
- `gui-v2/.../TodoKanban.tsx` — 列颜色变量名 color→dotColor，与 TodoStatusBadge 对齐
- `gui-v2/.../GroupHealthPanel.tsx` — text-[#f59e0b] → text-amber-500

**验证**: pnpm build 6pkgs pass, pnpm test pass, gui-v2 build pass

**审计范围**：P2 全部变更（2.1/2.2/2.3/2.4），10+ 文件。

**发现并修复 4 个问题**：

1. **WS get_agent_timeline 字段名错误** — `started_at` 不存在，正确列名是 `timestamp`；`obsDb.db` 为私有属性不可外部访问。修复：改用已有公共方法 `obsDb.getToolStats({agentId})`
2. **AgentTimeline 前端字段不匹配** — `TimelineEvent` 接口使用 `started_at`/`finished_at`，后端 ToolCallRecord 是 `timestamp`/`latency_ms`。修复：对齐接口 + 渲染逻辑
3. **ChatSearch 用错 Hook** — `useState(() => {...})` 不应带 cleanup 函数，应为 `useEffect(() => {...}, [])`。修复：替换为正确的 useEffect 并添加空依赖数组
4. **export_data 路径穿越漏洞** — exportAgentId/exportGroupId 未校验，可通过 `../` 访问 dataRoot 外文件。修复：正则校验 ID 为 `[\w-]+` + path.resolve 二次确认目标在 dataRoot 内

**修改文件**：
- `api/ws-server.ts` — get_agent_timeline 改用 getToolStats；export_data 加路径穿越防护
- `gui-v2/.../AgentTimeline.tsx` — 接口字段对齐 + key 修正
- `gui-v2/.../ChatSearch.tsx` — useState → useEffect + 空依赖数组

**验证**: pnpm build 6pkgs pass, pnpm test pass, gui-v2 build pass

**变更原因**：前端缺少对话搜索、Agent 活动可视化、数据导出、侧边栏自动刷新、MCP 状态监控等体验功能。

**修改文件**：
- Create: `gui-v2/src/components/settings/ChatSearch.tsx` — 对话全文搜索组件（搜索框 + 高亮匹配结果）
- Create: `gui-v2/src/components/settings/AgentTimeline.tsx` — Agent 活动时间线（垂直时间轴 + 工具调用详情）
- Modify: `gui-v2/src/components/settings/SettingsView.tsx` — 新增搜索对话/导出数据菜单项和组件
- Modify: `gui-v2/src/stores/settings.ts` — SettingsSection 类型新增 search/export
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 agent_timeline/search_results/export_result 事件处理；agent_destroyed/group_destroyed 自动刷新 get_state
- Modify: `packages/core/src/api/ws-server.ts` — 新增 get_agent_timeline / search_conversation / export_data 三个 WS 命令

**修改内容摘要**：
1. **侧边栏自动刷新**：agent_destroyed / group_destroyed 事件触发 get_state，创建事件已有此行为
2. **对话全文搜索**：WS search_conversation 调用 MemoryStore.searchHistory（FTS5），前端 ChatSearch 组件搜索框 + 高亮匹配结果
3. **Agent 时间线**：WS get_agent_timeline 查询 observability DB tool_calls 表，前端 AgentTimeline 垂直时间轴组件
4. **数据导出**：WS export_data 收集目录文件内容为 JSON（跳过 SQLite 二进制），前端一键下载

**验证**: pnpm build 6pkgs pass, pnpm test pass, gui-v2 build pass

### P2.4 群组协作细化

**变更原因**：Talk 讨论结果无法回流到 main 频道、Screener 过滤无统计数据、群组健康状态不可见。

**修改文件**：
- Modify: `tools/group-tools.ts` — 新增 `talk-close` 工具，关闭讨论时生成结构化摘要（参与者/结论/消息数）发回 main 频道
- Modify: `agent/agent.ts` — 注册 talk-close 工具到群组 Agent
- Modify: `group/screener.ts` — Screener 新增 stats 计数器（totalChecked/totalFiltered/estimatedTokensSaved）+ getStats() 方法
- Modify: `api/ws-server.ts` — 新增 get_screener_stats / get_group_health 两个 WS 命令
- Create: `gui-v2/src/components/group/GroupHealthPanel.tsx` — 群组健康度面板（任务完成率进度条 + 成员活跃度列表 + 最长阻塞时间）
- Modify: `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 新增 talk_summary 消息卡片（紫色边框 + 讨论信息 + 参与者）
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 group_health / screener_stats 事件处理

**修改内容摘要**：
1. **Talk 结果回流**：talk-close 工具关闭讨论时生成 JSON 结构化摘要（含 topic/participants/conclusion/messageCount），postMessage 到 main 频道；前端 GroupMessageBubble 检测 talk_summary 类型渲染为特殊卡片
2. **Screener 过滤统计**：Screener 每次 screen() 记录 totalChecked，shouldWake=false 时累加 totalFiltered 和 estimatedTokensSaved；WS get_screener_stats 返回统计数据
3. **群组健康度面板**：GroupHealthPanel 三卡片（任务完成率 + 成员活跃度 + 最长阻塞），通过 get_group_health 命令获取数据

**验证**: pnpm build 6pkgs pass, pnpm test pass, gui-v2 build pass

### P2.2 前端 — TODO 看板 + 批量操作 + 到期提醒

**变更原因**：TODO 只有平铺列表、单条操作，缺少可视化看板、批量操作和到期提醒。

**修改文件**：
- Modify: `gui-v2/src/stores/todo.ts` — status 类型扩展为 4 态（pending/in-progress/review/completed）；新增 selectedIds/viewMode/getUpcoming/toggleSelect/selectAll/clearSelection
- Modify: `gui-v2/src/components/todo/TodoStatusBadge.tsx` — 适配 4 种状态颜色和标签
- Modify: `gui-v2/src/components/todo/TodoItem.tsx` — 新增 checkbox 选择框、状态切换按钮、compact 模式
- Modify: `gui-v2/src/components/todo/TodoList.tsx` — 新增 selectedIds/onToggleSelect/onStatusCycle props
- Create: `gui-v2/src/components/todo/TodoKanban.tsx` — 四列看板视图（待处理→进行中→审核→完成）
- Modify: `gui-v2/src/components/todo/TodoPanel.tsx` — 新增 viewMode 切换（列表/看板）、批量操作栏（完成/删除/分配）、到期提醒横幅
- Modify: `gui-v2/src/hooks/useWebSocket.ts` — 新增 todo_batch_result 事件处理
- Modify: `packages/core/src/api/ws-server.ts` — 新增 update_todo_status / batch_complete_todo / batch_remove_todo / batch_update_todo 四个 WS 命令

**修改内容摘要**：
1. **TODO 看板视图**：4 列按状态分组，卡片展示标题+时间+负责人，点击循环切换状态
2. **批量操作**：卡片左侧 checkbox 多选 → 顶部批量栏出现 → 批量完成/删除/重新分配
3. **到期提醒**：TODO 面板顶部黄色横幅，显示 30 分钟内到期的 TODO 数量和名称
4. **状态流**：pending → in-progress → review → completed（点击"→ 下一状态"按钮循环推进）

**验证**: pnpm build 6pkgs pass, pnpm test pass, gui-v2 build pass

### P2.2 后端 — 智能截断 + 批量操作 API

**变更原因**：记忆搜索结果返回全文过大，TODO 操作只能单条执行。

**修改文件**：
- Modify: `memory/sqlite-adapter.ts` — EntryRow/HistoryRow 新增 snippet 字段；新增 snippetAroundMatch() 窗口截断；searchEntries/searchHistory 自动填充 snippet
- Modify: `todo/store.ts` — 新增 batchComplete / batchRemove / batchUpdate 三个批量方法
- Modify: `todo/tools.ts` — 新增 todo-batch-complete / todo-batch-remove / todo-batch-update 三个工具
- Modify: `agent/agent.ts` — 注册三个批量工具
- Modify: `runtime.ts` — butler/host 白名单追加三个批量工具

**修改内容摘要**：
1. **搜索结果智能截断**：搜索结果以匹配位置为中心截取前后各 80 字符窗口，搜不到精确位置退化为前缀 160 字符。保留 content 全文和 id，Agent 需要时可取出
2. **TODO 批量操作**：batchComplete（批量完成）、batchRemove（批量删除）、batchUpdate（批量重分配/改状态），各自返回成功数和失败明细

**验证**: pnpm build pass, pnpm test pass

### P2.3 元技能体系（技能包架构）

**变更原因**：现有技能（code-review/project-planning 等）聚焦于具体任务，缺少通用元能力。从 P2.3 "技能生态"转向，构建 Agent 元技能体系。

**设计决策**：废弃原来的 4 个具体技能（测试生成/文档/重构/API），改为 3 个通用元技能：
- `cognitive-toolkit`：任务拆解、自我验证、不确定性处理、批判性思维
- `collaboration-mindset`：有效沟通、知识传递、角色适应、分歧处理
- `learning-loop`：经验提取、模式识别、持续改进、举一反三

**架构实现**：
- 技能包架构：`meta-skills/SKILL.md` 根文件 + 3 个子技能子目录
- `SkillRepository.loadAll()` 改为递归扫描，支持嵌套子技能目录

**修改文件**：
- Create: `skills/meta-skills/SKILL.md` — 技能包根文件（体系纲领 + 路由表 + 组合模式）
- Create: `skills/meta-skills/cognitive-toolkit/SKILL.md` — 思考工具箱
- Create: `skills/meta-skills/collaboration-mindset/SKILL.md` — 协作思维
- Create: `skills/meta-skills/learning-loop/SKILL.md` — 学习循环
- Modify: `packages/core/src/skills/repository.ts` — loadAll() 递归扫描子目录

**验证**: pnpm build pass, pnpm test pass

## 2026-05-08

### 第二次审计 — P1 全模块

**审计发现 6 个问题并全部修复**：
1. archiveGroup 先清理后打包 → 失败时数据孤立 → 改为先 zip 成功再清理
2. completeGroup 无重复守卫 → 重复写 PROGRESS.md → 加 status==='completed' 守卫
3. 全 Provider 失败不记录日志 → 错误路径跳过 observability → 在 return 前插入 insertLLMCall
4. cache tokens 仍累积值 → 与 per-round delta 不一致 → 改为 per-round delta
5. runStartTime 未使用变量 → 删除
6. __cobeingRuntime + __cobeingWSServer 未在 stop() 清理 → 添加 delete

**验证**: pnpm build 6pkgs + pnpm test 281 tests + gui-v2 build 全部通过

### P1.1 Agent 自我进化 — 已完成

**变更原因**：Agent 缺少自我进化能力：性格调整、工具策略积累、经验深化、Skill 列表感知。

**实现内容**：
- 扩展 experience-reflect 工具：新增 `lesson`（教训）、`soul_update`（追加 SOUL.md）、`tool_usage`（场景→工具→效果，追加 TOOLS.md）三个可选参数
- prompt-builder 自动注入 Skill 列表：在 BOOTSTRAP 段之后从 config.json 读取 skills 字段，追加"当前装载的技能"行
- BOOTSTRAP 持久注入确认：现有行为已正确（不删除，每次激发），无需改动

**修改文件**：`experience-reflect.ts`, `agent.ts`, `prompt-builder.ts`

**验证**: `pnpm build` 6 packages pass, `pnpm test` 281 tests pass

### P1.3 群组生命周期管理 — 已完成

**变更原因**：群组永久存在，无状态机、完成检测、归档/恢复、文档自动同步。

**实现内容**：
- GroupConfig 新增 `status?: 'active' | 'completed' | 'archived'` 字段
- Group 状态机：active→completed（TODO全完成+静默>1h）→archived（手动触发，zip打包）
- 冻结规则：completed 拒绝新消息/TODO只读，archived 完全冻结
- GroupManager 新增 `completeGroup()` / `archiveGroup()` / `restoreGroup()` 方法
- GroupTodoScanner 完成检测：每 60s 扫描，TODO 全完成 + 最后消息 >1h → 自动 complete
- Scanner 文档同步：TODO 完成时自动追加 PROGRESS.md
- 前端：侧边栏群组状态标签（已完成/已归档）
- WS getState 响应包含群组 status 字段

**修改文件**：`types.ts`(shared), `group.ts`, `manager.ts`, `group-scanner.ts`, `ws-server.ts`, `gui-v2/types.ts`, `Sidebar.tsx`

**验证**: `pnpm build` 6 packages pass, `pnpm test` 281 tests pass, `gui-v2 npm run build` pass

### P1.2 管家多步推理 — 已完成

**变更原因**：管家仅单轮 LLM 调用，缺少多步推理、主动建议、进展跟踪、负载感知能力。

**实现内容**：
- 增强 butler system prompt：加入"多步推理能力"和"主动建议"行为准则
- 删除 butler-analyze-task 工具（单次 LLM 调用，功能被 system prompt 取代）
- 增强 butler-list 输出：Agent 状态显示中文标签（空闲/忙碌中/异常）
- 新增 butler-check-group 工具：读取群组 PROGRESS.md + TODO 状态 + 成员列表，返回结构化报告
- runtime.ts 工具白名单：butler-analyze-task → butler-check-group

**修改文件**：`butler.ts`, `runtime.ts`

**验证**: `pnpm build` 6 packages pass, `pnpm test` 281 tests pass

### P1.4 可观测性 — 已完成

**变更原因**：P1 首个模块，添加完整可观测性基础设施。

**实现内容**：
- 新建 `ObservabilityDB`（better-sqlite3, data/observability.db），两张表 llm_calls + tool_calls
- ConversationLoop.run() 每轮 LLM 调用完成后写入（model、provider、latency、tokens、is_error、fallback_used）
- ToolExecutor.execute() 每次工具调用完成后写入（tool_name、latency、is_error、param/result chars）
- Agent/Runtime 注入链：Runtime 创建单例 → butler/restored/prebuilt agents → ConversationLoop + ToolExecutor
- 3 个新 WS 命令：get_dashboard（聚合指标）、get_llm_stats、get_tool_stats
- 前端：新增 "dashboard" ViewType + 导航图标 + 5 卡片组件（Token/延迟/错误/工具排行/Agent活跃度）
- 支持按群组筛选、30s 自动刷新、空状态占位

**后端修改文件**：
- Create: `packages/core/src/observability/observability-db.ts`
- Modify: `conversation-loop.ts`, `executor.ts`, `agent.ts`, `runtime.ts`, `ws-server.ts`

**前端修改文件**：
- Create: `gui-v2/src/stores/observability.ts`
- Create: `gui-v2/src/components/observability/{DashboardView,TokenCard,LatencyCard,ToolRankCard,AgentActivityCard}.tsx`
- Modify: `types.ts`, `NavBar.tsx`, `MainContent.tsx`, `useWebSocket.ts`

**验证**: `pnpm build` 6 packages pass, `pnpm test` 281 tests pass, `gui-v2 npm run build` pass

**P1 整体顺序**：1.4 可观测性 → 1.2 管家多步推理 → 1.3 群组生命周期 → 1.1 Agent 自我进化

### P0 缺口修复（4 项）

**变更原因**：`docs/待办新.md` 中 4 个 P0 子项标记为完成但代码验证发现实际未实现。

**根因分析**：
1. P0.1.1 — `start.bat` 默认 CLI（非 GUI），`start-gui.bat` 未合并
2. P0.2.3 — 消息无状态追踪，发送即发即忘
3. P0.2.4 — Agent 单一 Provider，失败后无自动回落
4. P0.3 — 前后端均无群组历史分页能力

**修改文件**：
- `start.bat` — 默认模式改为 GUI (2)
- `start-gui.bat` — 已删除
- `gui-v2/src/lib/types.ts` — LogMessage 新增 status/errorMessage 字段
- `gui-v2/src/stores/chat.ts` — 新增 updateLastInMessage/prependMessages/hasMoreMessages
- `gui-v2/src/components/chat/ChatView.tsx` — 消息气泡显示状态标签（发送中→已发送→回复中→失败）
- `gui-v2/src/components/chat/GroupChatView.tsx` — 同上 + 加载更早消息按钮
- `gui-v2/src/components/chat/GroupMessageBubble.tsx` — 状态标签 + 错误提示
- `gui-v2/src/hooks/useWebSocket.ts` — WS 事件驱动状态更新 + group_history 处理
- `packages/core/src/group/group-db.ts` — 新增 getAllMessages() 分页查询
- `packages/core/src/api/ws-server.ts` — 新增 get_group_history WS 命令 + create_agent 注入 Provider
- `packages/core/src/conversation/conversation-loop.ts` — 跨 Provider 回落循环 + isFallbackEligible + buildProviderError
- `packages/core/src/agent/agent.ts` — 新增 setAllProviders / buildFallbackList
- `packages/core/src/agent/butler.ts` — butler-create-agent 注入 fallback providers
- `packages/core/src/runtime.ts` — 全局 __cobeingRuntime 引用 + providersMap getter + 所有 Agent 注入

**修改内容摘要**：

1. **P0.1.1 统一启动入口**：`start.bat` 默认 GUI，删除 `start-gui.bat`
2. **P0.2.3 消息状态反馈**：前端 LogMessage 新增 status 字段（sending→sent→streaming→done/error），WS 事件驱动状态流转，消息气泡渲染状态标签
3. **P0.2.4 Provider 自动降级**：ConversationLoop.run() 中对 timeout/503/500/402/429 等可回落错误自动尝试下一个 Provider（auth 错误不回落），成功则切换为后续默认 Provider
4. **P0.3 群组历史分页**：GroupDB.getAllMessages() 支持 cursor-based 分页，WS get_group_history 命令，前端 GroupChatView "加载更早的消息" 按钮

### 安全审计与修复

**变更原因**：对项目进行全量安全审计，发现并修复安全漏洞和逻辑缺陷。

**根因分析**：
- WebSocket 服务默认监听 0.0.0.0 且无认证 — 局域网内任意机器可完全控制系统
- API Key 在 get_config 和广播中明文传输到前端
- host-decompose-task 依赖关系 (group as any).groupManager 访问私有属性失败
- SecretStore 密钥仅由 hostname+username 派生，熵值不足
- LLM Gateway 超时仅在初始调用时触发，流式迭代无超时
- 沙箱网络白名单模式 iptables 规则从未实际执行
- ContainerPool 并发构建锁 static 变量无法支持多镜像并发
- 投票截止过期无后台定时器检查
- update_agent 不重建 ConversationLoop 导致配置更改不生效
- write-file/edit-file 消息中泄露绝对路径

**修改文件**：
- `packages/core/src/api/ws-server.ts`
- `packages/core/src/group/host-tools.ts`
- `packages/core/src/runtime.ts`
- `packages/core/src/gateway/llm-gateway.ts`
- `packages/core/src/config/secret-store.ts`
- `packages/core/src/tools/sandbox/container-pool.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/vote/store.ts`
- `packages/core/src/tools/write-file.ts`
- `packages/core/src/tools/edit-file.ts`

**修改内容摘要**：

1. **ws-server.ts** — P0: 绑定 localhost(127.0.0.1)；get_config/broadcast 不返回明文 API Key（仅保留掩码值 _apiKeyResolved）；setNestedValue 增加 __proto__/constructor/prototype 防护
2. **host-tools.ts + runtime.ts** — P0: makeHostDecomposeTaskTool 新增 setDependsOn 回调参数，替代 (group as any).groupManager 私有属性访问
3. **llm-gateway.ts** — P1: createTimedIterable 重构为包装 AsyncIterator 的每 chunk 超时
4. **secret-store.ts** — P1: 密钥派生加入持久化随机盐文件 (~/.cobeing/secret-key)
5. **container-pool.ts** — P1: build 锁改为 Map<image, Promise> 支持多镜像并发；新增容器启动(docker start)；新增 applyWhitelistRules 实际执行 iptables 规则；dockerCmd 改为 spawn 防注入
6. **agent.ts** — P2: run() 开头 await memoryStore.ready() 确保初始化完成
7. **ws-server.ts** — P2: update_agent 调用 rebuildLoop() 使配置立即可见
8. **vote/store.ts** — P2: load() 时检查 voting 投票是否过期自动转为 arbitrating
9. **write-file.ts / edit-file.ts** — P2: 成功消息使用相对路径替代绝对路径
10. **network-whitelist.ts** — 文件未修改（已有完整实现，现已被 container-pool 调用）

### 安全审计第二轮修复

**变更原因**：第二次审计发现遗漏问题和修复验证。

**根因分析**：
- update_config 未检测前端回传的掩码 API key（含 "****"）会误加密损坏
- update_config 整 provider 对象更新时缺少 apiKey 会误删已保存密钥
- `__cobeingDataRoot` 和 `__cobeingConfig` 全局变量未注册，summarize-phase 使用错误路径

**修改文件**：
- `packages/core/src/api/ws-server.ts`
- `packages/core/src/runtime.ts`

**修改内容摘要**：
1. **ws-server.ts** — update_config: 检测 apiKey 含 "****" 时跳过加密（保留现有值）；整 provider 对象缺失 apiKey 时继承现有加密值
2. **runtime.ts** — 在构造函数中注册 `(globalThis as any).__cobeingDataRoot` 和 `(globalThis as any).__cobeingConfig`

### 修复 Windows EPERM 测试失败

**变更原因**：11 个测试在 Windows 上因 SQLite 文件句柄未释放导致 `fs.rmSync` 失败。

**根因分析**：
- Group 创建 GroupDB (SQLite) 后没有 dispose/close 方法
- GroupManager.delete() 不关闭 SQLite 连接就直接删除文件
- 测试 afterEach 中 fs.rmSync 在 Windows 上无法删除仍有打开句柄的目录

**修改文件**：
- `packages/core/src/group/group.ts`
- `packages/core/src/group/manager.ts`
- `packages/core/src/group/router.test.ts`
- `packages/core/src/integration.test.ts`

**修改内容摘要**：
1. **group.ts** — 新增 `dispose()` 方法：暂停 WakeSystem + 关闭 GroupDB (SQLite)
2. **manager.ts** — `delete()` 先 dispose 再删文件；新增 `disposeAll()` 遍历清理所有群组
3. **router.test.ts** — afterEach 先 `groupManager.disposeAll()` 再用 try-catch 包 rmSync
4. **integration.test.ts** — 跟踪所有 GroupManager 实例并在 afterEach 中 disposeAll；增加等待和 try-catch

### 功能完整性审计与修复

**变更原因**：审计工具注册与 Agent 可访问性，发现功能缺口。

**修改文件**：
- `packages/core/src/runtime.ts`
- `packages/core/src/agent/butler.ts`
- `packages/core/src/tools/group-tools.ts`
- `STRUCTURE.md`

**修改内容摘要**：
1. **runtime.ts** — P0: 补充 `this.butler.injectGroupTools()` 调用，但丁获得 group-send/group-update-progress/group-experience-add/group-experience-summarize 工具
2. **butler.ts** — P1: 注册 todo-review 带群组 store getter，但丁可验收群组级子任务
3. **group-tools.ts** — P2: 去掉 group-experience-summarize 描述中的"群主专用"
4. **STRUCTURE.md** — P2: 补全 WS 命令文档（get_wake_queue / get_skill_doc），更新测试计数

### 第三轮审计修复（资源泄漏 + 前端问题）

**变更原因**：审计前端代码、资源泄漏、运行时清理路径、配置加载健壮性。

**根因分析**：
- runtime.stop() 未释放群组 SQLite 连接、MCP 连接、全局变量
- ws-client.ts 离线消息队列无上限，长时断连导致内存泄漏
- 前端 disconnect() 设置 onclose=null 跳过重连
- 前端 chat store 消息列表无界增长
- 前端 useWebSocket.ts 模块级 wsClient 引用在重连时可能失效
- 前端 `__wsClient` 全局泄漏

**修改文件**：
- `packages/core/src/runtime.ts`
- `gui-v2/src/lib/ws-client.ts`
- `gui-v2/src/stores/chat.ts`
- `gui-v2/src/hooks/useWebSocket.ts`

**修改内容摘要**：
1. **runtime.ts** — stop() 增加 groupManager.disposeAll()、mcpManager.close()、删除 5 个 __cobeing* 全局变量
2. **ws-client.ts** — pendingQueue 上限 100 条；disconnect() 清理 onerror/onmessage；保留 onclose 用于正常关闭
3. **chat.ts** — 单会话消息上限 500 条，超量淘汰最早消息
4. **useWebSocket.ts** — 移除 `(globalThis as any).__wsClient` 全局泄漏

### 实现：Agent 协作意识（待办 #13）

**变更原因**：Agent 在群组中仅被动响应 @mention，缺乏对队友、任务和自身角色的主动感知能力。

**修改内容**：

1. **prompt-builder.ts** — 协作上下文增强
   - TASK.md/PLAN.md/PROGRESS.md 截断从 500 放宽到 2000 字符
   - 新增"群组能力覆盖"区块：收集所有成员 JOB 能力关键词，由 LLM 自行判断任务匹配度
   - 新增"当前活跃状态"区块：显示各成员处理中/空闲状态及耗时
   - 新增"角色自适应提示"：根据 JOB 内容指导 Agent 主动承担、协作或待命
   - 新增"能力互补提示"：指导 Agent 在超出能力范围时识别队友或 @mention 群主

2. **group-context-v2.ts** — Agent 活跃状态
   - 新增 `AgentActiveStatus` 接口（agentId / status / since）
   - 新增 `setAgentStatus()` / `getActiveStatuses()` / `clearAgentStatuses()` 方法

3. **wake-system.ts** — 执行前刷新 + 状态广播
   - `executeWake()` 每次重新获取 member profiles 和 workspace 摘要，确保数据最新
   - 开始处理 Agent 时设置 `processing` 状态，完成后设置 `idle`
   - 将 `activeStatuses` 透传到 `buildGroupCollaborationContext()`
   - 错误恢复路径也正确清除 agent 状态

4. **group.ts** — 透传 `setAgentStatus()` / `getActiveStatuses()`

**修改文件**：
- `packages/core/src/conversation/prompt-builder.ts`
- `packages/core/src/group/group-context-v2.ts`
- `packages/core/src/group/wake-system.ts`
- `packages/core/src/group/group.ts`

### 实现：主动协作行为（待办 #14）

**变更原因**：Agent 只能被动响应 @mention，无法主动求助、汇报进度或上报阻塞。

**修改内容**：

1. **group-tools.ts** — 新增 2 个工具
   - `group-send`：Agent 主动向群组 main 频道发送消息，支持 @mention 目标成员。用于主动求助和阻塞上报
   - `group-update-progress`：Agent 主动更新群组 PROGRESS.md 进度记录，完成阶段性工作后调用

2. **agent.ts** — `injectGroupTools()` 注册 `group-send` 和 `group-update-progress`

3. **runtime.ts** — butler 工具白名单加入 `group-send` 和 `group-update-progress`

4. **prompt-builder.ts** — 协作规则中新增主动工具的使用指引

**修改文件**：
- `packages/core/src/tools/group-tools.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/runtime.ts`
- `packages/core/src/conversation/prompt-builder.ts`

### 实现：任务分解与分派（待办 #15）

**变更原因**：群组任务流转无结构化支持，子任务无父子关系、依赖管理或验收机制。

**修改内容**：

1. **types.ts** — TodoItem 扩展
   - 新增 `parentId` 字段（父子任务层级）
   - 新增 `dependsOn: string[]` 字段（依赖管理）
   - 新增 `deliverable` 字段（交付物描述）
   - 状态扩展为 `pending | in-progress | review | completed`

2. **store.ts** — TodoStore 新增方法
   - `listByParent(parentId)` — 按父任务查询子任务
   - `getDependents(id)` — 获取依赖当前 TODO 的下游任务
   - `areDependenciesMet(id)` — 检查上游依赖是否全部完成
   - `updateStatus(id, status)` — 带依赖检查的状态更新
   - `setDependsOn(id, dependsOn)` — 设置依赖列表

3. **tools.ts** — TODO 工具增强
   - `todo-add` 新增 `parentId` 和 `dependsOn` 参数
   - `todo-list` 显示父子关系和依赖信息
   - 新增 `todo-review` 工具：支持 approve（通过）或 rework（打回重做）

4. **host-tools.ts** — `host-decompose-task` 增强
   - SubTask 接口新增 `dependsOn: number[]`（按索引声明依赖）
   - 两遍创建：先建所有子任务，再回填依赖 ID

5. **group-scanner.ts** — 依赖自动触发
   - `complete()` 完成后自动检查下游依赖
   - 新增 `onDependencyMet` 回调
   - 依赖条件全部满足时通知下游 Agent

6. **manager.ts** — 扫描器注入 `onDependencyMet` 回调

**修改文件**：
- `packages/core/src/todo/types.ts`
- `packages/core/src/todo/store.ts`
- `packages/core/src/todo/tools.ts`
- `packages/core/src/todo/group-scanner.ts`
- `packages/core/src/group/host-tools.ts`
- `packages/core/src/group/manager.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/runtime.ts`

### 实现：冲突解决与共识机制（待办 #16）

**变更原因**：群组中 Agent 之间没有冲突检测、投票、仲裁机制，群主无法结构化处理分歧。

**修改内容**：

1. **vote/types.ts** — 新增投票数据结构
   - `VoteOption`：选项 + 优缺点 + 投票者列表
   - `VoteTopic`：议题 + 选项列表 + 状态（voting/passed/rejected/arbitrating）+ 截止时间

2. **vote/store.ts** — VoteStore 持久化存储
   - `create()` — 创建投票
   - `cast()` — 投票（过半自动通过，支持改票）
   - `arbitrate()` — 群主仲裁
   - 持久化到 `data/host/VOTES.json`

3. **vote/tools.ts** — 3 个投票工具
   - `vote-create` — 发起投票，支持多选项 + pros/cons
   - `vote-cast` — 投票，过半自动判定通过
   - `vote-result` — 查看结果和票数

4. **runtime.ts** — VoteStore 单例 + 全局注册

5. **agent.ts** — 注册投票工具到所有 Agent（含 butler 和 host）

**修改文件**：
- `packages/core/src/vote/types.ts`（新）
- `packages/core/src/vote/store.ts`（新）
- `packages/core/src/vote/tools.ts`（新）
- `packages/core/src/runtime.ts`
- `packages/core/src/agent/agent.ts`

### 实现：知识共享与经验传递（待办 #17）

**变更原因**：各 Agent 知识完全隔离，群组协作经验无法沉淀和传递。

**修改内容**：

1. **group-tools.ts** — 新增 2 个工具
   - `group-experience-add`：Agent 将关键决策/教训/有效模式写入群组 EXPERIENCE.md
   - `group-experience-summarize`：群主触发协作总结，提取各章节条目发到 main 频道

2. **prompt-builder.ts** — 协作上下文增强
   - "他山之石"区块：展示群组 EXPERIENCE.md 中的协作经验
   - 无经验时显示 `group-experience-add` 使用指引

3. **agent.ts** — `injectGroupTools()` 注册新工具

4. **runtime.ts** — butler 白名单加入新工具

**修改文件**：
- `packages/core/src/tools/group-tools.ts`
- `packages/core/src/conversation/prompt-builder.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/runtime.ts`

## 2026-05-08

### 增强：管家 Agent 生成能力 + 群主管理能力（待办 #9、#10）

**变更原因**：根据待办 #9、#10 检查结果，修复多项未实现功能。

**第9项修复（管家 Agent 生成能力）**：
- ws-server create_agent 集成 SubAgentSpawner：通过 WS/前端创建 Agent 时用 LLM 生成核心文件（soul/character/job/bootstrap），代替原空白模板复制
- 新增 butler-modify-agent 工具：管家可修改已有 Agent 的核心文件（SOUL/CHARACTER/JOB/BOOTSTRAP/TOOLS），支持读取和写入模式

**第10项修复（群主管理能力）**：
- group.ts addMember/removeMember 同步 MEMBERS.md 工作空间文件
- 新增 host-invite-member / host-remove-member 工具：群主可通过工具主动邀请和移除群组成员
- 新增 host-set-screener-prompt 工具：群主可设置群组级自定义筛� prompt（覆盖全局默认）
- 新增 host-manage-workspace 工具：群主可管理 STRUCTURE.md / PLAN.md / TASK.md
- local-filter.ts evaluate() 支持自定义 system prompt（群组级筛选策略）
- Group 新增 screenerPrompt 字段：WakeSystem 评估唤醒时传入群组自定义 prompt
- workspace.ts 新增泛型 writeFile/readFile 方法

**修改文件**：
- `packages/core/src/api/ws-server.ts` — create_agent 集成 SubAgentSpawner LLM 生成
- `packages/core/src/agent/butler.ts` — 新增 butler-modify-agent 工具
- `packages/core/src/group/host-tools.ts` — 新增 4 个群主工具（invite-member / remove-member / set-screener-prompt / manage-workspace）
- `packages/core/src/group/group.ts` — addMember/removeMember 同步 MEMBERS.md + screenerPrompt 字段
- `packages/core/src/group/wake-system.ts` — evaluateForOwner 传入群组自定义 prompt
- `packages/core/src/group/local-filter.ts` — evaluate() 签名扩展（可选 customSystemPrompt）
- `packages/core/src/group/workspace.ts` — 新增泛型 writeFile/readFile
- `packages/core/src/runtime.ts` — butler/config 白名单更新 + 新 host 工具注册

## 2026-05-07

### 增强：错误信息硬编码返回 + 前端唤醒队列显示

**问题描述**：
1. AI 服务异常（超时/密钥错误等）时，错误信息未结构化返回给前端，日志中只有模糊的"执行失败"
2. 前端设置页面无法看到哪些 Agent 正在排队等待唤醒

**修改文件**：
- `packages/core/src/conversation/conversation-loop.ts` — provider.chat() 添加 try/catch，分类返回中文错误消息
- `packages/core/src/group/wake-system.ts` — 新增 agent_error 事件类型、广播错误详情；新增 getQueue()/onQueueChange 机制
- `packages/core/src/group/group.ts` — 新增 setOnQueueChange/getWakeQueue 委托方法
- `packages/core/src/group/manager.ts` — 新增 _onQueueChange/setOnQueueChange/getAllWakeQueues
- `packages/core/src/api/ws-server.ts` — 对接 agent_error/wake_queue_update 广播，添加 get_wake_queue 命令
- `packages/core/src/runtime.ts` — TODOboard 路径广播 agent_error 代替 agent_completed
- `gui-v2/src/stores/wakeQueue.ts` — 新建唤醒队列 Zustand store
- `gui-v2/src/stores/settings.ts` — SettingsSection 新增 wakequeue
- `gui-v2/src/hooks/useWebSocket.ts` — 处理 agent_error/wake_queue_update 事件
- `gui-v2/src/components/settings/WakeQueueSection.tsx` — 新建唤醒队列组件
- `gui-v2/src/components/settings/SettingsView.tsx` — 菜单新增"唤醒队列"入口

**修改内容**：

**1. 错误信息硬编码返回**（conversation-loop.ts）
- provider.chat() 包裹 try/catch，根据错误内容分类（超时/密钥/配额/模型不可用/context-length/其他）
- 每种错误返回中文硬编码消息（如"⚠️ 云端服务无响应（连接超时）"）
- 返回结构化 AgentResponse 而非抛出异常

**2. 错误广播链路**（wake-system.ts / ws-server.ts / runtime.ts）
- WakeSystem 新增 `agent_error` 事件类型，带有 error 字段
- agent.run() 返回错误内容（以⚠️开头或"达到最大工具调用轮数限制"）时广播 agent_error
- provider 抛出异常时广播 agent_error 后重试，重试失败再次广播
- TODOboard 路径也改为 agent_error
- WS 直连 `send_message` 路径的 `.then()` 和 `.catch()` 都广播 agent_error

**3. 唤醒队列广播**（wake-system.ts → ws-server.ts）
- WakeSystem 新增 `getQueue()` 和 `setOnQueueChange(cb)`
- 入队/出队/合并/手动唤醒时均广播队列状态
- Group → GroupManager → WS server → 前端 `wake_queue_update` 推送

**4. 前端唤醒队列组件**（WakeQueueSection.tsx）
- 新建 WakeQueueSection 组件，显示所有群组的排队 Agent
- 每 3 秒轮询 get_wake_queue，同时接收实时推送
- SettingsView 菜单新增"唤醒队列"入口（settings.ts 扩展类型）

## 2026-05-07

### 修复：群组工具调用轮数限制 — 移除 config/default.json 的 20 轮硬限

**问题描述**：群组中 Agent 工具调用轮数仍受限（返回"达到最大工具调用轮数限制"），尽管 config-loader.ts 默认值为 Infinity。

**根因分析**：
`config/default.json` 中 `"maxToolRounds": 20` 和 `"butlerMaxToolRounds": 40` 在 deepMerge 时覆盖了 `config-loader.ts` 的 `Infinity` 默认值，导致所有 Agent（含群组 Agent）受限于 20 轮。群组 Agent 的 `createGroupLoop()`（agent.ts:289）使用 `this.config.maxToolRounds`，与普通 Agent 共用同一值。

**修改文件**：
- `config/default.json` — 移除 `maxToolRounds` 和 `butlerMaxToolRounds`，回退至 `config-loader.ts` 的 `Infinity` 默认
- `docs/用户指南.md` — 同步移除示例配置中的对应字段

**修改内容**：
1. config/default.json: 删除 `"maxToolRounds": 20` 和 `"butlerMaxToolRounds": 40`
2. `config-loader.ts` 的 `DEFAULT_CONFIG.core.maxToolRounds = Infinity` 和 `butlerMaxToolRounds = Infinity` 现在能真正生效

### 修复：启动时自动唤醒不该唤醒的 Agent + 唤醒队列显示正在回答状态

**问题描述**：
1. 每次重启应用后，群组中大量 Agent 被自动唤醒（即使没有新消息），导致启动后出现大量无效响应
2. 唤醒队列组件只显示排队中的 Agent，无法看到正在回答中的 Agent，用户不清楚"谁在处理中"

**根因分析**：
1. restoreGroups() 使用 `ctxV2.append()` 恢复历史消息，触发 WakeSystem 的 `onMessage` 回调，扫描历史 @mention 后全部加入唤醒队列。虽然 `pauseWakeSystem()` 暂停了队列处理，但入队操作仍在进行。当 `resumeAllWakeSystems()` 时，所有积压的 @mention 被一次性触发。
2. WakeSystem 从队列出队后即无法追踪，前端不知道哪个 Agent 正在执行。

**修改文件**：
- `packages/core/src/group/manager.ts` — restoreGroups 改用 appendSilent
- `packages/core/src/group/wake-system.ts` — 新增 clearQueue()、_currentProcessing 追踪、入队类型改为 appendSilent
- `packages/core/src/group/group.ts` — 新增 clearWakeQueue()
- `packages/core/src/api/ws-server.ts` — queue data 携带 processing 字段
- `gui-v2/src/stores/wakeQueue.ts` — store 新增 processing 字段
- `gui-v2/src/components/settings/WakeQueueSection.tsx` — 显示"正在回答"状态
- `gui-v2/src/hooks/useWebSocket.ts` — 适配 processing 字段

**修改内容**：

**1. 启动误唤醒修复**（manager.ts）
- `restoreGroups()`: `ctxV2.append()` → `appendSilent()`，恢复历史消息时不触发 `onMessage` 回调，@mention 不会入队
- `wake-system.ts`: 新增 `clearQueue()` 方法作安全兜底

**2. 正在回答追踪**（wake-system.ts）
- 新增 `_currentProcessing` 字段，在 `agent.run()` 执行前设置为当前 Agent ID，完成后清空
- `getQueue()` 返回 `{ queue, processing }` 包含正在处理的 Agent
- 每次状态变化（开始处理/完成/失败）广播队列状态

**3. 前端展示**（WakeQueueSection.tsx）
- 正在回答的 Agent 显示旋转图标 + "正在回答…" 标签（高亮边框）
- 头部统计区分"X 个正在回答，Y 个等待唤醒"
- 每个群组分别显示排队和正在回答的 Agent

## 2026-05-07

### Office MCP 服务器 — 高级工具扩展（12 个高级工具）

**问题描述**：11 个基础工具只覆盖创建/保存/基础写入，缺少文档处理的高级功能。

**新增工具**：

**Word 高级**（3 个）
| 工具 | 功能 |
|------|------|
| `office_doc_set_header_footer` | 设置页眉页脚 |
| `office_doc_add_image` | 插入图片（URL/本地 + 标题） |
| `office_doc_merge` | 合并多个文档 |

**Excel 高级**（6 个）
| 工具 | 功能 |
|------|------|
| `office_excel_open` | 打开已有 .xlsx 文件编辑 |
| `office_excel_add_formula` | 插入 Excel 公式（SUM/AVERAGE 等） |
| `office_excel_sort` | 按列排序（升/降序 + 表头） |
| `office_excel_merge_cells` | 合并/取消合并单元格 |
| `office_excel_freeze_panes` | 冻结窗格（冻结表头行） |
| `office_excel_format_range` | 格式化区域（字体/颜色/边框/对齐/数字格式） |

**PPT 高级**（3 个）
| 工具 | 功能 |
|------|------|
| `office_ppt_add_table` | 幻灯片中插入表格（首行加粗表头） |
| `office_ppt_add_chart` | 添加图表（柱状/折线/饼图） |
| `office_ppt_add_notes` | 添加演讲者备注 |

**修改文件**：
- `packages/mcp-servers/office/src/office-engine.ts` — 新增 12 个高级引擎函数
- `packages/mcp-servers/office/src/tools.ts` — 新增 12 个高级工具定义

**总计**：32 个工具（11 基础 + 12 高级 + 9 格式/公文/PPT视觉），覆盖 95% 以上的办公文档处理需求。

### Office MCP 服务器 — 高级格式/公文式/PPT视觉设计（9 个新增）

**问题描述**：缺少中文公文格式、高级段落格式和 PPT 视觉设计能力。

**新增工具**：

**高级格式 & 公文式**（5 个）
| 工具 | 功能 |
|------|------|
| `office_doc_set_margins` | 页边距设置（公文标准: 上3.7/下3.5/左2.8/右2.6 cm） |
| `office_doc_set_line_spacing` | 行距/段距设置（公文正文标准 28 磅） |
| `office_doc_add_page_number` | 页码添加（支持对齐/起始页） |
| `office_doc_create_official` | **一键创建国标公文**（GB/T 9704-2012 全格式） |
| `office_doc_format_paragraph` | 段落高级格式（缩进/边框/底纹） |

**公文式文档标准**（`office_doc_create_official`）：
- 页边距: 上3.7cm / 下3.5cm / 左2.8cm / 右2.6cm
- 标题: 二号宋体加粗居中
- 正文: 三号仿宋 / 28磅行距 / 首行缩进2字符
- 一级标题: 黑体 / 二级标题: 楷体
- 文号/签发人/附件/落款/成文日期自动排版
- 页码居中

**PPT 视觉设计**（4 个）
| 工具 | 功能 |
|------|------|
| `office_ppt_set_theme` | 主题配色（主色/辅色/背景/字体色） |
| `office_ppt_style_slide` | 幻灯片样式（背景色/渐变） |
| `office_ppt_add_transition` | 切换效果（fade/push/wipe/split/reveal） |
| `office_ppt_format_text` | 文本高级格式（字号/颜色/阴影/字体） |

### Office MCP 服务器 — Word/Excel/PowerPoint 三件套

**问题描述**：Agent 需要创建和编辑办公文档（Word/Excel/PPT），无对应 MCP 服务器。

**解决方案**：新建 `packages/mcp-servers/office/` MCP 服务器，基于 `docx` / `exceljs` / `pptxgenjs` 实现办公文档的创建→编辑→保存全生命周期。通过 stdio JSON-RPC 2.0 协议暴露 11 个工具。

**技术栈**：TypeScript + docx + exceljs + pptxgenjs（纯 Node.js，无需 Python/Office 安装）

**工具列表**：

| 分类 | 工具 | 功能 |
|------|------|------|
| Word (3) | `office_create_doc` | 创建文档（支持初始段落/标题/格式） |
| | `office_doc_add_content` | 添加段落/表格/分页符 |
| | `office_doc_save` | 保存 .docx 到磁盘 |
| Excel (4) | `office_create_excel` | 创建工作簿（支持初始数据） |
| | `office_excel_write_data` | 写入单元格区域（自动表头加粗） |
| | `office_excel_add_sheet` | 添加新工作表 |
| | `office_excel_save` | 保存 .xlsx 到磁盘 |
| PPT (3) | `office_create_ppt` | 创建演示文稿（支持初始幻灯片） |
| | `office_ppt_add_slide` | 添加幻灯片（标题/正文/图片） |
| | `office_ppt_save` | 保存 .pptx 到磁盘 |
| 状态 | `office_status` | 服务器状态查询 |

**修改文件**：
- `packages/mcp-servers/office/` — 新建 MCP 服务器（5 源文件）
- `config/default.json` — 添加 office MCP 配置（默认沙箱模式）
- `STRUCTURE.md` — 新增 office 服务器条目

### MCP 架构重构 — 全局管理器 + 按需发现注册 + 公共提示词

**问题描述**：之前 MCP 工具在启动时自动注册到所有 Agent（N 次重连浪费），且 Agent 没有 MCP 相关提示词，不知道可以通过 mcp-discover/mcp-register 发现和使用外部工具。

**架构变更**：
- **旧**：`connectAllMCPServers()` 遍历 Agent 逐个连接，每个 Agent 启动一次 MCP 服务器进程
- **新**：全局 `MCPManager` 启动时统一连接 → Agent 按需通过 `mcp-discover`/`mcp-register` 发现和注册工具

**修改文件**：
- `packages/core/src/mcp/manager.ts` — 新增 `getServers()` / `getServerTools()` 查询方法
- `packages/core/src/tools/mcp-tools.ts` — 新建 `mcp-discover` / `mcp-register` 工具
- `packages/core/src/runtime.ts` — 全局 MCPManager，`registerMCPTools()` 注册发现工具
- `packages/core/src/agent/agent.ts` — 新增 `rebuildLoop()` 方法
- `config/templates/AGENTS.md` — 新增 MCP 工具使用说明

**修改内容**：
1. **MCPManager 新增查询 API**：`getServers()` 返回所有已连接服务器及其工具列表，`getServerTools(id)` 返回指定服务器桥接工具
2. **mcp-discover 工具**：Agent 调用后可查看所有可用 MCP 服务器和工具列表
3. **mcp-register 工具**：Agent 调用后将指定服务器工具注册到自己的 ToolRegistry，自动重建 conversation loop
4. **全局 MCPManager**：Runtime 启动时统一连接所有 MCP 服务器，不再每 Agent 独立连接
5. **rebuildLoop()**：Agent 新增公开方法，供 mcp-register 外部注册工具后重建 loop
6. **AGENTS.md 提示**：新增"MCP 服务器工具（按需注册）"章节，告知 Agent 使用 mcp-discover → mcp-register 流程

### QQ Bot MCP 服务器 — 增强：富媒体/群管理/事件网关

**问题描述**：初版仅实现基础文本消息和群列表。需增强消息类型、群组管理能力和实时事件接收。

**修改文件**：
- `packages/mcp-servers/qqbot/src/qq-client.ts` — 重写，新增 20+ API
- `packages/mcp-servers/qqbot/src/tools.ts` — 重写，5 个→18 个工具
- `packages/mcp-servers/qqbot/src/index.ts` — 新增网关自动连接
- `config/default.json` — 新增 `QQ_BOT_AUTO_CONNECT_GATEWAY`

**修改内容**：

**1. 消息收发增强**（7 个工具）
- `qq_send_friend_message` / `qq_send_group_message` — 纯文本
- `qq_send_markdown_message` — Markdown 富文本（标题/表格/代码块）
- `qq_send_image` — 图片消息（URL, 最大 30MB）
- `qq_send_rich_message` — 文字+图片+文件组合
- `qq_withdraw_message` — 撤回 2 分钟内群消息
- `qq_get_message_history` — 获取群最近消息记录

**2. 群组管理增强**（8 个工具）
- `qq_get_groups` / `qq_get_group_info` / `qq_get_group_members` / `qq_get_member_info`
- `qq_kick_member` — 踢出成员
- `qq_mute_member` — 禁言/解禁（毫秒精度）
- `qq_set_group_admin` — 设置/取消管理员
- `qq_get_announcements` — 群公告

**3. 事件通知系统**（5 个工具）
- WebSocket 网关连接/断开/状态
- 事件轮询 `qq_poll_events`（消费即清空）
- 消息轮询 `qq_poll_messages`（含附件）
- 自动重连（5 秒间隔）+ 心跳维持

**4. QQ API 客户端增强**
- 新增 PATCH/DELETE HTTP 方法
- Markdown/图片/富媒体消息发送
- 群成员管理（踢出/禁言/管理员设置）
- WebSocket Gateway 连接（完整握手/心跳/Identify/重连）
- 事件缓存 + 消息提取（C2C/GROUP_AT）

### QQ Bot MCP 服务器 — 实现 Agent 调用 QQ 操作工具

**问题描述**：P1 待办"6. MCP 实际对接"中基础设施（动态注册 + 前端 UI）已完成，但缺少可用的 MCP 服务器。Agent 无法通过工具操作 QQ Bot（发消息、管理群组、传文件）。

**解决方案**：新建 `packages/mcp-servers/qqbot/` MCP 服务器，通过 stdio JSON-RPC 2.0 协议暴露 5 个 QQ Bot 操作工具。配置写入 `config/default.json#mcpServers.qqbot`，Runtime 启动时自动连接所有 Agent。

**修改文件**：
- `packages/mcp-servers/qqbot/` — 新建 QQ Bot MCP 服务器（4 源文件）
- `config/default.json` — 添加 qqbot MCP 服务器配置
- `pnpm-workspace.yaml` — 添加 `packages/mcp-servers/*` glob
- `STRUCTURE.md` — 新增 mcp-servers 目录树

**修改内容**：

1. **MCP 协议服务器** (`mcp-server.ts`)：实现 JSON-RPC 2.0 over stdio，支持 initialize/tools/list/tools/call/ping
2. **QQ API 客户端** (`qq-client.ts`)：封装 QQ Bot 官方 HTTP API（消息/群组/文件），沙箱模式（无凭据时返回模拟数据）
3. **工具定义** (`tools.ts`)：5 个 MCP 工具
   - `qq_send_friend_message` — 发送好友消息
   - `qq_send_group_message` — 发送群消息
   - `qq_get_groups` — 获取群列表
   - `qq_get_group_info` — 获取群详情
   - `qq_upload_file` — 上传群文件
   - `qq_bot_status` — Bot 状态查询
4. **自动注册**：`config/default.json#mcpServers.qqbot` → Runtime 启动时 `connectAllMCPServers()` 自动连接所有 Agent，工具以 `mcp:qqbot:qq_send_*` 格式注册

### TODOboard 触发链路修复 — 事件广播 / WakeSystem 唤醒 / todo-complete 传参

**问题描述**：TODOboard 功能存在 3 个关键缺陷，Agent 难以在独立和群组场景中正常触发 TODO。

**根因分析**：
1. **Agent TODO 发射后不管**（`runtime.ts`）：`agent.run()` 结果被丢弃，前端无事件，回复无人查看
2. **群组 TODO 绕过 WakeSystem**（`manager.ts`）：`targetAgent.run()` 不经过群组上下文，Agent 无三层记忆、回复不写回群组
3. **todo-complete onComplete 丢失**（`butler.ts`）：ButlerAgent 用 2 参调用 `makeTodoCompleteTool`，覆盖了基类的 3 参版本，`groupScanner.complete()` 路径永不触发

**修改文件**：
- `packages/core/src/runtime.ts` — Agent TODO 添加 agent_started/agent_completed 广播 + 回复日志
- `packages/core/src/group/manager.ts` — 群组 TODO 改用 `group.postMessage()` 触发 WakeSystem 自然唤醒
- `packages/core/src/agent/butler.ts` — `makeTodoCompleteTool` 传 3 参，恢复 onComplete 动作链

**修改内容**：
1. **Agent TODO 事件广播**：`agent.run()` 前后广播 `agent_started`/`agent_completed`，流式广播 tool_event/usage_stats，日志记录 TODO 触发和回复
2. **群组 TODO WakeSystem 唤醒**：`onTrigger` 调用 `g.postMessage("TODOboard", "@{targetId} {message}")`，触发完整唤醒链路（@mention → 队列 → 三层上下文 → 回复写回群组 → WS 广播）
3. **todo-complete 传参修复**：同时传入 `groupStoreGetter` 和 `groupScannerGetter`，优先走 `scanner.complete()` 触发 onComplete 动作链

### TODOboard 触发续期 — markTriggered 后移 + tool_event 流式

**问题描述**：续期修复和工具调用可视化缺失。

**根因分析**：
1. `markTriggered` 在 `onTrigger` 之前调用，触发失败时 TODO 永久丢失
2. Agent TODO 的 `agent.run()` 未传 events 回调，前端看不到 tool_call 和 token 用量

**修改文件**：
- `packages/core/src/todo/scanner.ts` — markTriggered 移至 onTrigger 成功后
- `packages/core/src/todo/group-scanner.ts` — 同上
- `packages/core/src/runtime.ts` — agent.run() 传入 events（onToolCall/onToolResult/onUsage）

**修改内容**：
1. **续期失败恢复**：`markTriggered()` 从 `onTrigger` 前移至后，触发失败时 TODO 保持 pending，下次扫描可重试
2. **tool_event 流式**：Agent TODO 的 `agent.run()` 传入 events 回调，广播 tool_call start/complete、usage_stats 到前端

### 待办文档审计 — 同步代码实际状态

**问题描述**：`docs/待办.md` 最后更新 2026-04-25，多处已实现功能仍标记为未完成。

**修改文件**：
- `docs/待办.md` — 更新 7 处状态

**修改内容**：

| 条目 | 之前 | 之后 | 根因 |
|------|------|------|------|
| Item 4 Skill 数量 | 3 个 | 6 个（+agent-creation, +math-analysis-learning * 2） | 新增技能未同步 |
| Item 5 白名单域名访问 | ❌ 未实现 | ⚠️ 配置层完成，iptables 未接入 | 实现后未更新状态 |
| Item 5 安全加固 | ❌ 未实现 | ❌ seccomp/apparmor，仅 noNewPrivileges + roRootfs + cap-drop | 描述不准确 |
| Item 6.2 MCP 动态注册 | ❌ 未实现 | ✅ 已实现（MCPManager.connect 自动发现注册） | 实现后未同步 |
| Item 6.3 前端 MCP UI | ❌ 未实现 | ✅ 已实现（McpSection 组件） | 实现后未同步 |
| Item 7 完成进度 | "大部分已实现" | ✅ 7/8 已完成 | 状态过时 |
| Item 8 群组历史管理 | 全部 ❌ | 🔵 持久化/摘要/可见性 3 项 ✅，滚动搜索/分页 2 项 ⚠️ | 三层记忆架构实现后未同步 |

### 审计报告全部修复 — ConversationLoop 重建优化 / agent-message 工厂化 / TODO 去重

**问题描述**：`docs/Agent系统深度调查报告.md` §6 列出的 6 个问题全部修复。

**修改内容**：

#### Fix 6.3 [P1] ConversationLoop 重建开销
- `agent.ts`: 新增 `_toolExecutor` 字段，构造时存储后在 `injectSkillRepository()` / `injectGroupTools()` 中复用，避免每次创建新的 PermissionEnforcer + ToolExecutor

#### Fix 6.5 [P2] agent-message 全局单例 → 工厂模式
- `agent-message.ts`: 移除模块级 `_registry` 变量，改为 `makeAgentMessageTool(registry)` 工厂函数，每个 Runtime 实例持有自己的 registry 引用
- `agent.ts`: 从 `BUILTIN_TOOLS` 移除 `agent-message`，新增 `injectAgentMessageTool(registry)` 方法
- `runtime.ts`: 移除 `setAgentRegistry()` 调用，在 `restoreAgents()` / `registerPrebuiltAgents()` 中调用 `injectAgentMessageTool()`
- `butler.ts`: `butler-create-agent` 创建 Agent 后调用 `injectAgentMessageTool(registry)`
- `ws-server.ts`: `create_agent` 处理器中调用 `injectAgentMessageTool(this.agentRegistry)`
- `index.ts`: 导出改为 `makeAgentMessageTool`

#### Fix 6.6 [P2] ButlerAgent TODO 工具重复注册
- `butler.ts`: 移除冗余的 `currentTimeTool` 注册（已在父类 Agent 构造函数中注册）

**修改文件**：
- `packages/core/src/tools/agent-message.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/agent/butler.ts`
- `packages/core/src/runtime.ts`
- `packages/core/src/api/ws-server.ts`
- `packages/core/src/index.ts`

### 修复：restoreAgents 默认工具缺失 + 群组工具注入缺失

**问题描述**：`Agent系统深度调查报告` 发现 `restoreAgents()` 存在两个 P0 Bug：
1. 默认工具列表缺少 `edit-file` 和 `agent-message`
2. 恢复 Agent 后未调用 `injectGroupTools()`，导致重启后的 Agent 无法参与群组通信

**根因分析**：
1. `runtime.ts:248` — 默认工具列表与 `butler.ts`、`ws-server.ts` 不一致（后者已在 5/7 早些时候修复）
2. `runtime.ts:257` — `restoreAgents()` 创建 Agent 后调用了 `injectSkillRepository()` 但遗漏了 `injectGroupTools()`，而 `registerPrebuiltAgents()` 有正确调用

**修改文件**：
- `packages/core/src/runtime.ts` — 两处修复

**修改内容**：
1. `restoreAgents()` 默认工具列表补上 `edit-file` 和 `agent-message`
2. `restoreAgents()` Agent 创建后添加 `injectGroupTools()` 调用

### 功能可访问性审计与修复 — Agent/群组工具缺口

**问题描述**：审计发现 6 个可访问性缺口，非 Butler Agent 无法使用群组通信工具，新建 Agent 缺少关键工具，WS 创建 Agent 未注册 skill/群组工具。

**根因分析**：
1. `group-members`/`talk-create`/`talk-send`/`talk-read` 仅在 `butler.ts` 中注册，常规 Agent 和 Host 无此能力
2. `butler-create-agent` 和 WS `create_agent` 默认工具列表不完整（缺少 `edit-file`/`agent-message`）
3. Host 工具白名单缺少 `edit-file`/`web-fetch`/`agent-message`
4. WS `create_agent` 创建后未调用 `injectSkillRepository()` 和 `injectGroupTools()`
5. Agent 加入群组时未注入群组通信工具

**修改文件**：
- `packages/core/src/agent/agent.ts` — 新增 `injectGroupTools()` 方法
- `packages/core/src/agent/butler.ts` — 修正默认工具列表、创建群组/加入成员时注入群组工具
- `packages/core/src/api/ws-server.ts` — 修正默认工具列表、创建 Agent/群组/添加成员时注入工具
- `packages/core/src/runtime.ts` — 修正 Host 默认工具列表、注册 Agent 时注入群组工具

**修改内容**：

1. **Agent.injectGroupTools()** (`agent.ts`)：新增方法，为 Agent 注册 `group-members`/`talk-create`/`talk-send`/`talk-read` 四个群组通信工具（含去重），重建 conversation loop

2. **默认工具列表修正**（`butler.ts:156-157`, `ws-server.ts:538-549`）：
   - `["bash", "read-file", "write-file", "glob", "grep", "web-fetch"]`
   - → `["bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message"]`
   - 新增 `edit-file`（字符串替换编辑）和 `agent-message`（Agent 间直接通信）

3. **Host 工具白名单修正**（`runtime.ts:561-564`）：新增 `edit-file`, `web-fetch`, `agent-message`

4. **WS create_agent 注入工具**（`ws-server.ts`）：创建 Agent 后调用 `agent.injectSkillRepository()` 和 `agent.injectGroupTools()`

5. **创建群组时注入**（`butler.ts` `makeCreateGroupTool`, `ws-server.ts` `create_group`）：为所有初始成员调用 `agent.injectGroupTools()`

6. **加入群组时注入**（`butler.ts` `makeAddToGroupTool`, `ws-server.ts` `add_group_member`）：为新成员调用 `agent.injectGroupTools()`

7. **运行时注册 Agent 时注入**（`runtime.ts:662`）：`registerPrebuiltAgents()` 中所有 Agent 调用 `agent.injectGroupTools()`

### CLAUDE.md 更新 — 新增三项强制检查

**修改文件**：
- `CLAUDE.md` — 新增"每次更新代码必须完成三项"章节

**修改内容**：
1. 更新 `PROGRESS.md`（日期、问题描述、根因、修改文件、修改内容）
2. 更新 `docs/` 中相关文档（后端能力清单/待办/前端清单等），文档必须与代码一致
3. 确认新功能对 Agent/群组可访问性（Agent 能用吗、群组能用吗、前端能操作吗）

### 文档审计：删除幻觉内容，同步代码实际状态

**修改文件**：
- `docs/后端能力清单.md` — 修正 8 处（统计/MCP预设/Butler工具/记忆系统/WS/沙箱/Provider/测试）
- `docs/待办.md` — 修正 3 处（TODO/记忆/Skill 状态）

---

**问题描述**：`docs/后端能力清单.md` 和 `docs/待办.md` 中存在多处与代码实际状态不一致的"幻觉内容"。

**修改文件**：
- `docs/后端能力清单.md` — 修正统计数据、工具列表、MCP 预设、记忆系统、WS API 等 8 处
- `docs/待办.md` — 修正 P0 #1 TODO驱动自动化状态、P2 #7 记忆系统状态
- `packages/core/src/runtime.ts` — 移除不存在的工具引用

**修改内容**：

1. **统计数据更新**（后端能力清单）：147→~275 测试、17→36 测试文件、~83→~90 TS 源文件、最后更新日期 2026-04-21→2026-05-07

2. **Butler 工具表修复**（后端能力清单）：
   - 工具数量从"20+"修正为"14"
   - 移除错误归类的 `group-speak`/`talk-create`/`talk-send`/`talk-read`（这些是群组工具，在 group-tools.ts 中，非 Butler 专属）
   - 添加注释说明群组通信工具的实际位置

3. **MCP 预设模板删除**（后端能力清单 §8.1）：
   - 删除 GitHub/Word/Excel/PowerPoint 四条预设（`@modelcontextprotocol/server-github`、`mcp-server-docx` 等）
   - 代码中完全不存在这些预设配置，属于幻觉

4. **记忆系统更新**（后端能力清单 §七）：
   - 新增 MemoryStore 统一引擎描述（双存储、冻结快照、安全扫描、原子写入、字符限制、FTS5 搜索）
   - 新增 memory 工具（add/replace/remove/read）描述
   - 旧 MemoryWriter/Reader/Indexer 标记为兼容模块

5. **其他修正**（后端能力清单）：
   - WS API 从"10 个命令"修正为"32+ 个命令"
   - 沙箱从 `sandbox.ts` 修正为 `tools/sandbox/` 并列出 5 个子文件
   - Provider 新增 Moonshot 和 SiliconFlow（代码中存在但文档遗漏）
   - QQ Channel 协议新增 QQBot Gateway

6. **待办事项状态修正**：
   - P0 #1 TODO驱动自动化：❌ 未实现 → ✅ 已实现（代码中 TodoStore/Scanner/Tools 完整）
   - P2 #7 记忆系统重构：7/8 已完成，仅"搜索结果智能截断"待实现

7. **代码修复**：
   - `runtime.ts`：butler tools 白名单中将不存在的 `"group-speak"` 替换为实际存在的 `"group-members"`

---

## 2026-05-01

### 群组三层记忆架构实现

**问题描述**：当前 WakeSystem 每次唤醒 Agent 时将 current.md 全文（59KB+）作为上下文发送。Agent 的 ConversationLoop 跨调用累积这些上下文，导致：
1. 上下文溢出（100 条消息 × 59KB ≈ 5.9MB）
2. 历史不一致（失败调用留下孤立 user 消息）
3. 特定 Agent（被 @mention 最多的）最先崩溃

**解决方案**：将群组记忆分为三层（Raw DB + Abstract 文件 + 每 Agent 压缩历史），Agent 唤醒时发送压缩历史 + 近期未压缩原文，而非全量累积。

**修改文件**：
- `packages/core/src/group/group-db.ts` — 新增 GroupDB 主库（messages + visibility + compression_marks 三表）
- `packages/core/src/group/compressed-history.ts` — 新增 CompressedHistory 每 Agent 压缩历史管理
- `packages/core/src/tools/summarize-phase.ts` — 新增 summarize-phase 工具（Agent 主动压缩历史）
- `packages/core/src/group/three-layer-memory.test.ts` — 新增 10 个自动化测试
- `packages/core/src/group/group.ts` — 集成 GroupDB，3 个消息入口写入主 DB，computeVisibility/writeToGroupDb/syncToAgentDbs
- `packages/core/src/group/manager.ts` — restoreGroups 写入历史消息到 GroupDB（content hash 防重复）
- `packages/core/src/group/wake-system.ts` — 重写上下文构建为三层架构，回复同步到 GroupDB，不再单独传 groupContext
- `packages/core/src/agent/agent.ts` — 注册 summarize-phase 工具，getGroupLoop 每次清空历史

**修改内容**：
1. **GroupDB**：SQLite 主库，messages 表存全量消息，visibility 表按 agent_id 过滤可见性，compression_marks 表跟踪压缩标记
2. **消息写入链路**：postMessage/postToTalk/postTalkSummary/injectMessage 全部写入 GroupDB，按 tag（main/talk）计算可见性，写入后同步到所有可见 Agent 的从 DB
3. **上下文构建**：WakeSystem 改为三层构建 — 抽象层（群组文件） + 压缩历史（{agentId}-compressed.md） + 未压缩原文（GroupDB 查询）+ 触发消息
4. **ConversationLoop**：每次群组唤醒前清空历史，上下文由 WakeSystem 每次完整重建，不再跨调用累积
5. **summarize-phase**：Agent 完成阶段性任务后主动调用，压缩历史并清理 Agent 从 DB 中的旧消息
6. **回复同步**：Agent 回复通过 appendSilent 写入 GroupContextV2 后，同步写入 GroupDB

---

## 2026-04-30 (4)

### 修复：特定 Agent（塔防游戏逻辑工程师）被 @mention 后无法回复

**问题描述**：群组中"塔防游戏逻辑工程师"每次被 @mention 后都无法回复，其他 Agent 正常。

**根因分析**：
1. Agent 的群组 ConversationLoop 历史会跨调用累积，如果某次调用失败（LLM API 错误、上下文过大等），历史会处于不一致状态（有 user 消息但无 assistant 回复）
2. 后续调用在不一致的历史上继续累积，导致 LLM API 持续失败
3. `executeWake` 的 catch 块只记录日志，不广播错误到前端，用户看不到任何反馈

**修改文件**：
- `packages/core/src/group/wake-system.ts` — 错误恢复 + 错误广播
- `packages/core/src/agent/agent.ts` — 新增 `clearGroupLoop()` 方法

**修改内容**：
1. **错误恢复机制**：`executeWake` 失败后自动清除群组对话历史，用精简上下文（只用触发消息）重试一次
2. **错误广播**：失败时将错误信息通过 `onAgentResponse` 发送到前端，用户能看到 `[错误] Agent 执行失败: ...` 提示
3. **`clearGroupLoop(groupId)`**：Agent 新增方法，清除指定群组的 ConversationLoop 历史

---

## 2026-04-30 (3)

### 修复：agent_started 广播中 @mention 列表过量 — 按通道去重

**问题描述**：前端日志显示 `agent_started` 事件中的 `@mention` 列表包含几十个重复条目。

**根因分析**：
1. `wake-system.ts` 的 `executeWake()` 从 `enrichedContext`（完整群组历史）中用正则提取 `@mention`，导致历史中所有 mention 重复列出
2. `ws-server.ts` 的 `send_message` 处理器同样从完整消息内容中正则提取，未去重
3. 没有通道信息，无法区分同名 mention 来自哪个群组

**修改文件**：
- `packages/core/src/group/wake-system.ts` — `WakeEntry` 新增 `triggerMentions` 字段
- `packages/core/src/api/ws-server.ts` — `send_message` 处理器 mention 去重
- `gui-v2/src/hooks/useWebSocket.ts` — 适配新 mentions 格式

**修改内容**：
1. **预提取触发 mention**：`enqueueMention` 只记录触发该 Agent 的 `@mention` 文本（`@{resolvedId}`），不记录整条消息；按 resolved agent ID 去重
2. **通道属性**：mentions 格式从 `string[]` 改为 `Array<{ text: string; channel: string }>`，`channel` 为 groupId（群组通道）或 agentId（主通道）
3. **send_message 去重**：用户直接发消息时也按 resolved agent ID 去重，附加通道信息
4. **前端适配**：`useWebSocket.ts` 使用 `m.text` 显示，`mentionTargets` 存不带 `@` 的名称（LogsSection 渲染时加 `@`）
5. **修复 @@ 双前缀**：`group_message` 处理器的 `mentionTargets` 也去掉 `@` 前缀，避免渲染时出现 `@@Agent`

---

## 2026-04-30 (2)

### 修复：启动时 GUI 无法加载 Agent/群组列表（二次修复）

**问题描述**：之前的端口探测 + 空状态重试修复后，启动时 GUI 仍然偶现无法加载智能体和群组列表。

**根因分析**：
启动序列中 `wsServer.start()` 在 `restoreGroups()` 之后调用，Agent 和群组数据在 WS server 启动前已全部加载到 registry。但 WS server 启动后没有主动广播最终状态 — 如果 GUI 连接时序恰好在某些边缘情况（如首次 `state` 消息丢失、WS 连接建立瞬间的竞态），客户端可能收到空状态且重试机制也未能恢复。

**修改文件**：
- `packages/core/src/runtime.ts` — 启动完成后调用 `broadcastState()`
- `packages/core/src/api/ws-server.ts` — `getState()` 增加日志

**修改内容**：
1. **启动后主动广播状态**：在 `resumeAllWakeSystems()` 之后调用 `wsServer.broadcastState()`，确保所有已连接的 GUI 客户端收到完整的 Agent/群组列表
2. **getState 日志**：每次调用 `getState()` 时记录 agent 数量和 group 数量，便于诊断连接时序问题

### 修复：群组上下文污染 — 多群组唤醒时 Agent 上下文相互覆盖

**问题描述**：Agent 同时属于多个群组时，群组 A 的内容会被发送到群组 B，引起上下文污染。群主（host）尤为明显。

**根因分析**：
1. `_groupContext` 是 Agent 实例上的单个可变字段 — 多群组并发时互相覆盖（竞态条件）
2. `conversationLoop.history` 跨群组累积 — 群组 A 的对话历史混入群组 B 的上下文
3. `promptBuilder` 每轮工具调用重新读取 `_groupContext` — 多轮时可能已被其他群组覆盖

**修改文件**：
- `packages/core/src/agent/agent.ts` — 新增 `RunOptions` 接口、`createGroupLoop()`/`getGroupLoop()` 方法、修改 `run()` 支持群组隔离
- `packages/core/src/group/wake-system.ts` — `executeWake()` 改用 `RunOptions` 参数传递 groupContext，不再调用 `setGroupContext`/`clearGroupContext`
- `packages/core/src/api/ws-server.ts` — `send_message` 处理器改用 `RunOptions` 传递 groupContext

**修改内容**：
1. **RunOptions 接口**：`run(input, { groupId, groupContext, events })` — 将群组上下文从"Agent 属性"降级为"运行时参数"
2. **群组隔离 ConversationLoop**：当 `groupId` 存在时，用 `group:{groupId}` 作为 key 创建独立的 ConversationLoop（复用 `sessionLoops` 模式），history 不再跨群组累积
3. **闭包捕获 groupContext**：`createGroupLoop()` 的 promptBuilder 闭包捕获传入的 `groupContext` 参数，不读取 `this._groupContext`
4. **向后兼容**：`run(input, events)` 旧签名仍可用（非群组场景），`_groupContext`/`setGroupContext`/`clearGroupContext` 保留但不再被群组路径使用

### 修复：@mention 触发链路在日志中不显示

**问题描述**：前端日志系统看不到谁 @ 了谁、谁被触发 — 只有直接发消息时有 `agent_started`，WakeSystem 唤醒路径完全没有广播。

**根因分析**：`agent_started`/`agent_completed` 事件只在 `ws-server.ts` 的 `send_message` 处理器中广播，而 @mention 触发走的是 `WakeSystem.executeWake()` 路径，该路径没有广播这两个事件。

**修改文件**：
- `packages/core/src/group/wake-system.ts` — 新增 `onAgentEvent` 回调 + `setOnAgentEvent` setter，在 `executeWake()` 中广播 `agent_started`/`agent_completed`
- `packages/core/src/group/group.ts` — 新增 `setOnAgentEvent` 委托方法
- `packages/core/src/group/manager.ts` — 新增 `_onAgentEvent` 字段 + `setOnAgentEvent` 方法，在 `create()`/`loadAll()` 中传递
- `packages/core/src/api/ws-server.ts` — `setGroupManager()` 中接入 `gm.setOnAgentEvent()` 回调，广播到前端 WS

### 修复：restoreGroups 阻塞启动 + @mention 误匹配

**问题描述**：
1. 启动时偶现无法加载 Agent/群组列表 — `restoreGroups()` 恢复历史消息时触发 WakeSystem 唤醒队列，LLM 调用阻塞主线程，WS server 延迟启动
2. @mention 提取误匹配中文短词（"到了"、"逻辑工程师"被当作 mention）

**根因分析**：
1. `GroupManager.restoreGroups()` 调用 `ctxV2.append()` 恢复历史消息，触发 WakeSystem 的 `onMessage` 回调 → 入队唤醒 → `processQueue()` 执行 LLM 调用 → 阻塞主线程 → WS server 无法启动
2. `parseMentions` 正则 `@([\w一-鿿][\w一-鿿-]*)` 匹配 2 字符的中文短词

**修改文件**：
- `packages/core/src/group/wake-system.ts` — 新增 `pause()`/`resume()` 机制，`processQueue()` 检查暂停状态
- `packages/core/src/group/group.ts` — 新增 `pauseWakeSystem()`/`resumeWakeSystem()` 委托
- `packages/core/src/group/manager.ts` — `restoreGroups()` 期间暂停 WakeSystem，新增 `resumeAllWakeSystems()` 方法
- `packages/core/src/runtime.ts` — WS server 启动后调用 `groupManager.resumeAllWakeSystems()`
- `packages/core/src/group/group-context-v2.ts` — `parseMentions` 正则要求最少 3 字符
- `packages/core/src/api/ws-server.ts` — `extractMentions` 同步更新正则
- `gui-v2/src/hooks/useWebSocket.ts` — 前端 `extractMentions` 同步更新正则

---

## 2026-04-30

### 增强：日志活动项格式升级（结构化字段 + 准确渲染）

**问题描述**：
1. 日志中 Agent 名称、群组名称没有加粗显示 — `renderBoldText` 用正则匹配引号内容，但日志文本中名称不带引号
2. 修改的文件名没有斜体显示 — `FileChangeView` 用了 `<strong>` 而非 `<em>`
3. 日志无法看到谁 @ 了谁、谁被触发 — 缺少 `agent_started`/`agent_completed` 事件

**根因分析**：
1. `renderBoldText` 依赖正则匹配引号/文件扩展名，无法匹配普通文本中的 Agent/群组名称
2. 后端不广播 agent 处理开始/完成事件，前端无法构建触发链路

**修改文件**：
- `gui-v2/src/stores/activity.ts` — ActivityEntry 增加 `agentName`/`groupName`/`fileName`/`mentionTargets` 结构化字段
- `gui-v2/src/hooks/useWebSocket.ts` — emitActivity 支持 extra 参数；新增 `agent_started`/`agent_completed` 处理；群组消息从 store 解析名称；@mention 记录目标列表
- `gui-v2/src/components/settings/LogsSection.tsx` — 替换 `renderBoldText` 为 `renderActivityText`（使用结构化字段精确渲染）；FileChangeView 文件名改斜体；ToolGroupView/FileChangeView 从 store 解析 agent 名称
- `packages/core/src/api/ws-server.ts` — 在 agent.run() 前广播 `agent_started`，完成后广播 `agent_completed`

**修改内容**：
1. **结构化名称字段**：ActivityEntry 新增 `agentName?`/`groupName?`/`fileName?`/`mentionTargets?`，前端直接用这些字段渲染加粗/斜体，不再依赖文本正则
2. **名称解析**：所有 emitActivity 调用从 agents/groups store 解析名称（agent_destroyed、group_destroyed、member_added、member_removed、group_message、agent_response）
3. **触发链路**：后端新增 `agent_started`（含 mentions 列表）和 `agent_completed` 广播；前端渲染为 ⚡ "AgentB 被触发（@AgentA）" 和 ✅ "AgentB 处理完成"
4. **@mention 追踪**：group_message 日志明确显示 "谁在群组 X 中 @ 了谁"，mentionTargets 用高亮渲染
5. **文件名斜体**：FileChangeView 中 `<strong>` 改为 `<em className="italic text-purple">`

### 修复：群组 @mention 循环唤醒导致消息泛滥

**问题描述**：群组中几个智能体反复轮流回答"工作已经完成"，出现十几条无用消息。

**根因分析**：
1. `ctx.append` 触发 `onMessage` 回调，Agent 回复中的 @mention 再次被处理，形成循环
2. 队列没有去重，同一 Agent 可能被多次唤醒
3. @all 被跳过没有处理
4. 没有记录触发消息的内容，多次 @mention 可能丢失任务

**修改文件**：
- `packages/core/src/group/wake-system.ts` — 重写唤醒机制

**修改内容**：

1. **队列去重：同一 Agent 不重复唤醒**
   - 新增 `enqueueMention` 方法，添加前检查队列中是否已有该 Agent
   - 如果已有，合并触发内容（不重复唤醒，但保留所有任务上下文）

2. **触发内容保留：防止任务丢失**
   - `WakeEntry` 新增 `triggerContents: string[]` 字段
   - 同一 Agent 被 @多次时，所有触发消息的内容会合并
   - 唤醒时将合并的触发内容作为额外上下文传递给 Agent

3. **使用 `appendSilent` 防止循环唤醒**
   - Agent 回复使用 `ctx.appendSilent` 写入（不触发 `onMessage` 回调）
   - 避免 Agent 回复中的 @mention 再次触发唤醒链

4. **@all 处理：唤醒所有成员（除了发送者）**
   - 检测到 @all 时，遍历所有群组成员加入队列
   - 跳过消息发送者，防止自己唤醒自己

5. **已执行 `pnpm --filter @cobeing/core run build`**

---

### 增强：活动日志功能扩展

**问题描述**：活动日志只显示简单的系统消息，缺少对 @mention、工具调用、文件变更、TODO 变更的监控。

**修改文件**：
- `gui-v2/src/stores/activity.ts` — 重写 activity store，支持多种条目类型
- `gui-v2/src/hooks/useWebSocket.ts` — 添加对各类事件的记录
- `gui-v2/src/components/settings/LogsSection.tsx` — 重写日志 UI

**修改内容**：

1. **activity store 重写**
   - 新增 `ToolCallGroup`：连续工具调用自动合并为一组（5 秒窗口内）
   - 新增 `FileChangeEntry`：记录文件创建/修改/删除
   - 新增 `TodoChangeEntry`：记录 TODO 添加/完成/移除
   - `ActivityEntry` 增加 `category`、`agentId`、`groupId` 字段

2. **useWebSocket.ts 事件记录增强**
   - `group_message`：记录 @mention 事件
   - `tool_event`：改用 `addToolCall` 记录到工具调用组
   - `file_saved`：记录文件变更
   - `todo_added/completed/removed`：记录 TODO 变更
   - 所有事件附带 `agentId`、`groupId` 关联

3. **LogsSection.tsx UI 重写**
   - 统一时间线：所有类型条目按时间排序显示
   - 工具调用组：可展开/折叠的下拉栏，显示调用详情
   - 文件变更：显示操作类型（创建/修改/删除）和文件名
   - TODO 变更：显示操作类型和 TODO 标题
   - 名称加粗：Agent 名称、文件名、@mention 等使用不同颜色加粗
   - 过滤器增加"文件"和"TODO"分类

---

### 修复：活动日志无法正常显示

**问题描述**：前端新增的活动日志功能（设置 → 日志）打开后显示"暂无活动"，看不到任何记录。

**根因分析**：`LogsSection` 组件通过 `window.addEventListener("ws-activity")` 监听事件，但事件是即时触发的——如果用户在日志页面未打开时产生了活动，这些事件就丢失了。组件挂载后无法收到之前的历史事件。

**修改文件**：
- `gui-v2/src/stores/activity.ts` — 新建活动日志 store
- `gui-v2/src/hooks/useWebSocket.ts` — 改用 store 记录活动
- `gui-v2/src/components/settings/LogsSection.tsx` — 改为从 store 读取数据
- `STRUCTURE.md` — 新增 activity.ts 条目

**修改内容**：

1. **新建 activity.ts store**
   - 创建 `useActivityStore`，持久化活动记录（最多 200 条）
   - 提供 `addEntry` 和 `clear` 方法

2. **useWebSocket.ts 改用 store**
   - `emitActivity` 函数改为调用 `useActivityStore.getState().addEntry()`
   - 移除 `window.dispatchEvent` 方式

3. **LogsSection.tsx 改为从 store 读取**
   - 移除 `useState` 和事件监听逻辑
   - 直接从 `useActivityStore` 读取 entries
   - 清空按钮调用 store 的 `clear` 方法

---

### 修复：启动时智能体/群组列表偶现为空

**问题描述**：通过 `start.bat` 启动程序时，有时 GUI 无法正常加载智能体和群组列表，显示"暂无 Agent"和"暂无群组"。

**根因分析**：`start.bat` 使用固定 `timeout /t 3`（3秒）等待后端启动，但后端初始化涉及 Docker 可用性检查、Agent 恢复、MCP 服务器连接等异步操作，3 秒经常不够。GUI 连接 WS 时后端尚未准备好，`getState()` 返回空数组。

**修改文件**：
- `start.bat` — GUI 模式和 Both 模式的启动等待逻辑
- `gui-v2/src/hooks/useWebSocket.ts` — 空状态自动重试机制

**修改内容**：

1. **start.bat — 端口探测替代固定等待**
   - 用 PowerShell 探测 18765 端口是否可连接，替代原来的 `timeout /t 3`
   - 每秒探测一次，最多等待 60 秒
   - 同时修复了 GUI 模式和 Both 模式两处

2. **useWebSocket.ts — 空状态自动重试**
   - 新增 `stateRetryCount` 和 `stateRetryTimer` 两个 ref
   - 收到 `state` 消息时，如果 agents 和 groups 都为空，自动在 2 秒后重发 `get_state`
   - 最多重试 5 次（共 10 秒），防止无限循环
   - 重连时重置计数器，组件卸载时清理 timer
