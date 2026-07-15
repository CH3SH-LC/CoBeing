# Butler Entry Round 2: Frontend UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Butler page from a bare chat-only view into a full three-column layout (sidebar + chat + settings drawer) with task receipt cards, input action buttons, and visual polish.

**Architecture:** Three new React components (`ButlerSidebar`, `TaskReceiptCard`, `ChatInputActions`) slot into the existing layout skeleton. `ButlerSidebar` renders inside the existing `Sidebar` component when `activeView === "butler"`. All data reads from existing Zustand stores (`butlerTasks`, `agents`, `chat`). No new backend APIs. Visual polish applies to the files touched in this round only.

**Tech Stack:** React 19, Zustand, TypeScript, Tailwind CSS, lucide-react

---

## File Structure

| # | Action | File | Responsibility |
|---|--------|------|----------------|
| 1 | Modify | `gui-v2/src/lib/types.ts` | Add TaskReceipt type, extend LogMessage.metadata |
| 2 | Create | `gui-v2/src/components/layout/ButlerSidebar.tsx` | Butler-specific sidebar: 4 blocks |
| 3 | Modify | `gui-v2/src/components/layout/Sidebar.tsx` | Support butler view: render ButlerSidebar |
| 4 | Create | `gui-v2/src/components/chat/TaskReceiptCard.tsx` | Inline task status card in messages |
| 5 | Create | `gui-v2/src/components/chat/ChatInputActions.tsx` | Low-weight action buttons below input |
| 6 | Modify | `gui-v2/src/components/chat/ChatView.tsx` | Wire Card, Actions, header chip |
| 7 | Modify | `gui-v2/src/styles/globals.css` | Visual polish pass |

**Total: 3 new files, 4 modified files**

---

### Task 1: Types — TaskReceipt + metadata extension

**Files:**
- Modify: `gui-v2/src/lib/types.ts`

- [ ] **Step 1: Add TaskReceipt type and extend LogMessage metadata**

Read the current `LogMessage` interface in `types.ts`. Add the new types after the `ButlerTaskSummary` interface (added in Round 1), then modify `LogMessage.metadata`.

Add at end of file (before the final export):

```ts
// ========== Task Receipt (chat card) ==========

export interface TaskReceipt {
  id: string;
  title: string;
  assigneeType: "agent" | "group";
  assigneeName: string;
  status: "running" | "waiting_user" | "completed" | "failed" | "cancelled";
  summary?: string;
  nextAction?: string;
  artifacts?: Array<{ name: string; path?: string }>;
}
```

Find `LogMessage` interface and modify the `metadata` field:

From:
```ts
metadata?: Record<string, unknown>;
```
(or whatever the current type is)

To:
```ts
metadata?: {
  taskReceipt?: TaskReceipt;
  cards?: Array<{ type: string; payload: unknown }>;
};
```

- [ ] **Step 2: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

---

### Task 2: ButlerSidebar — 管家侧栏

**Files:**
- Create: `gui-v2/src/components/layout/ButlerSidebar.tsx`

- [ ] **Step 1: Create ButlerSidebar component**

Write `gui-v2/src/components/layout/ButlerSidebar.tsx`:

