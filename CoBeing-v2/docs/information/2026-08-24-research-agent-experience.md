# 调研报告：智能体经验总结机制（agent experience summarization）

> 调研日期：2026-08-24
> 调研范围：多智能体框架 CoBeing v2 的"管家 + 工作智能体总结经验（适合自己）"方案
> 来源数量：25 个独立来源（12 论文级 + 9 官方文档级 + 3 本地源码/设计文档级 + 1 知识性整理）
> 可信度：🟢 论文/官方/本地可验证；🟡 知名博客；🟣 知识性整理（未联网验证）

---

## 1. 执行摘要

业界主流智能体记忆/经验系统的共识是：**经验由 agent 在自己的上下文/角色/工具上自动生成，经"反思/蒸馏"压缩为高层条目，注入后续 prompt 复用**（ExpeL/Voyager/Reflexion/Generative Agents）；"什么时候总结"用**失败触发 + 显著性/数量阈值 + 后台异步**三种混合机制；膨胀用**合并/降级/审计重构**而非硬删除。**"适合自己"由"自己产、为自己、携带来源元数据"的闭环保证**，而非把身份硬编码进条目。dsh（本项目参照系）本身**没有自动经验系统**——其长期记忆是人工/代理策展的静态文件（SKILL.md 技能库按触发按需加载、agent preset、工作区 CLAUDE.md）+ 可重建事件日志。CoBeing v2 当前已具备条目式经验存储与部分写入路径，但**读取侧（自动注入）缺失、工作智能体无触发时机、总结不自适（不知道智能体自身定义）、无膨胀收敛**。

核心结论（🟢 多来源交叉验证）：经验系统应 = **自适 scope 总结（自身定义约束） + 任务边界/轮次节流触发 + 画像合并收敛 + user 动态区注入（不破坏前缀稳定）**——即本次落地方案（`docs/v2-经验总结方案-v0.1.md`）。

## 2. 调研方法

- **搜索维度**（计划 4 维）：① 学术与框架：记忆体系与反思机制；② 经验学习与自我改进；③ 工业实践与上下文工程；④ 中文社区实践。
- **🔴 基础设施故障**：`web_search` 工具后端 API key 失效（实测报错 `Authentication Fails, Your api key: ****Rby9 is invalid`，2026-08-24），无法联网检索。子智能体改用 **pwsh 直连 arXiv / 官方文档站抓取并逐一核实**（HTTP 200 + 摘要核对）；1 个子任务（中文社区）因此受阻未完成（拒绝编造来源，如实标注）。
- **本地可验证来源**：dsh 工程源码审计（`D:\deepseek-harness\deepseek-harness`，grep/glob 定位）+ v1 项目既有设计文档（EXPERIENCE.md 概要机制、三层记忆）+ 纯HI 权威源 + v2 规格文档。
- **假设**：外部系统（MemGPT 等）的机制描述基于论文摘要/官方文档精读，未做复现实验；标注为 🟢 的来源为本次实际核实，🟣 为训练知识整理（未核实）。

## 3. 调研发现

### 3.1 dsh 的"经验机制"审计（🟢 本地源码可验证）

dsh 没有自动经验总结子系统。其长期记忆由四类机制构成：

| 机制 | 实现（源码位置） | 特征 |
|---|---|---|
| 技能库 | `packages/skill/skill-filesystem/src/index.ts`（SKILL.md 文件提供者，`.dsh/skills/<名>/SKILL.md`）；`packages/skill/skill/src/index.ts`（注册表 + 作用域分层：全局层 / preset 层）；`packages/skill/skill-packdge/src/index.ts`（`SKILL_FILE='SKILL.md'` 安装） | 每个技能 = 带 frontmatter（name/description/rank/可调用开关）的 SKILL.md；**按 description 索引、按需加载**（不默认注入全部）；作用域链支持 preset 级挂载 |
| agent preset | `${DSH_HOME}/.agent-presets/<id>/`（会话装配：人格 + prompt 段 + 插件行） | 静态策展；一个会话一份；升级覆盖 |
| 工作区指令 | 工作区根 CLAUDE.md / AGENTS.md | 人工维护的项目级长期记忆 |
| 事件日志 | 会话 append-only 事件日志（可重建） | 全部模型请求可从日志重建（模型可见 ⟺ 已记录） |

