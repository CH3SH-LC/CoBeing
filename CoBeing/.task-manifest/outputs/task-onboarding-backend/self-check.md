# 自检报告 — task-onboarding-backend
> 自检时间: 2026-08-04T02:40:00+08:00

## 文件存在性
- [x] `D:\agent-codes\CoBeing\packages\core\src\api\handlers\onboarding.ts` — 存在且非空（约 340 行）

## 接口签名匹配（与 interface-declaration.md 对比）
- [x] `registerOnboardingHandlers`: `export function registerOnboardingHandlers(register: HandlerRegistrar): void` — 实际签名一致
- [x] WS 命令：`onboarding_apply` / `onboarding_get` 经 register 注册（HandlerRegistrar 类型）

## 功能完整性
- [x] onboarding_apply 校验 interests 非空数组（空/空白 → error）
- [x] 幂等：data/onboarding.json 存在且 done=true → `{status:"already_done"}`（附已存列表），不重复创建
- [x] 兴趣→角色映射表 7 项全覆盖：生活/学习/旅行/购物/创作/家庭事务/工作杂事
- [x] 取 1-2 个角色；重复兴趣去重；note 非空 → 只创建 1 个、role=note、候选名第一个未占用 id
- [x] 每个 Agent 复用 create_agent 核心链路（agent.ts:26-180 照搬）：AgentPaths.ensureDirs → writeConfig(默认工具白名单) → writeCapability → runAgentCreator → 模板 fallback → new Agent → registry.register → inject skillRepo/groupManager/agentMessage → addAgentToRegistry → ButlerRegistry → logMessage/broadcastState
- [x] Market 轻量推荐：official tier 优先、certified 补足，≤2 条，去重，不自动安装；无 marketCatalog → 空数组
- [x] 写 data/onboarding.json `{done:true, createdAt, createdAgents, marketRecommendations}`（tmp+rename 原子写）
- [x] onboarding_result payload：`{status:"done"|"already_done"|"error", createdAgents:[{id,name,role}], marketRecommendations:[{id,name,description,tier}]}`
- [x] onboarding_get：读标记返回 done/createdAt/createdAgents/marketRecommendations
- [x] 失败语义：Provider 不可用 → `{status:"error", message}`；单 Agent 创建失败 catch 后继续其余（不阻塞）；全部失败 → error 且不写标记（允许重试）

## 接口自洽
- [x] 所有导出的函数/类型在同一个模块内有定义（registerOnboardingHandlers + 2 个类型导出，内部使用）
- [x] 没有引用不存在的模块/文件 → tsc + pnpm build + dist 运行时 import 均通过（imports: @cobeing/shared, @cobeing/providers, agent.js, paths.js, butler-registry.js, tool-agent/creator.js, tools/sandbox/docker-sandbox.js, market/catalog.js, handlers/types.js, ws-server.js[type-only]）
- [x] 没有孤立的导出 → 契约要求 registerOnboardingHandlers；额外导出的 OnboardingCreatedAgent/OnboardingMarketRecommendation 为 payload 结构类型，被模块内部使用

## 错误处理
- [x] 参数校验：interests 非数组/空数组/全空白 → error
- [x] 兴趣未匹配且无 note → error（提示补充自定义描述）
- [x] Provider 不可用 → onboarding_result status:error（不创建任何 Agent）
- [x] agentRegistry 未就绪 → status:error
- [x] Docker 检查失败/不可用 → sandbox 禁用（与 create_agent 一致，try/catch 兜底）
- [x] 单 Agent 创建异常 → 记录失败并继续其余 Agent
- [x] 已存在同 id Agent → 跳过不重复创建（note 路径候选名预选未占用 id）
- [x] 标记写入失败 → log error，不影响响应
- [x] 标记读取损坏 → 视为未完成（允许重新 onboarding）

## 真实验证（非仅静态检查）
- [x] `cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit` — 通过（0 错误）
- [x] `cd D:/agent-codes/CoBeing && pnpm build` — 通过（全部 7 个包构建成功）
- [x] 运行时 smoke（临时脚本驱动 dist 编译产物，21 断言全 PASS）：A 参数校验 / B already_done 幂等 / C 未匹配 error / D Provider error / E happy path（2 Agent 创建 + 角色映射 + 推荐≤2 官方优先 + 标记落盘 + master registry 登记 + 二次 apply already_done）/ F note 自定义角色 + id 占用跳过 / G onboarding_get
