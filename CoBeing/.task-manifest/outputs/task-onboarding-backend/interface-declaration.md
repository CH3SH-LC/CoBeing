# 接口声明 — task-onboarding-backend
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-04T02:10:00+08:00

## 我将创建/修改的文件
- [ ] `D:\agent-codes\CoBeing\packages\core\src\api\handlers\onboarding.ts` — 阶段 B 后端：onboarding_apply / onboarding_get WS 命令 handler（新建）

（合约范围仅此一个文件；不修改 ws-server.ts / runtime.ts / 其他 handler / 前端。）

## 我将暴露的接口
| 名称 | 签名 | 所在文件 |
|------|------|----------|
| registerOnboardingHandlers | `export function registerOnboardingHandlers(register: HandlerRegistrar): void` | packages/core/src/api/handlers/onboarding.ts |

注册的 WS 命令（经 HandlerRegistrar 注册，主线程在 ws-server.ts 统一接线，本文件不 import ws-server）：

| 命令 | 请求 payload | 响应 type | 响应 payload |
|------|-------------|-----------|--------------|
| onboarding_apply | `{ interests: string[], note?: string }` | `onboarding_result` | `{ status: "done" \| "already_done" \| "error", createdAgents: [{id,name,role}], marketRecommendations: [{id,name,description,tier}], message?: string }` |
| onboarding_get | `{}` | `onboarding_get_result` | `{ done: boolean, createdAt?: string, createdAgents: [{id,name,role}], marketRecommendations: [{id,name,description,tier}] }` |

错误路径统一发 `{ type: "error", payload: { message } }`（参数校验类），或 `onboarding_result {status:"error", message}`（Provider 不可用）。

## 我需要的外部输入
| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/core/src/api/handlers/agent.ts | create_agent (26-180) | 初始 Agent 创建链路行为模板（照搬：AgentPaths.ensureDirs → writeConfig → writeCapability → runAgentCreator → 模板 fallback → new Agent → registry.register → 注入工具 → addAgentToRegistry → ButlerRegistry → logMessage/broadcastState） |
| packages/core/src/agent/tool-agent/creator.ts | runAgentCreator | 生成 CHARACTER.md / JOB.md（失败返回空 files，由模板兜底） |
| packages/core/src/market/catalog.ts | MarketCatalog.search(query, {type?, tier?}) | 官方/认证 tier 轻量推荐（≤2 条，不自动安装） |
| packages/core/src/api/handlers/plugin.ts | registerPluginHandlers | WS handler 风格参考 |
| packages/core/src/api/handlers/types.ts | HandlerRegistrar / WsCommandHandler | handler 类型（this: CoreWSServer） |
| packages/core/src/agent/paths.ts | AgentPaths / AgentFiles / createDefaultCapabilityCard | Agent 目录与文件写入 |
| packages/core/src/agent/registry.ts | AgentRegistry.register/get/list | Agent 实例注册 |
| packages/shared/src/master-registry.ts | addAgentToRegistry | master registry 单一真相源 |
| packages/core/src/agent/butler-registry.ts | ButlerRegistry.registerAgent | butler 侧注册 |
| packages/core/src/api/ws-server.ts | CoreWSServer 成员（只读） | this.dataRoot / this.agentRegistry / this.providerResolver / this.skillRepo / this.groupManager / this.marketCatalog / sendToClient / broadcastState / logMessage |

## 设计决策（实现要点落地）
1. 兴趣→角色映射表：生活→家庭事务助理、学习→学习监督员、旅行→旅行规划师、购物→购物顾问、创作→写作编辑、家庭事务→家庭事务助手、工作杂事→资料整理员。
2. 角色数量：去重映射后取前 2 个；若 `note` 非空 → 只创建 1 个 Agent，name 在映射角色名候选（无映射则「个人助理」）中取第一个未被占用的 id，role = note（自定义优先作 role 描述；候选全部被占用 → error）。
3. 幂等：`dataRoot/onboarding.json` 存在且 `done === true` → `{status:"already_done"}`（附已存 createdAgents / marketRecommendations）。
4. 失败语义：Provider 不可用（`this.providerResolver` 无结果）→ `onboarding_result {status:"error", message}`；单个 Agent 创建异常（Creator 失败已被模板兜底、注册冲突等）→ 记录失败并继续其余 Agent，不阻塞。
5. 复用 create_agent 默认配置：tools 白名单 `["bash","read-file","write-file","edit-file","glob","grep","web-fetch","agent-message"]`、permissions workspace-readwrite、sandbox Docker 可用性检查（不可用则禁用）、模板目录 `path.resolve("packages/core/src/templates/agent")` 占位符替换 `{{name}}`/`{{role}}`。
6. Market 推荐：按每个 interest 关键词 `catalog.search(kw, {tier:"official"})` 聚合去重；不足 2 条再补 `{tier:"certified"}`；总计 ≤2 条；无 marketCatalog → 空数组。映射为 `{id,name,description,tier}`。

## 风险和假设
- 假设 1：主线程（ws-server.ts 后续任务）会 import `registerOnboardingHandlers` 并接线 onboarding_apply / onboarding_get 命令——本文件只导出注册函数，不修改 ws-server.ts（合约约束）。
- 假设 2：`onboarding_get` 响应 type 采用 `onboarding_get_result`（前端合约只定义了 onboarding_apply 的响应，get 无消费者契约，采用独立 type 保持语义清晰）。
- 假设 3：Agent 名称直接取角色名（如「家庭事务助理」），id 为 name 小写化+空格转连字符——与现有「前端工程师/游戏开发工程师」等中文 id Agent 一致；若该 id 已在 registry 则跳过（防止重复创建）。
- 假设 4：`dataRoot` 即 `data/`，onboarding.json 落在 `data/onboarding.json`（合约指定）。
- 风险：runAgentCreator 为 LLM 调用，耗时较长；失败已由模板 fallback 兜底，与 create_agent 行为一致。