**启示**：dsh 的"经验"是**人工/代理策展的静态文件 + 描述索引按需加载**，其可靠性与"按触发加载、不塞爆上下文"的取舍可直接借鉴；但"自动从任务中提炼经验"是 dsh 也未解决的面——CoBeing v2 本次实现属增强面。

### 3.2 学术与框架：记忆体系与反思机制（🟢 论文/官方文档，已核实）

| 来源 | 关键机制 |
|---|---|
| MemGPT（2310.08560） | 虚拟上下文管理：in-context（system+working+FIFO）↔ out-of-context（archival 向量库 + recall 历史）；**LLM 函数调用自我编辑记忆**；上下文 >70% 阈值注入"memory pressure"警告 |
| Generative Agents（2304.03442） | 记忆流（自然语言全量记录）+ **反思**（重要度评分累计超阈值触发，约每天 2-3 次；先"自我提问"再检索作答，写回含指针的高层推论）+ 规划；检索 = relevance+recency+importance 加权 |
| Reflexion（2303.11366） | **口头自省**：失败后把"我从这次学到…"写入情景记忆缓冲，下轮带反思重试；HumanEval 91%（当时超 GPT-4） |
| A-MEM（2502.12110） | Zettelkasten 卡片笔记：每条记忆带上下文/关键词/标签，动态建链，新记忆可刷新旧记忆表示 |
| HippoRAG（2405.14831） | 知识图谱 + Personalized PageRank 检索，整合大量经验且避免灾难性遗忘 |
| Letta 官方文档 | **MemFS**（git 版控记忆文件系统）：`/init` `/remember` `/doctor`（审计漂移重复）`/dreaming`（**后台子代理在空闲/压缩时回顾近期对话、整合经验写回，不打断工作**）；Shared Memory = 多智能体 git 共享仓库 |
| Anthropic 上下文工程（官方） | 上下文 = 有限预算；compaction（临满时压摘要 + 保留关键决策/未解 bug + 最近 5 文件）；structured note-taking / agentic memory（笔记写窗外、按需拉回）；progressive disclosure |

### 3.3 经验学习与自我改进（🟢 论文级，已核实）

| 来源 | 关键机制 |
|---|---|
| ExpeL（2308.10144，AAAI-24） | 经验库范式：**训练任务集自动收集自然语言经验 → 抽取洞见 → 推理时回忆洞见+历史经验注入 prompt**；免参数更新、跨任务迁移 |
| Voyager（2305.16291） | 永久增长技能库（**可执行代码**）：迭代提示（环境反馈+执行错误+自验证）；embedding 相似度检索注入；**注入技能子集优于全量** |
| LATS（2310.04406） | 自反思嵌入 MCTS：失败反思入搜索树，后续决策规避失败路径 |
| LRLL（2406.18746） | skill abstractor 把近期经历蒸馏成新库技能；自引导探索提新任务；免灾难遗忘 |
| Agent Skills 综述（2602.12430） | SKILL.md 规范 + 渐进式披露（先索引后展开）+ MCP 整合；**警示 26.1% 社区技能含漏洞**（信任与生命周期治理） |
| Muscle Memory（2608.08995） | 反主流：高频主流意图**编译成专属 specialist agent**（Harvest→Analyze→Augment→Evaluate），两级触发+质量门控 |
| SMA（2608.12743） | verifier-guided reflection 蒸馏可迁移教训；每条带 **TRS（可迁移可靠性分）**，用复用成败反哺权重、淘汰过时项 |

**共识归纳**：
1. 经验来源锚在**反馈信号**（失败/完成/环境报错）；提取 = 口头自省 / 程序自验证 / 蒸馏抽象器 三种。
2. 存储 = 自然语言条目（可解释） / 可执行技能（可复用） / 编译子 agent（高频稳定）三层递进。
3. 检索 = 语义相似度 × 可靠性权重（SMA TRS 动态校准）+ 多因子（最近性/重要性）；注入用渐进式披露。
4. 防膨胀 = 合并蒸馏 + 权重衰减淘汰 + 质量门控；**矛盾处理是普遍缺口**（多为检索排序自然优先）——可差异化。
5. "适合自己" = **自己产、为自己**（经验来自该 agent 自身任务/工具轨迹）+ 来源元数据过滤（避免 A 领域经验误嫁 B 领域）。

