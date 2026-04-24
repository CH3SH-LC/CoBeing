import { useState, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { AgentInfo } from "@/lib/types";
import { getWsClient } from "@/hooks/useWebSocket";
import { useConfigStore } from "@/stores/config";
import { useSettingsStore } from "@/stores/settings";

const BUILTIN_TOOLS = [
  "bash", "read-file", "write-file", "edit-file", "glob", "grep", "web-fetch", "agent-message",
];

const PERMISSIONS = ["full-access", "workspace-write", "read-only", "ask"];

const CATALOG_MODELS: Record<string, Array<{ id: string; name: string; tags?: string[] }>> = {
  deepseek: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", tags: ["fast"] },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", tags: ["reasoning", "coding"] },
  ],
  zhipu: [
    { id: "glm-4-plus", name: "GLM-4 Plus", tags: ["flagship"] },
    { id: "glm-4-air", name: "GLM-4 Air", tags: ["fast"] },
    { id: "glm-4-flash", name: "GLM-4 Flash", tags: ["fast"] },
    { id: "glm-4-long", name: "GLM-4 Long" },
    { id: "codegeex-4", name: "CodeGeeX 4", tags: ["coding"] },
  ],
  qwen: [
    { id: "qwen-max", name: "Qwen Max", tags: ["flagship"] },
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "qwen-turbo", name: "Qwen Turbo", tags: ["fast"] },
    { id: "qwen-coder-plus", name: "Qwen Coder Plus", tags: ["coding"] },
    { id: "qwq-32b", name: "QwQ 32B", tags: ["reasoning"] },
  ],
  minimax: [
    { id: "MiniMax-Text-01", name: "MiniMax Text 01" },
    { id: "MiniMax-M1", name: "MiniMax M1" },
  ],
  volcengine: [
    { id: "doubao-pro-32k", name: "Doubao Pro 32K" },
    { id: "doubao-pro-128k", name: "Doubao Pro 128K" },
    { id: "doubao-1.5-pro-256k", name: "Doubao 1.5 Pro 256K" },
  ],
  moonshot: [
    { id: "moonshot-v1-8k", name: "Moonshot V1 8K" },
    { id: "moonshot-v1-32k", name: "Moonshot V1 32K" },
    { id: "moonshot-v1-128k", name: "Moonshot V1 128K" },
    { id: "kimi-k2", name: "Kimi K2" },
  ],
  siliconflow: [
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3 (SF)" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1 (SF)" },
    { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B (SF)" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "o3-mini", name: "O3 Mini" },
    { id: "o4-mini", name: "O4 Mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-haiku-4-20250414", name: "Claude Haiku 4" },
  ],
  gemini: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  grok: [
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-3-fast", name: "Grok 3 Fast" },
    { id: "grok-3-mini", name: "Grok 3 Mini" },
  ],
};

interface AgentConfigTabProps {
  agent: AgentInfo;
}

