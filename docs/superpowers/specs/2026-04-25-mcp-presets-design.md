# MCP 预设模板系统设计

> 日期：2026-04-25 | 状态：设计完成

## 目标

为 CoBeing 添加 GitHub 维护能力和 Office 三件套（Word/Excel/PowerPoint）能力，通过 MCP 预设模板系统提供。

## 预设定义

4 个预设 MCP 服务器：

| 预设 | ID | 包名 | 传输 | 启动命令 | 环境变量 |
|------|----|------|------|---------|---------|
| GitHub | `github` | `@modelcontextprotocol/server-github` | stdio | `npx -y @modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN`（必填） |
| Word | `word` | `mcp-server-docx` | stdio | `uvx mcp-server-docx` | 无 |
| Excel | `excel` | `mcp-server-xlsx` | stdio | `uvx mcp-server-xlsx` | 无 |
| PowerPoint | `powerpoint` | `mcp-server-pptx` | stdio | `uvx mcp-server-pptx` | 无 |

- GitHub 使用 `npx`（Node.js 生态），需要用户提供 Personal Access Token
- Office 三件套使用 `uvx`（Python uv 的临时运行工具），自动下载运行，无需预安装
- Office 服务器需要 Python 环境 + uv 工具

## UI 设计

采用与 Channel 配置相同的预设模式（`ChannelsSection.tsx` 参考）。

### 预设常量

```typescript
const MCP_PRESETS = [
  {
    id: "github",
    nameZh: "GitHub",
    desc: "仓库管理、Issue/PR、文件读写、分支操作、搜索",
    transport: "stdio" as const,
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
    transport: "stdio" as const,
    command: "uvx",
    args: ["mcp-server-docx"],
    envFields: [],
  },
  {
    id: "excel",
    nameZh: "Excel 表格",
    desc: "读写 .xlsx 表格，支持公式、图表、数据操作",
    transport: "stdio" as const,
    command: "uvx",
    args: ["mcp-server-xlsx"],
    envFields: [],
  },
  {
    id: "powerpoint",
    nameZh: "PowerPoint 演示",
    desc: "读写 .pptx 演示文稿，支持幻灯片、布局、内容操作",
    transport: "stdio" as const,
    command: "uvx",
    args: ["mcp-server-pptx"],
    envFields: [],
  },
];
```

### 交互流程

1. 用户点击 [+ 添加] 弹出对话框
2. 顶部下拉框选择预设类型（GitHub / Word / Excel / PowerPoint / 自定义）
3. 选择预设后自动填充 command、args
4. 如有 envFields（如 GitHub Token），显示对应输入框
5. 选择"自定义"则显示完整的手动配置表单（复用现有 McpSection 逻辑）
6. 已添加的预设在列表中显示预设名称

### 文件变更

- `gui-v2/src/components/settings/McpSection.tsx` — 添加 `MCP_PRESETS` 常量，改造添加对话框支持预设选择

## Runtime 集成

### 自动连接

在 `runtime.ts` 的 `start()` 方法中，所有 Agent 注册完成后，自动连接配置中的 MCP 服务器。

```
start() 流程：
  1. 检查 Docker
  2. 注册 butler
  3. restoreAgents()
  4. registerPrebuiltAgents()
  5. ★ connectAllMCPServers() ← 新增
  6. restoreGroups()
  7. ...
```

### 连接逻辑

```typescript
private async connectAllMCPServers(): Promise<void> {
  const mcpServers = this.config.mcpServers;
  if (!mcpServers || Object.keys(mcpServers).length === 0) return;

  const agents = this.registry.list();
  for (const [serverId, serverConfig] of Object.entries(mcpServers)) {
    for (const agent of agents) {
      try {
        await agent.connectMCPServer(serverId, serverConfig);
        log.info("MCP server %s connected to agent %s", serverId, agent.id);
      } catch (err: any) {
        log.warn("MCP server %s failed for agent %s: %s", serverId, agent.id, err.message);
      }
    }
  }
}
```

- 所有 Agent（butler + host + restored）都连接所有 MCP 服务器
- 连接失败不阻断启动，仅 warn 日志
- MCP 工具注册到各 Agent 的 ToolRegistry，格式 `mcp:{serverId}:{toolName}`

### 热重载

WS 命令 `update_config` 更新 `mcpServers` 时，需要热重载 MCP 连接：
- 新增服务器：所有 Agent 连接新服务器
- 删除服务器：所有 Agent 断开该服务器
- 修改服务器：断开旧连接，重新连接

## 配置变更

`config/default.json` 的 `mcpServers` 字段（已有 schema，无需修改）：

```json
{
  "mcpServers": {}
}
```

用户通过 UI 添加预设后自动填充。无需手动编辑 JSON。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `gui-v2/src/components/settings/McpSection.tsx` | 添加 MCP_PRESETS，改造添加对话框 |
| `packages/core/src/runtime.ts` | 添加 `connectAllMCPServers()` 方法 |
| `config/default.json` | 确保 `mcpServers` 字段存在（已有） |
| `STRUCTURE.md` | 无需变更（无新文件） |
| `docs/后端能力清单.md` | 更新 MCP 章节 |

## 前置条件

- Node.js 环境（npx）— GitHub MCP 服务器
- Python 环境 + uv 工具（uvx）— Office MCP 服务器
- GitHub Personal Access Token — GitHub MCP 服务器认证
