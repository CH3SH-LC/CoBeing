# MCP 预设模板系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CoBeing 添加 GitHub 和 Office（Word/Excel/PowerPoint）MCP 预设模板，用户通过 UI 一键添加，Runtime 启动时自动连接。

**Architecture:** 在 McpSection.tsx 中添加 MCP_PRESETS 常量和预设选择 UI（参考 ChannelsSection.tsx 模式），在 runtime.ts 中添加 connectAllMCPServers() 方法自动连接配置中的 MCP 服务器到所有 Agent。

**Tech Stack:** TypeScript, React (Zustand), MCP JSON-RPC 2.0

---

### Task 1: McpSection.tsx — 添加 MCP_PRESETS 常量

**Files:**
- Modify: `gui-v2/src/components/settings/McpSection.tsx`

- [ ] **Step 1: 添加 MCP_PRESETS 和 ENV_FIELD_DEFS 常量**

在 `McpSection.tsx` 文件顶部（`import` 之后、`EMPTY` 之前）添加：

```typescript
// ---- MCP 预设 ----

interface EnvFieldDef {
  key: string;
  label: string;
  hint: string;
  placeholder: string;
  required?: boolean;
}

interface McpPreset {
  id: string;
  nameZh: string;
  desc: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: EnvFieldDef[];
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    nameZh: "GitHub",
    desc: "仓库管理、Issue/PR、文件读写、分支操作、搜索",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "Personal Access Token",
        hint: "GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        required: true,
      },
    ],
  },
  {
    id: "word",
    nameZh: "Word 文档",
    desc: "读写 .docx 文档，支持段落、表格、样式操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-docx"],
    envFields: [],
  },
  {
    id: "excel",
    nameZh: "Excel 表格",
    desc: "读写 .xlsx 表格，支持公式、图表、数据操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-xlsx"],
    envFields: [],
  },
  {
    id: "powerpoint",
    nameZh: "PowerPoint 演示",
    desc: "读写 .pptx 演示文稿，支持幻灯片、布局、内容操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-pptx"],
    envFields: [],
  },
];
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误（可能有已存在的不相关警告）

- [ ] **Step 3: Commit**

```bash
git add gui-v2/src/components/settings/McpSection.tsx
git commit -m "feat(mcp): add MCP_PRESETS constant definitions"
```

---

### Task 2: McpSection.tsx — 改造添加对话框支持预设选择

**Files:**
- Modify: `gui-v2/src/components/settings/McpSection.tsx`

- [ ] **Step 1: 重构 EMPTY 和编辑状态**

将现有的 `EMPTY` 常量和 `editing` 状态扩展，增加 `presetId` 字段：

```typescript
// 替换现有 EMPTY
const EMPTY: McpEntry & { presetId?: string } = { name: "", transport: "stdio", command: "", args: [], url: "", presetId: "" };
```

更新 `editing` 状态类型：

```typescript
const [editing, setEditing] = useState<{ key: string; entry: McpEntry & { presetId?: string } }>({ key: "", entry: EMPTY });
```

- [ ] **Step 2: 添加预设选择处理函数**

在 `McpSection` 组件内添加预设选择逻辑：

```typescript
const handlePresetSelect = (presetId: string) => {
  if (!presetId) {
    // 自定义模式
    setEditing({ ...editing, entry: { ...EMPTY, presetId: "" } });
    return;
  }
  const preset = MCP_PRESETS.find(p => p.id === presetId);
  if (!preset) return;

  const env: Record<string, string> = {};
  for (const f of preset.envFields) {
    env[f.key] = "";
  }

  setEditing({
    ...editing,
    entry: {
      ...editing.entry,
      presetId,
      transport: preset.transport,
      command: preset.command,
      args: [...preset.args],
      env: Object.keys(env).length > 0 ? env : undefined,
    },
  });
};
```

- [ ] **Step 3: 改造添加对话框 — 添加预设选择下拉框**

在 `<Dialog>` 内部、`{!editing.key && (` 的 name 输入框**之前**，添加预设选择：

```tsx
{/* 预设选择（仅新增时） */}
{!editing.key && (
  <label className="block">
    <span className="text-sm text-txt-sub">选择预设</span>
    <select
      value={editing.entry.presetId || ""}
      onChange={(e) => handlePresetSelect(e.target.value)}
      className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
    >
      <option value="">-- 自定义 --</option>
      {MCP_PRESETS.map(p => (
        <option key={p.id} value={p.id}>{p.nameZh} — {p.desc}</option>
      ))}
    </select>
  </label>
)}
```

- [ ] **Step 4: 改造添加对话框 — 预设模式下隐藏 command/args/url 输入框**

将现有的 transport/command/args/url 输入框包裹在条件判断中，预设模式下只显示预设信息和 envFields：

```tsx
{/* 预设信息（选择预设后） */}
{!editing.key && editing.entry.presetId && (() => {
  const preset = MCP_PRESETS.find(p => p.id === editing.entry.presetId)!;
  return (
    <div className="rounded-lg bg-elevated" style={{ padding: "12px 16px" }}>
      <div className="text-sm text-txt">
        {preset.nameZh} <span className="text-txt-muted">· {preset.transport}</span>
      </div>
      <div className="text-sm text-txt-muted mt-1">
        {preset.command} {(preset.args || []).join(" ")}
      </div>
      {preset.envFields.map(f => (
        <label key={f.key} className="block mt-3">
          <span className="text-sm text-txt-sub">
            {f.label}
            {f.required && <span className="text-danger ml-1">*</span>}
          </span>
          {f.hint && <div className="text-xs text-txt-muted mt-0.5 mb-1">{f.hint}</div>}
          <input
            type="password"
            value={editing.entry.env?.[f.key] || ""}
            onChange={(e) => setEditing({
              ...editing,
              entry: {
                ...editing.entry,
                env: { ...editing.entry.env, [f.key]: e.target.value },
              },
            })}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
            placeholder={f.placeholder}
          />
        </label>
      ))}
    </div>
  );
})()}

{/* 自定义模式：完整配置表单 */}
{(!editing.key && !editing.entry.presetId) && (
  <>
    <label className="block">
      <span className="text-sm text-txt-sub">传输方式</span>
      <select ...>
        {/* 现有 transport 选择 */}
      </select>
    </label>
    {/* 现有 command/args/url 输入框 */}
  </>
)}
```

- [ ] **Step 5: 更新 handleSave 逻辑**

保存时，如果选择了预设，自动用预设的 nameZh 作为默认名称：

```typescript
const handleSave = () => {
  let name = editing.key || editing.entry.name.trim();
  // 预设模式：如果没有填写名称，用预设 ID 作为默认名
  if (!name && editing.entry.presetId) {
    name = editing.entry.presetId;
  }
  if (!name) return;

  // 保存时去掉 presetId（不写入配置文件）
  const { presetId: _, ...entryData } = editing.entry;
  updateMcp(name, { ...entryData, name });
  setEditOpen(false);
};
```

- [ ] **Step 6: 更新列表显示预设名称**

在 MCP 服务器列表中，根据 command/args 显示预设名称：

```tsx
{entries.map(([key, m]) => {
  // 检测是否匹配预设
  const matchedPreset = MCP_PRESETS.find(
    p => p.command === m.command &&
         JSON.stringify(p.args) === JSON.stringify(m.args)
  );
  return (
    <div key={key} className="flex items-center gap-3 rounded-lg bg-elevated" style={{ padding: "14px 20px" }}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-txt">{key}</div>
        <div className="text-sm text-txt-muted">
          {matchedPreset?.nameZh || m.transport} · {m.transport === "stdio" ? m.command : m.url}
        </div>
      </div>
      <button onClick={() => handleEdit(key)} className="text-sm text-txt-sub hover:text-accent">编辑</button>
      <button onClick={() => handleDelete(key)} className="text-sm text-txt-sub hover:text-danger">删除</button>
    </div>
  );
})}
```

- [ ] **Step 7: 更新 openAdd 重置逻辑**

确保打开添加对话框时重置 presetId：

```typescript
const openAdd = () => { setEditing({ key: "", entry: { ...EMPTY } }); setEditOpen(true); };
```

- [ ] **Step 8: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 9: 手动测试 UI**

Run: `cd D:/agent-codes/cobeing/gui-v2 && npm run dev`
Expected: 设置 → MCP 服务器 → 添加 → 预设下拉框显示 4 个预设 + 自定义

- [ ] **Step 10: Commit**

```bash
git add gui-v2/src/components/settings/McpSection.tsx
git commit -m "feat(mcp): add preset selector UI to MCP add dialog"
```

---

### Task 3: runtime.ts — 添加 connectAllMCPServers()

**Files:**
- Modify: `packages/core/src/runtime.ts`

- [ ] **Step 1: 添加 connectAllMCPServers 方法**

在 `runtime.ts` 的 `stop()` 方法之前添加：

```typescript
/** 连接配置中的所有 MCP 服务器到所有 Agent */
private async connectAllMCPServers(): Promise<void> {
  const mcpServers = this.config.mcpServers;
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;

  const agents = this.registry.list();
  log.info("Connecting %d MCP server(s) to %d agent(s)", Object.keys(mcpServers).length, agents.length);

  for (const [serverId, serverConfig] of Object.entries(mcpServers)) {
    for (const agent of agents) {
      try {
        await agent.connectMCPServer(serverId, serverConfig);
        log.info("MCP server '%s' connected to agent '%s'", serverId, agent.id);
      } catch (err: any) {
        log.warn("MCP server '%s' failed for agent '%s': %s", serverId, agent.id, err.message);
      }
    }
  }
}
```

- [ ] **Step 2: 在 start() 中调用 connectAllMCPServers()**

在 `start()` 方法中，`this.registerPrebuiltAgents()` 之后、`this.groupManager.restoreGroups()` 之前添加：

```typescript
// 连接 MCP 服务器到所有 Agent
await this.connectAllMCPServers();
```

完整上下文（`start()` 方法约 275-282 行区域）：

```typescript
    // 从 ButlerRegistry 恢复已持久化的 Agent
    this.restoreAgents();

    // Register pre-built agents (e.g., HostAgent)
    this.registerPrebuiltAgents();

    // 连接 MCP 服务器到所有 Agent
    await this.connectAllMCPServers();

    // Restore persisted groups from data/groups/
    this.groupManager.restoreGroups();
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/runtime.ts
git commit -m "feat(mcp): auto-connect MCP servers to all agents on startup"
```

---

### Task 4: ws-server.ts — MCP 配置热重载

**Files:**
- Modify: `packages/core/src/api/ws-server.ts`

- [ ] **Step 1: 添加 MCP 热重载回调接口**

在 `CoreWSServer` 类中添加一个回调属性：

```typescript
private onMcpConfigChange: ((serverId: string, config: any) => Promise<void>) | null = null;

setOnMcpConfigChange(handler: (serverId: string, config: any) => Promise<void>): void {
  this.onMcpConfigChange = handler;
}
```

- [ ] **Step 2: 在 update_config 处理中检测 mcpServers 变更**

在 `update_config` case 的 `setNestedValue` 之后、`writeFileSync` 之前，添加 MCP 变更检测：

```typescript
// 检测 MCP 服务器配置变更
if (cfgPath.startsWith("mcpServers.")) {
  const serverId = cfgPath.split(".")[1];
  if (this.onMcpConfigChange) {
    this.onMcpConfigChange(serverId, value).catch(err => {
      log.warn("MCP config change handler error: %s", err.message);
    });
  }
}
```

- [ ] **Step 3: 在 runtime.ts 中注册 MCP 热重载回调**

在 `runtime.ts` 的 `start()` 方法中，`await this.wsServer.start()` 之前添加：

```typescript
// MCP 配置热重载
this.wsServer.setOnMcpConfigChange(async (serverId, config) => {
  const agents = this.registry.list();
  if (config === null) {
    // 删除：断开所有 Agent 的该 MCP 服务器
    for (const agent of agents) {
      try {
        // Agent 没有 disconnectMCPServer 方法，需要通过 mcpManager
        // 暂时跳过断开，重启后生效
        log.info("MCP server '%s' removed (restart to apply)", serverId);
      } catch { /* ignore */ }
    }
  } else {
    // 新增/修改：连接所有 Agent
    for (const agent of agents) {
      try {
        await agent.connectMCPServer(serverId, config);
        log.info("MCP server '%s' hot-connected to agent '%s'", serverId, agent.id);
      } catch (err: any) {
        log.warn("MCP server '%s' hot-connect failed for '%s': %s", serverId, agent.id, err.message);
      }
    }
  }
});
```

- [ ] **Step 4: 验证 TypeScript 编译**

Run: `cd D:/agent-codes/cobeing && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/api/ws-server.ts packages/core/src/runtime.ts
git commit -m "feat(mcp): add hot-reload for MCP server config changes"
```

---

### Task 5: 更新 default.json 确保 mcpServers 字段

**Files:**
- Modify: `config/default.json`

- [ ] **Step 1: 检查 default.json 是否已有 mcpServers**

当前 `default.json` 没有 `mcpServers` 字段。添加空对象：

在 `"groups": []` 之后添加：

```json
"mcpServers": {}
```

完整文件尾部：

```json
  "gui": {
    "enabled": true,
    "wsPort": 18765
  },
  "groups": [],
  "mcpServers": {}
}
```

- [ ] **Step 2: Commit**

```bash
git add config/default.json
git commit -m "config: add empty mcpServers field to default.json"
```

---

### Task 6: 更新文档

**Files:**
- Modify: `docs/后端能力清单.md`

- [ ] **Step 1: 更新 MCP 章节**

在 `docs/后端能力清单.md` 的 `## 八、MCP 集成` 章节末尾添加：

```markdown
### 8.1 预设模板

| 预设 | 包名 | 启动命令 | 能力 |
|------|------|---------|------|
| GitHub | `@modelcontextprotocol/server-github` | `npx -y @modelcontextprotocol/server-github` | 仓库/Issue/PR/文件/分支/搜索 |
| Word | `mcp-server-docx` | `uvx mcp-server-docx` | .docx 读写、段落、表格、样式 |
| Excel | `mcp-server-xlsx` | `uvx mcp-server-xlsx` | .xlsx 读写、公式、图表、数据 |
| PowerPoint | `mcp-server-pptx` | `uvx mcp-server-pptx` | .pptx 读写、幻灯片、布局 |

- 前端设置 UI 提供预设选择，一键添加
- Runtime 启动时自动连接配置中的 MCP 服务器到所有 Agent
- 配置变更支持热重载（新增/修改即时生效，删除需重启）
```

- [ ] **Step 2: Commit**

```bash
git add docs/后端能力清单.md
git commit -m "docs: add MCP presets documentation"
```
