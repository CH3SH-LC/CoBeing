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
  newSourceId,
  DEEPSEEK_MODELS,
  type ModelConfigs,
  type ModelSource,
} from '../settings'
import {
  checkUpdate,
  downloadInstaller,
  launchInstaller,
  onDownloadProgress,
  formatBytes,
  type DesktopUpdateInfo,
} from '../update'

type Section = 'model' | 'update' | 'about'

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error'

/** 空来源表单（编辑/新建共用） */
function emptyForm(): Omit<ModelSource, 'id'> & { id: string } {
  return { id: newSourceId(), name: '', api_key: '', base_url: '', model: DEEPSEEK_MODELS[0].id }
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
                    </div>
                    {s.id !== activeId && (
                      <button className="btn small" onClick={() => void handleSetActive(s.id)}>
                        设为当前
                      </button>
                    )}
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
                      <div className="hint">DeepSeek V4 系列（v4-flash 默认）</div>
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
            <div className="sub">CoBeing 桌面端 v2.0.3</div>
            <div className="sub">架构：Tauri 2 原生桌面 + 内置内核（免装 Node.js）</div>
            <div className="sub">模型：DeepSeek V4 系列（默认 deepseek-v4-flash），可配置多个来源</div>
            <div className="sub">自动更新：GitHub Releases（左侧「检查更新」）</div>
          </section>
        )}
      </div>
    </div>
  )
}
