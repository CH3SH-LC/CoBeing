/**
 * App 骨架：底部五 Tab（对话/群组/智能体/控制台/设置）+ 全局连接状态 + 通知横幅 + 实时同步
 *
 * 实时同步协议：内核广播 update 事件（scope=butler/group/groups/agents）→
 * 全局消费后写入 lastUpdate context → 各视图订阅按 scope 即时刷新（不依赖轮询）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { client, type ConnStatus } from './rpc'
import type { NotifyPayload, RemoteHello, UpdateScope } from './types'
import { getActiveProfile, updateActiveTunnelUrl } from './store'
import { ToastHost, useToast } from './components/Toast'
import { StatusBar } from './components/StatusBar'
import { ChatView } from './views/ChatView'
import { GroupsView } from './views/GroupsView'
import { AgentsView } from './views/AgentsView'
import { ConsoleView } from './views/ConsoleView'
import { SettingsView } from './views/SettingsView'

export interface AppState {
  status: ConnStatus
  hello: RemoteHello | null
  /** 最近一次 notify 文本（横幅用） */
  lastNotify: NotifyPayload | null
  /** 最近一次内核数据变更信号（实时同步协议）；视图按 scope 订阅刷新 */
  lastUpdate: { scope: UpdateScope; group?: string; kind?: string; ts: number } | null
  /** 手动重连当前配置 */
  reconnect: () => void
}

const AppStateCtx = createContext<AppState>({
  status: 'idle',
  hello: null,
  lastNotify: null,
  lastUpdate: null,
  reconnect: () => undefined,
})

export function useAppState(): AppState {
  return useContext(AppStateCtx)
}

const TABS = [
  { id: 'chat', label: '对话', icon: '💬' },
  { id: 'groups', label: '群组', icon: '👥' },
  { id: 'agents', label: '智能体', icon: '🤖' },
  { id: 'console', label: '控制台', icon: '🎛️' },
  { id: 'settings', label: '设置', icon: '⚙️' },
] as const

type TabId = (typeof TABS)[number]['id']

export function App() {
  const [tab, setTab] = useState<TabId>('chat')
  const [status, setStatus] = useState<ConnStatus>('idle')
  const [hello, setHello] = useState<RemoteHello | null>(null)
  const [lastNotify, setLastNotify] = useState<NotifyPayload | null>(null)
  const [lastUpdate, setLastUpdate] = useState<AppState['lastUpdate']>(null)
  const toast = useToast()
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const offStatus = client.onStatus((s, h) => {
      setStatus(s)
      setHello(h)
    })
    const offNotify = client.onNotify((n) => {
      if (n.type === 'update') {
        // 实时同步信号：写入 context 供各视图即时刷新（不弹横幅，避免打扰）
        setLastUpdate({ scope: n.scope, group: n.group, kind: n.kind, ts: Date.now() })
        return
      }
      if (n.type === 'confirm') {
        // 确认请求不弹横幅（在对话页渲染确认卡）
        setLastNotify(n)
        return
      }
      if (n.type === 'tunnel' && n.action === 'update' && n.url) {
        // 方案 v2：电脑自动构建公网隧道完成 → 保存到当前配置并作为候补地址
        const updated = updateActiveTunnelUrl(n.url)
        if (updated) {
          toast.push('公网连接已就绪，断开局域网也能连接', 3500)
          // 当前未连接时立即用新地址重连（局域网+公网交替）
          if (client.status !== 'connected') {
            client.connect(updated.url, updated.token, updated.tunnelUrl ? [updated.tunnelUrl] : [])
          }
        }
        return
      }
      if (n.type === 'pair') {
        toast.push(n.action === 'paired' ? `${n.deviceName} 已配对` : `${n.deviceName} 已撤销配对`, 3000)
        return
      }
      setLastNotify(n)
      // 系统提示 + 震动
      if (n.type === 'text') {
        toast.push(n.content, 4000)
        try {
          navigator.vibrate?.(120)
        } catch {
          // 无震动能力
        }
      }
    })
    const offHello = client.onHello((h) => setHello(h))
    // 启动时若已有配置则自动连接（公网隧道地址作为候补，断线自动交替）
    const profile = getActiveProfile()
    if (profile) {
      client.connect(profile.url, profile.token, profile.tunnelUrl ? [profile.tunnelUrl] : [])
    }
    return () => {
      offStatus()
      offNotify()
      offHello()
    }
  }, [toast])

  const reconnect = useCallback(() => {
    const profile = getActiveProfile()
    if (!profile) {
      toast.push('请先在设置中添加并选择服务器配置', 3000)
      return
    }
    client.connect(profile.url, profile.token, profile.tunnelUrl ? [profile.tunnelUrl] : [])
  }, [toast])

  const state = useMemo<AppState>(
    () => ({ status, hello, lastNotify, lastUpdate, reconnect }),
    [status, hello, lastNotify, lastUpdate, reconnect],
  )

  void notifiedRef

  return (
    <AppStateCtx.Provider value={state}>
      <div className="page">
        {(status === 'reconnecting' || status === 'error') && (
          <div className={`conn-banner ${status}`}>
            <span>{status === 'reconnecting' ? '📡 连接断开，正在重连…' : '⚠️ 连接失败'}</span>
            <button onClick={reconnect}>重连</button>
          </div>
        )}
        <StatusBar onTapSettings={() => setTab('settings')} />
        {tab === 'chat' && <ChatView />}
        {tab === 'groups' && <GroupsView />}
        {tab === 'agents' && <AgentsView />}
        {tab === 'console' && <ConsoleView />}
        {tab === 'settings' && <SettingsView />}
        <nav className="tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <span className="tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <ToastHost />
    </AppStateCtx.Provider>
  )
}