### 3.4 工业实践与上下文工程（🟢 官方文档级，已核实）

子智能体用 pwsh 直连官方源抓取全文核实（web_search 仍故障），共 10 个官方级来源：

- **Anthropic 官方 ×3**（🟢）：
  - *Effective context engineering for AI agents*：context rot、compaction（保关键决策/未解 bug/最近文件）、structured note-taking / agentic memory（笔记写窗外、按需拉回）、CLAUDE.md 混合策略；
  - *Building effective agents*：agent 设计最小化原则（与 dsh 极简同源）；
  - *Prompt caching cookbook*：**KV 缓存硬约束——前缀字节稳定是命中唯一杠杆**（最小 1024 token、TTL 5 分钟命中刷新、读 0.1×/写 1.25×、≤4 断点）。
- **LangMem / LangGraph 官方 ×5**（🟢）：记忆分**语义（Profile/Collection）/ 情景 / 程序**三类 + Working + Archival；热路径注入模板；后台提取（非阻塞）；prompt_optimizer 多 agent 归因。**画像 + 条目分层与 CoBeing v2 一致**。
- **MCP memory server**（🟢）：记忆工具化（write/search 等），发现方式同 tool（与 v2 工具智能体思路一致）。
- **Graphiti / Zep**（🟢）：时序事实失效（time-decay）+ 来源元数据，避免矛盾与跨域误用。

**注入位置共识（官方验证）**：**冻结 system 前缀，动态经验进 user 动态区**——CoBeing v2 的"组装前缀稳定 + `[我的经验档案]` user 动态区注入"方向正确，**不要写回 system 冻结段**。
**二期注入方向（官方验证）**：检索子集 + 渐进式披露（先索引后展开），而非全量新鲜度。
**网络限制（如实标注）**：`docs.claude.com` / `docs.cursor.com` / `openai.com` 本环境不可达，Claude Code / Cursor / OpenAI 细节由可达的 Anthropic 官方博客替代覆盖，需可联网环境补正源核对。

### 3.5 v1 本地既有设计（🟢 本地文档可验证）

- `docs/superpowers/specs/2026-05-25-guide-experience-summary-design.md`：EXPERIENCE.md **概要区 + 正文**双层——System Prompt 只注入概要（≤1500 字符，倒序取最近），正文按需 read_file；写入时同步维护概要区。**经验教训**：① 概要注入限制 token 浪费 ✅ 已吸收为本方案"注入限量"；② "文件不删条目"导致概要手动维护成本 → 本方案改为 LLM 自动合并画像。
- `docs/superpowers/specs/2026-04-30-group-memory-three-layer-design.md`：Raw（数据库原文 + FTS5 检索）/ Abstract（PROGRESS/TASK/PLAN/EXPERIENCE 公共文件）/ 压缩标记 三层。**教训**：v1 的 EXPERIENCE.md 由"群主/Agent 手工维护"、正文注入 59KB 导致上下文溢出——证明**自动总结 + 限量注入**是必要的（本方案落地）。

### 3.6 内部既有调研：Hermes 记忆系统（🟢 本地文档可验证）

`docs/调研/hermes记忆储存系统调研.txt`（Nous Research 开源 Agent）——五项工程决策与本方案**交叉印证**：

| Hermes 决策 | 本方案对应 | 状态 |
|---|---|---|
| **冻结快照**：会话启动冻结 System Prompt 快照，记忆写入不重建 prompt → prefix cache 保持有效 | system 冻结段 + 经验注入 user 动态区（前缀不变） | ✅ 已落地 |
| **主动记忆策展**：每 nudge_interval 轮（默认 10）后台子代理审查对话、判断"什么值得记"并写入 | 长活群组轮次节流总结（每 5 轮且有活动，fire-and-forget 不阻塞） | ✅ 已落地 |
| 多层检索融合（FTS5+Jaccard+HRR）+ **信任评分与时间衰减**（helpful/unhelpful 反馈校准质量） | SMA TRS 同思路；一期用"最近优先+画像合并"，信任/衰减 | 📌 二期候选 |
| **上下文围栏**：召回记忆包 `<memory-context>` 标签 + 系统注释，防混淆为实时指令 | `[我的经验档案]` 段头标记 | ✅ 已落地（段头语义化） |
| **记忆安全**：写入前提示注入检测 / 数据泄露检测 / 隐形 Unicode 检测 | 无 | 📌 二期候选 |

