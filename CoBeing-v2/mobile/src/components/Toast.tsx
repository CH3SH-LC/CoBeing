/**
 * 轻量 Toast（应用内横幅；系统级通知留二期 LocalNotifications）
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'

export interface ToastItem {
  id: number
  text: string
}

const ToastCtx = createContext<{ push: (text: string, durationMs?: number) => void }>({
  push: () => undefined,
})

export function useToast() {
  return useContext(ToastCtx)
}

let nextId = 1

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const push = useCallback((text: string, durationMs = 2500) => {
    const id = nextId++
    setItems((prev) => [...prev.slice(-2), { id, text }])
    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id))
      timers.current.delete(id)
    }, durationMs)
    timers.current.set(id, timer)
  }, [])

  return (
    <ToastCtx.Provider value={{ push }}>
      <div className="toast-wrap">
        {items.map((i) => (
          <div key={i.id} className="toast">
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
