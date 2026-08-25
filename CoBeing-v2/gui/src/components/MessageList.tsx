import type { PublicMessage } from '../types'

export type ActorKind = 'user' | 'butler' | 'agent'

interface MessageListProps {
  messages: PublicMessage[]
  actorKind: (actor: string) => ActorKind
}

function avatarText(actor: string): string {
  if (actor === 'user') return '我'
  if (actor === 'butler') return '丁'
  return actor.slice(0, 1).toUpperCase()
}

/** 消息气泡列表（用户右 / 智能体左；气泡色随角色走主题 token） */
export function MessageList({ messages, actorKind }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-hint">
        还没有消息
        <br />
        从下方输入框开始与但丁对话
      </div>
    )
  }
  return (
    <>
      {messages.map((m) => {
        const kind = actorKind(m.actor)
        const rowClass = kind === 'user' ? 'user' : kind === 'butler' ? 'butler' : 'agent'
        return (
          <div key={m.seq} className={`msg-row ${rowClass}`}>
            <div className="avatar">{avatarText(m.actor)}</div>
            <div
              className="msg-col"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, maxWidth: '68%' }}
            >
              <div className="msg-meta">
                <span>{m.actor === 'user' ? '我' : m.actor}</span>
                {m.task && <span className="msg-tag">任务：{m.task}</span>}
                {m.mention && m.mention.length > 0 && (
                  <span className="msg-tag">@ {m.mention.join(', ')}</span>
                )}
                <span>#{m.seq}</span>
              </div>
              <div className="msg-bubble">{m.content}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}
