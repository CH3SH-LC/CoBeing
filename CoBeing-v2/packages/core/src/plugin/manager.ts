/**
 * 插件定义与加载管理器（自研）
 *
 * - 插件 = { id, apply(fiber, config) }；apply 内注册皆 effect。
 * - 加载失败只影响该插件（fiber 已 dispose 清理半注册状态），不扩散。
 * - 热重载（基础版）：reload(id) = 卸载旧 fiber + 重新 apply；文件级 watch 为后续增强。
 */

import { EventBus } from './bus.js'
import { Fiber } from './fiber.js'

export interface PluginDef {
  id: string
  apply: (fiber: Fiber, config: unknown) => void
}

export interface LoadedPlugin {
  id: string
  fiber: Fiber
  def: PluginDef
  config: unknown
}

export class PluginManager {
  private bus = new EventBus()
  private services = new Map<string, { value: unknown; owner: Fiber | null }>()
  private loaded = new Map<string, LoadedPlugin>()

  /** 内核级服务注册（宿主面提供，先于插件加载） */
  provide<T>(key: string, value: T): () => void {
    if (this.services.has(key)) throw new Error(`service already provided: ${key}`)
    this.services.set(key, { value, owner: null })
    return () => {
      const entry = this.services.get(key)
      if (entry && entry.owner === null) this.services.delete(key)
    }
  }

  /** 插件可读取内核服务 */
  requireService<T>(key: string): T {
    const entry = this.services.get(key)
    if (!entry) throw new Error(`service not found: ${key}`)
    return entry.value as T
  }

  getService<T>(key: string): T | undefined {
    const entry = this.services.get(key)
    return entry ? (entry.value as T) : undefined
  }

  /** 加载插件（重复 id 抛错）；失败自动回滚该 fiber 全部注册 */
  load(def: PluginDef, config: unknown = {}): LoadedPlugin {
    if (this.loaded.has(def.id)) throw new Error(`plugin already loaded: ${def.id}`)
    const fiber = new Fiber(this.bus, this.services)
    try {
      def.apply(fiber, config)
    } catch (error) {
      fiber.dispose()
      throw new Error(`plugin failed to apply: ${def.id}: ${String(error)}`)
    }
    const loaded: LoadedPlugin = { id: def.id, fiber, def, config }
    this.loaded.set(def.id, loaded)
    return loaded
  }

  /** 卸载插件 */
  unload(id: string): void {
    const loaded = this.loaded.get(id)
    if (!loaded) return
    this.loaded.delete(id)
    loaded.fiber.dispose()
  }

  /** 热重载：卸载 + 重新加载（保留 config） */
  reload(id: string): LoadedPlugin {
    const loaded = this.loaded.get(id)
    if (!loaded) throw new Error(`plugin not loaded: ${id}`)
    const { def, config } = loaded
    this.unload(id)
    return this.load(def, config)
  }

  /** 触发内核事件（跨 fiber） */
  emit(type: string, payload: unknown): void {
    this.bus.emit(type, payload)
  }

  /** 插件侧事件监听（经 Fiber）由 load 内 apply 完成；此处提供根监听（宿主面用） */
  on(type: string, handler: (payload: unknown) => void): () => void {
    return this.bus.on(type, handler)
  }

  list(): LoadedPlugin[] {
    return [...this.loaded.values()]
  }

  disposeAll(): void {
    for (const id of [...this.loaded.keys()]) this.unload(id)
  }
}
