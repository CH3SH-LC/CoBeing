# CoBeing 项目指令

## 前端设计规则

**涉及前端 UI 设计时，必须先阅读 `.claude/skills/frontend-design/` 目录下的用户偏好文件。**
特别是 `user-ui-preferences.md` 中的层次化渲染、间距、字号、圆角等规则。

**涉及 CoBeing 前端专有名词时，必须先阅读 `.claude/skills/frontend-design/co-being-ui-terms.md`。**
例如用户提到“背景”“卡片背景”“左侧列表卡片”“标题卡片”“主体对话卡片”“设置浮层”“磨砂质感”“全局任务”“智能体设置”“群组设置”时，必须按该术语文件理解，避免把最左侧导航栏、主体列表卡片、对话卡片等概念混淆。

**涉及 CoBeing 默认前端显示、整体风格或跨界面统一时，必须阅读 `.claude/skills/frontend-design/co-being-ui-design-preferences.md`。**
该文件记录当前用户要求的三层主体结构、卡片比例、留白、字号、糖果色层次和浮层规则，优先级高于临时审美猜测。

## 执行规则

- **修改 `.ts` 源码后必须运行 `pnpm build`**，因为 `dev.ts` 从 `packages/core/dist/` 导入编译产物，不构建则改动不生效。

### Bug 修复的相似性扫描

**每次修复一个 bug 时，必须主动扫描项目中是否存在同类问题，一并修复。**

核心原则：一个 bug 很少孤立存在。如果你在某个组件/文件中发现了问题，那么项目中其他使用相同模式、相同 API、相同数据结构的地方很可能有完全相同的 bug。

**扫描步骤**：

1. **分析根因模式** — 抽象出 bug 的本质模式（如 "某个 Zustand selector 返回新引用导致重渲染" 或 "某个全局变量名在 namespace 合并后失效"）
2. **搜索相同模式** — 用 Grep 搜索项目中所有使用了相同模式的地方
3. **逐个检查并修复** — 每个匹配项都可能是相同的 bug，逐一确认并修复
4. **验证全部修复** — `pnpm build` + `pnpm test` 确保所有修复正确

**示例**：
- 发现 `CreateAgentDialog` 中 `disabled` 加在 `Select.Root` 上报错 → 立即检查 `AgentConfigTab`、`GroupMembersTab` 是否有相同问题
- 发现 `SettingsView` 中 `getExtensionsByType()` 每次返回新数组导致渲染异常 → 立即检查 `CreateAgentDialog`、`AgentConfigTab`、`ChannelsSection` 中是否用了相同的 anti-pattern
- 发现 `__cobeingRuntime` 在 namespace 合并后失效 → 立即搜索所有 `__cobeing*` 旧式全局引用是否也失效

**禁止行为**：修完一处就声称 "bug 已修复"，而不检查其他位置。这会制造反复的修复循环。

## 文档系统

### 文档目录结构

> 文档统一存放在工作区根目录 `D:\agent-codes\`，与项目代码分离。

```
D:\agent-codes\
├── GOAL.md               # 项目愿景
├── README.md             # 项目说明
├── STRUCTURE.md          # 项目结构文档
├── PROGRESS.md           # 详细开发进度
├── PROGRESS-LITE.md      # 精简进度（标签化）
├── PROGRESS-VERSION.md   # 版本发布记录
└── docs/
    ├── 项目信息/          # 当前核心项目文档
    │   ├── 产品战略.md    # 产品定位、管家入口、Market 分层
    │   ├── 核心技术.md    # 三层智能体、TODOboard、群组驱动协作技术主张
    │   ├── 项目现状.md    # 按代码事实描述当前实现与边界
    │   ├── 架构说明.md    # 后端/前端/Agent/Group/扩展架构
    │   ├── 使用说明.md    # 当前用户与进阶用户使用路径
    │   └── 当前待办.md    # 当前仍有效的待办
    ├── superpowers/       # 实现计划与设计规格
    ├── 调研/              # 竞品调研与技术调查
    └── archive/           # 历史归档
