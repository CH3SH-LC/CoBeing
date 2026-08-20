# 完成报告 — task-qq-wiring

**状态**: DONE

## 产出文件清单
- [packages/core/src/mcp/transport.ts] — 修改：StdioTransport.start() 的 procEnv 从 PATH/Path/SystemRoot/TEMP/TMP 白名单 + config env 改为 `{ ...process.env, ...this.env }`（子进程继承 process.env，MCP server 可读 .env 中的 QQ 凭据；config env 覆盖 process.env）
- [packages/core/src/runtime/channels.ts] — 修改：新增导出 `registerConfigChannels(config: AppConfig): void`（enabled 且 type==='qqbot' 时，enc: 值 decrypt、缺省回退 QQ_BOT_APP_ID/QQ_BOT_APP_SECRET env，new QQBotChannel({appId, appSecret, intents}) + registerChannel；getChannel(id) 已存在则跳过 = 幂等）；startChannels() 开头调用一次完成接线
- [.task-manifest/outputs/qq-config.json] — 新建：mcpServers.qqbot + channels.qqbot 配置片段，凭据为 `__ENCRYPT_ME__` 占位（未含明文凭据，供集成阶段加密替换后合入 config/default.json）
- [packages/core/src/mcp/transport.test.ts] — 新建：2 用例（子进程继承 process.env、config env 覆盖 process.env），真实 spawn node 子进程
- [packages/core/src/runtime/channels.test.ts] — 新建：6 用例（qqbot 注册、enc: 解密、env 回退、非 qqbot 跳过、disabled 跳过、幂等），mock @cobeing/channels 捕获构造参数
- [.task-manifest/outputs/task-qq-wiring/interface-declaration.md] — 接口声明（先于实现）
- [.task-manifest/outputs/task-qq-wiring/self-check.md] — 自检报告

## 自检结果
- [x] 文件存在性
- [x] 接口签名匹配
- [x] 功能完整性
- [x] 接口自洽
- [x] 错误处理
- 全部通过: 是

## 验证结果
- `npx vitest run packages/core/src/mcp/transport.test.ts packages/core/src/runtime/channels.test.ts` — 8/8 全绿
- `npx vitest run packages/core` — 63 文件 615 测试全绿（无回归）
- `pnpm --filter @cobeing/core build` — tsc 通过
- `pnpm --filter @cobeing/core test` — 通过（注：@cobeing/core 无 test 脚本，pnpm 空操作 EXIT=0；实际测试以上面两项为准）

## 说明与注意事项（供集成线程）
1. **enabled 过滤**：registerConfigChannels 仅在 `cfg.enabled === true` 时注册。若注册 disabled 条目，startChannels 阶段 2 会把已注册但被禁用的 channel 当插件 channel 启动，破坏 disabled 语义（已在声明与测试中记录）。qq-config.json 片段 enabled: true，集成后行为符合预期。
2. **全量 pnpm test 的 2 个失败**（packages/mcp-servers/browser/browser-engine.test.ts，close/storageState 相关）来自并行任务 task-browser-mcp 的在建代码（该包为 untracked 工作区文件），与本次改动无关，@cobeing/core 全绿。
3. **transport env 覆盖语义**：`...process.env` 在前、`...this.env` 在后，config env（含可选的 PATH 键）可覆盖 process.env；Windows PATH/Path 双键由 process.env 天然保留。
4. **未修改**：config/default.json、packages/channels（qqbot-channel.ts 等）、packages/mcp-servers/qqbot — 均按约束未动；qqbot MCP server 包无需改动（dist 已存在，配置片段 args 路径 `packages/mcp-servers/qqbot/dist/index.js` 实测存在）。
5. 配置片段合入 config/default.json 时，凭据需用项目 secret-store 的 encrypt() 加密为 `enc:` 值替换 `__ENCRYPT_ME__`。
