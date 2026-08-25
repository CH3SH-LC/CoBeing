/**
 * Fiber：一个插件实例的作用域（参考 cordis fiber 语义，自研精简版）
 *
 * - 注册皆 effect：所有注册（服务/事件/副作用）都通过 effect 登记，卸载自动清理。
 * - 崩溃隔离：fiber 内 apply 抛错只影响该插件，不扩散到内核。
 */

import { EventBus } from './bus.js'

export class Fiber {
  private disposers: Array<() => void> = []
  private provided = new Map<string, unknown>()
  disposed = false

  constructor(
    private bus: EventBus,
    private services: Map<string, { value: unknown; owner: Fiber | null }>,
  ) {}

  /** 注册副作用（disposer），卸载时按逆序执行 */
  effect(disposer: () => void): void {
    this.disposers.push(disposer)
  }

  /** 监听事件（卸载自动移除） */
  on<T = unknown>(type: string, handler: (payload: T) => void): void {
    this.effect(this.bus.on(type, handler as Handler))
  }

  /** 发布事件 */
  emit(type: string, payload: unknown): void {
    this.bus.emit(type, payload)
  }

  /** 注册服务（重复注册抛错；卸载自动移除） */
  provide<T>(key: string, value: T): void {
    if (this.services.has(key)) {
      throw new Error(`service already provided: ${key}`)
    }
    this.services.set(key, { value, owner: this })
    this.effect(() => {
      const entry = this.services.get(key)
      if (entry && entry.owner === this) this.services.delete(key)
    })
  }

  /** 读取服务（可空；勿缓存跨 fiber 生命周期） */
  get<T>(key: string): T | undefined {
    const entry = this.services.get(key)
    return entry ? (entry.value as T) : undefined
  }

  /** 必得服务 */
  require<T>(key: string): T {
    const value = this.get<T>(key)
    if (value === undefined) throw new Error(`service not found: ${key}`)
    return value
  }

  /** 卸载：逆序执行全部 disposer */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // 单个 disposer 失败不阻止其余清理
      }
    }
  }
}

type Handler = (payload: unknown) => void
