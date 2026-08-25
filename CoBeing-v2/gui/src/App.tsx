import { useCallback, useEffect, useMemo, useState, createContext, useContext } from 'react'
import { rpc, onKernelExited, onKernelNotify } from './rpc'
import type { AgentDef, NotifyPayload } from './types'
import { MainChatView } from './views/MainChatView'
import { GroupsView } from './views/GroupsView'
import { AgentsView } from './views/AgentsView'
import { E2EPanel } from './components/E2EPanel'

type View = 'chat' | 'groups' | 'agents'

/** 内核数据变更信号（实时同步）：视图订阅后按 scope 刷新对应数据，不依赖轮询 */
export interface KernelUpdate {
  scope: 'butler' | 'group' | 'groups' | 'agents'
  group?: string
  kind?: string
  ts: number
}

const KernelUpdateCtx = createContext<KernelUpdate | null>(null)

/** 订阅最近一次内核数据变更信号（实时同步协议）；null=尚未收到 */
export function useKernelUpdate(): KernelUpdate | null {
  return useContext(KernelUpdateCtx)
}

export default function App() {
  const [view, setView] = useState<View>('chat')
  const [kernelAlive, setKernelAlive] = useState<boolean | null>(null)
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [update, setUpdate] = useState<KernelUpdate | null>(null)

  const checkKernel = useCallback(async () => {
    try {
      const alive = await rpc.getKernelStatus()
      setKernelAlive(alive)
    } catch {
      setKernelAlive(false)
    }
  }, [])

  useEffect(() => {
    void checkKernel()
    const timer = setInterval(() => void checkKernel(), 5000)
    let unlisten: (() => void) | undefined
    void onKernelExited(() => setKernelAlive(false)).then((fn) => {
      unlisten = fn
    })
    // 全局订阅内核数据变更：不随视图切换卸载——手机/电脑任一端变更，另一端实时感知
    let unlistenNotify: (() => void) | undefined
    void onKernelNotify((n: NotifyPayload) => {
      if (n.type === 'update') {
        setUpdate({ scope: n.scope, group: n.group, kind: n.kind, ts: Date.now() })
      }
    }).then((fn) => {
      unlistenNotify = fn
    })
    return () => {
      clearInterval(timer)
      unlisten?.()
      unlistenNotify?.()
    }
  }, [checkKernel])

  // 智能体名录（群组视图成员选择用）
  useEffect(() => {
    const tick = async () => {
      try {
        setAgents(await rpc.listAgents())
      } catch {
        /* 内核未就绪时静默 */
      }
    }
    void tick()
    const timer = setInterval(tick, 4000)
    return () => clearInterval(timer)
  }, [])

  const updateValue = useMemo(() => update, [update])

  return (
    <KernelUpdateCtx.Provider value={updateValue}>
      <div className="app">
        <header className="topbar">
          <div className="topbar-title">CoBeing v2</div>
          <nav className="topbar-nav">
            <button className={`nav-item ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
              主对话
            </button>
            <button className={`nav-item ${view === 'groups' ? 'active' : ''}`} onClick={() => setView('groups')}>
              群组
            </button>
            <button className={`nav-item ${view === 'agents' ? 'active' : ''}`} onClick={() => setView('agents')}>
              智能体
            </button>
          </nav>
          <div className="kernel-status">
            <span className={`status-dot ${kernelAlive === false ? 'offline' : ''}`} />
            {kernelAlive === null ? '内核连接中…' : kernelAlive ? '内核在线' : '内核离线'}
          </div>
        </header>
        <main className="main">
          {view === 'chat' && <MainChatView />}
          {view === 'groups' && <GroupsView agents={agents} />}
          {view === 'agents' && <AgentsView />}
        </main>
        <E2EPanel />
      </div>
    </KernelUpdateCtx.Provider>
  )
}
