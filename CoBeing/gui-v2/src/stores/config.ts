import { create } from "zustand";
import { getWsClient } from "@/hooks/useWebSocket";

export interface ProviderEntry {
  name: string;
  apiKeyEnv: string;
  apiKey?: string;
  /** 后端解析环境变量后的 masked 值，前端只读 */
  _apiKeyResolved?: string;
  type?: string;
  baseURL?: string;
  plan?: "general" | "coding";
}

export interface ChannelBindTo {
  type: "agent" | "group";
  agentId?: string;
  groupId?: string;
}

export interface ChannelEntry {
  name: string;
  enabled: boolean;
  type: string;
  bindTo?: ChannelBindTo;
  [key: string]: unknown;
}

export interface McpEntry {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ConfigStore {
  providers: Record<string, ProviderEntry>;
  channels: Record<string, ChannelEntry>;
  mcpServers: Record<string, McpEntry>;
  loaded: boolean;

  setConfig: (config: {
    providers?: Record<string, ProviderEntry>;
    channels?: Record<string, ChannelEntry>;
    mcpServers?: Record<string, McpEntry>;
  }) => void;

  fetchConfig: () => void;

  updateProvider: (name: string, entry: ProviderEntry) => void;
  deleteProvider: (name: string) => void;

  updateChannel: (name: string, entry: ChannelEntry) => void;
  deleteChannel: (name: string) => void;

  updateMcp: (name: string, entry: McpEntry) => void;
  deleteMcp: (name: string) => void;
}

function sendUpdate(configPath: string, value: unknown) {
  getWsClient()?.send({ type: "update_config", payload: { path: configPath, value } });
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  providers: {},
  channels: {},
  mcpServers: {},
  loaded: false,

  setConfig: (config) => set({
    providers: config.providers || {},
    channels: config.channels || {},
    mcpServers: config.mcpServers || {},
    loaded: true,
  }),

  fetchConfig: () => {
    getWsClient()?.send({ type: "get_config" });
  },

  updateProvider: (name, entry) => {
    const providers = { ...get().providers, [name]: entry };
    set({ providers });
    sendUpdate(`providers.${name}`, {
      apiKeyEnv: entry.apiKeyEnv || undefined,
      apiKey: entry.apiKey || undefined,
      type: entry.type || undefined,
      baseURL: entry.baseURL || undefined,
      plan: entry.plan || undefined,
    });
  },

  deleteProvider: (name) => {
    const { [name]: _, ...rest } = get().providers;
    set({ providers: rest });
    sendUpdate(`providers.${name}`, null);
  },

  updateChannel: (name, entry) => {
    const channels = { ...get().channels, [name]: entry };
    set({ channels });
    sendUpdate(`channels.${name}`, entry);
  },

  deleteChannel: (name) => {
    const { [name]: _, ...rest } = get().channels;
    set({ channels: rest });
    sendUpdate(`channels.${name}`, null);
  },

  updateMcp: (name, entry) => {
    const mcpServers = { ...get().mcpServers, [name]: entry };
    set({ mcpServers });
    sendUpdate(`mcpServers.${name}`, {
      transport: entry.transport,
      command: entry.command || undefined,
      args: entry.args || undefined,
      env: entry.env || undefined,
      url: entry.url || undefined,
      headers: entry.headers || undefined,
    });
  },

  deleteMcp: (name) => {
    const { [name]: _, ...rest } = get().mcpServers;
    set({ mcpServers: rest });
    sendUpdate(`mcpServers.${name}`, null);
  },
}));
