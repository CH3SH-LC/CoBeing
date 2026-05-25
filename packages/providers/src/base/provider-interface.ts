/**
 * LLM Provider 统一接口
 */
import type {
  ChatParams,
  ChatChunk,
  ModelInfo,
  ModelCapabilities,
} from "@cobeing/shared";

export interface LLMProvider {
  readonly id: string;
  readonly name: string;

  /** 流式聊天补全 */
  chat(params: ChatParams): AsyncIterable<ChatChunk>;

  /** 非流式聊天（便捷方法） */
  chatComplete(params: ChatParams): Promise<string>;

  /** 列出可用模型 */
  listModels(): Promise<ModelInfo[]>;

  /** 查询模型能力 */
  capabilities(model: string): ModelCapabilities;
}

/** 将 provider 注册到全局 */
const providerRegistry = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider | undefined {
  return providerRegistry.get(id);
}

export function getAllProviders(): LLMProvider[] {
  return [...providerRegistry.values()];
}
