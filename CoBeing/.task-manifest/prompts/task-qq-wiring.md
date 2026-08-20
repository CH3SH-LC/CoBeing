# 子任务：task-qq-wiring

## 任务描述
修复 CoBeing 的 QQ Bot 接线缺口：①StdioTransport 子进程 env 不继承 process.env（MCP server 读不到 .env 凭据）；②config.channels 里配置了 qqbot 但从未实例化注册 QQBotChannel。产出 qq 配置片段供主线程合入。

## 依赖关系
- 依赖的任务：无（第 0 批）
- 本任务产出被以下任务依赖：集成（主线程）

## 输入文件
| 文件 | 章节/位置 | 描述 |
|------|-----------|------|
| packages/core/src/mcp/transport.ts | StdioTransport.start() | 现 env 白名单不继承 process.env |
| packages/core/src/runtime/channels.ts | startChannels() | getChannel(id) 从注册表取，但无实例化点 |
| packages/channels/src/qq/qqbot-channel.ts | QQBotChannel | constructor({appId, appSecret, intents})，id 固定 "qqbot" |
| packages/core/src/config/schema.ts | AppConfig.channels | enabled/type/qqbotAppId/qqbotAppSecret/qqbotIntents/bindTo |
| packages/core/src/config/secret-store.ts | isEncrypted/decrypt | enc: 前缀解密 |
| config/default.json | 现状 | 不要直接修改！只作为片段参考 |

## 输出接口
| 文件 | 导出 | 签名/说明 |
|------|------|-----------|
| packages/core/src/mcp/transport.ts（修改） | StdioTransport | start() 的 procEnv 需包含 ...process.env 与 ...this.env（config env 覆盖 process.env） |
| packages/core/src/runtime/channels.ts（修改） | registerConfigChannels | function registerConfigChannels(config: AppConfig): void — 遍历 config.channels，type==='qqbot' 时 new QQBotChannel({appId, appSecret, intents})（enc: 值先 decrypt，缺省回退 process.env.QQ_BOT_APP_ID/QQ_BOT_APP_SECRET）并 registerChannel()，幂等（已注册跳过） |
| .task-manifest/outputs/qq-config.json | 配置片段 | 见下方格式 |
| packages/core/src/mcp/transport.test.ts（可能新建） | 单测 | env 继承 process.env；config env 覆盖 |
| packages/core/src/runtime/channels.test.ts（可能新建） | 单测 | registerConfigChannels 行为 |

**qq-config.json 格式**（`__ENCRYPT_ME__` 占位，主线程集成时替换为 enc: 加密值）：
```json
{
  "mcpServers": {
    "qqbot": {
      "transport": "stdio",
      "command": "node",
      "args": ["packages/mcp-servers/qqbot/dist/index.js"],
      "env": {}
    }
  },
  "channels": {
    "qqbot": {
      "enabled": true,
      "type": "qqbot",
      "qqbotAppId": "__ENCRYPT_ME__",
      "qqbotAppSecret": "__ENCRYPT_ME__",
      "bindTo": { "type": "agent", "agentId": "butler" }
    }
  }
}
```

## 关键实现要点
1. **transport.ts**：`procEnv` 从白名单改为 `{ ...process.env, ...this.env }`——config env 需覆盖 process.env（保留覆盖语义）。注意 Windows 上 PATH/Path 双键场景由 process.env 天然覆盖。
2. **channels.ts**：`registerConfigChannels(config)` 必须在 `startChannels()` 之前调用（runtime.start() 里合适位置接线，或在 startChannels 开头调用一次）。构造 QQBotChannel 时 appId/appSecret 若有 `enc:` 前缀用 decrypt() 解密；为空时回退 process.env.QQ_BOT_APP_ID / process.env.QQ_BOT_APP_SECRET。已注册（getChannel("qqbot") 存在）则跳过——幂等。
3. **QQBotChannelConfig 继承 QQBotGatewayConfig**（appId/appSecret/intents），构造后 `registerChannel(channel)`（来自 @cobeing/channels）。
4. **测试**：先检查文件是否存在，存在则追加，不存在则新建。transport 测试验证子进程 env 继承（可用 spawn 一个输出 env 的脚本或注入测试变量）；channels 测试 mock/构造 QQBotChannel 验证注册与解密。
5. **不要改 config/default.json**、不要改 qqbot MCP server 包、不要改 qqbot-channel.ts 本身（除非发现必改的 bug，改动需在 completion 中说明）。

## 验证标准
- [ ] transport.ts 修改完成，procEnv 包含 process.env
- [ ] channels.ts 导出 registerConfigChannels 且幂等
- [ ] .task-manifest/outputs/qq-config.json 已写入（含 __ENCRYPT_ME__ 占位）
- [ ] 测试文件已写
- [ ] `pnpm --filter @cobeing/core test` 通过（本任务新增测试全绿）
- [ ] `pnpm --filter @cobeing/core build` 通过

## 工作协议
请遵循「myworkflow:subagent-protocol」的 5 阶段工作规范：
1. 读取合约 + 确认输入：读取 `.task-manifest/task-contract-realwork.yaml` 中你的条目和所有输入文件
2. 声明接口：先写 interface-declaration.md 承诺你的接口——声明先于实现
3. 产出实现：按声明逐项编码，每完成一个文件在声明中勾选
4. 自检：写 self-check.md，逐项核对，全部打勾才能进入下一步
5. 完成报告：写 completion.md，列出产出文件和自检结果

## 约束
- 只修改本任务指定的输出文件，不修改其他模块
- 不修改 config/default.json（主线程统一合入）
- 凭据明文（1905411647 / Tt65pUxCCyWpvnSt）只能出现在 qq-config.json 的 __ENCRYPT_ME__ 上下文注释中或 .env 中，不得写进任何会被 git 跟踪的源码文件
- 文件路径必须精确匹配