export function AgentConfigTab({ agent }: AgentConfigTabProps) {
  const configProviders = useConfigStore((s) => s.providers);
  const [provider, setProvider] = useState(agent.provider);
  const [model, setModel] = useState(agent.model);
  const [permission, setPermission] = useState("full-access");
  const [enabledTools, setEnabledTools] = useState<string[]>(BUILTIN_TOOLS);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [networkMode, setNetworkMode] = useState<"all" | "whitelist" | "none">("all");
  const [allowDomains, setAllowDomains] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [memoryLimit, setMemoryLimit] = useState("512m");
  const [cpuLimit, setCpuLimit] = useState(1);
  const [commandTimeout, setCommandTimeout] = useState(30);
  const [diskLimit, setDiskLimit] = useState("1g");
  const [securityEnabled, setSecurityEnabled] = useState(true);
  const [selectedImage, setSelectedImage] = useState("cobeing-sandbox:python");
  const [mounts, setMounts] = useState<Array<{ hostPath: string; containerPath: string; readOnly: boolean }>>([]);
  const [newDomain, setNewDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [destroyOpen, setDestroyOpen] = useState(false);

  const isBuiltin = agent.id === "butler" || agent.id === "host";
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);

  const handleDestroyAgent = () => {
    getWsClient()?.send({
      type: "destroy_agent",
      payload: { agentId: agent.id },
    });
    setDestroyOpen(false);
    setDetailPanelOpen(false);
  };

  const allProviders = useMemo(() => {
    const merged = new Set([...Object.keys(CATALOG_MODELS), ...Object.keys(configProviders)]);
    return [...merged].sort();
  }, [configProviders]);

  const models = CATALOG_MODELS[provider] || [];
  const modelInCatalog = models.some(m => m.id === model);

  const toggleTool = (tool: string) => {
    setEnabledTools((prev) => prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]);
    setSaved(false);
  };

  const handleSave = () => {
    setSaving(true);
    getWsClient()?.send({
      type: "update_agent",
      payload: {
        agentId: agent.id,
        config: {
          provider,
          model,
          permissions: { mode: permission },
          sandbox: {
            enabled: sandboxEnabled,
            filesystem: "isolated",
            network: {
              enabled: networkMode !== "none",
              mode: networkMode,
              allowDomains: allowDomains,
            },
            resources: {
              memory: memoryLimit,
              cpus: cpuLimit,
              timeout: commandTimeout,
              disk: diskLimit,
            },
            security: {
              enabled: securityEnabled,
              noNewPrivileges: securityEnabled,
              readOnlyRootfs: securityEnabled,
              dropAllCapabilities: securityEnabled,
            },
            image: selectedImage,
            bindings: mounts.map(m => `${m.hostPath}:${m.containerPath}${m.readOnly ? ":ro" : ""}`),
          },
          tools: enabledTools,
        },
      },
    });
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 300);
  };

  const handleReset = () => {
    setProvider(agent.provider);
    setModel(agent.model);
    setPermission("full-access");
    setEnabledTools(BUILTIN_TOOLS);
    setSandboxEnabled(false);
    setNetworkMode("all");
    setAllowDomains([]);
    setSelectedGroups([]);
    setDiskLimit("1g");
    setSecurityEnabled(true);
    setSelectedImage("cobeing-sandbox:python");
    setMounts([]);
    setNewDomain("");
    setSaved(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-txt-sub mb-1.5 block">Provider</label>
          <Select value={provider} onValueChange={(v) => {
            setProvider(v);
            const m = CATALOG_MODELS[v];
            if (m?.[0]) setModel(m[0].id);
            setSaved(false);
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {allProviders.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm text-txt-sub mb-1.5 block">Model</label>
          {models.length > 0 ? (
            <Select value={model} onValueChange={(v) => { setModel(v); setSaved(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
                {/* 如果当前模型不在目录中，添加一个自定义选项 */}
                {!modelInCatalog && model && (
                  <SelectItem value={model}>{model} (自定义)</SelectItem>
                )}
              </SelectContent>
            </Select>
          ) : (
            <input
              value={model}
              onChange={(e) => { setModel(e.target.value); setSaved(false); }}
              className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
              placeholder="模型 ID"
            />
          )}
        </div>
      </div>

      <div>
        <label className="text-sm text-txt-sub mb-1.5 block">权限模式</label>
        <select value={permission} onChange={(e) => { setPermission(e.target.value); setSaved(false); }} className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
          {PERMISSIONS.map((p) => (<option key={p} value={p}>{p}</option>))}
        </select>
      </div>

      <div className="rounded-xl bg-elevated" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-txt">Docker 沙箱</span>
          <Switch checked={sandboxEnabled} onCheckedChange={(v) => { setSandboxEnabled(v); setSaved(false); }} />
        </div>

        {sandboxEnabled && (
          <>
            {/* 网络模式选择 */}
            <div>
              <label className="text-xs text-txt-sub mb-1 block">网络模式</label>
              <select value={networkMode} onChange={(e) => { setNetworkMode(e.target.value as any); setSaved(false); }}
                className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                <option value="all">全开</option>
                <option value="whitelist">白名单</option>
                <option value="none">全关</option>
              </select>
            </div>

            {/* 域名白名单管理 */}
            {networkMode === "whitelist" && (
              <div className="rounded-lg bg-surface-solid p-3 space-y-2">
                <label className="text-xs text-txt-sub block">域名白名单</label>
                {allowDomains.map((domain, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm text-txt flex-1">{domain}</span>
                    <button onClick={() => { setAllowDomains(prev => prev.filter((_, idx) => idx !== i)); setSaved(false); }}
                      className="text-xs text-danger hover:text-danger/80">删除</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="输入域名" className="flex-1 h-7 px-2 rounded bg-input border border-bdr text-sm text-txt" />
                  <button onClick={() => { if (newDomain) { setAllowDomains(prev => [...prev, newDomain]); setNewDomain(""); setSaved(false); } }}
                    className="h-7 px-3 rounded bg-accent text-white text-xs">添加</button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {["dev-tools", "package-managers", "documentation"].map(groupId => (
                    <button key={groupId} onClick={() => {
                      setSelectedGroups(prev => prev.includes(groupId) ? prev.filter(g => g !== groupId) : [...prev, groupId]);
                      setSaved(false);
                    }} className={`px-2 py-1 rounded text-xs ${selectedGroups.includes(groupId) ? "bg-accent text-white" : "bg-hover text-txt-sub"}`}>
                      {groupId}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 挂载目录配置 */}
            <div className="rounded-lg bg-surface-solid p-3 space-y-2">
              <label className="text-xs text-txt-sub block">挂载目录</label>
              {mounts.map((mount, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-txt">{mount.hostPath} → {mount.containerPath}</span>
                  <label className="flex items-center gap-1 text-xs text-txt-sub">
                    <input type="checkbox" checked={mount.readOnly}
                      onChange={(e) => { setMounts(prev => prev.map((m, idx) => idx === i ? { ...m, readOnly: e.target.checked } : m)); setSaved(false); }} />
                    只读
                  </label>
                  <button onClick={() => { setMounts(prev => prev.filter((_, idx) => idx !== i)); setSaved(false); }}
                    className="text-xs text-danger">删除</button>
                </div>
              ))}
              <button onClick={() => {
                const path = prompt("输入主机目录路径:");
                if (path) {
                  const containerPath = `/workspace/${path.split(/[/\\]/).pop()}`;
                  setMounts(prev => [...prev, { hostPath: path, containerPath, readOnly: false }]);
                  setSaved(false);
                }
              }} className="h-7 px-3 rounded bg-accent text-white text-xs">添加挂载</button>
            </div>

            {/* 资源限制 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-txt-sub mb-1 block">内存限制</label>
                <select value={memoryLimit} onChange={(e) => { setMemoryLimit(e.target.value); setSaved(false); }}
                  className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                  <option value="256m">256MB</option>
                  <option value="512m">512MB</option>
                  <option value="1g">1GB</option>
                  <option value="2g">2GB</option>
                  <option value="4g">4GB</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-txt-sub mb-1 block">CPU 核数</label>
                <select value={cpuLimit} onChange={(e) => { setCpuLimit(Number(e.target.value)); setSaved(false); }}
                  className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-txt-sub mb-1 block">超时(秒)</label>
                <input type="number" value={commandTimeout} min={5} max={300}
                  onChange={(e) => { setCommandTimeout(Number(e.target.value)); setSaved(false); }}
                  className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt" />
              </div>
            </div>

            {/* 磁盘限制和镜像选择 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-txt-sub mb-1 block">磁盘限制</label>
                <select value={diskLimit} onChange={(e) => { setDiskLimit(e.target.value); setSaved(false); }}
                  className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                  <option value="128m">128MB</option>
                  <option value="256m">256MB</option>
                  <option value="512m">512MB</option>
                  <option value="1g">1GB</option>
                  <option value="2g">2GB</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-txt-sub mb-1 block">镜像</label>
                <select value={selectedImage} onChange={(e) => { setSelectedImage(e.target.value); setSaved(false); }}
                  className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                  <option value="cobeing-sandbox:base">base (Node.js)</option>
                  <option value="cobeing-sandbox:python">python (Node.js + Python)</option>
                  <option value="cobeing-sandbox:full">full (Node.js + Python + Go)</option>
                </select>
              </div>
            </div>

            {/* 安全加固开关 */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-txt">安全加固</span>
              <Switch checked={securityEnabled} onCheckedChange={(v) => { setSecurityEnabled(v); setSaved(false); }} />
            </div>
          </>
        )}

        {!sandboxEnabled && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-txt">网络访问</span>
            <Switch checked={networkMode !== "none"} onCheckedChange={(v) => { setNetworkMode(v ? "all" : "none"); setSaved(false); }} />
          </div>
        )}
      </div>

      <div className="rounded-xl bg-elevated" style={{ padding: 20 }}>
        <label className="text-sm text-txt-sub mb-3 block">启用工具</label>
        <div className="grid grid-cols-2 gap-2">
          {BUILTIN_TOOLS.map((tool) => (
            <button key={tool} onClick={() => toggleTool(tool)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${enabledTools.includes(tool) ? "bg-accent/10 text-accent" : "bg-surface-solid text-txt-muted"}`}>
              <span>{enabledTools.includes(tool) ? "\u2611" : "\u2610"}</span>
              {tool}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 h-10 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50">
          {saving ? "保存中..." : saved ? "\u2713 已保存" : "保存修改"}
        </button>
        <button onClick={handleReset} className="h-10 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">重置</button>
      </div>

      {!isBuiltin && (
        <div className="pt-2">
          <button
            onClick={() => setDestroyOpen(true)}
            className="w-full h-10 rounded-xl text-sm text-danger border border-danger/30 hover:bg-danger/10 transition-colors"
          >
            销毁智能体
          </button>
        </div>
      )}

      <ConfirmDialog
        open={destroyOpen}
        onOpenChange={setDestroyOpen}
        title="销毁智能体"
        description={`确定要销毁智能体 "${agent.name}" 吗？此操作不可撤销。`}
        confirmLabel="销毁"
        variant="danger"
        onConfirm={handleDestroyAgent}
      />
    </div>
  );
}