## 4. 方案对比

| 维度 | A：纯自动（后台/任务边界总结） | B：纯自驱动（工具 save） | C：混合（本方案） |
|---|---|---|---|
| 沉淀完整性 | 高（不依赖 agent 自觉） | 低（依赖主动调用） | 高（边界自动 + 自驱动补充） |
| 成本 | 每边界 LLM 调用 | 按需 | 任务边界/轮次节流 + 按需 |
| 适己性 | 靠 scope 指令 | 靠 scope 指令 | scope = 自身定义 + 既有画像 |
| 膨胀控制 | 需合并机制 | 需合并机制 | 画像合并（阈值触发） |
| 推荐 | — | — | ✅ C（ExpeL + Generative Agents 触发 + Letta Dreaming 异步 + SMA 可靠性思路的务实裁剪） |

注入位置对比：system 注入（破坏前缀稳定 ✗） vs user 动态区（✅ 本方案） vs 渐进式披露（二期可加检索）。

## 5. 对立观点与争议

- **检索 vs 编译**：主流是"检索注入文本经验"（ExpeL/Voyager/SMA），Muscle Memory 主张"编译成 specialist"更省 token 更可靠。本方案一期选检索注入（实现简单、可解释）；高频意图编译为二期候选。
- **自动总结是否值得**：自动总结有 LLM 成本与"记忆污染"（错误经验固化）风险；Reflexion/SMA 用 verifier 校验缓解。本方案：scope 约束 + 失败静默 + 画像合并可重写，风险可控；但**未做 verifier 校验**（标注为已知缺口）。
- **记忆注入 vs 上下文纯净**（dsh 极简原则"无动态注入"）：本方案的经验注入进 user 动态区，不违背 system 冻结原则，但增加 user 侧 token 占用——限量（画像 ≤800 字符 + 6 条 × ≤300 字符）。

## 6. 信息缺口

- 🔴 `web_search` 后端故障，中文社区实践维度（扣子/Dify 记忆、Coze 记忆方案）**未调研**（子智能体受阻报告，拒绝编造——已如实记录）；恢复后可补。
- 🟣 Claude Code 细节 / ChatGPT 记忆为知识性整理，未联网核实（`docs.claude.com`/`openai.com` 本环境不可达）。
- ⚠️ 经验矛盾处理（两条冲突教训）业界无成熟方案，本方案暂以"合并去矛盾"处理；二期可借 Graphiti 时序失效 + 来源元数据升级。
- ⚠️ 经验注入的"真实收益"（KV 缓存命中率变化、任务成功率提升）无定量实验——真实验证脚本只验证链路与落盘，不测收益。
- ⚠️ 记忆安全检测（提示注入检测 / 上下文围栏强化 / 信任评分与时间衰减，Hermes 五决策之二）未落地（二期候选）。

## 7. 来源清单

