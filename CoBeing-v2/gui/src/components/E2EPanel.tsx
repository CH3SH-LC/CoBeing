import { useEffect, useRef, useState } from 'react'
import { runE2E, type E2EStep } from '../e2e'

/** E2E 自检面板：URL hash 含 #e2e 或 VITE_E2E=1 时启用（阶段 4 真实验证入口，非产品功能） */
export function E2EPanel() {
  const [enabled] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.location.hash.includes('e2e') || import.meta.env.VITE_E2E === '1'),
  )
  const [steps, setSteps] = useState<E2EStep[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState<boolean | null>(null)
  const autoStarted = useRef(false)

  if (!enabled) return null

  const start = async () => {
    setRunning(true)
    setDone(null)
    setSteps([])
    const ok = await runE2E((index, step) => {
      setSteps((prev) => {
        const next = [...prev]
        next[index] = step
        return next
      })
    })
    setDone(ok)
    setRunning(false)
  }

  // VITE_E2E=1 时自动运行（外部驱动真实验证用）
  useEffect(() => {
    if (import.meta.env.VITE_E2E === '1' && !autoStarted.current) {
      autoStarted.current = true
      void start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="e2e-panel">
      <h4>E2E 自检 {done === null ? '' : done ? '— ✅ 全部通过' : '— ❌ 存在失败'}</h4>
      {steps.map((s, i) => (
        <div key={i} className={`e2e-step ${s.state === 'pass' ? 'pass' : s.state === 'fail' ? 'fail' : ''}`}>
          <span className="state">{s.state === 'pass' ? '✅' : s.state === 'fail' ? '❌' : s.state === 'running' ? '…' : '·'}</span>
          <span>
            {s.name}
            {s.detail && <div className="detail">{s.detail}</div>}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 12 }}>
        <button className="btn primary small" onClick={() => void start()} disabled={running}>
          {running ? '运行中…' : done === null ? '开始自检' : '重新自检'}
        </button>
      </div>
    </div>
  )
}
