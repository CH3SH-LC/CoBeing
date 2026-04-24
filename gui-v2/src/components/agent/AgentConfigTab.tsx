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
  const [networkEnabled, setNetworkEnabled] = useState(true);
  const [memoryLimit, setMemoryLimit] = useState("512m");
  const [cpuLimit, setCpuLimit] = useState(1);
  const [commandTimeout, setCommandTimeout] = useState(30);
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
            network: networkEnabled,
            resources: {
              memory: memoryLimit,
              cpus: cpuLimit,
              timeout: commandTimeout,
            },
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
    setNetworkEnabled(true);
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
            <div className="flex items-center justify-between">
              <span className="text-sm text-txt">网络访问</span>
              <Switch checked={networkEnabled} onCheckedChange={(v) => { setNetworkEnabled(v); setSaved(false); }} />
            </div>
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
          </>
        )}
        {!sandboxEnabled && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-txt">网络访问</span>
            <Switch checked={networkEnabled} onCheckedChange={(v) => { setNetworkEnabled(v); setSaved(false); }} />
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
