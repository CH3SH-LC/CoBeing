/**
 * 消息列表（投影渲染：公共消息 + 压缩摘要 + 确认卡）
 *
 * - 头像：角色首字 + 确定性配色（user 用主题色，其余按名字哈希取色）
 * - 日期分隔：今天 / 昨天 / M月D日（跨天显示）
 * - 时间戳：每条消息 HH:MM
 * - 骨架屏：投影未就绪（加载中）时显示 shimmer 占位
 */

import type { NotifyPayload, ProjectionDto } from '../types'
import { useToast } from './Toast'
import { client } from '../rpc'

const AVATAR_COLORS = [
  '#f76c8e', // 樱花粉
  '#4cc9b0', // 薄荷
  '#8b9cf7', // 淡紫
  '#f2a65a', // 蜜橘
  '#5aa9e6', // 天蓝
  '#c08be0', // 香芋
  '#6bcb77', // 草绿
  '#e0708f', // 玫瑰
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

function avatarText(actor: string): string {
  if (actor === 'user') return '我'
  if (actor === 'butler') return '丁'
  return actor.slice(0, 1).toUpperCase()
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return '今天'
  if (sameDay(d, yesterday)) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function clock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 骨架屏（投影加载中） */
export function MessageSkeleton() {
  return (
    <div aria-label="加载中" role="status">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-msg" style={{ flexDirection: i % 2 === 0 ? 'row' : 'row-reverse' }}>
          <div className="sk-circle" />
          <div className="sk-lines">
            <div className="sk-line" style={{ width: i % 2 === 0 ? '62%' : '78%' }} />
            <div className="sk-line" style={{ width: i % 2 === 0 ? '38%' : '52%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MessageList({ projection, confirm }: { projection: ProjectionDto | null; confirm: NotifyPayload | null }) {
  const toast = useToast()
  if (!projection) {
    return <MessageSkeleton />
  }

  const replyConfirm = async (label: string) => {
    try {
      await client.mainWindowSpeak(`【确认答复】${label}`)
      toast.push(`已答复：${label}`)
    } catch (error) {
      toast.push(`答复失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const messages = projection.publicMessages
  // 跨天分组：记录每条消息所属"日"的边界
  const days: Array<{ label: string; ts: number; indexes: number[] }> = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    const label = dayLabel(m.ts ?? Date.now())
    const last = days.at(-1)
    if (last && last.label === label) last.indexes.push(i)
    else days.push({ label, ts: m.ts ?? Date.now(), indexes: [i] })
  }

  return (
    <div>
      {projection.compactions.map((c, i) => (
        <div key={`comp-${i}`} className="msg system">
          <div className="bubble">📦 压缩摘要：{c.summary}</div>
        </div>
      ))}
      {days.length === 0 && (
        <div className="empty">
          <div className="big">💬</div>
          暂无消息
        </div>
      )}
      {days.map((day) => (
        <div key={`day-${day.ts}`}>
          <div className="day-sep">{day.label}</div>
          {day.indexes.map((idx) => {
            const m = messages[idx]!
            const isUser = m.actor === 'user'
            return (
              <div key={m.seq} className={`msg ${isUser ? 'user' : 'other'}`}>
                <div className="avatar" style={{ background: isUser ? 'var(--accent-strong)' : avatarColor(m.actor) }}>
                  {avatarText(m.actor)}
                </div>
                <div className="msg-col">
                  <div className="meta">
                    {isUser ? '我' : m.actor}
                    {m.mention?.length ? ` @${m.mention.join('@')}` : ''}
                    <span className="time">{clock(m.ts ?? Date.now())}</span>
                  </div>
                  <div className="bubble">{m.content}</div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
      {confirm?.type === 'confirm' && (
        <div className="confirm-card">
          <div className="q">❓ {confirm.question}</div>
          <div className="opts">
            {confirm.options.map((o) => (
              <button key={o.id} className="btn small" onClick={() => replyConfirm(o.label)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
