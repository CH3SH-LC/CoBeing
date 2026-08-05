import { useState, useMemo, useCallback } from "react";
import { usePluginsStore, type PluginInfo } from "@/stores/plugins";
import { useExtensionsStore } from "@/stores/extensions";
import { getWsClient } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/shared/ToggleSwitch";
import { SearchInput } from "@/components/shared/SearchInput";

export function PluginsTab() {
  const plugins = usePluginsStore((s) => s.plugins);
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const sorted = useMemo(() =>
    [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
    [plugins]
  );

  const filtered = useMemo(() =>
    sorted.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [sorted, searchQuery]
  );

  const selected = plugins.find(p => p.id === selectedItem);

  const togglePlugin = useCallback((id: string, enabled: boolean) => {
    const client = getWsClient();
    client?.send({ type: "toggle_plugin", payload: { pluginId: id, enabled } });
    // Optimistic update — read latest state from store, not stale closure
    const current = usePluginsStore.getState().plugins;
    usePluginsStore.getState().setPlugins(
      current.map(p => p.id === id ? { ...p, enabled } : p)
    );
  }, []);

  const handleSelect = useCallback((id: string) => () => setSelectedItem(id), [setSelectedItem]);

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: flat plugin list (no categories) */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <SearchInput placeholder="🔍 搜索插件..." value={searchQuery} onChange={setSearchQuery} />
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((plugin) => (
            <button
              key={plugin.id}
              onClick={handleSelect(plugin.id)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === plugin.id
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "14px 20px", marginBottom: 2 }}
            >
              <div className="truncate text-left">
                <div className="font-medium truncate">{plugin.name}</div>
                <div className="text-xs text-txt-muted">v{plugin.version}</div>
              </div>
              <ToggleSwitch
                checked={plugin.enabled}
                onChange={(v) => togglePlugin(plugin.id, v)}
              />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center text-center" style={{ padding: "32px 8px", gap: 8 }}>
              <div className="text-3xl">🧩</div>
              <p className="text-sm text-txt-muted">无已注册插件</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: plugin detail/config */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {selected ? (
          <PluginDetail key={selected.id} plugin={selected} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一个插件查看详情和配置</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PluginDetail({ plugin }: { plugin: PluginInfo }) {
  const schema = plugin.configSchema;
  const [config, setConfig] = useState<Record<string, unknown>>(plugin.config ?? {});
  const [features, setFeatures] = useState<Record<string, boolean>>(
    (plugin.config?.features as Record<string, boolean>) ?? {}
  );

  const handleFieldChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleFeatureToggle = (key: string, v: boolean) => {
    const next = { ...features, [key]: v };
    setFeatures(next);
    setConfig(prev => ({ ...prev, features: next }));
  };

  const handleSave = () => {
    const client = getWsClient();
    client?.send({ type: "update_plugin_config", payload: { pluginId: plugin.id, config: { ...config, features } } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-txt">{plugin.name}</h3>
          <p className="text-sm text-txt-muted">v{plugin.version} · {plugin.enabled ? "运行中" : "已禁用"}</p>
        </div>
        <span className={cn("text-xs px-2 py-0.5 rounded-full",
          plugin.enabled ? "bg-success/10 text-success" : "bg-txt-muted/10 text-txt-muted")}>
          {plugin.enabled ? "已启用" : "已禁用"}
        </span>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <InfoBadge label="版本" value={plugin.version} />
        <InfoBadge label="类型" value={plugin.kind} />
        <InfoBadge label="模型数" value={String(plugin.models?.length ?? "-")} />
      </div>

      {/* Config schema form — if available */}
      {schema?.fields && schema.fields.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">🔑 连接配置</h4>
          <div className="grid grid-cols-2 gap-3">
            {schema.fields.map((field) => (
              <div key={field.key} className={field.key.length > 20 ? "col-span-2" : ""}>
                <label className="text-sm text-txt-muted block mb-1">{field.label}</label>
                {field.secret ? (
                  <input
                    type="password"
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(config[field.key] ?? "")}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-input border border-bdr text-sm text-txt"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature toggles — if available */}
      {schema?.features && schema.features.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">⚙️ 功能开关</h4>
          <div className="space-y-3">
            {schema.features.map((feat) => (
              <div key={feat.key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-txt">{feat.label}</div>
                  {feat.desc && <div className="text-xs text-txt-muted">{feat.desc}</div>}
                </div>
                <ToggleSwitch
                  checked={!!features[feat.key]}
                  onChange={(v) => handleFeatureToggle(feat.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Models list — for provider plugins */}
      {plugin.models && plugin.models.length > 0 && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">📋 模型列表 ({plugin.models.length})</h4>
          <div className="flex flex-wrap gap-2">
            {plugin.models.map((m) => (
              <span key={m.id} className="rounded-full px-3 py-1 text-xs bg-input border border-bdr text-txt-sub">
                {m.name ?? m.id}
                {m.contextWindow ? ` (${Math.round(m.contextWindow / 1024)}K)` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: raw JSON editor for plugins without configSchema */}
      {(!schema || (!schema.fields?.length && !schema.features?.length)) && (
        <div className="bg-elevated rounded-xl p-4 mb-3">
          <h4 className="text-sm font-medium text-txt mb-3">📝 配置 (JSON)</h4>
          <textarea
            value={JSON.stringify(config, null, 2)}
            onChange={(e) => {
              try { setConfig(JSON.parse(e.target.value)); } catch { /* invalid JSON during editing */ }
            }}
            rows={8}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={handleSave}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          保存配置
        </button>
      </div>
    </div>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-elevated text-center" style={{ padding: "8px 12px" }}>
      <div className="text-xs text-txt-muted">{label}</div>
      <div className="text-sm font-semibold text-txt">{value}</div>
    </div>
  );
}
