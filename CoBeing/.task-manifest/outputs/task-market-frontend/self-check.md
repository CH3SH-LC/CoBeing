# 自检报告 — task-market-frontend

日期：2026-08-03
状态：全部通过

## 产出文件核对

| # | 文件 | 状态 | 说明 |
|---|------|------|------|
| 1 | gui-v2/src/lib/types.ts（修改） | ✅ | 追加 9 个 Market 类型；ExtensionsTab 增加 "market" |
| 2 | gui-v2/src/stores/market.ts（新） | ✅ | useMarketStore，形状与合约一致，含全部 11 个 action |
| 3 | gui-v2/src/hooks/ws-handlers/market-handlers.ts（新） | ✅ | buildMarketHandlers 覆盖 5 个消息，风格与 extension-handlers 一致 |
| 4 | gui-v2/src/hooks/useWebSocket.ts（修改） | ✅ | buildMarketHandlers(ctx) 并入主 handler 表 |
| 5 | gui-v2/src/components/extensions/MarketTab.tsx（新） | ✅ | MarketTab(): JSX.Element（import type { JSX } from "react"） |
| 6 | gui-v2/src/components/extensions/ExtensionsView.tsx（修改） | ✅ | TABS 增加 market + 内容区渲染 MarketTab |

## 合约签名逐项核对（export_matches）

- [x] `useMarketStore: UseBoundStore<StoreApi<...>>` — 命中（stores/market.ts:31）
- [x] `buildMarketHandlers(ctx: WsHandlerContext): Record<string, WsMessageHandler>` — 命中（market-handlers.ts:33）
- [x] `MarketTab(): JSX.Element` — 命中（MarketTab.tsx:173）
- [x] MarketResourceType / MarketTier / MarketRiskLevel / MarketDependency / MarketResourceView / MarketDepNode / MarketInstallResult / InstalledEntry — 全部命中（types.ts:395-442）
- [x] `ExtensionsTab` 含 "market" — 命中（types.ts:4）

## WS 协议核对（冻结协议，无增改）

- [x] 发 market_list（带 filters）/ 收 market_list{resources,installed} → handler 写 resources + installed(Record 化)
- [x] 发 market_get{id} / 收 market_get{resource,dependencyTree} → handler 写 detail（含 dependencyTree 缺失时防御性回退）
- [x] 发 market_install{id}（无 confirmed）/ 收 approval_required → pendingInstall + installState
- [x] confirmInstall 发 market_install{id, confirmed:true}
- [x] 收 installed/already_installed → installState="installed" + 同步 detail.installed + load() 刷新 + emitActivity
- [x] 收 error → lastError
- [x] 发 market_uninstall{id} / 收 {id,removedIds} → 删除 installed + 同步 detail.installed=false + load()
- [x] 收 market_installed{installed} → 整体更新 installed Record
- [x] 发送统一 getWsClient()?.send({type, payload})，与 agentEnhancement.ts 一致

## store 行为约定核对

- [x] load() 发 market_list（带当前 filters）；MarketTab useEffect 在 mount 时调用
- [x] setTypeFilter/setTierFilter/setQuery 更新后自动重新 load（query 立即重载）
- [x] openDetail 重置安装状态并发 market_get；closeDetail 清空 detail
- [x] requestInstall 置 "installing" 发 market_install{id}（无 confirmed）
- [x] confirmInstall 对 pendingInstall 发 confirmed:true（无 pending 时 no-op）

## UI 规则核对（frontend-design 三份规则）

- [x] 层次化：卡片/面板 bg-surface + border-bdr/40 + var(--shadow-surface)，浮于渐变背景上；面板内子区域 bg-elevated（描述/权限/依赖区块）；chips bg-elevated，选中 bg-accent/10 text-accent（无 ring 轮廓线）
- [x] 间距：过滤栏 padding 16px 20px、卡片 padding 18、列表行 14px 20px 参考、gap 16-24
- [x] 字号：正文 text-sm、标题 text-base/text-lg、徽章/标签 text-xs；无 9-11px
- [x] 圆角：卡片/面板 rounded-xl、按钮/输入框 rounded-lg、徽章 rounded-full
- [x] 分隔线：var(--color-divider) 细线（卡片操作区分隔、权限列表行分隔、依赖树连线）
- [x] 浮层：复用 components/ui/sheet.tsx（右滑 300ms、磨砂 overlay blur(16px) saturate(1.4)、shadow-surface-lg），浮层内 tab/表单/危险操作同层级体系
- [x] 主题 token：无硬编码色值；tier 徽章 official=success 绿 / certified=purple 紫 / community=accent-warm 橙 / local=elevated 灰；risk 徽章 low=success / medium=accent-warm / high=danger
- [x] 社区确认流：卡片安装 → openDetail+requestInstall → approval_required → 浮层警告区 + 确认安装（bg-accent-warm）
- [x] 状态处理：首次加载文字、lastError 横幅（danger token）、installing 禁用、安装成功内联 success 横幅 + emitActivity 活动日志

## 验证命令结果

| 命令 | 结果 |
|------|------|
| `cd gui-v2 && pnpm exec tsc --noEmit` | ✅ 通过（0 错误） |
| `cd gui-v2 && pnpm build` | ✅ 通过（tsc + vite build，仅既有 chunk-size/dynamic-import warning） |
| `cd gui-v2 && pnpm exec vitest run` | ✅ 4 个测试文件 19 个测试全绿（userProfile 9 / theme 6 / surface-style-audit 2 / GlobalTodoPanel 2） |

### 说明：合约命令 `cd D:/agent-codes/CoBeing && pnpm exec vitest run gui-v2/src` 的现状
该命令从仓库根执行时命不中 gui-v2 测试：根目录 `D:/agent-codes/CoBeing/vitest.config.ts` 的 include 仅为
`packages/*/src/**/*.test.ts, packages/*/tests/**/*.test.ts`，不含 gui-v2。这是**既有配置问题**（我改动前同样报
"No test files found, exiting with code 1"），gui-v2 测试需在 gui-v2 目录下运行（无 gui-v2 专属 vitest 配置，
vitest 默认 include 命中 gui-v2/src）。因可改文件清单不含根 vitest.config.ts，未修改该配置；19 个既有测试
全部通过，未被破坏。若主线程需要根目录单命令可跑，建议后续把 gui-v2 include 补进根 vitest.config.ts。
