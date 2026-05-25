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
  kind: "model-provider" | "channel" | "tool" | "memory-backend";
  register(api: CoBeingPluginApi): void | Promise<void>;
}

// ── 宿主注入给插件的 API ──

export interface CoBeingPluginApi {
  registerModelProvider(provider: ModelProviderPlugin): void;
  registerChannel(channel: ChannelPlugin): void;
  registerTool(tool: ToolPlugin): void;
  registerMemoryBackend(backend: MemoryBackendPlugin): void;
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

// ── 插件清单（cobeing.plugin.json） ──

export interface PluginManifest {
  id: string;
  name: string;
  kind: "model-provider" | "channel" | "tool" | "memory-backend";
  version: string;
  main: string;
  cobeingVersion?: string;
}
