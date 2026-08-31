/**
 * 设置视图（桌面端，分栏布局）：左侧条目导航 + 右侧内容区
 *
 * - 「模型」：多来源管理——创建/编辑/删除多个模型来源（全部保存），
 *   选择当前使用来源（切换后重启内核生效）；模型下拉为 DeepSeek v4 系列
 * - 「检查更新」：无右侧内容，点击左侧条目即启动检查（结果就地显示在条目下方）
 * - 「关于」：版本信息
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getModelConfigs,
  saveModelSource,
  setActiveModelSource,
  deleteModelSource,
  testModelSource,
  newSourceId,
  DEEPSEEK_MODELS,
  REASONING_EFFORTS,
  type ModelConfigs,
  type ModelSource,
  type TestConnectionResult,
} from '../settings'
import {
  checkUpdate,
  downloadInstaller,
  launchInstaller,
  onDownloadProgress,
  formatBytes,
  type DesktopUpdateInfo,
} from '../update'
import { rpc } from '../rpc'
import type { RemoteStatus } from '../types'

type Section = 'model' | 'update' | 'phone' | 'about'

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error'

/** 空来源表单（编辑/新建共用） */
function emptyForm(): Omit<ModelSource, 'id'> & { id: string } {
  return {
    id: newSourceId(),
    name: '',
    api_key: '',
    base_url: '',
    model: DEEPSEEK_MODELS[0].id,
    // 2.0.9：思考模式默认关闭（快且稳）；强度默认 high
    thinking_enabled: false,
    reasoning_effort: 'high',
  }
}

