# Market 整体架构 - 设计文档

> 日期：2026-06-08 | 状态：方向收敛

## 背景

CoBeing 的 Market 不能先被做成“应用商店页面”。页面只是最终的展示形式，真正需要先解决的是：资源从哪里来、如何描述、如何判断可信、如何声明依赖、如何安装到本地、如何让管家或群主在需要时推荐，以及如何避免普通用户被复杂资源类型淹没。

当前代码已经有插件、技能、MCP、Agent、Group、扩展页和本地插件注册表等基础设施，但它们更像“已安装资源管理”和“扩展运行底座”。`CoBeing-market/` 目录目前只有 `agents/`、`MCPs/`、`plugins/`、`skills/` 四个空分类目录，还没有资源包规范、Market 索引、认证元数据、依赖树、安装计划或社区风险审查。

本设计的目标是先完善 Market 整体架构，而不是立即做 Market 页面。

## 已确认设计决策

| 维度 | 决策 |
| --- | --- |
| Market 定位 | 可信能力供应链，不是普通用户主入口 |
| 当前阶段重点 | 完善整体架构，不先做页面 |
| 普通用户路径 | 主要通过 Butler / 群主 / Agent 的资源请求间接使用 Market |
| 进阶用户路径 | 可浏览、安装、fork、发布资源，但必须看到信任、依赖和风险 |
| 默认策略 | 优先本地创建；只有明显更优的可信资源才推荐 |
| 社区资源 | 不能静默安装，必须用户主动审查并授权 |
| 安装方式 | Market 资源安装后 fork/copy 到本地，再按用户风格改造 |
| 资源层级 | Group > Agent > Skill / Plugin / MCP > Butler Persona |
| 关键对象 | Resource Manifest、Trust Profile、Dependency Tree、Install Plan、Local Fork |

## 目标

1. 把 Market 定义为 CoBeing 的可信能力供应链。
2. 明确 Market 资源类型和资源包规范。
3. 明确信任分级、审核信息和风险说明。
4. 明确 Group / Agent / Skill / Plugin / MCP / Persona 的依赖关系。
5. 明确安装前如何生成安装计划和用户确认项。
6. 明确 Market 资源如何 fork 到本地并继续个性化。
7. 明确 Butler、群主、Agent 与 Market 的交互边界。
8. 为后续实现提供比“做页面”更稳定的架构依据。

## 非目标

1. 不在本阶段设计完整 Market 页面。
2. 不把普通用户暴露到复杂资源列表中。
3. 不允许管家静默安装社区未认证资源。
4. 不把 Group 或 Agent 当作单文件插件安装。
5. 不要求本设计直接实现代码。
6. 不讨论远程商业分发、支付、作者结算等平台经营问题。

## 核心定义

Market 是 CoBeing 的可信能力供应链。

它不是：

- 不是普通用户每天打开的商店首页。
- 不是插件列表页面。
- 不是把 zip 包复制到目录的下载器。
- 不是让管家随意安装社区资源的后门。

它是：

- 一个资源发现与评估层。
- 一个资源包规范。
- 一个信任和审核体系。
- 一个依赖树和权限风险解释器。
- 一个安装计划生成器。
- 一个把外部资源 fork 到本地个性化空间的入口。

一句话口径：

> Market 不负责替用户做复杂选择，而负责让 Butler、群主、Agent 和进阶用户在需要扩展能力时，能找到、理解、审查、安装和本地化可信资源。

## 总体架构

```text
Market Repository
  ├─ Resource Index
  ├─ Resource Packages
  ├─ Trust / Audit Metadata
  └─ Version / Update Metadata

Market Resolver
  ├─ Search / Match
  ├─ Ranking / Recommendation
  ├─ Trust Filter
  └─ Local Alternative Generator

Install Planner
  ├─ Dependency Tree
  ├─ Permission / Risk Summary
  ├─ Conflict Check
  ├─ User Confirmation Items
  └─ Install Plan

Local Installer
  ├─ Fork / Copy to Local Data
  ├─ Apply Config / Templates
  ├─ Register Resource
  ├─ Enable Plugin / Skill / MCP
  └─ Rollback Record

Runtime Consumers
  ├─ Butler
  ├─ Host / Group
  ├─ Agent
  ├─ Advanced User UI
  └─ Onboarding
```

这五层比页面更重要。未来可以有 Market 页面，但页面只调用 Resolver 和 Installer，不应该把信任、依赖、权限和安装逻辑写死在前端。

## 资源类型

### Group Package

Group 是最大资源。安装 Group 通常意味着安装一个长期场景空间：

