# 任务拓扑 — CoBeing 真实软件接入（浏览器 + QQ）

## 并行批次表

| 批次 | 层级 | 任务 | 说明 |
|------|------|------|------|
| 第0批 | 0 | task-qq-wiring | QQ 接线补完，无依赖可立即启动 |
| 第0批 | 0 | task-browser-mcp | 浏览器 MCP 包实现，无依赖可立即启动（playwright+chromium 主线程后台预装中） |
| 第1批 | 1 | 集成（主线程） | 两个 config 片段合入 config/default.json + integration-verify |
| 第2批 | 2 | 真实验证（主线程） | real-world-verify：QQ 网关只读 + 浏览器真实导航 |

## 接口耦合点

| 输出任务 | 输出文件 | 被依赖的任务 |
|----------|----------|--------------|
| task-qq-wiring | .task-manifest/outputs/qq-config.json | 集成（主线程合入 config） |
| task-qq-wiring | packages/core/src/mcp/transport.ts（修改） | 集成后 runtime 全链路 |
| task-qq-wiring | packages/core/src/runtime/channels.ts（修改） | 集成后 channel 启动链路 |
| task-browser-mcp | .task-manifest/outputs/browser-config.json | 集成（主线程合入 config） |
| task-browser-mcp | packages/mcp-servers/browser/dist/*（build） | 集成后 MCP manager 连接 |

## 风险标注

| 风险 | 级别 | 说明 |
|------|------|------|
| config/default.json 并行编辑冲突 | 中 | 已规避：子任务只产出片段文件，主线程统一合入 |
| pnpm install 锁冲突 | 中 | 已规避：playwright 由主线程后台预装完成 |
| chromium 下载 300MB | 中 | 后台下载中，真实验证若未就绪则降级（浏览器真实导航延迟到就绪后） |
| QQ 真实验证依赖外网 | 中 | bots.qq.com 若不可达 → 降级凭据验证 + 沙箱 |
| transport.test.ts / channels.test.ts 文件已存在 | 低 | 若已存在则追加而非覆盖（先检查再写） |

## 派发降级预案

- 任一子智能体失败 → 重试 1 次；仍失败 → 该任务主线程直接实现。
