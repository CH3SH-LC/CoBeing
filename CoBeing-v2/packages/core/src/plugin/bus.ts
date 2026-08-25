/**
 * 事件总线（内核级，跨 fiber 可见）
 * 观察者失败被隔离（不影响其他监听者与发布者）。
 */

type Handler = (payload: unknown) => void

export class EventBus {
  private listeners = new Map<string, Set<Handler>>()

  /** 返回 disposer */
  on(type: string, handler: Handler): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler)
    return () => {
      const s = this.listeners.get(type)
      if (!s) return
      s.delete(handler)
      if (s.size === 0) this.listeners.delete(type)
    }
  }

  emit(type: string, payload: unknown): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const handler of [...set]) {
      try {
        handler(payload)
      } catch {
        // 观察者失败被隔离：记录由上层日志服务负责，不扩散
      }
    }
  }
}