export function SettingsView() {
  // ---------- 分栏导航 ----------
  const [section, setSection] = useState<Section>('model')

  // ---------- 模型来源 ----------
  const [configs, setConfigs] = useState<ModelConfigs>({ sources: [], active_source: '' })
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<(Omit<ModelSource, 'id'> & { id: string }) | null>(null)

  // ---------- 更新 ----------
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [installerPath, setInstallerPath] = useState('')
  const [updateError, setUpdateError] = useState('')
  const unlistenRef = useRef<(() => void) | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const cfg = await getModelConfigs()
      if (cfg && Array.isArray(cfg.sources)) {
        setConfigs(cfg)
      }
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void refresh().then(() => setLoaded(true))
    void onDownloadProgress((p) => setProgress(p)).then((fn) => {
      unlistenRef.current = fn
    })
    return () => {
      unlistenRef.current?.()
    }
  }, [refresh])

  const activeId = configs.active_source
  const activeCount = configs.sources.length

  // ---------- 模型来源操作 ----------
  const handleSaveSource = async () => {
    if (!editing) return
    if (!editing.name.trim()) {
      setError('来源名称必填')
      return
    }
    setError('')
    setNotice('')
    try {
      await saveModelSource({ ...editing, name: editing.name.trim() })
      setEditing(null)
      await refresh()
      setNotice('来源已保存' + (activeCount === 0 ? '，并已设为当前使用' : ''))
    } catch (e) {
      setError(String(e))
    }
  }

  const handleSetActive = async (id: string) => {
    setError('')
    setNotice('')
    try {
      await setActiveModelSource(id)
      await refresh()
      setNotice('已切换当前使用来源，重启应用后生效')
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (id: string) => {
    setError('')
    setNotice('')
    try {
      await deleteModelSource(id)
      await refresh()
      setNotice('来源已删除')
    } catch (e) {
      setError(String(e))
    }
  }

  // ---------- 测试连接（2.0.9：真实调用模型 API 验证配置） ----------
  const [testResults, setTestResults] = useState<Record<string, TestConnectionResult>>({})
  const [testingId, setTestingId] = useState('')

  const handleTest = async (id: string) => {
    setTestingId(id)
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: '测试中…' } }))
    try {
      const result = await testModelSource(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: String(e) } }))
    } finally {
      setTestingId('')
    }
  }

  // ---------- 检查更新（点击左侧条目即触发） ----------
  const handleCheckUpdate = useCallback(async () => {
    setUpdatePhase('checking')
    setUpdateError('')
    try {
      const info = await checkUpdate()
      setUpdateInfo(info)
      setUpdatePhase('idle')
    } catch (e) {
      setUpdateError(String(e))
      setUpdatePhase('error')
    }
  }, [])

  const handleDownload = async () => {
    if (!updateInfo) return
    setUpdatePhase('downloading')
    setProgress(null)
    setUpdateError('')
    try {
      const path = await downloadInstaller(updateInfo.asset_url, updateInfo.asset_name)
      setInstallerPath(path)
      setUpdatePhase('downloaded')
    } catch (e) {
      setUpdateError(String(e))
      setUpdatePhase('error')
    }
  }

  const handleInstall = async () => {
    if (!installerPath) return
    setUpdateError('')
    try {
      await launchInstaller(installerPath)
      setUpdatePhase('idle')
    } catch (e) {
      setUpdateError(String(e))
      setUpdatePhase('error')
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  // 点击「检查更新」条目：启动检查（该条目无右侧内容，结果就地显示）
  const handleUpdateEntryClick = () => {
    setSection('update')
    void handleCheckUpdate()
  }

  // ---------- 手机连接（方案 v2：自动配对 + 隧道状态） ----------
  const [remote, setRemote] = useState<RemoteStatus | null>(null)
  const [remoteError, setRemoteError] = useState('')
  const [copied, setCopied] = useState('')

  const refreshRemote = useCallback(async () => {
    try {
      const status = await rpc.remoteStatus()
      setRemote(status)
      setRemoteError('')
    } catch (e) {
      setRemoteError(String(e))
    }
  }, [])

  useEffect(() => {
    if (section !== 'phone') return
    void refreshRemote()
    const timer = setInterval(() => void refreshRemote(), 5000)
    return () => clearInterval(timer)
  }, [section, refreshRemote])

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setRemoteError('复制失败')
    }
  }

  const handleRevoke = async (deviceId: string, deviceName: string) => {
    if (!window.confirm(`撤销 ${deviceName} 的配对？该手机需重新配对才能连接。`)) return
    try {
      await rpc.pairRevoke(deviceId)
      await refreshRemote()
    } catch (e) {
      setRemoteError(String(e))
    }
  }

  return (
    <div className="card" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* ---------- 左侧条目 ---------- */}
      <div
        style={{
          width: 200,
          flex: 'none',
          borderRight: '1px solid var(--divider, rgba(0,0,0,0.08))',
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 0',
          gap: 4,
        }}
      >
        {(
          [
            { key: 'model', label: '模型' },
            { key: 'phone', label: '手机连接' },
            { key: 'update', label: '检查更新' },
            { key: 'about', label: '关于' },
          ] as { key: Section; label: string }[]
        ).map((item) => (
          <button
            key={item.key}
            className={`nav-item ${section === item.key ? 'active' : ''}`}
            style={{ textAlign: 'left', padding: '10px 20px', borderRadius: 8, border: 'none', background: section === item.key ? 'var(--accent-soft, rgba(94,164,244,0.15))' : 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 14 }}
            onClick={() => {
              if (item.key === 'update') handleUpdateEntryClick()
              else setSection(item.key)
            }}
          >
            {item.label}
            {item.key === 'update' && updatePhase === 'checking' && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-secondary)' }}>…</span>}
          </button>
        ))}
        {/* 检查更新结果就地显示在条目下方 */}
        {section === 'update' && (
          <div style={{ padding: '8px 20px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
            {updatePhase === 'checking' && <div>正在检查 GitHub 最新版本…</div>}
            {updateInfo && (
              <div>
                <div>当前 v{updateInfo.current_version} · 最新 {updateInfo.latest_tag}</div>
                {updateInfo.has_update ? (
                  <div>
                    <div style={{ marginTop: 4 }}>
                      {updatePhase === 'downloading'
                        ? pct !== null
                          ? `下载中… ${pct}%（${formatBytes(progress?.received)} / ${formatBytes(progress?.total)}）`
                          : '下载中…'
                        : `新版本安装包 ${updateInfo.asset_name}（${formatBytes(updateInfo.asset_size)}）`}
                    </div>
                    {updatePhase === 'downloaded' && (
                      <div style={{ marginTop: 4 }}>
                        下载完成：{installerPath}
                        <br />
                        点击下方按钮启动安装程序，完成后重启应用。
                      </div>
                    )}
                    {updatePhase === 'error' && (
                      <div style={{ color: 'var(--danger, #e5484d)', marginTop: 4 }}>{updateError}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: 4 }}>已是最新版本 ✅</div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    className="btn small"
                    disabled={updatePhase === 'checking' || updatePhase === 'downloading' || updatePhase === 'downloaded'}
                    onClick={() => void handleCheckUpdate()}
                  >
                    重新检查
                  </button>
                  {updateInfo.has_update && updatePhase !== 'downloaded' && (
                    <button
                      className="btn small"
                      disabled={updatePhase === 'checking' || updatePhase === 'downloading'}
                      onClick={() => void handleDownload()}
                    >
                      下载并安装 {updateInfo.latest_tag}
                    </button>
                  )}
                  {updatePhase === 'downloaded' && (
                    <button className="btn small primary" onClick={() => void handleInstall()}>
                      启动安装程序
                    </button>
                  )}
                  {updatePhase === 'error' && (
                    <button className="btn small secondary" onClick={() => void handleCheckUpdate()}>
                      重试
                    </button>
                  )}
                </div>
              </div>
            )}
            {updateInfo?.body && (
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
                {updateInfo.body.slice(0, 2000)}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ---------- 右侧内容 ---------- */}
      <div className="card-body" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ===== 模型 ===== */}
        {section === 'model' && (
          <>
            <section>
              <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>模型来源</h3>
              <div className="sub" style={{ marginBottom: 12 }}>
                可创建多个模型来源（如不同 API Key / 模型），全部保存；选择「当前使用」的来源生效，切换后重启应用。
              </div>
              {error && (
                <div className="sub" style={{ color: 'var(--danger, #e5484d)', marginBottom: 8 }}>
                  {error}
                </div>
              )}
              {notice && (
                <div className="sub" style={{ color: 'var(--success, #30a46c)', marginBottom: 8 }}>
                  {notice}
                </div>
              )}

              {!loaded && <div className="sub">加载中…</div>}
              {loaded && activeCount === 0 && !editing && (
                <div className="sub" style={{ marginBottom: 12 }}>
                  尚未配置任何模型来源。未配置时内核以 mock 模式运行（界面可体验，智能体不真实工作）。
                </div>
              )}

              {configs.sources.map((s) => (
                <div key={s.id} className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                      <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>
                        {s.name}
                        {s.id === activeId && (
                          <span className="badge success" style={{ marginLeft: 8 }}>
                            当前使用
                          </span>
                        )}
                      </div>
                      <div className="sub">模型：{s.model || 'deepseek-v4-flash（默认）'}</div>
                      {s.base_url && <div className="sub">Base URL：{s.base_url}</div>}
                      <div className="sub">
                        API Key：{s.api_key ? `${s.api_key.slice(0, 4)}…${s.api_key.slice(-4)}` : '（未配置）'}
                      </div>
                      <div className="sub">
                        思考模式：{s.thinking_enabled ? `开启（强度 ${s.reasoning_effort || 'high'}）` : '关闭（快且稳）'}
                      </div>
                      {testResults[s.id] && (
                        <div className="sub" style={{ color: testResults[s.id].ok ? 'var(--success, #30a46c)' : 'var(--danger, #e5484d)', marginTop: 4 }}>
                          {testResults[s.id].ok ? '✅ ' : '❌ '}
                          {testResults[s.id].message}
                        </div>
                      )}
                    </div>
                    {s.id !== activeId && (
                      <button className="btn small" onClick={() => void handleSetActive(s.id)}>
                        设为当前
                      </button>
                    )}
                    <button
                      className="btn small secondary"
                      disabled={testingId === s.id}
                      onClick={() => void handleTest(s.id)}
                    >
                      {testingId === s.id ? '测试中…' : '测试连接'}
                    </button>
                    <button className="btn small secondary" onClick={() => setEditing({ ...s })}>
                      编辑
                    </button>
                    <button className="btn small danger" onClick={() => void handleDelete(s.id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}

              {!editing && (
                <button className="btn" onClick={() => setEditing(emptyForm())}>
                  + 添加来源
                </button>
              )}

              {editing && (
                <div className="card" style={{ padding: 16, marginTop: 12 }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>
                    {configs.sources.some((s) => s.id === editing.id) ? `编辑：${editing.name || '来源'}` : '添加模型来源'}
                  </h3>
                  <div className="form">
                    <div className="form-field">
                      <label htmlFor="src-name">来源名称</label>
                      <input
                        id="src-name"
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        placeholder="DeepSeek 官方 / 备用 Key"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="src-api-key">API Key</label>
                      <input
                        id="src-api-key"
                        type="password"
                        value={editing.api_key}
                        onChange={(e) => setEditing({ ...editing, api_key: e.target.value })}
                        placeholder="sk-…（留空 = 未配置，内核回退环境变量）"
                        autoComplete="off"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="src-base-url">Base URL</label>
                      <input
                        id="src-base-url"
                        value={editing.base_url}
                        onChange={(e) => setEditing({ ...editing, base_url: e.target.value })}
                        placeholder="https://api.deepseek.com（留空 = 默认 DeepSeek）"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="src-model">模型</label>
                      <select
                        id="src-model"
                        value={editing.model}
                        onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                      >
                        {DEEPSEEK_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="hint">DeepSeek V4 系列（v4-flash 默认；已无 chat/reasoner 模型——思考行为由下方开关+强度控制）</div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="src-thinking">思考模式（推理开关）</label>
                      <select
                        id="src-thinking"
                        value={editing.thinking_enabled ? 'enabled' : 'disabled'}
                        onChange={(e) => setEditing({ ...editing, thinking_enabled: e.target.value === 'enabled' })}
                      >
                        <option value="disabled">关闭（推荐：响应快、工具调用稳）</option>
                        <option value="enabled">开启（先推理再回答，深度思考但慢）</option>
                      </select>
                      <div className="hint">关闭 = 请求带 thinking disabled（等价于旧版非推理模型）；开启后回答质量更高但更慢、maxTokens 需更大</div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="src-effort">思考强度（思考模式开启时生效）</label>
                      <select
                        id="src-effort"
                        disabled={!editing.thinking_enabled}
                        value={editing.reasoning_effort || 'high'}
                        onChange={(e) => setEditing({ ...editing, reasoning_effort: e.target.value })}
                      >
                        {REASONING_EFFORTS.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <div className="hint">low / high / max（medium、xhigh 会被服务端映射为 high）</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn primary" onClick={() => void handleSaveSource()}>
                        保存来源
                      </button>
                      <button className="btn ghost" onClick={() => setEditing(null)}>
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {/* ===== 手机连接（方案 v2：自动配对 + 隧道状态） ===== */}
        {section === 'phone' && (
          <section>
            <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>手机连接</h3>
            <div className="sub" style={{ marginBottom: 12 }}>
              手机 App 打开后会自动发现本电脑（同一 WiFi），确认配对即可互联；配对成功后自动构建 cloudflared 公网隧道，手机在任意网络下都能连接。
            </div>
            {remoteError && (
              <div className="sub" style={{ color: 'var(--danger, #e5484d)', marginBottom: 8 }}>{remoteError}</div>
            )}
            {!remote && !remoteError && <div className="sub">加载中…</div>}

            {remote && !remote.enabled && (
              <div className="sub" style={{ color: 'var(--warning, #b57a00)' }}>
                远程互联未启用（内核未以 --remote-port 启动）。重启应用后生效。
              </div>
            )}

            {remote?.enabled && (
              <>
                <div className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
                  <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>局域网地址（手机同一 WiFi 直连）</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <code style={{ background: 'var(--bg-soft, rgba(0,0,0,0.04))', padding: '4px 8px', borderRadius: 6 }}>{remote.lanUrl}</code>
                    <button className="btn small secondary" onClick={() => void copyText('lan', remote.lanUrl ?? '')}>
                      {copied === 'lan' ? '已复制 ✓' : '复制'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span className="sub">Token：</span>
                    <code style={{ background: 'var(--bg-soft, rgba(0,0,0,0.04))', padding: '4px 8px', borderRadius: 6 }}>
                      {remote.token ? `${remote.token.slice(0, 6)}…${remote.token.slice(-4)}` : '—'}
                    </code>
                    {remote.token && (
                      <button className="btn small secondary" onClick={() => void copyText('token', remote.token ?? '')}>
                        {copied === 'token' ? '已复制 ✓' : '复制 Token'}
                      </button>
                    )}
                  </div>
                  <div className="sub" style={{ marginTop: 8 }}>
                    发现服务：{remote.discoveryPort ? `UDP :${remote.discoveryPort}（手机扫描可发现本机）` : '未启用'}
                  </div>
                  <div className="sub">配对方式：手机 App「设置 → 自动发现电脑」→ 手机确认 → 自动交换密钥并连接。</div>
                </div>

                <div className="card" style={{ padding: '12px 16px', marginBottom: 10 }}>
                  <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>
                    公网隧道（cloudflared）
                    {remote.tunnelRunning ? <span className="badge success" style={{ marginLeft: 8 }}>运行中</span> : <span className="badge" style={{ marginLeft: 8 }}>未启动</span>}
                  </div>
                  {remote.tunnelUrl ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <code style={{ background: 'var(--bg-soft, rgba(0,0,0,0.04))', padding: '4px 8px', borderRadius: 6 }}>{remote.tunnelUrl}</code>
                      <button className="btn small secondary" onClick={() => void copyText('tunnel', remote.tunnelUrl ?? '')}>
                        {copied === 'tunnel' ? '已复制 ✓' : '复制'}
                      </button>
                    </div>
                  ) : (
                    <div className="sub" style={{ marginTop: 6 }}>
                      手机配对成功后自动启动（需联网下载 cloudflared，首次约 1-2 分钟）。
                    </div>
                  )}
                  <div className="sub" style={{ marginTop: 6 }}>隧道地址每次电脑重启会变化，手机在同一 WiFi 下会自动同步新地址。</div>
                </div>

                <div className="card" style={{ padding: '12px 16px' }}>
                  <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>
                    已配对设备（{remote.pairs.length}）
                  </div>
                  {remote.pairs.length === 0 && <div className="sub" style={{ marginTop: 6 }}>暂无配对设备。打开手机 App 扫描即可开始配对。</div>}
                  {remote.pairs.map((p) => (
                    <div key={p.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <div className="grow">
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.deviceName}</div>
                        <div className="sub">{new Date(p.pairedAt).toLocaleString()}</div>
                      </div>
                      <button className="btn small danger" onClick={() => void handleRevoke(p.deviceId, p.deviceName)}>
                        撤销
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ===== 检查更新（无独立右侧内容；结果在左侧条目下方展示） ===== */}
        {section === 'update' && (
          <div className="sub">
            检查更新结果展示在左侧「检查更新」条目下方。点击条目即自动检查 GitHub 最新正式版。
          </div>
        )}

        {/* ===== 关于 ===== */}
        {section === 'about' && (
          <section>
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>关于</h3>
            <div className="sub">CoBeing 桌面端 v2.0.11</div>
            <div className="sub">架构：Tauri 2 原生桌面 + 内置内核（免装 Node.js）</div>
            <div className="sub">模型：DeepSeek 系列（默认 deepseek-v4-flash；思考开关/强度在「模型」来源配置中调整），可配置多个来源</div>
            <div className="sub">手机互联：局域网自动发现 + 一键配对 + cloudflared 公网隧道</div>
            <div className="sub">自动更新：GitHub Releases（左侧「检查更新」）</div>
          </section>
        )}
      </div>
    </div>
  )
}
