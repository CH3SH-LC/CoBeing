import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc } from '../rpc'
import { useKernelUpdate } from '../App'
import type { AgentDef, GroupMeta, GroupStatus, ProjectionDto } from '../types'
import { MessageList } from '../components/MessageList'
import { Modal } from '../components/Modal'

/** 成员标签显示名（协议标识 user/butler → 用户可见；其余原样） */
function memberLabel(m: string): string {
  if (m === 'user') return '用户'
  if (m === 'butler') return '铃音'
  return m
}

interface GroupsViewProps {
  agents: AgentDef[]
}

/** 群组窗口：群组列表 + 群内对话（成员 / 发言 / 任务说明展示） */
export function GroupsView({ agents }: GroupsViewProps) {
  const [groups, setGroups] = useState<GroupMeta[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [proj, setProj] = useState<ProjectionDto | null>(null)
  const [status, setStatus] = useState<GroupStatus | null>(null)
  const [text, setText] = useState('')
  const [task, setTask] = useState('')
  const [mention, setMention] = useState<string[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createMembers, setCreateMembers] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const refreshGroups = useCallback(async () => {
    try {
      setGroups(await rpc.listGroups())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshProjection = useCallback(async (name: string) => {
    try {
      setProj(await rpc.groupProjection(name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshStatus = useCallback(async (name: string) => {
    try {
      setStatus(await rpc.groupStatus(name))
    } catch {
      // 群可能已归档
    }
  }, [])

  useEffect(() => {
    void refreshGroups()
    const timer = setInterval(() => void refreshGroups(), 3000)
    return () => clearInterval(timer)
  }, [refreshGroups])

  // 实时同步：内核变更广播（groups 域 → 列表刷新；group 域 → 当前群投影刷新）
  const kernelUpdate = useKernelUpdate()
  useEffect(() => {
    if (!kernelUpdate) return
    if (kernelUpdate.scope === 'groups') {
      void refreshGroups()
    } else if (kernelUpdate.scope === 'group' && selected && kernelUpdate.group === selected) {
      void refreshProjection(selected)
    }
  }, [kernelUpdate, refreshGroups, refreshProjection, selected])

  useEffect(() => {
    if (!selected) {
      setProj(null)
      setStatus(null)
      return
    }
    void refreshProjection(selected)
    void refreshStatus(selected)
    const timer = setInterval(() => {
      void refreshProjection(selected)
      void refreshStatus(selected)
    }, 2000)
    return () => clearInterval(timer)
  }, [selected, refreshProjection, refreshStatus])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [proj?.publicMessages.length])

  const selectedMeta = groups.find((g) => g.name === selected) ?? null
  const workAgents = agents.filter((a) => a.name !== 'butler')

  const send = async () => {
    const content = text.trim()
    if (!selected || !content || sending) return
    setSending(true)
    setError('')
    try {
      await rpc.speakToGroup(selected, 'user', content, { mention, task: task.trim() || undefined })
      setText('')
      setTask('')
      setMention([])
      await refreshProjection(selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const createGroup = async () => {
    const name = createName.trim()
    if (!name) return
    try {
      const members = ['user', 'butler', ...createMembers.filter((m) => m !== 'user' && m !== 'butler')]
      const created = await rpc.createGroup(name, members)
      setShowCreate(false)
      setCreateName('')
      setCreateMembers([])
      setSelected(created.name)
      await refreshGroups()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const archiveGroup = async () => {
    if (!selected) return
    try {
      await rpc.archiveGroup(selected)
      setShowArchive(false)
      setSelected(null)
      await refreshGroups()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleMention = (name: string) => {
    setMention((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]))
  }

  const messages = proj?.publicMessages ?? []

  return (
    <>
      {/* 左卡片：群组列表 */}
      <aside className="card card-list">
        <div className="card-title">
          <h2>群组</h2>
          <span className="spacer" />
          <span className="badge">{groups.length}</span>
          <button className="btn small" onClick={() => setShowCreate(true)}>
            新建
          </button>
        </div>
        <div className="card-body">
          {groups.length === 0 && <div className="empty-hint">暂无群组</div>}
          {groups.map((g) => (
            <div
              key={g.name}
              className={`list-item ${selected === g.name ? 'active' : ''}`}
              onClick={() => setSelected(g.name)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-item-title">{g.name}</div>
                <div className="list-item-sub">{g.label.map(memberLabel).join(' · ')}</div>
              </div>
              <span className={`badge ${g.status === 'working' ? 'success' : ''}`}>{g.status}</span>
            </div>
          ))}
        </div>
      </aside>

      {selectedMeta ? (
        <>
          {/* 标题卡片：群组信息 */}
          <div className="card card-detail" style={{ flex: 'none', width: 260 }}>
            <div className="card-title">
              <h2>{selectedMeta.name}</h2>
              <span className="spacer" />
              <span className={`badge ${selectedMeta.status === 'working' ? 'success' : ''}`}>
                {selectedMeta.status}
              </span>
            </div>
            <div className="card-body">
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>成员（label ≥ 3）</label>
                <div className="mention-row">
                  {selectedMeta.label.map((m) => {
                    const member = status?.members.find((s) => s.name === m)
                    return (
                      <span key={m} className={`chip on ${member?.busy ? 'chip-busy' : ''}`} style={{ cursor: 'default' }}>
                        {member?.busy ? '⏳ ' : ''}
                        {memberLabel(m)}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>工作空间</label>
                <span className="hint" style={{ wordBreak: 'break-all' }}>
                  {selectedMeta.space}
                </span>
              </div>
              {status?.lastActivity && (
                <div className="form-field" style={{ marginBottom: 14 }}>
                  <label>最近活动</label>
                  <span className="hint">{new Date(status.lastActivity).toLocaleTimeString()}</span>
                </div>
              )}
              {(selectedMeta.taskSummary || status?.taskSummary) && (
                <div className="form-field" style={{ marginBottom: 14 }}>
                  <label>任务摘要</label>
                  <span className="hint">{status?.taskSummary ?? selectedMeta.taskSummary}</span>
                </div>
              )}
              <button className="btn danger" onClick={() => setShowArchive(true)} disabled={selectedMeta.status !== 'working'}>
                归档群组
              </button>
            </div>
          </div>

          {/* 主体对话卡片 */}
          <section className="card card-chat">
            <div className="card-title">
              <h2>{selectedMeta.name}</h2>
              <span className="spacer" />
              {error && <span className="badge danger">{error}</span>}
            </div>
            <div className="chat-scroll" ref={scrollRef}>
              <MessageList messages={messages} actorKind={(a) => (a === 'user' ? 'user' : a === 'butler' ? 'butler' : 'agent')} />
            </div>
            <div className="chat-input-wrap">
              <div className="mention-row">
                <span className="hint">@ 唤醒：</span>
                <span className={`chip ${mention.includes('@all') ? 'on' : ''}`} onClick={() => toggleMention('@all')}>
                  @all
                </span>
                {selectedMeta.label
                  .filter((m) => m !== 'user')
                  .map((m) => (
                    <span key={m} className={`chip ${mention.includes(m) ? 'on' : ''}`} onClick={() => toggleMention(m)}>
                      @{memberLabel(m)}
                    </span>
                  ))}
              </div>
              {mention.length === 0 && (
                <div className="hint" style={{ marginBottom: 4 }}>
                  未选 @ 成员 → 发言将唤醒全部工作智能体（默认 @all）
                </div>
              )}
              <input
                placeholder="任务说明（唤醒纪律：必须附任务说明）"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
              <div className="input-row">
                <textarea
                  rows={2}
                  placeholder={`向群组 ${selectedMeta.name} 发言…`}
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
            </div>
          </section>
        </>
      ) : (
        <section className="card card-chat">
          <div className="empty-hint">
            选择一个群组查看协作
            <br />
            或点击「新建」创建群组（成员 ≥ 3：user + butler + 至少 1 个工作智能体）
          </div>
        </section>
      )}

      {/* 新建群组浮层 */}
      {showCreate && (
        <Modal
          title="新建群组"
          onClose={() => setShowCreate(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void createGroup()} disabled={!createName.trim() || createMembers.length === 0}>
                创建
              </button>
            </>
          }
        >
          <div className="form">
            <div className="form-field">
              <label>群组名</label>
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="如：网站改版小组" />
            </div>
            <div className="form-field">
              <label>工作智能体成员（user 与 butler 自动包含）</label>
              <div className="mention-row">
                {workAgents.length === 0 && <span className="hint">暂无工作智能体，请先到「智能体」页创建</span>}
                {workAgents.map((a) => (
                  <span
                    key={a.name}
                    className={`chip ${createMembers.includes(a.name) ? 'on' : ''}`}
                    onClick={() =>
                      setCreateMembers((prev) => (prev.includes(a.name) ? prev.filter((m) => m !== a.name) : [...prev, a.name]))
                    }
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 归档确认浮层（规格：归档死亡需明确确认） */}
      {showArchive && selectedMeta && (
        <Modal
          title="归档群组"
          onClose={() => setShowArchive(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowArchive(false)}>
                取消
              </button>
              <button className="btn danger" onClick={() => void archiveGroup()}>
                确认归档（工作区隔离保留历史）
              </button>
            </>
          }
        >
          <div className="form-field">
            <span className="hint">
              归档「{selectedMeta.name}」后群组进入死亡状态：工作区归档隔离、生成复用建议，历史记录保留。
            </span>
          </div>
        </Modal>
      )}
    </>
  )
}
