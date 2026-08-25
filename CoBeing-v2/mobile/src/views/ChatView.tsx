/**
 * 对话视图：但丁主窗口投影 + 发送 + 会话管理（新对话/历史回看）+ 确认卡
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../rpc'
import { useAppState } from '../App'
import { useToast } from '../components/Toast'
import { MessageList } from '../components/MessageList'
import type { ConversationInfo, NotifyPayload, ProjectionDto } from '../types'

export function ChatView() {
  const { status, lastUpdate } = useAppState()
  const toast = useToast()
  const [projection, setProjection] = useState<ProjectionDto | null>(null)
  const [conversations, setConversations] = useState<ConversationInfo[]>([])
  const [currentId, setCurrentId] = useState<string>('current')
  const [confirm, setConfirm] = useState<NotifyPayload | null>(null)
  const [text, setText] = useState('')
  const [showConvList, setShowConvList] = useState(false)
  const [confirmingNew, setConfirmingNew] = useState(false)
  const [viewing, setViewing] = useState<ConversationInfo | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const proj = await client.butlerConversationProjection(currentId)
      setProjection(proj)
    } catch (error) {
      if (status === 'connected') {
        toast.push(`投影加载失败：${error instanceof Error ? error.message : String(error)}`, 3000)
      }
    }
  }, [currentId, status, toast])

  useEffect(() => {
    if (status !== 'connected') {
      setProjection(null)
      return
    }
    void refresh()
    pollRef.current = setInterval(() => void refresh(), 3000)
    const offNotify = client.onNotify((n) => {
      if (n.type === 'confirm') setConfirm(n)
    })
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      offNotify()
    }
  }, [status, refresh])

  // 实时同步：但丁回复/新消息广播 → 立即刷新（不等待 3s 轮询）
  useEffect(() => {
    if (status === 'connected' && lastUpdate?.scope === 'butler') {
      void refresh()
    }
  }, [lastUpdate, status, refresh])

  useEffect(() => {
    if (status !== 'connected') return
    void client
      .listButlerConversations()
      .then(setConversations)
      .catch(() => undefined)
  }, [status, currentId])

  // 新消息自动滚底（用户上滑时暂停）
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [projection])

  const send = async () => {
    const content = text.trim()
    if (!content) return
    setText('')
    try {
      await client.mainWindowSpeak(content)
      void refresh()
    } catch (error) {
      toast.push(`发送失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const newConversation = async () => {
    if (!confirmingNew) {
      setConfirmingNew(true)
      return
    }
    setConfirmingNew(false)
    try {
      const result = await client.newButlerConversation()
      setCurrentId('current')
      setConversations(await client.listButlerConversations())
      toast.push(`已开启新对话（${result.id}）`)
      void refresh()
    } catch (error) {
      toast.push(`新对话失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const openConversation = async (conv: ConversationInfo) => {
    if (conv.current) {
      setCurrentId('current')
    } else {
      setViewing(conv)
      setCurrentId(conv.id)
    }
    setShowConvList(false)
  }

  const backToCurrent = () => {
    setViewing(null)
    setCurrentId('current')
  }

  const ctx = projection?.context
  const contextText = ctx ? `${(ctx.estimatedTokens / 1000).toFixed(1)}k / ${(ctx.thresholdTokens / 1000).toFixed(1)}k` : ''

  return (
    <div className="page">
      <div className="topbar" style={{ padding: '6px 10px' }}>
        <button className="btn ghost small" onClick={() => setShowConvList((v) => !v)}>
          {viewing ? `历史：${viewing.firstUserMessage?.slice(0, 10) ?? viewing.id}` : '会话'}
        </button>
        <div className="title" style={{ fontSize: 13, fontWeight: 600 }}>
          {viewing ? '历史会话（只读）' : '与但丁对话'}
          {contextText && <span className="sub" style={{ marginLeft: 6 }}>上下文 {contextText}</span>}
        </div>
        {viewing ? (
          <button className="btn small secondary" onClick={backToCurrent}>
            返回当前
          </button>
        ) : (
          <button className={`btn small ${confirmingNew ? 'danger' : 'ghost'}`} onClick={() => void newConversation()}>
            {confirmingNew ? '再点确认' : '新对话'}
          </button>
        )}
      </div>

      {showConvList && (
        <div className="card" style={{ margin: 8 }}>
          {conversations.map((c) => (
            <div key={c.id} className="row">
              <div className="grow">
                <div className="title">
                  {c.current ? '📌 当前会话' : `🗂 ${c.firstUserMessage?.slice(0, 18) ?? c.id}`}
                </div>
                <div className="sub">
                  {new Date(c.createdAt).toLocaleString()} · {c.messageCount} 条
                  {c.archivedAt ? ` · ${new Date(c.archivedAt).toLocaleString()} 归档` : ''}
                </div>
              </div>
              <button className="btn small secondary" onClick={() => void openConversation(c)}>
                打开
              </button>
            </div>
          ))}
          {conversations.length === 0 && <div className="empty">暂无会话</div>}
        </div>
      )}

      <div className="page-body" ref={bodyRef} style={{ paddingBottom: 90 }}>
        <MessageList projection={projection} confirm={confirm} />
      </div>

      {!viewing && (
        <div className="composer">
          <textarea
            rows={1}
            placeholder="给但丁发消息…（Enter 发送）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button className="btn" disabled={!text.trim() || status !== 'connected'} onClick={() => void send()}>
            发送
          </button>
        </div>
      )}
    </div>
  )
}