```tsx
import { useButlerTasksStore } from "@/stores/butlerTasks";
import { useSettingsStore } from "@/stores/settings";

export function ButlerSidebar() {
  const summary = useButlerTasksStore((s) => s.summary);
  const tasks = useButlerTasksStore((s) => s.tasks);
  const getByStatus = useButlerTasksStore((s) => s.getByStatus);
  const toggleDetailPanel = useSettingsStore((s) => s.toggleDetailPanel);

  const waitingTasks = getByStatus("waiting_user").slice(0, 3);
  const recentTasks = tasks
    .filter((t) => t.status !== "cancelled")
    .slice(-3)
    .reverse();

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "text-accent";
      case "waiting_user": return "text-warning";
      case "completed": return "text-success";
      case "failed": return "text-danger";
      default: return "text-txt-muted";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "running": return "运行中";
      case "waiting_user": return "待确认";
      case "completed": return "已完成";
      case "failed": return "失败";
      case "cancelled": return "已取消";
      default: return status;
    }
  };

  return (
    <aside className="w-64 h-full flex flex-col shrink-0" style={{ padding: "20px 16px", gap: 16 }}>
      {/* 今日托管 */}
      <div className="rounded-xl bg-surface border border-bdr/40" style={{ padding: 16, boxShadow: "var(--shadow-surface)" }}>
        <p className="text-xs text-txt-muted font-medium uppercase tracking-wide" style={{ marginBottom: 12 }}>今日托管</p>
        <div className="flex justify-between">
          <div className="text-center">
            <p className="text-lg font-bold text-accent">{summary.running}</p>
            <p className="text-xs text-txt-muted">运行中</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-warning">{summary.waitingUser}</p>
            <p className="text-xs text-txt-muted">待确认</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-success">{summary.completed}</p>
            <p className="text-xs text-txt-muted">已完成</p>
          </div>
        </div>
      </div>

      {/* 待我确认 */}
      <div className="flex-1 min-h-0 rounded-xl bg-surface border border-bdr/40 overflow-hidden" style={{ boxShadow: "var(--shadow-surface)" }}>
        <div style={{ padding: "16px 16px 8px" }}>
          <p className="text-xs text-txt-muted font-medium uppercase tracking-wide">待我确认</p>
        </div>
        <div className="overflow-y-auto" style={{ padding: "0 16px 16px" }}>
          {waitingTasks.length === 0 ? (
            <p className="text-xs text-txt-muted text-center" style={{ padding: "20px 0" }}>暂无待确认事项</p>
          ) : (
            waitingTasks.map((task) => (
              <div key={task.id} className="rounded-lg bg-hover/50" style={{ padding: "10px 12px", marginBottom: 8 }}>
                <p className="text-sm text-txt font-medium truncate">{task.title}</p>
                <p className="text-xs text-txt-muted truncate" style={{ marginTop: 4 }}>{task.assigneeName}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 最近回执 */}
      <div className="rounded-xl bg-surface border border-bdr/40 overflow-hidden" style={{ boxShadow: "var(--shadow-surface)", maxHeight: 180 }}>
        <div style={{ padding: "16px 16px 8px" }}>
          <p className="text-xs text-txt-muted font-medium uppercase tracking-wide">最近回执</p>
        </div>
        <div className="overflow-y-auto" style={{ padding: "0 16px 16px" }}>
          {recentTasks.length === 0 ? (
            <p className="text-xs text-txt-muted text-center" style={{ padding: "16px 0" }}>暂无托管记录</p>
          ) : (
            recentTasks.map((task) => (
              <div key={task.id} className="rounded-lg hover:bg-hover/50 transition-colors" style={{ padding: "8px" }}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${statusColor(task.status)}`}>{statusLabel(task.status)}</span>
                  <span className="text-sm text-txt truncate">{task.title}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="shrink-0 rounded-xl bg-surface border border-bdr/40" style={{ padding: 12, boxShadow: "var(--shadow-surface)" }}>
        <button
          onClick={() => toggleDetailPanel()}
          className="w-full text-left text-xs text-txt-sub hover:text-txt hover:bg-hover rounded-md transition-colors"
          style={{ padding: "8px 12px" }}
        >
          管家设置
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors (may show "unused import" warning for `useSettingsStore` — acceptable, it's used in the button onClick).

---

### Task 3: Sidebar.tsx — 支持 butler 视图

**Files:**
- Modify: `gui-v2/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add butler view support to Sidebar**

The current Sidebar returns null for non-agents/non-groups views. Add butler view support.

Add import:
```ts
import { ButlerSidebar } from "./ButlerSidebar";
```

Modify the early return line from:
```tsx
if (activeView !== "agents" && activeView !== "groups") return null;
```
to:
```tsx
if (activeView === "butler") return <ButlerSidebar />;
if (activeView !== "agents" && activeView !== "groups") return null;
```

- [ ] **Step 2: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

---

### Task 4: TaskReceiptCard — 任务回执卡片

**Files:**
- Create: `gui-v2/src/components/chat/TaskReceiptCard.tsx`

- [ ] **Step 1: Create TaskReceiptCard component**

Write `gui-v2/src/components/chat/TaskReceiptCard.tsx`:

```tsx
import { useState } from "react";
import type { TaskReceipt } from "@/lib/types";

interface TaskReceiptCardProps {
  receipt: TaskReceipt;
}

const statusConfig: Record<TaskReceipt["status"], { label: string; className: string }> = {
  running: { label: "运行中", className: "bg-accent/10 text-accent" },
  waiting_user: { label: "待确认", className: "bg-warning/10 text-warning" },
  completed: { label: "已完成", className: "bg-success/10 text-success" },
  failed: { label: "失败", className: "bg-danger/10 text-danger" },
  cancelled: { label: "已取消", className: "bg-txt-muted/10 text-txt-muted" },
};

export function TaskReceiptCard({ receipt }: TaskReceiptCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig[receipt.status];

  return (
    <div className="rounded-xl bg-msg-tool" style={{ padding: "12px 16px", marginTop: 12 }}>
      {/* Collapsed view */}
      <div
        className="flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.className}`}>
          {cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-txt font-medium truncate">
            {receipt.title}
          </p>
          <p className="text-xs text-txt-muted truncate">
            {receipt.assigneeType === "group" ? "群组" : "Agent"}：{receipt.assigneeName}
          </p>
        </div>
        <span className="text-xs text-txt-muted">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-bdr" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {receipt.summary && (
            <div>
              <p className="text-xs text-txt-muted font-medium" style={{ marginBottom: 4 }}>摘要</p>
              <p className="text-sm text-txt leading-relaxed">{receipt.summary}</p>
            </div>
          )}

          {receipt.nextAction && (
            <div className="rounded-lg bg-surface-solid" style={{ padding: "10px 14px" }}>
              <p className="text-xs text-txt-muted" style={{ marginBottom: 2 }}>下一步</p>
              <p className="text-sm text-txt">{receipt.nextAction}</p>
            </div>
          )}

          {receipt.artifacts && receipt.artifacts.length > 0 && (
            <div>
              <p className="text-xs text-txt-muted font-medium" style={{ marginBottom: 6 }}>产物</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {receipt.artifacts.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-txt-sub">
                    <span>📄</span>
                    <span>{a.name}</span>
                    {a.path && <span className="text-xs text-txt-muted font-mono">{a.path}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

---

### Task 5: ChatInputActions — 输入快捷按钮

**Files:**
- Create: `gui-v2/src/components/chat/ChatInputActions.tsx`

- [ ] **Step 1: Create ChatInputActions component**

Write `gui-v2/src/components/chat/ChatInputActions.tsx`:

```tsx
import { Send, Plus, BarChart3 } from "lucide-react";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { getVisibleUserAgents } from "@/lib/coreAgents";
import { useState, useRef, useEffect } from "react";

interface ChatInputActionsProps {
  view: "butler" | "agent" | "group";
  onInsertText?: (text: string) => void;
}

export function ChatInputActions({ view, onInsertText }: ChatInputActionsProps) {
  const [showDispatchMenu, setShowDispatchMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const dispatchRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dispatchRef.current && !dispatchRef.current.contains(e.target as Node)) setShowDispatchMenu(false);
      if (createRef.current && !createRef.current.contains(e.target as Node)) setShowCreateMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const visibleAgents = getVisibleUserAgents(agents);

  const btnClass = "text-xs text-txt-sub hover:text-txt hover:bg-hover rounded-md transition-colors flex items-center gap-1";
  const btnStyle = { padding: "4px 8px" };

  if (view === "butler") {
    return (
      <div className="flex items-center" style={{ gap: 4 }}>
        {/* 派发 */}
        <div ref={dispatchRef} className="relative">
          <button
            onClick={() => { setShowDispatchMenu(!showDispatchMenu); setShowCreateMenu(false); }}
            className={btnClass}
            style={btnStyle}
          >
            <Send size={12} /> 派发
          </button>
          {showDispatchMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20 overflow-y-auto"
                 style={{ marginBottom: 4, width: 200, maxHeight: 160 }}>
              <p className="text-xs text-txt-muted font-medium" style={{ padding: "8px 12px 4px" }}>选择目标</p>
              {visibleAgents.map((a) => (
                <button key={a.id} onClick={() => { onInsertText?.(`@${a.id} `); setShowDispatchMenu(false); }}
                  className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "8px 12px" }}>
                  <span>🤖 {a.name}</span>
                </button>
              ))}
              {groups.map((g) => (
                <button key={g.id} onClick={() => { onInsertText?.(`@${g.id} `); setShowDispatchMenu(false); }}
                  className="w-full text-left text-xs text-txt hover:bg-hover transition-colors truncate"
                  style={{ padding: "8px 12px" }}>
                  <span>👥 {g.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 创建 */}
        <div ref={createRef} className="relative">
          <button
            onClick={() => { setShowCreateMenu(!showCreateMenu); setShowDispatchMenu(false); }}
            className={btnClass}
            style={btnStyle}
          >
            <Plus size={12} /> 创建
          </button>
          {showCreateMenu && (
            <div className="absolute bottom-full left-0 rounded-lg bg-elevated border border-bdr shadow-lg z-20"
                 style={{ marginBottom: 4, width: 160 }}>
              <button onClick={() => { onInsertText?.("/new "); setShowCreateMenu(false); }}
                className="w-full text-left text-xs text-txt hover:bg-hover transition-colors"
                style={{ padding: "8px 12px" }}>
                🤖 新建 Agent
              </button>
              <button onClick={() => { onInsertText?.("/new-group "); setShowCreateMenu(false); }}
                className="w-full text-left text-xs text-txt hover:bg-hover transition-colors"
                style={{ padding: "8px 12px" }}>
                👥 新建群组
              </button>
            </div>
          )}
        </div>

        {/* 摘要 */}
        <button
          onClick={() => onInsertText?.("总结一下当前的托管状态")}
          className={btnClass}
          style={btnStyle}
        >
          <BarChart3 size={12} /> 摘要
        </button>
      </div>
    );
  }

  // Non-butler views: minimal actions
  return null;
}
```

- [ ] **Step 2: Install lucide-react if not present**

Check if lucide-react is already a dependency:
```powershell
cd gui-v2; node -e "require('./package.json').dependencies['lucide-react'] ? console.log('exists') : console.log('missing')"
```

If missing:
```powershell
cd gui-v2; pnpm add lucide-react
```

- [ ] **Step 3: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

---

### Task 6: ChatView.tsx — 接入卡片、按钮、Chip

**Files:**
- Modify: `gui-v2/src/components/chat/ChatView.tsx`

- [ ] **Step 1: Add imports**

Add at top of file (after existing imports):

```ts
import { TaskReceiptCard } from "./TaskReceiptCard";
import { ChatInputActions } from "./ChatInputActions";
import { useButlerTasksStore } from "@/stores/butlerTasks";
import type { TaskReceipt } from "@/lib/types";
```

- [ ] **Step 2: Add butler summary chip to ChatHeader**

In the `ChatHeader` component, add a prop and display a chip for butler view.

Add prop to ChatHeader:
```ts
function ChatHeader({ name, status, model, provider, connected, isGroup, memberCount, showConfigButton, configOpen, onToggleConfig, activeView }: {
  // ... existing types
}) {
```

In the ChatHeader component, find the div that shows name/subtitle (around line 78-82). Add after the subtitle `<p>`:

After the closing `</p>` of the subtitle line, add:
```tsx
{activeView === "butler" && (
  <ButlerStatusChip />
)}
```

Add this helper component at file scope (near ChatHeader):
```tsx
function ButlerStatusChip() {
  const summary = useButlerTasksStore((s) => s.summary);
  const total = summary.running + summary.waitingUser + summary.completed;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent" style={{ marginTop: 4, display: "inline-block" }}>
      {total} 托管中
    </span>
  );
}
```

- [ ] **Step 3: Wire TaskReceiptCard into MessageBubble**

In the `MessageBubble` component, the `msg` prop is `LogMessage`. After the MarkdownContent div, add the task receipt card:

Find the line `</div>` after `<MarkdownContent content={msg.content} />` (around line 223). Before that closing div, add:

```tsx
{!isUser && msg.metadata?.taskReceipt && (
  <TaskReceiptCard receipt={msg.metadata.taskReceipt as TaskReceipt} />
)}
```

- [ ] **Step 4: Wire ChatInputActions into ChatInput**

In the `ChatInput` component (the `function ChatInput(...)` definition), find the button row div (around line 438: `className="flex items-center justify-between"`).

Add `const activeView = useSettingsStore((s) => s.activeView);` inside the ChatInput function.

In the left side of the button row (the div with `className="flex items-center" style={{ gap: 12 }}`), add before the existing buttons:

```tsx
{activeView === "butler" && (
  <ChatInputActions view="butler" onInsertText={(t) => setText((prev) => prev + t)} />
)}
```

- [ ] **Step 5: Replace gear emoji with lucide Settings icon in ChatHeader**

Add import:
```ts
import { Settings } from "lucide-react";
```

Find the settings button (the `⚙` character around line 110) and replace:
```tsx
⚙
```
with:
```tsx
<Settings size={16} />
```

- [ ] **Step 6: TypeScript check**

```powershell
cd gui-v2; npx tsc --noEmit
```

Expected: Zero type errors.

---

### Task 7: Visual Polish — globals.css

**Files:**
- Modify: `gui-v2/src/styles/globals.css`

- [ ] **Step 1: Scan and fix over-small font sizes in the CSS**

Read `gui-v2/src/styles/globals.css`. Search for any `text-[9px]`, `text-[10px]`, `text-[11px]` — these violate the design spec.

If found:
- `text-[9px]` → `text-xs`
- `text-[10px]` → `text-xs`
- `text-[11px]` → `text-xs`

Also ensure that the CSS variables for the warning color exist. Search for `--color-warning` in the CSS. If it doesn't exist, add it in the `:root` block:

```css
--color-warning: #f59e0b;
--color-warning-sub: #b45309;
```

These are needed by `ButlerSidebar` and `TaskReceiptCard` (they use `text-warning` and `bg-warning/10`).

- [ ] **Step 2: Verify Tailwind config has warning color**

Read `gui-v2/tailwind.config.js` or `gui-v2/tailwind.config.ts`. Check if `warning` and `danger` are in the color palette. If not, add:

```js
colors: {
  warning: {
    DEFAULT: "var(--color-warning)",
  },
  danger: {
    DEFAULT: "var(--color-danger)",
  },
}
```

Note: Check the actual Tailwind config format used in this project and match it.

- [ ] **Step 3: Verify build**

```powershell
cd gui-v2; npx vite build
```

Expected: Build succeeds (existing chunk-size warnings are acceptable).

---

### Task 8: Full Verification

- [ ] **Step 1: Backend build**

```powershell
cd D:\agent-codes\CoBeing; pnpm build
```

Expected: 7 packages compile without errors.

- [ ] **Step 2: Backend tests**

```powershell
pnpm test
```

Expected: 477 tests pass (no backend changes, should be identical to Round 1).

- [ ] **Step 3: Frontend type check + build**

```powershell
cd gui-v2; npx tsc --noEmit; npx vite build
```

Expected: Zero type errors, build successful.

- [ ] **Step 4: Verify the file list**

```powershell
# New files
Test-Path "gui-v2/src/components/layout/ButlerSidebar.tsx"
Test-Path "gui-v2/src/components/chat/TaskReceiptCard.tsx"
Test-Path "gui-v2/src/components/chat/ChatInputActions.tsx"
```

Expected: All return `True`.

---

## Summary

| Task | Files | New | Mod | Description |
|------|-------|-----|-----|-------------|
| 1 | 1 | 0 | 1 | types.ts: TaskReceipt + metadata extension |
| 2 | 1 | 1 | 0 | ButlerSidebar: 4-block sidebar |
| 3 | 1 | 0 | 1 | Sidebar.tsx: support butler view |
| 4 | 1 | 1 | 0 | TaskReceiptCard: collapsible task card |
| 5 | 1 | 1 | 0 | ChatInputActions: action buttons |
| 6 | 1 | 0 | 1 | ChatView.tsx: wire Card + Actions + Chip |
| 7 | 1 | 0 | 1 | globals.css: visual polish |
| 8 | - | - | - | Full verification |

**Total: 3 new files, 4 modified files, 8 tasks**
