# 子任务:task-onboarding-backend(阶段 B 后端)

## 任务描述
onboarding_apply WS 命令:问卷答案(兴趣标签)→ 生成 1-2 个初始 Agent(复用 create_agent 链路)+ 返回 Market 官方资源轻量推荐(≤2 条,不自动安装);onboarding_done 幂等标记。

## 关键契约(读 .task-manifest/task-contract-butler.md 中你的条目)
- 输出文件清单与验证命令见合约。
- **不动 ws-server.ts**(主线程注册);不动 runtime.ts。

## 实现要点
1. handlers/onboarding.ts:
   - onboarding_apply{interests:string[], note?} → 校验 interests 非空数组 → 若 data/onboarding.json 存在且 done=true → 返回 {status:"already_done"}
   - 兴趣 → 角色映射(内置映射表:生活→家庭事务助理、学习→学习监督员、旅行→旅行规划师、购物→购物顾问、创作→写作编辑、家庭事务→家庭事务助手、工作杂事→资料整理员;自定义 note 优先作 role 描述)。取 1-2 个角色。
   - 每个角色复用 create_agent 核心逻辑(读 handlers/agent.ts:26-180):AgentPaths.ensureDirs → writeConfig(默认工具白名单同 create_agent)→ writeCapability → runAgentCreator 生成 CHARACTER/JOB(失败模板 fallback)→ new Agent(config, prov, this.dataRoot) → agentRegistry.register。可抽公共函数或内联实现,行为保持一致。
   - Market 轻量推荐:marketCatalog.search(兴趣关键词, {tier:"official"}) 取前 2 条;无 marketCatalog 则空数组。
   - 写 data/onboarding.json {done:true, createdAt, createdAgents, recommendations};返回 onboarding_result{status:"done", createdAgents:[{id,name,role}], marketRecommendations:[{id,name,description,tier}]}
   - 失败语义:某 Agent 创建失败不阻塞其他;Provider 不可用 → {status:"error", message}
2. 测试可选(handler 单测需 mock 依赖,若实现困难在完成报告说明,主线程冒烟覆盖)。

## 验证
- cd D:/agent-codes/CoBeing/packages/core && pnpm exec tsc --noEmit
- cd D:/agent-codes/CoBeing && pnpm build

## 工作协议
遵循「myworkflow:subagent-protocol」,task-id=task-onboarding-backend。声明/自检/完成报告写 .task-manifest/outputs/task-onboarding-backend/。
