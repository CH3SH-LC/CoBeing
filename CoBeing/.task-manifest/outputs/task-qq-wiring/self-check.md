# 自检报告 — task-qq-wiring
> 自检时间: 2026-08-12T20:20:00+08:00

## 文件存在性
- [x] packages/core/src/mcp/transport.ts — 存在且非空（已修改 procEnv）
- [x] packages/core/src/runtime/channels.ts — 存在且非空（已新增 registerConfigChannels）
- [x] .task-manifest/outputs/qq-config.json — 存在，JSON 解析通过，含 __ENCRYPT_ME__ 占位，无明文凭据
- [x] packages/core/src/mcp/transport.test.ts — 存在且非空（2 测试）
- [x] packages/core/src/runtime/channels.test.ts — 存在且非空（6 测试）
- [x] .task-manifest/outputs/task-qq-wiring/interface-declaration.md — 存在

## 接口签名匹配（与 interface-declaration.md 对比）
- [x] StdioTransport: start() 中 `procEnv = { ...process.env, ...this.env }` — 实际实现（transport.ts:61-64）与声明一致；this.env 覆盖 process.env（覆盖语义保留）
- [x] registerConfigChannels: `function registerConfigChannels(config: AppConfig): void` — 实际签名（channels.ts:132）一致；遍历 config.channels、enabled 且 type==='qqbot'、getChannel(id) 幂等跳过、decrypt（channels.ts:140）、回退 process.env.QQ_BOT_APP_ID/QQ_BOT_APP_SECRET（channels.ts:137-138）、new QQBotChannel({appId, appSecret, intents})（channels.ts:149-153）、registerChannel（channels.ts:154）
- [x] startChannels: 函数体开头调用 registerConfigChannels(config)（channels.ts:164），签名不变

## 功能完整性
- [x] 子进程 env 继承 process.env（transport.test.ts「子进程默认继承」实测通过：自定义注入变量 child 可见）
- [x] config env 覆盖 process.env（transport.test.ts「config env 覆盖」实测通过）
- [x] type='qqbot' 条目构造并注册 QQBotChannel（channels.test.ts 用例 1 通过）
- [x] enc: 值 decrypt 后传入（channels.test.ts 用例 2 通过，真实 encrypt/decrypt 回路）
- [x] 缺省回退 process.env（channels.test.ts 用例 3 通过）
- [x] 非 qqbot 类型跳过（channels.test.ts 用例 4 通过）
- [x] disabled 跳过（channels.test.ts 用例 5 通过）
- [x] 重复调用幂等，不重复构造（channels.test.ts 用例 6 通过）

## 接口自洽
- [x] 所有导出的函数/类型在同一个模块内有定义（registerConfigChannels 定义于 channels.ts 并被 startChannels 调用；StdioTransport 定义于 transport.ts）
- [x] import/require 引用存在性 — `pnpm --filter @cobeing/core build`（tsc）通过 = 所有导入可解析（@cobeing/channels、../config/secret-store.js 均存在）
- [x] 没有孤立的导出 — registerConfigChannels 在 startChannels（channels.ts:164）被调用，也是合约要求导出；QQBotChannel/registerChannel/getChannel 均从 @cobeing/channels 导入且被使用（grep 验证）
- [x] qq-config.json 结构与合约格式逐字段一致（mcpServers.qqbot / channels.qqbot / __ENCRYPT_ME__ / bindTo butler）

## 错误处理
- [x] 已注册重复调用 → 幂等跳过，不重复构造（测试覆盖）
- [x] disabled / 非 qqbot 类型 → 跳过，不注册（测试覆盖）
- [x] 凭据缺失（config 与 env 均无）→ 注册但 log.warn 提示，运行时 connect 失败由 startChannels 既有 catch 兜底
- [x] decrypt 失败 → decrypt() 返回 ""，不泄露密文（secret-store 既有语义）
- [x] transport 测试子进程输出超时 → 轮询带 8s 超时 reject，不会悬挂

## 验证命令结果
- [x] `npx vitest run packages/core/src/mcp/transport.test.ts packages/core/src/runtime/channels.test.ts` — 2 文件 8 测试全绿
- [x] `npx vitest run packages/core` — 63 文件 615 测试全绿（回归确认）
- [x] `pnpm --filter @cobeing/core build` — tsc 通过
- [x] `pnpm --filter @cobeing/core test` — 无 test 脚本时 pnpm 空操作 EXIT=0（契约命令通过；实际验证以上面两项为准）
- 注：全量 `pnpm test` 中仅 packages/mcp-servers/browser/browser-engine.test.ts 2 用例失败 — 属并行任务 task-browser-mcp 在建代码（该包整个 untracked），与本次改动无关

## 结论
- 自检全部 [x]，无未完成项；可进入阶段 5。
