# 接口声明 — task-qq-wiring
> 本声明是我的接口承诺。「myworkflow:integration-verify」将据此验证我的产出。
> 声明时间: 2026-08-12T20:30:00+08:00

## 我将创建/修改的文件
- [x] packages/core/src/mcp/transport.ts（修改）— StdioTransport.start() 的 procEnv 改为继承 process.env，config env（this.env）覆盖 process.env
- [x] packages/core/src/runtime/channels.ts（修改）— 新增 registerConfigChannels() 并在 startChannels() 开头调用一次
- [x] .task-manifest/outputs/qq-config.json（新建）— qqbot 配置片段（__ENCRYPT_ME__ 占位，不含明文凭据）
- [x] packages/core/src/mcp/transport.test.ts（新建）— env 继承与覆盖单测
- [x] packages/core/src/runtime/channels.test.ts（新建）— registerConfigChannels 行为单测（mock @cobeing/channels）

## 我将暴露的接口
| 名称 | 签名 | 所在文件 |
|------|------|----------|
| StdioTransport（修改） | `class StdioTransport implements MCPTransport` — start() 中 `procEnv = { ...process.env, ...this.env }`（config env 覆盖 process.env；Windows PATH/Path 双键由 process.env 天然覆盖，this.env 可再覆盖） | packages/core/src/mcp/transport.ts |
| registerConfigChannels（新增导出） | `function registerConfigChannels(config: AppConfig): void` — 遍历 config.channels：enabled 为真且 type==='qqbot' 且未注册（getChannel(id) 不存在）时，解析凭据（enc: 值 decrypt；缺失回退 process.env.QQ_BOT_APP_ID / QQ_BOT_APP_SECRET），`new QQBotChannel({ appId, appSecret, intents })` 并 registerChannel()。幂等：已注册跳过 | packages/core/src/runtime/channels.ts |
| startChannels（修改，签名不变） | `async function startChannels(deps: ChannelDeps): Promise<void>` — 函数体开头调用一次 `registerConfigChannels(deps.config)`（满足"必须在 startChannels 之前/开头"接线要求） | packages/core/src/runtime/channels.ts |

## 我需要的外部输入
| 文件 | 内容（节/函数/类型） | 用途 |
|------|---------------------|------|
| packages/channels/src/qq/qqbot-channel.ts | `QQBotChannel`、`QQBotChannelConfig`（constructor({appId, appSecret, intents?})，id 固定 "qqbot"） | 构造与注册 QQBotChannel |
| packages/channels/src/base/channel-interface.ts | `registerChannel(channel)` / `getChannel(id)` | 注册与幂等检查（经 @cobeing/channels index 导出） |
| packages/core/src/config/schema.ts | `AppConfig.channels`（enabled/type/qqbotAppId/qqbotAppSecret/qqbotIntents/bindTo） | registerConfigChannels 入参类型 |
| packages/core/src/config/secret-store.ts | `decrypt(value)` — enc: 前缀解密，非前缀原样返回 | 凭据解密 |
| packages/channels/src/qq/qqbot-gateway-client.ts | `QQBotGatewayConfig`（appId/appSecret/intents?）— 构造无网络副作用 | 构造参数类型 |

## 风险和假设
- 假设 1：`enabled: false` 的条目不注册。若不跳过，startChannels 阶段 2（插件未配置 channel 启动循环）会把已注册但被禁用的 channel 当作插件 channel 启动，破坏 disabled 语义。合约未明说 enabled 过滤，此为合理解释，已写入单测。
- 假设 2：`qq-config.json` 仅含 `__ENCRYPT_ME__` 占位，不含明文凭据（满足"明文凭据不进 git 跟踪源码"约束，占位符由集成阶段加密替换）。
- 假设 3：`pnpm --filter @cobeing/core test` 在 @cobeing/core 无 test 脚本时是 pnpm 空操作（已验证 EXIT=0 无输出），实测验证以根 vitest 定向运行本任务测试文件为准，build 用 `pnpm --filter @cobeing/core build`（tsc）。
- 假设 4：channels.test.ts 通过 vi.mock("@cobeing/channels") 完全替换模块（工厂内自建捕获数组与注册表，避免 vi.mock 提升导致的 TDZ），channel 注册表语义（getChannel/registerChannel/getAllChannels）在 mock 内保持一致；类型层面仍以真实 QQBotChannel 签名为准。
- 风险：transport.test.ts 真实 spawn 子进程，Windows 下 node 需在 PATH（测试运行环境满足）；等待子进程输出用轮询+超时，避免悬挂。
