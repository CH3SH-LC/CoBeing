/**
 * LLMGateway — LLM 请求并发控制和队列调度（全局必经链路）
 *
 * 2026-08-09 决策：所有 LLM 调用统一经过 Gateway（队列 + RPM 限流 + 超时 + 重试）。
 * Gateway 不绑定具体 Provider，调用方显式传入 provider 实例（保留 ConversationLoop
 * 的 fallback 链与熔断器语义，gateway 负责跨调用点的并发治理）。
 *
 * 使用方式：
 *   import { chatWithGateway, chatCompleteWithGateway } from "./gateway/llm-gateway.js";
 *   for await (const chunk of await chatWithGateway(provider, params)) { ... }
 *
 * 无全局 gateway 时（单元测试/独立使用）自动降级为直接调用 provider，行为不变。
 */
import type { ChatParams, ChatChunk } from "@cobeing/shared";
import type { LLMProvider } from "@cobeing/providers";
import { createLogger } from "@cobeing/shared";

const log = createLogger("llm-gateway");

export interface GatewayConfig {
  maxConcurrency?: number;  // 最大并发请求数（默认 5）
  rpmLimit?: number;        // 每分钟请求限制（默认 60）
  timeout?: number;         // 单次请求超时 ms（默认 120000）
  retryAttempts?: number;   // 重试次数（默认 3）
}

interface QueueItem {
  provider: LLMProvider;
  params: ChatParams;
  kind: "stream" | "complete";
  resolveStream: (iterable: AsyncIterable<ChatChunk>) => void;
  resolveComplete: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** 获取全局 gateway（Runtime 启动时挂载），无则 undefined（直调降级） */
export function getGlobalGateway(): LLMGateway | undefined {
  return (globalThis as any).__cobeing?.gateway;
}

/** 统一的流式 LLM 调用入口：有全局 gateway 走 gateway，否则直调 provider */
export async function chatWithGateway(provider: Pick<LLMProvider, "chat">, params: ChatParams): Promise<AsyncIterable<ChatChunk>> {
  const gateway = getGlobalGateway();
  if (gateway) return gateway.chat(provider as LLMProvider, params);
  return provider.chat(params);
}

/** 统一的非流式 LLM 调用入口（chatComplete）：排队 + RPM 治理，无则直调 */
export async function chatCompleteWithGateway<T>(provider: Pick<LLMProvider, "chatComplete">, params: ChatParams): Promise<T> {
  const gateway = getGlobalGateway();
  if (gateway) return gateway.chatComplete<T>(provider as LLMProvider, params);
  return provider.chatComplete(params) as Promise<T>;
}

export class LLMGateway {
  private config: Required<GatewayConfig>;
  private queue: QueueItem[] = [];
  private activeCount = 0;
  private requestTimestamps: number[] = [];

  constructor(config?: GatewayConfig) {
    this.config = {
      maxConcurrency: config?.maxConcurrency ?? 5,
      rpmLimit: config?.rpmLimit ?? 60,
      timeout: config?.timeout ?? 120000,
      retryAttempts: config?.retryAttempts ?? 3,
    };
    log.info("Gateway initialized (concurrency=%d, rpm=%d, timeout=%dms, retries=%d)",
      this.config.maxConcurrency, this.config.rpmLimit, this.config.timeout, this.config.retryAttempts);
  }

  /** 提交流式 LLM 请求（排队执行；provider 由调用方传入） */
  async chat(provider: LLMProvider, params: ChatParams): Promise<AsyncIterable<ChatChunk>> {
    return new Promise<AsyncIterable<ChatChunk>>((resolve, reject) => {
      this.queue.push({
        provider, params, kind: "stream",
        resolveStream: resolve, resolveComplete: () => {}, reject,
      });
      this.schedule();
    });
  }

  /** 提交非流式 LLM 请求（chatComplete：排队 + RPM + 重试） */
  async chatComplete<T>(provider: LLMProvider, params: ChatParams): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        provider, params, kind: "complete",
        resolveStream: () => {}, resolveComplete: (v) => resolve(v as T), reject,
      });
      this.schedule();
    });
  }

  /** 内部调度 */
  private schedule(): void {
    while (this.queue.length > 0 && this.canStartNew()) {
      const item = this.queue.shift()!;
      this.activeCount++;
      this.recordRequest();

      this.executeWithRetry(item)
        .then((result) => {
          if (item.kind === "stream") item.resolveStream(result as AsyncIterable<ChatChunk>);
          else item.resolveComplete(result);
        })
        .catch(item.reject)
        .finally(() => {
          this.activeCount--;
          this.schedule();
        });
    }
  }

  private canStartNew(): boolean {
    if (this.activeCount >= this.config.maxConcurrency) return false;
    return this.getCurrentRpm() < this.config.rpmLimit;
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  private getCurrentRpm(): number {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t >= oneMinuteAgo);
    return this.requestTimestamps.length;
  }

  private async executeWithRetry(item: QueueItem): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        if (item.kind === "complete") {
          return await item.provider.chatComplete(item.params);
        }
        // 流式：用 Promise 包装 provider.chat() 以支持超时
        const iterable = await this.createTimedIterable(item.provider, item.params);
        return iterable;
      } catch (err: any) {
        lastError = err;
        if (attempt < this.config.retryAttempts - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          log.warn("Request failed (attempt %d/%d), retrying in %dms: %s",
            attempt + 1, this.config.retryAttempts, delay, err.message);
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error("Unknown error");
  }

  private async createTimedIterable(provider: LLMProvider, params: ChatParams): Promise<AsyncIterable<ChatChunk>> {
    const iterable = await provider.chat(params);
    // 包装 iterable：每个 chunk 超过 timeout 未到达则超时
    const timedIterable: AsyncIterable<ChatChunk> = {
      [Symbol.asyncIterator]: () => {
        const iterator = iterable[Symbol.asyncIterator]();
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const clear = () => { if (timeoutHandle) clearTimeout(timeoutHandle); };
        return {
          next: async (): Promise<IteratorResult<ChatChunk>> => {
            return new Promise((resolve, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new Error(`LLM request timed out after ${this.config.timeout}ms`));
              }, this.config.timeout);
              iterator.next().then(result => {
                clear();
                resolve(result);
              }, err => {
                clear();
                reject(err);
              });
            });
          },
          return: async () => {
            clear();
            return iterator.return?.() ?? { done: true, value: undefined };
          },
        };
      },
    };
    return timedIterable;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 获取当前状态 */
  getStatus(): { activeCount: number; queueLength: number; currentRpm: number } {
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      currentRpm: this.getCurrentRpm(),
    };
  }
}
