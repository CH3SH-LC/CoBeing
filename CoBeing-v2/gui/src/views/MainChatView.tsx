import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, onKernelNotify } from '../rpc'
import type { ConversationInfo, NotifyPayload, ProjectionDto } from '../types'
import { MessageList } from '../components/MessageList'

/**
 * 主对话窗口（唯一非群组特例）：但丁管家 + 会话管理 + 通知流 + ask-user 确认卡片
 *
 * - 会话管理：主窗口非无限流——「新对话」归档当前会话为历史（完整事件保留，可回看），
 *   重建空会话；历史会话列表只读查看；上下文进度（估算 token / 归档阈值）实时可见。
 */
export function MainChatView() {
  const [proj, setProj] = useState<ProjectionDto | null>(null)
  const [text, setText] = useState('')
  const [notifies, setNotifies] = useState<NotifyPayload[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  /** 2.0.14：铃音思考中——发送后直到看到但丁新回复（seq > 记录点）才清除 */
  const [thinkingUntil, setThinkingUntil] = useState<number | null>(null)
  const [convs, setConvs] = useState<ConversationInfo[]>([])
  const [viewingConv, setViewingConv] = useState<ConversationInfo | null>(null)
  const [histProj, setHistProj] = useState<ProjectionDto | null>(null)
  const [confirmNewConv, setConfirmNewConv] = useState(false)
  const [confirmResume, setConfirmResume] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const p = await rpc.butlerProjection()
      setProj(p)
      // 2.0.14：见到 butler 新回复（seq > 记录点）即清除"思考中"
      if (thinkingUntil !== null) {
        const hasButlerReply = p.publicMessages.some((m) => m.actor === 'butler' && m.seq > thinkingUntil)
        if (hasButlerReply) setThinkingUntil(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [thinkingUntil])

  const loadConvs = useCallback(async () => {
    try {
      setConvs(await rpc.listButlerConversations())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    void loadConvs()
    const timer = setInterval(() => {
      void refresh()
      void loadConvs()
    }, 2000)
    let unlisten: (() => void) | undefined
    void onKernelNotify((n) => {
      setNotifies((prev) => [...prev.slice(-19), n])
      void refresh()
      void loadConvs()
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      clearInterval(timer)
      unlisten?.()
    }
  }, [refresh, loadConvs])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [proj?.publicMessages.length, notifies.length, viewingConv, histProj?.publicMessages.length])

  const send = async () => {
    const content = text.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    try {
      // 2.0.14：记录当前最后 seq → 铃音思考中，直到但丁在它之后发言
      setThinkingUntil(proj?.publicMessages.at(-1)?.seq ?? 0)
      await rpc.mainWindowSpeak(content)
      setText('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  /** 开启新对话：两段确认（第一次点击进入确认态，第二次执行；避免原生弹窗） */
  const startNewConversation = async () => {
    if (!confirmNewConv) {
      setConfirmNewConv(true)
      return
    }
    setConfirmNewConv(false)
    setError('')
    try {
      await rpc.newButlerConversation()
      setNotifies([])
      setProj(null)
      setHistProj(null)
      setViewingConv(null)
      await refresh()
      await loadConvs()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 恢复历史会话为当前会话（2.0.8）：两段确认；当前会话先自动归档 */
  const resumeConversation = async () => {
    if (!viewingConv) return
    if (!confirmResume) {
      setConfirmResume(true)
      return
    }
    setConfirmResume(false)
    setError('')
    try {
      await rpc.resumeButlerConversation(viewingConv.id)
      setNotifies([])
      setProj(null)
      setHistProj(null)
      setViewingConv(null)
      await refresh()
      await loadConvs()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 会话切换：历史 → 只读查看；当前 → 返回 */
  const openConversation = async (conv: ConversationInfo) => {
    if (conv.current) {
      setViewingConv(null)
      return
    }
    try {      const p = await rpc.butlerConversationProjection(conv.id)
      setHistProj(p)
      setViewingConv(conv)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 确认卡片选项点击：
   *  - approval 卡（管家 create-agent 发起待批准创建智能体）：批准→confirmAgent，拒绝→rejectAgentApproval（直接 RPC，不回传管家）
   *  - 普通 ask-user 卡：答复文本回传主对话（管家下一轮看到选择并执行） */
  const answerConfirm = async (payload: Extract<NotifyPayload, { type: 'confirm' }>, optionId: string) => {
    try {
      if (payload.approval) {
        if (optionId === 'approve') await rpc.confirmAgent(payload.approval.name)
        else await rpc.rejectAgentApproval(payload.approval.name)
      } else {
        const label = payload.options.find((o) => o.id === optionId)?.label ?? optionId
        await rpc.mainWindowSpeak(`【确认答复】${label}`)
      }
      setNotifies((prev) => prev.filter((n) => n !== payload))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const messages = viewingConv ? (histProj?.publicMessages ?? []) : (proj?.publicMessages ?? [])
  const confirms = notifies.filter((n) => n.type === 'confirm')
  const context = proj?.context

  return (
    <>
      {/* 左卡片：主对话信息 + 会话列表 + 管家通知流 + 确认卡片 */}
      <aside className="card card-list">
        <div className="card-title">
          <h2>主对话</h2>
          <span className="spacer" />
          <span className="badge">{messages.length}</span>
        </div>
        <div className="card-body">
          <div className="form-field" style={{ marginBottom: 16 }}>
            <span className="hint">主对话是唯一非群组特例：与铃音（管家）直接对话，工作事务会转交群组。上下文达阈值自动压缩；「新对话」归档当前会话为历史并开启空会话。</span>
          </div>
          <div className="form-field">
            <label>会话（新对话窗口）</label>
            <div className="conv-list">
              {convs.map((c) => (
                <button
                  key={c.id}
                  data-testid={`conv-${c.id}`}
                  className={`conv-item ${viewingConv?.id === c.id ? 'active' : ''}`}
                  onClick={() => void openConversation(c)}
                  title={c.firstUserMessage ? `首条：${c.firstUserMessage}` : undefined}
                >
                  <span className="conv-name">
                    {c.current ? '当前会话' : `历史会话 ${formatTime(c.archivedAt ?? c.createdAt)}`}
                  </span>
                  <span className="badge">{c.messageCount}</span>
                </button>
              ))}
              {convs.length === 0 && <span className="hint">暂无会话</span>}
            </div>
          </div>
          {confirms.map((n) => (
            <div key={n.id} className="confirm-card">
              <div className="confirm-question">{n.question}</div>
              <div className="confirm-options">
                {n.options.map((opt) => (
                  <button key={opt.id} className="btn small" onClick={() => void answerConfirm(n, opt.id)}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {proj && proj.compactions.length > 0 && (
            <div className="form-field" style={{ marginBottom: 16 }}>
              <label>归档压缩</label>
              {proj.compactions.slice(-3).map((c) => (
                <div key={c.start} className="notify-item">
                  [{c.start}..{c.end}] {c.summary}
                </div>
              ))}
            </div>
          )}
          <div className="form-field">
            <label>管家通知</label>
            <div className="notify-list">
              {notifies.filter((n) => n.type === 'text').length === 0 && <span className="hint">暂无通知</span>}
              {notifies
                .filter((n) => n.type === 'text')
                .map((n, i) => (
                  <div key={i} className="notify-item">
                    {n.content}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </aside>

      {/* 标题卡片 */}
      <div style={{ display: 'none' }} />

      {/* 主体对话卡片 */}
      <section className="card card-chat">
        <div className="card-title">
          <h2>{viewingConv ? `历史会话 ${viewingConv.id}` : '主对话 · 铃音'}</h2>
          <span className="spacer" />
          {!viewingConv && context && context.thresholdTokens > 0 && (
            <span className="badge" title="自动压缩阈值：上下文估算达到后归档记忆并压缩">
              上下文 {formatTokens(context.estimatedTokens)} / {formatTokens(context.thresholdTokens)}
            </span>
          )}
          {viewingConv ? (
            <>
              {confirmResume && (
                <button className="btn small text" onClick={() => setConfirmResume(false)}>
                  取消
                </button>
              )}
              <button
                className={`btn small ${confirmResume ? 'primary' : ''}`}
                onClick={() => void resumeConversation()}
                title="恢复此历史会话为当前会话并继续对话（当前会话将先自动归档）"
              >
                {confirmResume ? '确认恢复？' : '恢复此会话'}
              </button>
              <button className="btn small" onClick={() => setViewingConv(null)}>
                ← 返回当前会话
              </button>
            </>
          ) : (
            <>
              {confirmNewConv && (
                <button className="btn small text" onClick={() => setConfirmNewConv(false)}>
                  取消
                </button>
              )}
              <button className={`btn small ${confirmNewConv ? 'danger' : ''}`} onClick={() => void startNewConversation()} title="归档当前对话为历史会话，开启全新对话（旧会话可回看）">
                {confirmNewConv ? '确认开启？' : '新对话'}
              </button>
            </>
          )}
          {error && <span className="badge danger">{error}</span>}
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          <MessageList messages={messages} actorKind={(a) => (a === 'user' ? 'user' : 'butler')} />
          {!viewingConv && thinkingUntil !== null && (
            <div className="msg butler">
              <div className="typing-dots" aria-label="铃音思考中">
                <span />
                <span />
                <span />
              </div>
              <span className="typing-label">铃音思考中…</span>
            </div>
          )}
        </div>
        <div className="chat-input-wrap">
          {viewingConv ? (
            <div className="input-row">
              <span className="hint">历史会话只读查看；「恢复此会话」可回到该会话继续对话（当前会话先自动归档）</span>
              <button className="btn" onClick={() => setViewingConv(null)}>
                返回当前会话
              </button>
            </div>
          ) : (
            <div className="input-row">
              <textarea
                rows={2}
                placeholder="对铃音说话…（工作类事务会由管家分析并转交群组）"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button className="btn primary" onClick={() => void send()} disabled={sending || !text.trim()}>
                发送
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  )
}

/** 时间短格式：MM-dd HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** token 千分格式：12345 → 12.3k */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}
