# P1.4 可观测性 — 设计文档

> 日期：2026-05-08 | 状态：已确认

## 概述

为 CoBeing 添加完整的可观测性基础设施：LLM 调用日志、工具调用审计、Token 消耗聚合、响应时间监控。数据持久化到 SQLite，前端提供独立仪表盘页面。

## 数据模型

新建 `data/observability.db`，两张表：

```sql
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  group_id TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER DEFAULT 0,
  cache_miss_tokens INTEGER DEFAULT 0,
  is_error INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  round INTEGER NOT NULL DEFAULT 1,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_llm_agent ON llm_calls(agent_id, timestamp);
CREATE INDEX idx_llm_group ON llm_calls(group_id, timestamp);

CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  group_id TEXT,
  tool_name TEXT NOT NULL,
  is_error INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  param_chars INTEGER NOT NULL DEFAULT 0,
  result_chars INTEGER NOT NULL DEFAULT 0,
  timestamp INTEGER NOT NULL
);
CREATE INDEX idx_tool_agent ON tool_calls(agent_id, timestamp);
CREATE INDEX idx_tool_group ON tool_calls(group_id, timestamp);
```

## 后端埋点

### ObservabilityDB（新文件）

`packages/core/src/observability/observability-db.ts`

- `insertLLMCall(record)` / `insertToolCall(record)` — 写入
- `getLLMStats(filter)` / `getToolStats(filter)` — 聚合查询
- `getDashboard(filter)` — 返回前端仪表盘所需全部数据
- 使用 better-sqlite3（与 GroupDB 一致）

### ConversationLoop 埋点

在 `run()` 方法 return 之前，从 `totalUsage` 提取数据写入 `llm_calls`。记录：model、provider、latency（Date.now() - startTime）、tokens、is_error、fallback_used（是否从非首选 provider 返回）。

`ConversationLoopConfig` 新增 `observabilityDB?: ObservabilityDB`。

### ToolExecutor 埋点

在 `execute()` return 之前写入 `tool_calls`。记录：toolName、agentId、latency、isError、param_chars、result_chars。

`ToolExecutor` 构造函数新增 `observabilityDB?: ObservabilityDB`。

### 注入链

Agent 创建 ConversationLoop 和 ToolExecutor 时，从 runtime 获取共享的 ObservabilityDB 实例传入。

## WS 命令

| 命令 | 参数 | 返回 |
|------|------|------|
| `get_dashboard` | `groupId?` | 聚合指标：token 总量/趋势、P50/P95 延迟、错误率、工具排行、Agent 活跃度 |
| `get_llm_stats` | `agentId?`, `groupId?`, `since?`, `limit?` | LLM 调用列表 + 摘要 |
| `get_tool_stats` | `agentId?`, `groupId?`, `since?`, `limit?` | 工具调用列表 + 摘要 |

在 `ws-server.ts` 注册 handler。

## 前端

### 导航

- `ViewType` 新增 `"dashboard"`
- `NavBar.tsx` 添加 📊 图标
- `MainContent.tsx` 渲染 DashboardView

### 仪表盘页面

布局为三行卡片网格，纯 CSS + 内联 SVG 图表（不引入图表库）：

- **Token 卡片**：今日/累计 token 数 + 7 天迷你柱状图
- **延迟卡片**：P50/P95 响应时间 + 24h 折线图
- **工具排行卡片**：按调用次数排序的 top 工具列表
- **错误率卡片**：LLM 和工具错误率 + 降级触发次数
- **Agent 活跃度卡片**：按群组筛选的 Agent 活跃度横向柱状图

### 数据流

1. 进入 Dashboard → 发送 `get_dashboard` → 填充 store
2. 每 30s 自动刷新
3. 顶部下拉框切换群组筛选

### 新文件

- `gui-v2/src/stores/observability.ts` — Zustand store
- `gui-v2/src/components/observability/DashboardView.tsx`
- `gui-v2/src/components/observability/TokenCard.tsx`
- `gui-v2/src/components/observability/LatencyCard.tsx`
- `gui-v2/src/components/observability/ToolRankCard.tsx`
- `gui-v2/src/components/observability/AgentActivityCard.tsx`

### 修改文件

- `gui-v2/src/lib/types.ts` — ViewType 新增 "dashboard"
- `gui-v2/src/components/layout/NavBar.tsx` — 导航项
- `gui-v2/src/components/layout/MainContent.tsx` — 路由
- `gui-v2/src/hooks/useWebSocket.ts` — dashboard 事件处理
- `gui-v2/src/stores/chat.ts` — 可能不需要改动（dashboard 有独立 store）

## 构建影响

- 后端 .ts 变更需要 `pnpm build`
- 前端独立构建：`cd gui-v2 && npm run build`

## 边界情况

- **空数据**：首次使用无历史数据，仪表盘显示空状态占位而非报错
- **大量数据**：SQLite 查询带 LIMIT 和时间范围过滤，get_dashboard 默认近 7 天
- **WS 断开**：仪表盘数据保持最后状态，连接恢复后自动刷新
- **群组删除**：历史数据保留，group_id 成为孤立引用（可手动清理）
