import { create } from "zustand";

export interface PluginModelInfo {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  maxOutput?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  tags?: string[];
}

export interface PluginInfo {
  id: string;
  name: string;
  kind: string;
  version: string;
  enabled: boolean;
  models?: PluginModelInfo[];
  channelType?: string;
  toolDefs?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  extensions?: Array<{
    id: string;
    type: string;
    label: string;
    componentPath: string;
    icon?: string;
  }>;
  isCustomInstance?: boolean;
  pluginId?: string;
  instanceId?: string;
  config?: Record<string, unknown>;
  configSchema?: {
    fields?: Array<{ key: string; label: string; type: string; secret?: boolean }>;
    features?: Array<{ key: string; label: string; desc?: string }>;
  };
}

interface PluginsStore {
  plugins: PluginInfo[];
  loaded: boolean;

  // Derived data — computed once when setPlugins is called:
  providers: PluginInfo[];
  channels: PluginInfo[];
  extensionPlugins: PluginInfo[];

  // Pre-computed extension panels by type:
  settingsPanels: Array<{ id: string; type: string; label: string; componentPath: string; icon?: string }>;
  dashboardCards: Array<{ id: string; type: string; label: string; componentPath: string; icon?: string }>;
  chatActions: Array<{ id: string; type: string; label: string; componentPath: string; icon?: string }>;

  setPlugins: (plugins: PluginInfo[]) => void;

  /** Get models for a specific provider ID (called inside useMemo, not as selector) */
  getModels: (providerId: string) => PluginModelInfo[];
}

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  plugins: [],
  loaded: false,
  providers: [],
  channels: [],
  extensionPlugins: [],
  settingsPanels: [],
  dashboardCards: [],
  chatActions: [],

  setPlugins: (plugins) => {
    // Pre-compute all derived slices ONCE
    const extensionPlugins = plugins.filter(p => p.kind === "extension" && p.enabled);
    const settingsPanels: PluginsStore["settingsPanels"] = [];
    const dashboardCards: PluginsStore["dashboardCards"] = [];
    const chatActions: PluginsStore["chatActions"] = [];
    for (const ep of extensionPlugins) {
      if (ep.extensions) {
        for (const ext of ep.extensions) {
          if (ext.type === "settings-panel") settingsPanels.push(ext);
          else if (ext.type === "dashboard-card") dashboardCards.push(ext);
          else if (ext.type === "chat-action") chatActions.push(ext);
        }
      }
    }

    set({
      plugins,
      loaded: true,
      providers: plugins.filter(p => p.kind === "model-provider" && p.enabled),
      channels: plugins.filter(p => p.kind === "channel" && p.enabled),
      extensionPlugins,
      settingsPanels,
      dashboardCards,
      chatActions,
    });
  },

  getModels: (providerId) => {
    // 1. Exact match: e.g., "deepseek" or "custom:my-llm"
    const { plugins } = get();
    const exact = plugins.find(p => p.id === providerId);
    if (exact?.models?.length) return exact.models;

    // 2. Custom instance lookup: find by instanceId field
    const cleanId = providerId.startsWith("custom:") ? providerId.slice(7) : "";
    if (cleanId) {
      const instance = plugins.find(
        p => p.isCustomInstance && p.instanceId === cleanId
      );
      if (instance?.models?.length) return instance.models;
      // Fallback: return parent plugin's models
      if (instance?.pluginId) {
        const parent = plugins.find(p => p.id === instance.pluginId);
        if (parent?.models?.length) return parent.models;
      }
    }

    // 3. Standard provider lookup by id
    const standard = plugins.find(
      p => p.id === providerId && p.kind === "model-provider"
    );
    return standard?.models || [];
  },
}));