- 群组定位。
- 群主规则。
- 初始成员建议。
- 成员 Agent 模板。
- 依赖的 Skills。
- 依赖的 Plugins / MCP。
- 群组 GUIDE。
- 初始 TODOboard 模板。
- 公共记忆种子。
- 示例工作流或验收用例。

Group 不能被当作一个单插件启用。它是组合包。

### Agent Package

Agent 是长期专业角色资源。安装 Agent 应包含：

- `CHARACTER.md` 模板。
- `JOB.md` 模板。
- `AGENTS.md` 规则模板。
- `MEMORY.md` 初始种子。
- `EXPERIENCE.md` 初始经验。
- `config.json` 建议。
- 依赖的 Skills / Plugins / MCP。
- 推荐使用场景和边界。

Agent 安装后应复制成本地 Agent。用户和 Butler 可以继续改造，不应长期绑定远程模板。

### Skill Package

Skill 是工作方法或流程。它适合低风险复用，但仍需声明：

- 适用场景。
- 需要哪些工具。
- 是否会引导 Agent 调用外部资源。
- 示例输入输出。
- 质量和边界说明。

Skill 默认风险低于 Plugin，但如果 Skill 要求使用高风险工具，也必须在安装计划中体现。

### Plugin Package

Plugin 是系统能力扩展，风险高于 Skill。它可能提供：

- Provider。
- Channel。
- Tool。
- UI Extension。
- Memory Backend。
- Hook / Prompt Layer。

Plugin 必须声明：

- 入口文件。
- 注册能力。
- 权限需求。
- 外部网络访问。
- 是否读取/写入本地文件。
- 是否需要账号/API key。
- 是否有前端 UI。
- 是否有 hook 或 prompt 注入能力。

当前 `cobeing.plugin.json` 只描述运行时插件字段，不足以作为 Market 审查包。Market 需要更外层的 Resource Manifest。

### MCP Package

MCP 是外部工具服务器资源。它应声明：

- 启动方式。
- transport 类型。
- 可暴露工具列表。
- 需要的环境变量。
- 网络和文件访问范围。
- 外部账号授权。
- 安全风险。

MCP 不能被普通 Agent 自动安装。Agent 可以提出资源缺口，由群主或 Butler 请求用户授权。

### Butler Persona Package

Butler Persona 是管家人格、语气和关系模式资源。它可能包含：

- 管家角色定位。
- 称呼和语气风格。
- 主动性偏好。
- 用户关系边界。
- 不可改变的职责边界说明。

Persona 风险通常低于 Plugin，但不能覆盖安全边界、工具权限和安装策略。

## Resource Manifest

每个 Market 资源都应有统一的外层 manifest。建议文件名：

```text
cobeing.resource.json
```

示例结构：

```json
{
  "schemaVersion": 1,
  "id": "official.travel.group.basic",
  "name": "旅行规划群组",
  "type": "group",
  "version": "1.0.0",
  "description": "用于旅行规划、预算、行程和提醒的群组模板",
  "publisher": {
    "id": "cobeing-official",
    "name": "CoBeing Official"
  },
  "trust": {
    "level": "official-certified",
    "reviewStatus": "approved",
    "reviewedAt": "2026-06-08"
  },
  "compatibility": {
    "cobeingVersion": ">=1.4.0"
  },
  "artifacts": [
    {
      "type": "group-template",
      "path": "group/"
    }
  ],
  "dependencies": [
    {
      "id": "official.agent.travel-planner",
      "type": "agent",
      "required": true,
      "reason": "负责行程规划"
    },
    {
      "id": "official.skill.budget-analysis",
      "type": "skill",
      "required": false,
      "reason": "用于预算拆解"
    }
  ],
  "permissions": {
    "riskLevel": "medium",
    "requiresNetwork": false,
    "requiresFilesystem": false,
    "requiresExternalAccount": false,
    "requiresUserApproval": true
  },
  "examples": [
    {
      "title": "七天日本旅行规划",
      "input": "七月想去日本七天，预算一万五",
      "outputSummary": "生成路线、预算和出发前提醒"
    }
  ],
  "install": {
    "forkToLocal": true,
    "defaultEnabled": false,
    "requiresRestart": false
  }
}
```

Market manifest 与运行时 manifest 的区别：

| 文件 | 作用 |
| --- | --- |
| `cobeing.resource.json` | Market 资源描述、信任、依赖、审核、安装计划输入 |
| `cobeing.plugin.json` | Plugin 运行时加载描述 |
| Agent/Group 模板文件 | 安装后复制到本地的资源内容 |
| `SKILL.md` | Skill 的实际执行说明 |
| MCP 配置 | MCP server 的运行配置 |

