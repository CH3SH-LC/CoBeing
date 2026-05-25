# 综合调研方案执行状态

> 来源: `docs/调研/综合调研-可执行改进方案.txt`
> 本文件仅记录方案的执行状态和分工安排，不写入进度文档。

---

## ✅ 已完成

| 方案 | 内容 | Tests | Commits |
|------|------|-------|---------|
| 方案 1 | System Prompt 三层架构重组 | 290 pass | 5 |
| 方案 4 | GUIDE.md + EXPERIENCE.md 概要机制 | 296 pass | 8 |
| 方案 9 | 记忆安全 + 中英文注入防御 | 335 pass | 3 |
| 方案 2 | 工具增强（edit-file/grep/bash） | 360 pass | 3 |
| 方案 8 | HRR 多策略记忆检索 | 417 pass | 3 |
| 方案 3 | 工具智能体系统（审查/判断/复制/记忆） | 397 pass | 9 |
| 方案 5 | 权限分级免审批 + 工作区绑定 | 397 pass | 13 |
| 方案 10 | 插件系统（plugin-sdk + 内置包装器） | 417 pass | 4 |

**方案 1 改动**: `prompt-builder.ts` (+buildStaticLayer/GROUP_MECHANICS_NOTICE), `agent.ts` (createGroupLoop 注入)
**方案 4 改动**: `workspace.ts` (+GUIDE.md 路径/读写), `agent.ts` (guideContent 注入), `prompt-builder.ts` (+extractExperienceSummary/maintainExperienceSummarySync), `memory-store.ts` (体验目标概要), `paths.ts` (appendExperience 维护概要), 模板更新
**方案 9 改动**: `security-scan.ts` (+13EN/+18CN/+混合检测/+围栏函数), `write-file.ts` (MEMORY.md/EXPERIENCE.md 写入前扫描), `memory-store.ts` (formatForSystemPrompt 围栏包裹), `index.ts` (新导出)
**方案 2 改动**: `edit-file.ts` (+replace_all/old=new校验/结构化输出), `grep.ts` (完整重写: output_mode/head_limit/offset/-A/-B/-C/multiline/-i/-n/glob), `bash.ts` (+16384字节输出截断)
**方案 8 改动**: `sqlite-adapter.ts` (+6列schema迁移/+Jaccard/+时间衰减/+多策略searchEntries/+trust反馈), `memory-store.ts` (+config/+markHelpful/markUnhelpful/+searchAndFeedback/+去重自动降分/+经验提取自动加分), `memory-tool.ts` (+feedback操作), `hrr.ts` (Phase 2 接口+桩)
**方案 3 改动**: 新建 `agent/tool-agent/`（types/base/review/judgment/clone/memory + tests）+ `tools/agent-clone.ts`；修改 `agent.ts`/`group-tools.ts`/`manager.ts`/`group.ts`/`wake-system.ts`/`group-scanner.ts`/`current-md.ts`/`config/default.json`；删除 `group/review-pipeline.ts`
**方案 5 改动**: `types.ts` (5级枚举+WorkspaceBinding), `master-registry.ts` (+migratePermissionMode), `permission.ts` (全量重写), `bash-classifier.ts` (新建+10tests), `permission.test.ts` (全量重写19tests), `agent.ts` (_bindings数组+5方法), `runtime.ts` (3处迁移调用), `ws-server.ts` (3新命令), `gui-v2/` 4文件 (types/store/useWebSocket/WorkspaceBindingSection)
**方案 10 改动**: 新建 `plugin-sdk/`（types/loader/builtins×8）+ `plugins/`（8清单），修改 `runtime.ts`（buildProviders/startChannels 插件化）

**Spec/Plan 文档**:
- `docs/superpowers/specs/2026-05-25-system-prompt-restructure-design.md`
- `docs/superpowers/plans/2026-05-25-system-prompt-restructure.md`
- `docs/superpowers/specs/2026-05-25-guide-experience-summary-design.md`
- `docs/superpowers/plans/2026-05-25-guide-experience-summary.md`
- `docs/superpowers/specs/2026-05-25-memory-security-cn-injection-design.md`
- `docs/superpowers/plans/2026-05-25-memory-security-cn-injection.md`
- `docs/superpowers/specs/2026-05-25-tool-enhancement-design.md`
- `docs/superpowers/plans/2026-05-25-tool-enhancement.md`
- `docs/superpowers/specs/2026-05-25-hrr-memory-retrieval-design.md`
- `docs/superpowers/plans/2026-05-25-hrr-memory-retrieval.md`
- `docs/superpowers/specs/2026-05-25-tool-agent-system-design.md`
- `docs/superpowers/plans/2026-05-25-tool-agent-system.md`
- `docs/superpowers/specs/2026-05-25-permission-system-redesign-design.md`
- `docs/superpowers/plans/2026-05-25-permission-system-redesign.md`
- `docs/superpowers/specs/2026-05-25-plugin-system-design.md`
- `docs/superpowers/plans/2026-05-25-plugin-system.md`

---

## ⏳ 待执行

| 窗口 | 方案 | 优先级 | 复杂度 | 核心改动 |
|------|------|--------|--------|---------|
| — | — | — | — | 本轮方案已全部完成 |

---

## 📋 第二轮（全部完成）

本批次 11 个方案已全部执行完毕。

## 🚫 暂缓

- 方案 6 — 缓存友好 System Prompt（架构差异）
- 方案 11 — 准备-执行分离（缺乏多执行器需求）
