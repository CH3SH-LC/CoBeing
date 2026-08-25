/**
 * 顶部连接状态胶囊（绿=已连/黄=重连中/红=断开）；点击进设置
 */

import { useAppState } from '../App'

const LABEL: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  reconnecting: '重连中…',
  error: '连接失败',
}

export function StatusBar({ onTapSettings }: { onTapSettings: () => void }) {
  const { status, hello } = useAppState()
  const cls = status === 'connected' ? 'connected' : status === 'reconnecting' || status === 'connecting' ? 'reconnecting' : status === 'error' ? 'error' : ''
  const sub = hello ? `${hello.name} v${hello.version}` : ''
  return (
    <div className="topbar">
      <div className="title">CoBeing</div>
      <button className={`status-pill ${cls}`} onClick={onTapSettings} title={sub}>
        <span className="dot" />
        <span>{LABEL[status] ?? status}</span>
      </button>
    </div>
  )
}