## Trust Profile

Market 资源必须有信任分级：

| 信任级别 | 含义 | 默认策略 |
| --- | --- | --- |
| `builtin` | 随应用提供，官方内置 | 可用于 onboarding，可默认推荐 |
| `official-certified` | 官方认证，经过审核和测试 | Butler 可轻量推荐 |
| `community-reviewed` | 社区资源，有基础自动检查或人工标记 | 可搜索，不主动强推 |
| `community-unverified` | 普通社区资源，未认证 | 必须用户主动审查后授权 |
| `local-private` | 用户或 Butler 本地创建 | 默认安全边界取决于本地配置 |

认证信息应至少包含：

- 发布者身份。
- 资源版本。
- 审核状态。
- 自动测试结果。
- 权限扫描结果。
- 依赖扫描结果。
- 示例输出。
- 最后审核时间。
- 是否被撤回或标记风险。

普通用户不需要理解所有细节，但安装前必须能看到压缩后的风险摘要。

## Risk Profile

建议使用五级风险：

| 风险 | 示例 | 策略 |
| --- | --- | --- |
| `low` | Persona、纯文本 Skill、无工具模板 | 可轻量确认 |
| `medium` | Agent / Group 模板，依赖低风险 Skill | 展示依赖和本地 fork |
| `high` | Plugin、MCP、外部 API、文件写入工具 | 必须明确权限确认 |
| `critical` | 外部账号、消息渠道、支付、远程执行 | 必须单独授权，不可批量默认同意 |
| `blocked` | 越权、恶意、版本不兼容、撤回资源 | 禁止安装 |

风险不是只看资源自身，也要看依赖树。低风险 Group 如果依赖高风险 Plugin，最终安装风险就是高风险。

## Dependency Tree

安装任何资源前都必须生成依赖树。

示例：

```text
旅行规划群组
├─ Host: 旅行协调员
├─ Agents
│  ├─ 行程规划师
│  │  └─ Skills: 路线规划
│  ├─ 预算分析师
│  │  └─ Skills: 预算拆解、比价分析
│  └─ 风险提醒员
│     ├─ Skills: 天气提醒、安全检查
│     └─ Plugins: 天气 Provider
└─ Optional MCP
   └─ 地图 MCP
```

依赖树必须回答：

- 必装依赖有哪些。
- 可选依赖有哪些。
- 哪些依赖已经本地存在。
- 哪些依赖需要新增。
- 哪些依赖版本冲突。
- 哪些依赖风险更高。
- 是否有替代依赖。

安装 Group 或 Agent 时，不能把依赖藏在描述里。

## Install Plan

Market Resolver 选中资源后，不直接安装，而是生成 Install Plan。

```ts
interface MarketInstallPlan {
  resourceId: string;
  resourceType: "group" | "agent" | "skill" | "plugin" | "mcp" | "butler-persona";
  trustLevel: string;
  overallRisk: "low" | "medium" | "high" | "critical" | "blocked";
  summary: string;
  dependencies: Array<{
    id: string;
    type: string;
    required: boolean;
    status: "already-installed" | "to-install" | "conflict" | "blocked";
    riskLevel: string;
    reason: string;
  }>;
  permissions: Array<{
    capability: string;
    riskLevel: string;
    reason: string;
    requiresSeparateApproval: boolean;
  }>;
  userConfirmations: Array<{
    id: string;
    question: string;
    required: boolean;
  }>;
  localFork: {
    forkToLocal: boolean;
    targetPath: string;
    editableAfterInstall: boolean;
  };
  rollback: {
    canRollback: boolean;
    filesToCreate: string[];
    registryChanges: string[];
  };
}
```

Install Plan 是用户授权、前端展示、Butler 解释和测试验证的共同对象。未来做页面时，页面也应该展示这个对象，而不是自己推导安装逻辑。

## Local Fork

Market 资源安装后应默认 fork/copy 到本地。

原因：

- CoBeing 是私人 AI Team，资源需要按用户风格长期变化。
- Agent 和 Group 不能长期依赖远程模板。
- 本地 fork 后可以安全编辑、记忆、经验和配置。
- 远程更新不能静默覆盖用户个性化内容。

本地 fork 策略：

| 资源 | 本地化方式 |
| --- | --- |
| Group | 复制群组模板，创建本地 Group、成员和 GUIDE |
| Agent | 复制五文件体系和 config，生成本地 Agent |
| Skill | 复制到 `data/skills/`，保留来源元数据 |
| Plugin | 复制到 `data/plugins/`，写入 registry，但默认是否启用取决于风险 |
| MCP | 写入本地 MCP 配置草案，等待用户授权启用 |
| Persona | 复制为 Butler persona 模板或应用到本地 Butler 配置 |

