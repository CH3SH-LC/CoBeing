# 活动日志系统设计

## 目标

将前端设置页的日志系统从"消息流量监控"改造为"用户可读的活动流"，让普通用户能直观了解系统发生了什么。

## 方案：前端拦截 WS 消息

不改后端。前端 `useWebSocket.ts` 已接收所有 WS 消息，在 switch-case 中将关键消息 dispatch 为 `ws-activity` 自定义事件，`LogsSection` 监听并渲染。

## 数据结构

```ts
interface ActivityEntry {
  id: string;           // 自增 ID
  timestamp: number;
  icon: string;         // emoji 图标
  text: string;         // 人类可读描述
  level: "info" | "warn" | "error";
}
```

## 事件映射

| WS 消息类型 | 图标 | 描述模板 | 级别 |
|---|---|---|---|
| `message` (system) | 🔔 | `{content}` | info |
| `stream_token` | — | 不记录（太频繁） | — |
| `agent_response` | 🤖 | 收到回复 | info |
| `tool_event` (start) | 🔧 | 执行了 `{toolName}` | info |
| `tool_event` (complete) | ✅ | `{toolName}` 执行完成 | info |
| `agent_created` | 📦 | Agent `{name}` 已创建 | info |
| `agent_destroyed` | 🗑️ | Agent `{agentId}` 已删除 | info |
| `group_created` | 👥 | 群组 `{name}` 已创建 | info |
| `group_destroyed` | 👥 | 群组 `{groupId}` 已解散 | info |
| `group_message` | 💬 | 群组消息 | info |
| `channel_message` | 📨 | 渠道消息 | info |
| `error` | ❌ | 错误: `{message}` | error |
| `member_added` | ➕ | 成员加入群组 | info |
| `member_removed` | ➖ | 成员离开群组 | info |

## UI 设计

- 保持在设置页 `LogsSection` 内
- 图标 + 描述 + 相对时间（"刚刚"、"2分钟前"）
- 过滤器：全部 / 消息 / 工具 / 系统
- 最多 200 条，自动滚动，清空按钮
- 空状态："暂无活动"

## 改动文件

1. `gui-v2/src/hooks/useWebSocket.ts` — 添加 `dispatchEvent("ws-activity", ...)` 调用
2. `gui-v2/src/components/settings/LogsSection.tsx` — 重写为活动流 UI