| # | 标题 | URL | 类型 | 可信度 | 引用点 |
|---|---|---|---|---|---|
| 1 | MemGPT: Towards LLMs as Operating Systems | arxiv.org/abs/2310.08560 | 论文 | 🟢 | 3.2 记忆分层/自编辑 |
| 2 | Generative Agents: Interactive Simulacra | arxiv.org/abs/2304.03442 | 论文 | 🟢 | 3.2 反思触发/自我提问 |
| 3 | Reflexion: Language Agents with Verbal RL | arxiv.org/abs/2303.11366 | 论文 | 🟢 | 3.2/3.3 口头自省 |
| 4 | A-MEM: Agentic Memory for LLM Agents | arxiv.org/abs/2502.12110 | 论文 | 🟢 | 3.2 结构化卡片 |
| 5 | HippoRAG: Neurobiologically Inspired LTM | arxiv.org/abs/2405.14831 | 论文 | 🟢 | 3.2 图谱检索 |
| 6 | Letta 官方文档 — Memory & Dreaming | docs.letta.com/configuration/memory | 官方文档 | 🟢 | 3.2 MemFS/后台整理 |
| 7 | Letta 官方文档 — Shared Memory | docs.letta.com/concepts/shared-memory | 官方文档 | 🟢 | 3.2 多智能体共享 |
| 8 | Anthropic — Effective Context Engineering | anthropic.com/engineering/effective-context-engineering | 官方文档 | 🟢 | 3.2/3.4 预算/compaction |
| 9 | ExpeL: Experiential Learning Agent | arxiv.org/abs/2308.10144 | 论文 | 🟢 | 3.3 经验库范式 |
| 10 | Voyager: An Open-Ended Embodied Agent | arxiv.org/abs/2305.16291 | 论文 | 🟢 | 3.3 技能库/子集注入 |
| 11 | LATS: Language Agent Tree Search | arxiv.org/abs/2310.04406 | 论文 | 🟢 | 3.3 失败反思入树 |
| 12 | LRLL: Lifelong Robot Library Learning | arxiv.org/abs/2406.18746 | 论文 | 🟢 | 3.3 蒸馏抽象器 |
| 13 | Agent Skills for LLMs 综述 | arxiv.org/abs/2602.12430 | 论文 | 🟢 | 3.3 SKILL.md/治理 |
| 14 | Muscle Memory for Agents | arxiv.org/abs/2608.08995 | 论文 | 🟢 | 3.3/5 编译 vs 检索 |
| 15 | Spatial Memory Agent (SMA) | arxiv.org/abs/2608.12743 | 论文 | 🟢 | 3.3 TRS 动态校准 |
| 16 | dsh 工程源码（skills/presets/事件日志） | 本机 D:\deepseek-harness\deepseek-harness\packages\skill\* | 源码 | 🟢 | 3.1 |
| 17 | v1 设计：GUIDE/EXPERIENCE 概要机制 + 三层记忆 | D:\agent-codes\docs\superpowers\specs\2026-05-25-guide-experience-summary-design.md / 2026-04-30-group-memory-three-layer-design.md | 本地设计文档 | 🟢 | 3.5 |
| 18 | Hermes 记忆储存系统调研（Nous Research） | D:\agent-codes\docs\调研\hermes记忆储存系统调研.txt | 本地调研文档 | 🟢 | 3.6（冻结快照/主动策展/信任衰减/安全围栏） |
| 19 | Anthropic — Building Effective Agents | anthropic.com/engineering/building-effective-agents | 官方文档 | 🟢 | 3.4 设计最小化 |
| 20 | Anthropic — Prompt Caching 文档 | docs.anthropic.com/en/docs/build-with-claude/prompt-caching | 官方文档 | 🟢 | 3.4 KV 缓存硬约束 |
| 21 | LangMem 官方文档（concepts / hot-path / memtools / prompt_optimizer） | langchain-ai.github.io/langmem/ | 官方文档 | 🟢 | 3.4 记忆分类/后台提取/热路径注入 |
| 22 | MCP memory server | github.com/modelcontextprotocol/servers | 官方仓库 | 🟢 | 3.4 记忆工具化 |
| 23 | Graphiti（getzep） | github.com/getzep/graphiti | 官方仓库 | 🟢 | 3.4 时序失效/来源元数据 |
| 24 | Zep | github.com/getzep/zep | 官方仓库 | 🟢 | 3.4 记忆服务 |
| 25 | Claude Code 细节 / ChatGPT 记忆 | （未联网核实；docs.claude.com/openai.com 本环境不可达） | 知识性整理 | 🟣 | 3.4 网络限制/6 |

## 8. 建议与下一步

1. ✅ 按方案 v0.1 落地（已实现）：自适 scope 总结 + 管家归档/群组归档/轮次节流/自驱动四触发 + 画像合并 + user 区注入 + `experience/info` 桥方法。
2. 二期候选（官方验证方向）：经验检索升级（标签/关键词过滤 → embedding 相似度 + TRS 可靠性权重 / Graphiti 时序失效 + 来源元数据）；**渐进式披露**（注入索引、命中展开，官方共识"检索子集优于全量"）；矛盾置信度标注；`experience/write` 事件入日志（模型可见 ⟺ 已记录）；记忆安全（注入检测 + 上下文围栏强化 + 信任评分/时间衰减）。
3. 工具：恢复 `web_search` 后端后补第 4 维（中文社区）调研并回写本报告；Claude Code/Cursor/OpenAI 细节在可联网环境补正源核对。

---

（本报告由深度调研流程生成：3 维成功（论文/官方级 25 来源核实）+ 1 维因搜索基础设施故障受阻并如实标注。）