本地资源应保留来源元数据：

```json
{
  "source": {
    "marketId": "official.travel.group.basic",
    "version": "1.0.0",
    "installedAt": "2026-06-08T00:00:00.000Z",
    "trustLevelAtInstall": "official-certified"
  }
}
```

## Update Strategy

fork 到本地后，Market 更新不能直接覆盖本地资源。

推荐策略：

1. Market 发现新版本。
2. 生成更新摘要。
3. 对比本地修改。
4. 如果是安全修复，提示优先更新。
5. 如果会覆盖本地 prompt、记忆或配置，必须展示差异并请求确认。
6. 用户可以选择忽略、合并、另存为新资源或重新 fork。

社区资源被撤回或标记风险时，应通知用户，但不直接删除本地资源。高风险插件可以建议禁用。

## Market Resolver

Market Resolver 是推荐和搜索核心，不是页面。

输入可能来自：

- Butler 根据用户需求请求。
- 群主根据群组资源缺口请求。
- Agent 发现自己缺 Skill/Plugin/MCP 后提出请求。
- Onboarding 根据用户兴趣请求。
- 进阶用户主动搜索。

Resolver 输出不是资源列表，而是少量候选和解释：

```ts
interface MarketRecommendation {
  resourceId: string;
  title: string;
  reason: string;
  trustLevel: string;
  riskLevel: string;
  expectedBenefit: string;
  localAlternative?: {
    canCreateLocally: boolean;
    summary: string;
  };
}
```

推荐原则：

1. 默认先考虑本地创建。
2. 官方内置和官方认证优先。
3. 社区未认证资源不主动强推。
4. 同一需求最多给少量候选。
5. 推荐必须解释为什么比本地创建更好。
6. 风险高于收益时不推荐安装。

## Butler / Host / Agent 关系

### Agent

Agent 可以发现自己缺资源，但不能静默安装资源。

它应表达：

- 缺什么能力。
- 为什么现有能力不足。
- 需要 Skill、Plugin、MCP、Agent 还是 Group。
- 如果继续不安装，会有什么替代方案。

### Host / 群主

群主负责群组内部资源请求的协调：

- 判断资源缺口是否真实影响群组任务。
- 防止成员随意申请无关资源。
- 把多个成员的资源请求合并成用户能理解的问题。
- 需要跨群组、安装资源或高风险权限时，交给 Butler 或用户确认。

群主不直接静默安装资源。

### Butler

Butler 是普通用户的资源申请解释器和授权入口。

它负责：

- 接收用户需求或群主资源请求。
- 调用 Market Resolver。
- 对比本地创建和 Market 安装。
- 只在官方认证资源明显更优时轻量推荐。
- 对社区未认证资源发起用户审查。
- 展示 Install Plan 摘要。
- 在用户授权后执行安装或本地创建。

Butler 不应该：

- 把大量 Market 搜索结果丢给普通用户。
- 静默安装社区资源。
- 用人格话术淡化权限风险。
- 在高风险资源上默认同意依赖安装。

## 普通用户体验

普通用户不应感知复杂 Market。

推荐体验：

```text
用户：我想准备去日本旅行。

Butler：
我可以先本地创建一个旅行规划群组。
另外，官方认证库里有一个“旅行规划群组”模板，包含行程、预算和出发提醒，能省一些配置时间。

它会创建 3 个 Agent 和 2 个低风险 Skill，不需要外部账号。
要用这个模板，还是我直接按你的偏好本地创建？
```

如果是社区未认证资源：

```text
我找到了一个社区旅行模板，但它没有官方认证。
它依赖一个地图 MCP，需要网络访问和外部服务配置。
我不能直接安装。你可以先查看作者、权限、依赖和示例输出，再决定是否继续。
```

## 进阶用户体验

进阶用户可以进入 Market / Extensions 管理更详细内容，但看到的也应是架构对象：

- 资源类型。
- 信任级别。
- 依赖树。
- 权限风险。
- 版本。
- 示例输出。
- 安装计划。
- 本地 fork 状态。
- 更新差异。

当前扩展页可以继续承担“已安装插件/技能/MCP 管理”，但不等同于完整 Market。

## 与现有实现的关系

当前已具备：

