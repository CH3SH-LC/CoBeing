/**
 * 群组视图：群列表 → 群投影 → 发言（mention chips + 任务说明）+ 归档
 */

import { useCallback, useEffect, useState } from 'react'
import { client } from '../rpc'
import { useAppState } from '../App'
import { useToast } from '../components/Toast'
import { MessageList } from '../components/MessageList'
import type { GroupMeta, GroupStatus, NotifyPayload, ProjectionDto } from '../types'

/** 成员标签显示名（协议标识 user/butler → 用户可见；其余原样） */
function memberLabel(m: string): string {
  if (m === 'user') return '用户'
  if (m === 'butler') return '铃音'
  return m
}

export function GroupsView() {
  const { status, lastUpdate } = useAppState()
  const toast = useToast()
  const [groups, setGroups] = useState<GroupMeta[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [projection, setProjection] = useState<ProjectionDto | null>(null)
  const [groupStatus, setGroupStatus] = useState<GroupStatus | null>(null)
  const [text, setText] = useState('')
  const [mention, setMention] = useState<string[]>([])
  const [task, setTask] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [confirm, setConfirm] = useState<NotifyPayload | null>(null)

  const refreshGroups = useCallback(async () => {
    try {
      setGroups(await client.listGroups())
    } catch {
      // 未连接
    }
  }, [])

  const refreshProjection = useCallback(async () => {
    if (!active) return
    try {
      setProjection(await client.groupProjection(active))
      setGroupStatus(await client.groupStatus(active))
    } catch {
      // 群可能已归档
    }
  }, [active])

  useEffect(() => {
    void refreshGroups()
  }, [status, refreshGroups])

  // 实时同步：群组列表/当前群投影变更广播 → 立即刷新（不等待轮询）
  useEffect(() => {
    if (status !== 'connected' || !lastUpdate) return
    if (lastUpdate.scope === 'groups') {
      void refreshGroups()
    } else if (lastUpdate.scope === 'group' && active && lastUpdate.group === active) {
      void refreshProjection()
    }
  }, [lastUpdate, status, refreshGroups, refreshProjection, active])

  useEffect(() => {
    if (!active) return
    void refreshProjection()
    const timer = setInterval(() => void refreshProjection(), 4000)
    const offNotify = client.onNotify((n) => {
      if (n.type === 'confirm') setConfirm(n)
    })
    return () => {
      clearInterval(timer)
      offNotify()
    }
  }, [active, refreshProjection])

  const openGroup = (name: string) => {
    setActive(name)
    setMention([])
    setTask('')
    setText('')
  }

  const send = async () => {
    const content = text.trim()
    if (!active || !content) return
    setText('')
    try {
      await client.speakToGroup(active, 'user', content, {
        mention: mention.length ? mention : undefined,
        task: task.trim() || undefined,
      })
      void refreshProjection()
    } catch (error) {
      toast.push(`发言失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const archive = async (name: string) => {
    try {
      await client.archiveGroup(name)
      toast.push(`群组 ${name} 已归档`)
      if (active === name) setActive(null)
      void refreshGroups()
    } catch (error) {
      toast.push(`归档失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const createGroup = async () => {
    const name = newName.trim()
    const label = newLabel
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!name || label.length < 3) {
      toast.push('群组名必填，且成员（含 user/butler）至少 3 个', 4000)
      return
    }
    try {
      await client.createGroup(name, label)
      toast.push(`群组 ${name} 已创建`)
      setCreating(false)
      setNewName('')
      setNewLabel('')
      void refreshGroups()
    } catch (error) {
      toast.push(`创建失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const members = active ? (groups.find((g) => g.name === active)?.label ?? []) : []

  if (active) {
    return (
      <div className="page">
        <div className="topbar">
          <button className="btn ghost small" onClick={() => setActive(null)}>
            ← 群组
          </button>
          <div className="title">{active}</div>
          <button className="btn small danger" onClick={() => void archive(active)}>
            归档
          </button>
        </div>
        <div className="page-body" style={{ paddingBottom: 90 }}>
          {/* 群组工作状态条：成员忙碌标记 + 当前任务 */}
          {groupStatus && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {groupStatus.members.map((m) => (
                  <span
                    key={m.name}
                    className={`chip ${m.busy ? 'chip-busy' : ''}`}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                  >
                    {m.busy ? '⏳ ' : ''}
                    {memberLabel(m.name)}
                  </span>
                ))}
              </div>
              {groupStatus.taskSummary && (
                <div className="sub" style={{ marginTop: 6 }}>
                  当前任务：{groupStatus.taskSummary}
                </div>
              )}
            </div>
          )}
          <MessageList projection={projection} confirm={confirm} />
        </div>
        <div className="composer">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {members.map((m) => (
                <button
                  key={m}
                  className={`btn small ${mention.includes(m) ? '' : 'ghost'}`}
                  onClick={() => setMention((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
                >
                  @{memberLabel(m)}
                </button>
              ))}
            </div>
            {mention.length === 0 && (
              <div className="sub" style={{ fontSize: 11 }}>
                未选 @ 成员 → 发言将唤醒全部工作智能体（默认 @all）
              </div>
            )}
            <textarea
              rows={1}
              placeholder="群组发言（@mention + 任务说明）…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <input placeholder="任务说明（可选，mention 时建议填写）" value={task} onChange={(e) => setTask(e.target.value)} />
          </div>
          <button className="btn" disabled={!text.trim()} onClick={() => void send()}>
            发送
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="title">群组</div>
        <button className="btn small secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? '取消' : '新建'}
        </button>
      </div>
      <div className="page-body">
        {creating && (
          <div className="card">
            <h3>新建群组</h3>
            <div className="field">
              <label>群组名</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="如：文档整理" />
            </div>
            <div className="field">
              <label>成员（空格/逗号分隔，含 user 与 butler 至少 3 个）</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="user butler writer" />
            </div>
            <button className="btn" onClick={() => void createGroup()}>
              创建
            </button>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.name} className="card">
            <h3>{g.name}</h3>
            <div className="sub">成员：{g.label.map(memberLabel).join(' · ')}</div>
            <div className="sub">状态：{g.status}{g.taskSummary ? ` · 任务：${g.taskSummary}` : ''}</div>
            <button className="btn small secondary" onClick={() => openGroup(g.name)}>
              进入群组
            </button>
          </div>
        ))}
        {groups.length === 0 && !creating && (
          <div className="empty">
            <div className="big">👥</div>
            暂无群组。点右上角「新建」创建一个（如 user + butler + writer）。
          </div>
        )}
      </div>
    </div>
  )
}
