# 完成报告 — task-market-frontend

日期：2026-08-03
状态：✅ 完成（自检全绿，见 self-check.md）

## 产出文件清单（6 个，3 改 3 新，未碰 packages/）

| 文件 | 类型 | 内容摘要 |
|------|------|----------|
| `gui-v2/src/lib/types.ts` | 修改 | `ExtensionsTab` 增加 `"market"`；追加 MarketResourceType/MarketTier/MarketRiskLevel/MarketDependency/MarketResourceView/MarketDepNode/MarketInstallResult/InstalledEntry 共 9 个导出，签名与合约逐字一致 |
| `gui-v2/src/stores/market.ts` | 新增 | `useMarketStore: UseBoundStore<StoreApi<...>>`，resources/installed(Record)/filters/detail/installState 状态机/pendingInstall/lastError + load/setTypeFilter/setTierFilter/setQuery/openDetail/closeDetail/requestInstall/confirmInstall/uninstall；发送统一 `getWsClient()?.send` |
| `gui-v2/src/hooks/ws-handlers/market-handlers.ts` | 新增 | `buildMarketHandlers(ctx)` 覆盖冻结协议 5 个消息（market_list/market_get/market_install/market_uninstall/market_installed），风格同 extension-handlers（store.getState()/setState）；market_list 附带 dispatch `ws-market-list` CustomEvent 供加载态使用；安装成功/卸载 emitActivity 活动日志 |
| `gui-v2/src/hooks/useWebSocket.ts` | 修改 | `...buildMarketHandlers(ctx)` 并入主 handler 表 |
| `gui-v2/src/components/extensions/MarketTab.tsx` | 新增 | 过滤栏（类型 chips + 信任分级 chips + 搜索框）、资源卡片网格（tier 徽章 4 色/类型图标/描述两行截断/risk 徽章/tags/安装·已安装+卸载·本地禁用）、详情 Sheet 浮层（描述/权限列表/递归依赖树带 divider 连线/底部操作条）、社区安装确认流（approval_required 警告区 + 确认安装）、加载/错误/安装中/成功内联提示；全部主题 token、无硬编码色值 |
| `gui-v2/src/components/extensions/ExtensionsView.tsx` | 修改 | TABS 增加 `{ id: "market", label: "Market", icon: "🛍️" }`，内容区渲染 `<MarketTab />` |

## 验证结果

- `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec tsc --noEmit` — ✅ 通过
- `cd D:/agent-codes/CoBeing/gui-v2 && pnpm build` — ✅ 通过（tsc + vite build，仅既有 warning）
- `cd D:/agent-codes/CoBeing/gui-v2 && pnpm exec vitest run` — ✅ 4 文件 19 测试全绿，未破坏既有测试

## 注意事项（主线程冒烟验证时）

1. **根目录跑 gui-v2 测试**：`pnpm exec vitest run gui-v2/src` 从 `D:/agent-codes/CoBeing` 执行会报 "No test files found" —— 根 vitest.config.ts 的 include 只有 `packages/*/src/**`，不含 gui-v2（既有配置问题，非本次改动引入）。在 `gui-v2/` 目录下运行即可全绿。如需根目录单命令覆盖，需在根 vitest.config.ts include 追加 gui-v2 模式（该文件不在本任务可改清单内）。
2. **依赖前端侧的协议字段**：`market_get` 响应 `dependencyTree` 缺失时前端已有防御性回退；`market_list` 的 `resources`/`installed` 与 `market_install` 的 `status` 分支均已按冻结协议处理。
3. **MarketTab 首次加载态**依赖 `market_list` 响应到达（ws-market-list 事件）；未连接 WS 时显示"正在加载市场资源…"。
