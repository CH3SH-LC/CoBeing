# CoBeing 项目指令

## 前端设计规则

**涉及前端 UI 设计时，必须先阅读 `.claude/skills/frontend-design/` 目录下的用户偏好文件。**
特别是 `user-ui-preferences.md` 中的层次化渲染、间距、字号、圆角等规则。

## 执行规则

- **修改 `.ts` 源码后必须运行 `pnpm build`**，因为 `dev.ts` 从 `packages/core/dist/` 导入编译产物，不构建则改动不生效。

## 文档系统

### 文档目录结构

```
docs/
├── superpowers/         # 实现计划与设计规格（plans/ + specs/）
├── 调研/                # 竞品调研与技术调查报告
│   └── LLM链接指南/     #   各厂商接入指南
├── 项目信息/            # 项目文档（设计清单/能力清单/指南/待办/测试）
└── archive/             # 历史归档
```

根目录进度文件：
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
| 后端能力变化 | `docs/项目信息/后端能力清单.md` |
| 待办事项状态变化 | `docs/项目信息/待办.md` |
| 前端设计变化 | `docs/项目信息/前端设计清单.md` |
| 用户功能变化 | `docs/项目信息/用户功能清单.md`、`docs/项目信息/用户指南.md` |
| 测试用例变化 | `docs/项目信息/测试清单.md` |

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
- `config/templates/` 新增/删除模板文件
- `skills/` 新增/删除技能目录
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
