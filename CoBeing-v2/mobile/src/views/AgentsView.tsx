/**
 * 智能体视图：名录 + 创建向导 + 待批准队列（手机端批准/拒绝建智能体）
 */

import { useCallback, useEffect, useState } from 'react'
import { client } from '../rpc'
import { useAppState } from '../App'
import { useToast } from '../components/Toast'
import type { AgentDef, ExperienceEntryDto } from '../types'

export function AgentsView() {
  const { status, lastUpdate } = useAppState()
  const toast = useToast()
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [approvals, setApprovals] = useState<AgentDef[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  // 记忆面板：展开的智能体名 → 条目 + 检索词
  const [memoryOpen, setMemoryOpen] = useState<string | null>(null)
  const [memoryEntries, setMemoryEntries] = useState<Record<string, ExperienceEntryDto[]>>({})
  const [memoryQuery, setMemoryQuery] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([client.listAgents(), client.listPendingApprovals()])
      setAgents(a)
      setApprovals(p)
    } catch {
      // 未连接
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [status, refresh])

  // 实时同步：名录/批准队列变更广播（电脑端批准/创建 → 手机端即时刷新）
  useEffect(() => {
    if (status === 'connected' && lastUpdate?.scope === 'agents') {
      void refresh()
    }
  }, [lastUpdate, status, refresh])

  const loadMemory = async (agentName: string, keyword = '') => {
    try {
      const entries = keyword.trim()
        ? await client.experienceSearch(agentName, keyword)
        : await client.experienceEntries(agentName)
      setMemoryEntries((prev) => ({ ...prev, [agentName]: entries }))
    } catch (error) {
      toast.push(`记忆加载失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const toggleMemory = (agentName: string) => {
    const next = memoryOpen === agentName ? null : agentName
    setMemoryOpen(next)
    if (next) void loadMemory(next)
  }

  const submit = async () => {
    if (!name.trim() || !role.trim()) {
      toast.push('名称与角色必填', 3000)
      return
    }
    try {
      await client.requestCreateAgent({ name: name.trim(), role: role.trim() })
      toast.push('创建请求已提交，等待管家批准')
      setCreating(false)
      setName('')
      setRole('')
      void refresh()
    } catch (error) {
      toast.push(`提交失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const confirm = async (agentName: string) => {
    try {
      await client.confirmAgent(agentName)
      toast.push(`已批准 ${agentName}`)
      void refresh()
    } catch (error) {
      toast.push(`操作失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const reject = async (agentName: string) => {
    try {
      await client.rejectAgentApproval(agentName)
      toast.push(`已拒绝 ${agentName}`)
      void refresh()
    } catch (error) {
      toast.push(`操作失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  const destroy = async (agentName: string) => {
    try {
      await client.destroyAgent(agentName)
      toast.push(`已销毁 ${agentName}`)
      void refresh()
    } catch (error) {
      toast.push(`操作失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    }
  }

  return (
    <div className="page">
      <div className="topbar">
        <div className="title">智能体</div>
        <button className="btn small secondary" onClick={() => setCreating((v) => !v)}>
          {creating ? '取消' : '创建'}
        </button>
      </div>
      <div className="page-body">
        {creating && (
          <div className="card">
            <h3>创建智能体</h3>
            <div className="field">
              <label>名称（英文，如 writer）</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="writer" />
            </div>
            <div className="field">
              <label>角色（中文职责描述）</label>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="负责文件读写与代码编辑" />
            </div>
            <button className="btn" onClick={() => void submit()}>
              提交创建请求
            </button>
          </div>
        )}

        {approvals.length > 0 && (
          <>
            <div className="section-title">⏳ 待批准</div>
            {approvals.map((a) => (
              <div key={a.name} className="card">
                <h3>{a.name}</h3>
                <div className="sub">{a.role}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn small" onClick={() => void confirm(a.name)}>
                    批准
                  </button>
                  <button className="btn small danger" onClick={() => void reject(a.name)}>
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        <div className="section-title">📇 名录</div>
        {agents.map((a) => (
          <div key={a.name} className="card">
            <h3>{a.name}</h3>
            <div className="sub">{a.role}</div>
            <div className="sub">
              {a.provider}/{a.model} · maxTokens {a.maxTokens ?? '-'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="btn small ghost" onClick={() => toggleMemory(a.name)}>
                {memoryOpen === a.name ? '收起记忆' : '🧠 记忆'}
              </button>
              {a.name !== 'butler' && (
                <button className="btn small danger" onClick={() => void destroy(a.name)}>
                  销毁
                </button>
              )}
            </div>
            {memoryOpen === a.name && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input
                    placeholder="检索记忆（关键词）"
                    value={memoryQuery[a.name] ?? ''}
                    onChange={(e) => setMemoryQuery((prev) => ({ ...prev, [a.name]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void loadMemory(a.name, memoryQuery[a.name] ?? '')
                    }}
                  />
                  <button className="btn small secondary" onClick={() => void loadMemory(a.name, memoryQuery[a.name] ?? '')}>
                    检索
                  </button>
                </div>
                {(memoryEntries[a.name] ?? []).length === 0 && <div className="sub">暂无经验条目（智能体工作后由【记忆】自动沉淀）</div>}
                {(memoryEntries[a.name] ?? []).map((e, i) => (
                  <div key={`${e.ts}-${i}`} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                    <div className="sub">
                      {new Date(e.ts).toLocaleString()} · {e.source}
                      {e.tags?.length ? ` · #${e.tags.join(' #')}` : ''}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {agents.length === 0 && !creating && (
          <div className="empty">
            <div className="big">🤖</div>
            暂无智能体（管家创建需经你批准，批准入口在此页）。
          </div>
        )}
      </div>
    </div>
  )
}
