import { useState, useEffect, useCallback, useMemo } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/shared/ToggleSwitch";
import { SearchInput } from "@/components/shared/SearchInput";

interface McpEntry {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  toolCount?: number;
}

const MCP_NAME_RE = /^[A-Za-z0-9_-]+$/;

function splitCommandLine(input: string): { command: string; args: string[] } {
  const parts = input.trim().match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  return {
    command: (parts[0] ?? "").replace(/^['"]|['"]$/g, ""),
    args: parts.slice(1).map(p => p.replace(/^['"]|['"]$/g, "")),
  };
}

export function McpsTab() {
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const [servers, setServers] = useState<McpEntry[]>([]);

  // Load MCP servers from config
  const fetchServers = useCallback(() => {
    const client = getWsClient();
    client?.send({ type: "get_config", payload: {} });
  }, []);

  useEffect(() => {
    fetchServers();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mcpServers) {
        const list: McpEntry[] = Object.entries(detail.mcpServers)
          .filter(([, cfg]) => cfg && typeof cfg === "object")
          .map(([name, cfg]: [string, any]) => ({
            name,
            ...cfg,
            enabled: cfg.enabled ?? true,
          }));
        setServers(list);
      }
    };
    window.addEventListener("ws-config-loaded", handler);
    return () => window.removeEventListener("ws-config-loaded", handler);
  }, [fetchServers]);

  const toggleServer = useCallback((name: string, enabled: boolean) => {
    setServers(prev => prev.map(s => s.name === name ? { ...s, enabled } : s));
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}.enabled`, value: enabled } });
  }, []);

  const deleteServer = useCallback((name: string) => {
    setServers(prev => prev.filter(s => s.name !== name));
    const client = getWsClient();
    // Delete by setting to undefined — backend handles removal
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}`, value: null } });
    setSelectedItem(null);
  }, [setSelectedItem]);

  const saveServerConfig = useCallback((name: string, config: Record<string, unknown>) => {
    setServers(prev => prev.map(s => s.name === name ? { ...s, ...config } as McpEntry : s));
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name}`, value: config } });
  }, []);

  const handleSelect = useCallback((id: string) => () => setSelectedItem(id), [setSelectedItem]);

  const filtered = useMemo(() =>
    servers.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [servers, searchQuery]
  );

  const selected = servers.find(s => s.name === selectedItem);
  const isNew = selectedItem === "__new__";

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: server list */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <SearchInput placeholder="🔍 搜索服务器..." value={searchQuery} onChange={setSearchQuery} />
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((srv) => (
            <button
              key={srv.name}
              onClick={handleSelect(srv.name)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === srv.name
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "8px 10px", marginBottom: 1 }}
            >
              <div className="truncate text-left">
                <div className="font-medium truncate">{srv.name}</div>
                <div className={cn("text-xs", srv.enabled ? "text-success" : "text-txt-muted")}>
                  {srv.enabled ? `● 在线${srv.toolCount ? ` · ${srv.toolCount}工具` : ""}` : "已关闭"}
                </div>
              </div>
              <ToggleSwitch
                checked={!!srv.enabled}
                onChange={(v) => toggleServer(srv.name, v)}
              />
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-txt-muted text-center py-4">无 MCP 服务器</p>
          )}
        </div>
        <div style={{ padding: "4px 8px 8px" }}>
          <button
            onClick={() => setSelectedItem("__new__")}
            className="w-full rounded-lg border border-dashed border-accent/50 text-accent text-sm
                       hover:bg-accent/5 transition-colors"
            style={{ padding: "10px" }}
          >
            + 添加 MCP 服务器
          </button>
        </div>
      </div>

      {/* Right: detail/config window */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {isNew ? (
          <NewMcpForm onCreated={(name) => {
            setSelectedItem(name);
            fetchServers();
          }} />
        ) : selected ? (
          <McpDetail
            key={selected.name}
            server={selected}
            onSave={(cfg) => saveServerConfig(selected.name, cfg)}
            onDelete={() => deleteServer(selected.name)}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一个 MCP 服务器查看配置</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NewMcpForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [envStr, setEnvStr] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    if (!MCP_NAME_RE.test(name.trim())) return;
    const cfg: Record<string, unknown> = { transport, enabled: true };
    if (transport === "stdio") {
      const parsed = splitCommandLine(command);
      if (!parsed.command) return;
      cfg.command = parsed.command;
      if (parsed.args.length > 0) cfg.args = parsed.args;
      if (envStr.trim()) {
        try { cfg.env = JSON.parse(envStr.trim()); } catch { /* ignore invalid JSON */ }
      }
    } else {
      cfg.url = url.trim();
    }
    const client = getWsClient();
    client?.send({ type: "update_config", payload: { path: `mcpServers.${name.trim()}`, value: cfg } });
    onCreated(name.trim());
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-txt mb-4">添加 MCP 服务器</h3>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-sm text-txt-sub block mb-1">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt" />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">传输方式</label>
          <select value={transport} onChange={(e) => setTransport(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt">
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </div>
        {transport === "stdio" ? (
          <div>
            <label className="text-sm text-txt-sub block mb-1">命令</label>
            <input value={command} onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
              placeholder="npx -y @modelcontextprotocol/server-github" />
          </div>
        ) : (
          <div>
            <label className="text-sm text-txt-sub block mb-1">URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
              placeholder="http://localhost:3000/mcp" />
          </div>
        )}
        <div>
          <label className="text-sm text-txt-sub block mb-1">环境变量 (JSON, 可选)</label>
          <input value={envStr} onChange={(e) => setEnvStr(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
            placeholder='{"GITHUB_TOKEN": "ghp_xxx"}' />
        </div>
        <button onClick={handleCreate}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          添加
        </button>
      </div>
    </div>
  );
}

function McpDetail({ server, onSave, onDelete }: {
  server: McpEntry;
  onSave: (cfg: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const [transport, setTransport] = useState(server.transport);
  const [command, setCommand] = useState([server.command, ...(server.args ?? [])].filter(Boolean).join(" "));
  const [url, setUrl] = useState(server.url ?? "");
  const [envStr, setEnvStr] = useState(server.env ? JSON.stringify(server.env) : "");

  const handleSave = () => {
    const cfg: Record<string, unknown> = { transport };
    if (transport === "stdio") {
      const parsed = splitCommandLine(command);
      cfg.command = parsed.command;
      cfg.args = parsed.args;
      if (envStr.trim()) { try { cfg.env = JSON.parse(envStr.trim()); } catch { /* ignore */ } }
    } else {
      cfg.url = url.trim();
      if (server.headers) cfg.headers = server.headers;
    }
    onSave(cfg);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-txt">{server.name}</h3>
          <p className="text-sm text-txt-muted">{server.transport} · {server.toolCount ?? "?"} 个工具</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full",
          server.enabled ? "bg-success/10 text-success" : "bg-txt-muted/10 text-txt-muted")}>
          {server.enabled ? "已连接" : "已断开"}
        </span>
      </div>

      <div className="bg-elevated rounded-xl p-4 mb-4">
        <h4 className="text-sm font-medium text-txt mb-3">连接配置</h4>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-txt-muted block mb-1">传输方式</label>
              <select value={transport} onChange={(e) => setTransport(e.target.value as any)}
                className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt">
                <option value="stdio">stdio</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div>
              {transport === "stdio" ? (
                <>
                  <label className="text-xs text-txt-muted block mb-1">命令</label>
                  <input value={command} onChange={(e) => setCommand(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt font-mono" />
                </>
              ) : (
                <>
                  <label className="text-xs text-txt-muted block mb-1">URL</label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt" />
                </>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-txt-muted block mb-1">环境变量 (JSON)</label>
            <input value={envStr} onChange={(e) => setEnvStr(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt font-mono" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave}
            className="rounded-lg px-3 py-1.5 text-sm bg-accent text-white hover:opacity-90">
            保存配置
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onDelete}
          className="text-sm text-danger hover:underline">
          删除此服务器
        </button>
      </div>
    </div>
  );
}
