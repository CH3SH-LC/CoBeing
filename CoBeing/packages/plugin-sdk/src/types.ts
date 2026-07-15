import type {
  ChatParams,
  ChatChunk,
  ModelInfo,
  ModelCapabilities,
  InboundMessage,
  OutboundMessage,
  ChannelCapabilities,
} from "@cobeing/shared";

// ── 插件自身 ──

export interface CoBeingPlugin {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  register(api: CoBeingPluginApi): void | Promise<void>;
}

// ── 宿主注入给插件的 API ──

export interface CoBeingPluginApi {
  registerModelProvider(provider: ModelProviderPlugin): void;
  registerChannel(channel: ChannelPlugin): void;
  registerTool(tool: ToolPlugin): void;
  registerMemoryBackend(backend: MemoryBackendPlugin): void;

  // 生命周期钩子
  onHook(event: string, handler: (...args: any[]) => any): void;

  // Prompt 扩展
  registerPromptLayer(layer: { id: string; priority: number; build(ctx: any): string }): void;

  // Skill / ToolAgent
  registerSkill(skill: { id: string; name: string; description: string; template: string; tools?: string[] }): void;
  registerToolAgent(agent: { id: string; name: string; description: string; prompt: string; maxIterations?: number }): void;

  // UI 扩展
  registerUIExtension(ext: UIExtension): void;

  // Runtime 访问
  getConfig(): Record<string, unknown>;

  // 内部：HookBus 引用（PluginLoader 用于注入 pluginId）
  _hookBus?: any;
}

// ── 四种插件类型 ──

export interface ModelProviderPlugin {
  readonly id: string;
  readonly name: string;
  chat(params: ChatParams): AsyncIterable<ChatChunk>;
  chatComplete(params: ChatParams): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
  capabilities(model: string): ModelCapabilities;
}

export interface ChannelPlugin {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(msg: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void | Promise<void>): void;
  capabilities(): ChannelCapabilities;
  isConnected(): boolean;
}

export interface ToolPlugin {
  id: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(params: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
  }>;
}

export interface MemoryBackendPlugin {
  id: string;
  store(key: string, value: unknown): Promise<void>;
  search(query: string, opts?: { limit?: number }): Promise<Array<{ key: string; score: number }>>;
}

// ── UI 扩展 ──

export interface UIExtension {
  id: string;
  type: "settings-panel" | "dashboard-card" | "chat-action";
  label: string;
  componentPath: string;
  icon?: string;
}

// ── 插件清单（cobeing.plugin.json） ──

export interface PluginManifest {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend" | "extension";
  version: string;
  main: string;
  models?: string;
  ui?: string;
  extensions?: string[];
  cobeingVersion?: string;
}

// ── 插件注册表（data/plugins/registry.json） ──

export interface PluginRegistryEntry {
  enabled: boolean;
  kind: string;
  dir: string;
  config: Record<string, unknown>;
}

export interface PluginRegistry {
  version: number;
  plugins: Record<string, PluginRegistryEntry>;
}
