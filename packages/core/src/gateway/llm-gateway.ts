/**
 * LLMGateway — LLM 请求并发控制和队列调度
 * 所有 Agent 共享一个 Gateway 实例，自动排队执行请求
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
  params: ChatParams;
  resolve: (iterable: AsyncIterable<ChatChunk>) => void;
  reject: (err: Error) => void;
}

export class LLMGateway {
  private provider: LLMProvider;
  private config: Required<GatewayConfig>;
  private queue: QueueItem[] = [];
  private activeCount = 0;
  private requestTimestamps: number[] = [];

  constructor(provider: LLMProvider, config?: GatewayConfig) {
    this.provider = provider;
    this.config = {
      maxConcurrency: config?.maxConcurrency ?? 5,
      rpmLimit: config?.rpmLimit ?? 60,
      timeout: config?.timeout ?? 120000,
      retryAttempts: config?.retryAttempts ?? 3,
    };
    log.info("Gateway initialized (concurrency=%d, rpm=%d)", this.config.maxConcurrency, this.config.rpmLimit);
  }

  /** 提交 LLM 请求（排队执行） */
  async chat(params: ChatParams): Promise<AsyncIterable<ChatChunk>> {
    return new Promise<AsyncIterable<ChatChunk>>((resolve, reject) => {
      this.queue.push({ params, resolve, reject });
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
        .then(item.resolve)
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

  private async executeWithRetry(item: QueueItem): Promise<AsyncIterable<ChatChunk>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        // 用 Promise 包装 provider.chat() 以支持超时
        const iterable = await this.createTimedIterable(item.params);
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

  private async createTimedIterable(params: ChatParams): Promise<AsyncIterable<ChatChunk>> {
    return new Promise<AsyncIterable<ChatChunk>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`LLM request timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      try {
        const iterable = this.provider.chat(params);
        clearTimeout(timeout);
        resolve(iterable);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
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