```

进度文件：
- `PROGRESS.md` — 详细开发进度（每次变更必更新）
- `PROGRESS-LITE.md` — 精简进度（标签化：[New Feature] / [Debug] / [Change]）
- `PROGRESS-VERSION.md` — 版本发布记录（仅发版时维护）
- `STRUCTURE.md` — 项目结构文档（文件变更时自动更新）

---

## 每次更新代码必须完成四项

**每次代码变更（新增功能、修复 bug、重构）后，以下四项缺一不可：**

### 1. 更新 `PROGRESS.md` 和 `PROGRESS-LITE.md`

在 `PROGRESS.md` 文件顶部追加详细变更条目，包含：
- 日期
- 问题描述 / 变更原因
- 根因分析（若是修复）
- 修改文件列表
- 修改内容摘要

在 `PROGRESS-LITE.md` 文件顶部追加精简条目，格式：
```
- [标签] 一句话描述做了什么
```
标签：`[New Feature]` 新功能 / `[Debug]` 修复 / `[Change]` 变更

### 2. 更新 `docs/项目信息/` 中相关文档

根据变更类型，检查并更新对应文档：

| 变更类型 | 需更新的文档 |
|----------|-------------|
| 产品定位、用户路径、Market 规则变化 | `docs/项目信息/产品战略.md` |
| 核心技术主张、Agent 分层、TODOboard、群组协作范式变化 | `docs/项目信息/核心技术.md` |
| 当前实现状态、完成度、能力边界变化 | `docs/项目信息/项目现状.md` |
| 后端/前端/Agent/Group/扩展架构变化 | `docs/项目信息/架构说明.md` |
| 启动方式、用户操作路径、使用边界变化 | `docs/项目信息/使用说明.md` |
| 待办事项状态变化 | `docs/项目信息/当前待办.md` |

**规则**：文档必须与代码实际状态一致，不得有幻觉内容。

### 3. 确认新功能对 Agent / 群组的可访问性

新增功能必须回答以下问题：
- **Agent 能用吗？** — 功能是否注册为工具？工具是否在 Agent 的 config.json 白名单中？默认所有 Agent 可调还是仅 Butler/Host？
- **群组能用吗？** — 功能是否在群组协作场景下工作？群组中的 Agent 通过 @mention 能触发吗？
- **前端能操作吗？** — 是否有对应的 WS 命令？前端是否已适配？用户能否在 GUI 中直接使用？

**示例检查项**：
- 新工具 → 确认 `agent.ts` 中已注册、`runtime.ts` 中 butler tools 白名单已更新
- 新 WS 命令 → 确认 `ws-server.ts` 已添加 handler、前端 `useWebSocket.ts` 已适配
- 新数据目录 → 确认 `STRUCTURE.md` 已更新

### 4. 同步更新 `STRUCTURE.md`

**任何新增、删除、重命名项目内文件/目录的操作后，必须立即同步更新 `STRUCTURE.md` 中的目录结构树。** 包括但不限于：
- `packages/` 下新增/删除源文件
- `gui-v2/src/` 下新增/删除组件/hook/store
- `packages/core/src/templates/` 新增/删除模板文件
- `data/skills/` 新增/删除技能目录
- `docs/` 新增/删除文档文件
- `scripts/` 新增/删除脚本

此规则无例外。保持 STRUCTURE.md 与实际文件系统完全一致。

## 其他检查项

每次更新功能后，额外检查以下是否需要同步更新：
- `start.bat` — 启动流程是否受影响
- `build-gui.bat` — 构建流程是否受影响
- `config/default.json` — 配置项是否需要新增/修改
- `data/` 目录结构 — 新增的目录是否需要 `ensureDirs` 或启动脚本预创建
- **根目录 `CLAUDE.md`** — 工作区目录结构树是否需要更新（新增/删除/重命名根目录或 `projects/`、`releases/`、`docs/`、`roadshow/` 下的条目时必须同步）

> `STRUCTURE.md` 的更新已纳入"每次更新代码必须完成四项"第 4 项，不再单独提醒。
