# 架构方向决策：CoBeing 为底座，吸收 dsh 工程机制

> 日期：2026-08-18
> 状态：**用户已确认判断方向**（CoBeing 基础上改造出 dsh 的工作能力）
> 依据：`dsh编码能力工程诊断-CoBeing差距.md`、`deepseek-harness-极简模式学习笔记.md`、dsh 官方源码（projects/deepseek-harness @ 99f6f02fec）、CoBeing 现状（conversation-loop.ts 等）

---

## 一、决策结论

**在 CoBeing 基础上改造出 dsh 的工作能力；不采用"以 dsh 为底座重建 CoBeing"。**

一句话理由：**CoBeing 的产品层（群组协作、管家入口、TODOboard、Market、GUI）是 dsh 完全没有的资产，搬到 dsh 上等于重造；而 dsh 的工程机制是"可移植的设计模式"，不依赖其插件架构，能在 CoBeing 现有代码上逐项落地。**

---

## 二、两方案对比

| 维度 | 方案 A：CoBeing 为底座，吸收 dsh 机制 | 方案 B：dsh 为底座，重建 CoBeing |
|---|---|---|
| 工程地基 | 逐步补课（P0/P1/P2，有限投入） | 直接获得（成熟） |
| 产品层 | **保留全部资产**（群组/管家/TODOboard/Market/GUI） | **全部重造**（dsh 上不存在群组长期协作、管家入口、TODOboard 三层、Market、普通用户 GUI） |
| 移植成本 | 工程机制是设计模式，可逐个落地（请求日志/调度器/持久 shell 均不依赖 Cordis） | 等于把 CoBeing 整体重写（语言/架构/范式全换） |
| 底座稳定性 | CoBeing 自有，可控 | dsh 为 developer preview，官方声明"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"，持续绑定上游重构风险 |
| 渐进性 | P0 三条有限投入即可显著提升 | 重写级投入，周期长 |
| 愿景匹配 | 完全匹配 GOAL.md（管家入口/Market/超级个体） | 愿景在 dsh 上不存在，等于放弃愿景重建 |

---

## 三、判断依据

### 1. 资产可移植性的不对称（决定性）

- **产品层不可替代**：dsh 定位是开发者编码工作台——无管家（用户第一联系人）、无群组长期协作空间（subagent 只是单次委派）、无 TODOboard 三层、无 Market 分级生态、无面向普通用户的产品化 GUI。这些是 CoBeing 的核心差异资产。
- **工程层可移植**：可重建会话日志、调度器式工具执行、工具契约（freshness/编辑协议/持久 shell）、缓存前缀稳定、错误恢复——都是通用机制设计，不依赖 Cordis 插件架构，CoBeing 现有代码可直接实现。

### 2. 底座稳定性

dsh 官方自述 developer preview（pre-release stance: "rename or repackage freely"，无兼容承诺）。CoBeing 面向普通用户，需要稳定底座；dsh 适合做**设计参考**而非底座——参考零风险，绑定则持续承压。

### 3. 渐进性与投入可控

方案 A 的 P0 三条（请求日志 → 工具调度器 → 持久 shell）是有限改造，完成即达"代码任务可靠"的最低充分集；方案 B 是重写级投入且中途不可见成果。

### 4. 愿景匹配

GOAL.md 的愿景（个人 Agent Team、管家入口、Market 分层、超级个体）在 dsh 上不存在。方案 A 保持愿景、补工程；方案 B 等于改愿景。

---

## 四、路线图（按优先级）

### P0（结构性，改造 conversation-loop）
1. **请求日志（可重建性）**：每次 LLM 请求 `{system, tools, messages, config}` 序列化为追加式记录；失败/中断可导出"模型看到的确切内容"；为快照测试打地基。→ 其余两项的地基，建议最先做。
2. **工具执行升级为调度器**：多 tool_calls 分类（排他/并行）→ 有界并行池 → 结果按模型序写回 history → abort 写合成结果（废除截断历史自愈）。
3. **持久 shell**：bash 工具升级为 per-agent 持久 PTY（状态跨调用、超时即重置并明说、输出保留前缀+裁剪说明）。

### P1（质量）
4. 工具契约模型视角审计（复用现有 file-version CAS；工具 description/schema 按模型契约重写；统一结果截断策略）。
5. 轻量 plan mode（作为会话状态而非 prompt 拼接；模式切换不改变工具目录）。
6. KV 缓存前缀稳定（固定组装顺序 + 工具 schema 排序稳定 + 请求指纹记录）。

### P2（工程文化）
7. 回放测试（录制真实编码会话 JSONL，keyless 回放断言）。
8. 失败语义纪律文档化（工具失败不终止任务、错误永远入日志、中断永远可续）。

### 长期
9. 插件架构渐进演进：在现有 plugin-sdk/HookBus/PromptLayer 上继续（不必全盘 Cordis 化，"插件化到够用"）。
10. 把 `projects/deepseek-harness` 当对照教材，定期对标吸收机制（如 preset 的 isolate realm 思想 → CoBeing Agent 配置分层）。

---

## 五、诚实代价与边界

- 方向 A 的工程地基是**持续投入的还债过程**（dsh 的 loop/工具管线是多年迭代），CoBeing 永远追不平 dsh 的工程深度。
- **不需要追平**：CoBeing 的目标不是成为更好的编码 harness，而是"能可靠完成生活/工作杂事的 Agent Team"；P0 三条达"代码任务可靠"的最低充分集即可。
- 禁止事项：**不直接搬 dsh 代码进 CoBeing**（架构不同，搬代码不如搬设计；且 dsh 为 MIT 但 vendor Cordis 有自身许可，需另行评估）。

---

## 六、参考文档

- `docs/调研/dsh编码能力工程诊断-CoBeing差距.md`（差距与落地建议）
- `docs/调研/deepseek-harness-极简模式学习笔记.md`（极简模式机制）
- `projects/deepseek-harness/`（dsh 官方源码，对照教材）
- `GOAL.md`（产品愿景）
- `docs/项目信息/当前待办.md`（决策记录表，本决策后续可登记）

## 七、后续行动项

- [ ] P0-1 请求日志改造（建议最先开工，按 agent-dev-loop 流程）
- [ ] P0-2 工具调度器改造
- [ ] P0-3 持久 shell
- [ ] 本决策登记到 `当前待办.md` 决策记录表