- `packages/plugin-sdk`：插件 manifest、loader、hook、prompt layer、UI extension 基础。
- `data/plugins/registry.json`：本地插件启用/禁用注册表。
- `list_plugins` WS 端点：前端可列出已注册插件。
- `gui-v2/src/components/extensions/PluginsTab.tsx`：已安装插件配置入口。
- SkillRepository 和 Skill 工具。
- MCP manager 和 bridge tool。
- Butler 创建 Agent / Group 的工具基础。
- `CoBeing-market/` 分类目录雏形。

当前缺失：

- Market Resource Manifest。
- Market Index。
- Trust / Audit Metadata。
- 依赖树解析器。
- Install Plan 生成器。
- 用户确认项模型。
- 本地 fork 来源元数据。
- 更新/撤回策略。
- Butler 调用 Market Resolver 的工具。
- 社区资源的安全审查流程。

因此后续实现应先补架构对象和后端流程，再考虑页面。

## 建议目录结构

`CoBeing-market/` 可逐步收敛为：

```text
CoBeing-market/
├── market.index.json
├── groups/
│   └── official.travel.group.basic/
│       ├── cobeing.resource.json
│       ├── group/
│       └── examples/
├── agents/
│   └── official.agent.travel-planner/
│       ├── cobeing.resource.json
│       ├── agent/
│       └── examples/
├── skills/
│   └── official.skill.budget-analysis/
│       ├── cobeing.resource.json
│       └── SKILL.md
├── plugins/
│   └── official.plugin.weather/
│       ├── cobeing.resource.json
│       ├── cobeing.plugin.json
│       └── index.js
├── mcps/
│   └── official.mcp.maps/
│       ├── cobeing.resource.json
│       └── mcp.config.json
└── personas/
    └── official.persona.friend-butler/
        ├── cobeing.resource.json
        └── persona.md
```

目录名和 resource id 应稳定。大小写建议统一使用小写 `mcps/`，当前 `MCPs/` 后续可迁移或兼容。

## 后续实施方向

建议按阶段推进：

1. **资源包规范**
   - 定义 `cobeing.resource.json` schema。
   - 为 Group / Agent / Skill / Plugin / MCP / Persona 各写一个最小示例。
   - 增加 market index 草案。

2. **Resolver 与 Install Plan**
   - 实现本地 Market 扫描。
   - 输出候选推荐和 Install Plan。
   - 不先做页面，可用 Butler 工具或调试命令验证。

3. **Local Fork Installer**
   - Skill / Plugin 先做最小安装。
   - Agent / Group 做模板复制和 registry 注册。
   - 写入来源元数据和 rollback 记录。

4. **Trust / Risk**
   - 先支持静态 trust metadata。
   - 再加自动检查：manifest 完整性、依赖闭包、权限风险、版本兼容。
   - 社区资源默认不通过自动安装。

5. **Butler 集成**
   - Butler 增加 Market Resolver 工具。
   - Butler 可生成“本地创建 vs 安装认证资源”的少量选项。
   - 未认证资源必须走用户审查。

6. **前端后置**
   - 先在现有扩展页展示已安装资源来源和风险。
   - 再考虑进阶用户 Market 浏览页。
   - 普通用户仍以 Butler 对话为主。

## 验收方向

后续实现时至少验证：

1. `CoBeing-market/` 中一个资源包可以被扫描并读出 manifest。
2. Group 包能生成完整依赖树。
3. 高风险 Plugin 依赖能把整体安装风险提升到 high。
4. 官方认证资源可被 Butler 轻量推荐。
5. 社区未认证资源不能被静默安装。
6. 安装前能生成 Install Plan，包含依赖、权限、用户确认项和 rollback 信息。
7. 安装 Agent 后会 fork 到本地 Agent 目录，而不是引用远程模板。
8. 安装 Group 后会创建本地 Group、成员和必要依赖。
9. 本地资源保留 market source 元数据。
10. Market 资源更新不会静默覆盖本地修改。
11. 普通用户不需要进入 Market 页面，也能通过 Butler 完成可信资源安装。

## 最终口径

Market 是 CoBeing 的可信能力供应链，不是一个优先要做的页面。

普通用户不需要直接理解 Skill、Plugin、MCP、Agent、Group 的差别。系统应由 Butler、群主和 Agent 在需要时提出资源缺口，再由 Market Resolver 给出少量可信候选和安装计划。

Market 资源必须有统一 manifest、信任分级、依赖树、权限风险、安装计划和本地 fork 策略。官方认证资源可以被轻量推荐，社区未认证资源必须用户主动审查。

先把这些架构对象做扎实，再做页面，CoBeing 的 Market 才不会变成一个“插件列表”，而会成为私人 AI Team 的可信能力供应系统。
