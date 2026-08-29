import { useCallback, useEffect, useState } from 'react'
import { rpc } from '../rpc'
import { useKernelUpdate } from '../App'
import type { AgentDef, ExperienceEntryDto } from '../types'
import { Modal } from '../components/Modal'

/** 智能体管理：名录 / 创建（需批准）/ 销毁（明确确认） */
export function AgentsView() {
  const [agents, setAgents] = useState<AgentDef[]>([])
  const [pending, setPending] = useState<AgentDef[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showDestroy, setShowDestroy] = useState(false)
  const [form, setForm] = useState({
    name: '',
    role: '',
    // 2.0.7：默认真实模型（deepseek）——mock 仅是显式测试选项，不再作为默认
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    maxTokens: '8192',
    basePrompt: '',
  })
  // 记忆面板：选中智能体的经验条目 + 检索词
  const [memoryInfo, setMemoryInfo] = useState<{ count: number; lastUpdated?: number } | null>(null)
  const [memoryEntries, setMemoryEntries] = useState<ExperienceEntryDto[]>([])
  const [memoryQuery, setMemoryQuery] = useState('')
  const [memoryLoading, setMemoryLoading] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([rpc.listAgents(), rpc.listPendingApprovals()])
      setAgents(a)
      setPending(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [refresh])

  // 实时同步：名录/批准队列变更（手机端批准/创建 → 电脑端即时刷新）
  const kernelUpdate = useKernelUpdate()
  useEffect(() => {
    if (kernelUpdate?.scope === 'agents') void refresh()
  }, [kernelUpdate, refresh])

  const selectedAgent = agents.find((a) => a.name === selected) ?? null

  const submitCreate = async () => {
    const name = form.name.trim()
    const role = form.role.trim()
    if (!name || !role) return
    try {
      await rpc.requestCreateAgent({
        name,
        role,
        basePrompt: form.basePrompt.trim() || undefined,
        provider: form.provider || undefined,
        model: form.model || undefined,
        maxTokens: Number(form.maxTokens) || undefined,
        createdAt: Date.now(),
      })
      setForm({ name: '', role: '', provider: 'deepseek', model: 'deepseek-v4-flash', maxTokens: '8192', basePrompt: '' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const confirmPending = async (name: string) => {
    try {
      await rpc.confirmAgent(name)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const destroy = async () => {
    if (!selected) return
    try {
      await rpc.destroyAgent(selected)
      setShowDestroy(false)
      setSelected(null)
      setMemoryInfo(null)
      setMemoryEntries([])
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // 记忆面板加载：选中智能体 → 条目数 + 最近条目
  useEffect(() => {
    if (!selected) {
      setMemoryInfo(null)
      setMemoryEntries([])
      setMemoryQuery('')
      return
    }
    void (async () => {
      setMemoryLoading(true)
      try {
        const [info, entries] = await Promise.all([rpc.experienceInfo(selected), rpc.experienceEntries(selected)])
        setMemoryInfo(info)
        setMemoryEntries(entries)
      } catch {
        setMemoryInfo(null)
        setMemoryEntries([])
      } finally {
        setMemoryLoading(false)
      }
    })()
  }, [selected])

  const searchMemory = async () => {
    if (!selected) return
    setMemoryLoading(true)
    try {
      const entries = memoryQuery.trim()
        ? await rpc.experienceSearch(selected, memoryQuery)
        : await rpc.experienceEntries(selected)
      setMemoryEntries(entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMemoryLoading(false)
    }
  }

  return (
    <>
      {/* 左卡片：智能体名录 */}
      <aside className="card card-list">
        <div className="card-title">
          <h2>智能体</h2>
          <span className="spacer" />
          <span className="badge">{agents.length}</span>
        </div>
        <div className="card-body">
          {agents.length === 0 && <div className="empty-hint">暂无工作智能体</div>}
          {agents.map((a) => (
            <div
              key={a.name}
              className={`list-item ${selected === a.name ? 'active' : ''}`}
              onClick={() => setSelected(a.name)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-item-title">{a.name}</div>
                <div className="list-item-sub">{a.role}</div>
              </div>
              {a.provider === 'mock' ? (
                <span className="badge" style={{ background: 'var(--warning-soft, rgba(181,122,0,0.18))', color: 'var(--warning, #b57a00)' }}>
                  mock ⚠（未真实调用）
                </span>
              ) : (
                <span className="badge">{a.provider ?? '未配置'}</span>
              )}
            </div>
          ))}
        </div>
        {pending.length > 0 && (
          <div className="card-body" style={{ borderTop: '1px solid var(--divider)' }}>
            <div className="form-field" style={{ marginBottom: 10 }}>
              <label>待批准创建（{pending.length}）</label>
            </div>
            {pending.map((p) => (
              <div key={p.name} className="list-item" style={{ padding: '10px 12px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="list-item-title">{p.name}</div>
                  <div className="list-item-sub">{p.role}</div>
                </div>
                <button className="btn small primary" onClick={() => void confirmPending(p.name)}>
                  批准
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* 标题卡片：选中智能体 */}
      <div className="card card-detail" style={{ flex: 'none', width: 260 }}>
        <div className="card-title">
          <h2>{selectedAgent ? selectedAgent.name : '智能体'}</h2>
          <span className="spacer" />
          {error && <span className="badge danger">{error}</span>}
        </div>
        <div className="card-body">
          {selectedAgent ? (
            <>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>角色</label>
                <span className="hint">{selectedAgent.role}</span>
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>模型路由</label>
                <span className="hint">
                  {selectedAgent.provider ?? 'mock'} / {selectedAgent.model ?? 'mock-model'}
                </span>
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>maxTokens</label>
                <span className="hint">{selectedAgent.maxTokens ?? '默认'}</span>
              </div>
              {selectedAgent.basePrompt && (
                <div className="form-field" style={{ marginBottom: 14 }}>
                  <label>定义</label>
                  <span className="hint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {selectedAgent.basePrompt}
                  </span>
                </div>
              )}
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>创建于</label>
                <span className="hint">{new Date(selectedAgent.createdAt).toLocaleString()}</span>
              </div>

              {/* 记忆面板：经验条目数 + 检索 + 最近条目 */}
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>
                  经验档案
                  {memoryInfo ? `（${memoryInfo.count} 条${memoryInfo.lastUpdated ? ` · 最近 ${new Date(memoryInfo.lastUpdated).toLocaleDateString()}` : ''}）` : ''}
                </label>
                <div className="input-row" style={{ marginBottom: 8 }}>
                  <input
                    placeholder="检索经验（关键词）"
                    value={memoryQuery}
                    onChange={(e) => setMemoryQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void searchMemory()
                    }}
                  />
                  <button className="btn small" onClick={() => void searchMemory()} disabled={memoryLoading}>
                    {memoryLoading ? '…' : '检索'}
                  </button>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {memoryEntries.length === 0 && !memoryLoading && (
                    <span className="hint">暂无经验条目（智能体工作后由【记忆】自动沉淀）</span>
                  )}
                  {memoryEntries.map((e, i) => (
                    <div key={`${e.ts}-${i}`} className="hint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '6px 8px', background: 'var(--bg)', borderRadius: 8 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {new Date(e.ts).toLocaleString()} · {e.source}
                        {e.tags?.length ? ` · #${e.tags.join(' #')}` : ''}
                      </span>
                      <br />
                      {e.content}
                    </div>
                  ))}
                </div>
              </div>

              <button className="btn danger" onClick={() => setShowDestroy(true)}>
                销毁智能体
              </button>
            </>
          ) : (
            <span className="hint">从左侧选择智能体查看详情；「创建」走待批准队列（规格：创造需用户批准）。</span>
          )}
        </div>
      </div>

      {/* 主体卡片：创建向导 */}
      <section className="card card-chat">
        <div className="card-title">
          <h2>创建智能体</h2>
          <span className="spacer" />
          <span className="badge">通用性 &gt; 专业性</span>
        </div>
        <div className="card-body">
          <div className="form">
            <div className="form-row">
              <div className="form-field">
                <label>名字</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：websearcher" />
              </div>
              <div className="form-field">
                <label>角色</label>
                <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="如：网页搜索与信息收集" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>provider</label>
                <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                  <option value="deepseek">deepseek（推荐，真实模型调用）</option>
                  <option value="mock">mock（仅测试：固定硬回复，不真实工作）</option>
                </select>
              </div>
              <div className="form-field">
                <label>model</label>
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="deepseek-v4-flash（推理）或 deepseek-chat（工具调用更稳）" />
              </div>
              <div className="form-field">
                <label>maxTokens</label>
                <input value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} />
              </div>
            </div>
            {form.provider === 'mock' && (
              <div className="sub" style={{ color: 'var(--warning, #b57a00)' }}>
                ⚠ mock 模式返回固定硬回复，智能体不会真实工作。仅用于界面测试，正式任务请使用 deepseek。
              </div>
            )}
            {form.provider === 'deepseek' && form.model === 'deepseek-v4-flash' && (
              <div className="sub">
                💡 deepseek-v4-flash 为推理模型（先思考后回答）；工具调用任务若遇空回复，建议改用 deepseek-chat。
              </div>
            )}
            <div className="form-field">
              <label>定义（basePrompt，可选）</label>
              <textarea rows={3} value={form.basePrompt} onChange={(e) => setForm({ ...form, basePrompt: e.target.value })} placeholder="智能体的完整职责定义（注入系统提示[定义]段）" />
            </div>
            <div className="form-field">
              <span className="hint">
                提交后进入待批准队列（左侧底部），由你批准后才登记入名录。deepseek 模型需要内核以 DEEPSEEK_API_KEY 启动。
              </span>
            </div>
            <div>
              <button
                className="btn primary"
                onClick={() => void submitCreate()}
                disabled={!form.name.trim() || !form.role.trim()}
              >
                提交创建请求
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 创建中浮层（提交后提示）——直接用待批准队列可见性替代，无需浮层 */}

      {/* 销毁确认浮层（规格：毁灭需明确点击确认） */}
      {showDestroy && selectedAgent && (
        <Modal
          title="销毁智能体"
          onClose={() => setShowDestroy(false)}
          actions={
            <>
              <button className="btn" onClick={() => setShowDestroy(false)}>
                取消
              </button>
              <button className="btn danger" onClick={() => void destroy()}>
                确认销毁（清人格经验 + 注销名录，历史保留）
              </button>
            </>
          }
        >
          <div className="form-field">
            <span className="hint">
              销毁「{selectedAgent.name}」将清除其人格经验档案并注销名录条目；历史对话记录保留。此操作不可撤销。
            </span>
          </div>
        </Modal>
      )}
    </>
  )
}
