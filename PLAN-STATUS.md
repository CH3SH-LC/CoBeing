# 综合调研方案执行状态

> 来源: `docs/调研/综合调研-可执行改进方案.txt`
> 本文件仅记录方案的执行状态和分工安排，不写入进度文档。

---

## ✅ 已完成

| 方案 | 内容 | Tests | Commits |
|------|------|-------|---------|
| 方案 1 | System Prompt 三层架构重组 | 290 pass | 5 |
| 方案 4 | GUIDE.md + EXPERIENCE.md 概要机制 | 296 pass | 8 |

**方案 1 改动**: `prompt-builder.ts` (+buildStaticLayer/GROUP_MECHANICS_NOTICE), `agent.ts` (createGroupLoop 注入)
**方案 4 改动**: `workspace.ts` (+GUIDE.md 路径/读写), `agent.ts` (guideContent 注入), `prompt-builder.ts` (+extractExperienceSummary/maintainExperienceSummarySync), `memory-store.ts` (体验目标概要), `paths.ts` (appendExperience 维护概要), 模板更新

**Spec/Plan 文档**:
- `docs/superpowers/specs/2026-05-25-system-prompt-restructure-design.md`
- `docs/superpowers/plans/2026-05-25-system-prompt-restructure.md`
- `docs/superpowers/specs/2026-05-25-guide-experience-summary-design.md`
- `docs/superpowers/plans/2026-05-25-guide-experience-summary.md`

---

## ⏳ 待执行（4 窗口可并行，无交叉依赖）

| 窗口 | 方案 | 优先级 | 复杂度 | 核心改动 |
|------|------|--------|--------|---------|
| **A** | 方案 5 — 权限分级免审批 + 工作区绑定 | P0 | 中 | `permission.ts` 重写为 5 级体系 + `bash.ts` 命令分级 |
| **B** | 方案 9 — 记忆安全 + 中英文注入防御 | P0 | 低 | 新建 `security/memory-security.ts` + 调用点接入 |
| **C** | 方案 3 — 工具智能体系统 | P1 | 高 | 新建 `agent/tool-agent/`（审查/判断/复制/记忆 4 种） |
| **D** | 方案 2 — 工具增强 | P1 | 低 | `edit-file.ts` + `grep.ts` + `bash.ts` 小改 |

---

## 📋 第二轮（P2，待 P0+P1 完成后启动）

- **方案 8** — HRR 多策略记忆检索（FTS5 + Jaccard + 信任衰减）
- **方案 10** — 插件系统（最小化接口 + loader）

## 🚫 暂缓

- 方案 6 — 缓存友好 System Prompt（架构差异）
- 方案 11 — 准备-执行分离（缺乏多执行器需求）
