# 完成报告 — task-onboarding-backend

**状态**: DONE

## 产出文件清单
- `D:\agent-codes\CoBeing\packages\core\src\api\handlers\onboarding.ts`（新建）— onboarding_apply / onboarding_get WS 命令 handler；导出 `registerOnboardingHandlers(register: HandlerRegistrar): void`。复用 create_agent 链路（AgentPaths 写文件 + AgentCreator 生成 + 模板 fallback + registry 注册），生成 1-2 个初始 Agent；Market 官方/认证推荐 ≤2 条（不自动安装）；幂等标记 data/onboarding.json。

未修改任何其他文件（ws-server.ts / runtime.ts / 其他 handler / 前端均未触碰；已用 git status 确认 handlers 目录仅新增 onboarding.ts）。

## 自检结果
- [x] 文件存在性
- [x] 接口签名匹配
- [x] 功能完整性
- [x] 接口自洽
- [x] 错误处理
- 全部通过: 是

验证命令结果：
- `cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit` — 通过，0 错误
- `cd D:/agent-codes/CoBeing && pnpm build` — 通过（7 个包全部构建成功）

真实验证：临时 smoke 脚本驱动 dist 编译产物（fake provider / fake marketCatalog / 真实 AgentRegistry / 临时 dataRoot），21 个断言全部 PASS，覆盖：interests 校验、already_done 幂等、未匹配 error、Provider 不可用 error、happy path（2 Agent 创建、角色映射、推荐 ≤2 官方优先、标记落盘、master registry 登记、二次 apply 幂等）、note 自定义角色 + id 占用跳过、onboarding_get。脚本为临时产物已删除（证据记录于 self-check.md）。

## onboarding_result payload 结构
```
{
  status: "done" | "already_done" | "error",   // error 时附带 message
  createdAgents: [{ id: string, name: string, role: string }],
  marketRecommendations: [{ id: string, name: string, description: string, tier: string }],
  message?: string                              // 仅 status==="error"
}
```
- `onboarding_apply {interests: string[], note?: string}` → 响应 type `onboarding_result`；`onboarding_get {}` → 响应 type `onboarding_get_result`，payload `{done, createdAt?, createdAgents, marketRecommendations}`。
- 参数校验类错误（interests 非空数组等）→ 标准 `{type:"error"}` 消息。

## 已知担忧 (DONE_WITH_CONCERNS 时填写)
无。测试可选要求（handler 单测）按合约降级说明：未新增单测文件（「只创建 onboarding.ts」约束），改以 dist 运行时 smoke 21 断言真实验证 + 主线程冒烟留待集成（onboarding 命令尚未在 ws-server.ts 注册——按合约由主线程接线，本任务未动该文件）。

## 缺失信息 (NEEDS_CONTEXT 时填写)
无。

## 阻塞原因 (BLOCKED 时填写)
无。
