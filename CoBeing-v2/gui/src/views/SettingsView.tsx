/**
 * 设置视图（桌面端）：模型配置 + 检查更新 + 关于
 *
 * - 模型配置：API Key / Base URL / 模型名 → model-config.json（Rust 命令）
 *   保存后需重启内核/应用生效（内核启动时优先读配置文件，回退环境变量）
 * - 检查更新：内嵌更新卡片（检查 GitHub Releases → 下载 → 启动安装）
 * - 关于：版本信息
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getModelConfig, saveModelConfig } from '../settings'
import {
  checkUpdate,
  downloadInstaller,
  launchInstaller,
  onDownloadProgress,
  formatBytes,
  type DesktopUpdateInfo,
} from '../update'

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error'

export function SettingsView() {
  // ---------- 模型配置 ----------
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [configLoaded, setConfigLoaded] = useState(false)
  const [configStatus, setConfigStatus] = useState('')
  const [configError, setConfigError] = useState('')

  // ---------- 更新 ----------
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [installerPath, setInstallerPath] = useState('')
  const [updateError, setUpdateError] = useState('')
  const unlistenRef = useRef<(() => void) | undefined>(undefined)

  // 初始化：读取当前模型配置 + 订阅下载进度
  useEffect(() => {
    void getModelConfig()
      .then((cfg) => {
        setApiKey(cfg.api_key)
        setBaseUrl(cfg.base_url)
        setModel(cfg.model)
        setConfigLoaded(true)
      })
      .catch((e) => setConfigError(String(e)))
    void onDownloadProgress((p) => setProgress(p)).then((fn) => {
      unlistenRef.current = fn
    })
    return () => {
      unlistenRef.current?.()
    }
  }, [])

  const handleSaveConfig = async () => {
    setConfigStatus('')
    setConfigError('')
    try {
      await saveModelConfig({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim(), model: model.trim() })
      setConfigStatus('已保存。重启应用后生效（内核启动时读取新配置）。')
    } catch (e) {
      setConfigError(String(e))
    }
  }

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

  return (
    <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="card-title">
        <h2>设置</h2>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ---------- 模型配置 ---------- */}
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>模型配置</h3>
          {configError && (
            <div className="sub" style={{ color: 'var(--danger, #e5484d)', marginBottom: 8 }}>
              读取配置失败：{configError}
            </div>
          )}
          <div className="form">
            <div className="form-field">
              <label htmlFor="cfg-api-key">API Key</label>
              <input
                id="cfg-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…（留空 = 未配置，内核回退环境变量）"
                autoComplete="off"
              />
              <div className="hint">
                {configLoaded && (apiKey ? '已配置' : '未配置')} · 保存后重启应用生效
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="cfg-base-url">Base URL</label>
              <input
                id="cfg-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com（留空 = 默认 DeepSeek）"
              />
            </div>
            <div className="form-field">
              <label htmlFor="cfg-model">模型名</label>
              <input
                id="cfg-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="deepseek-chat（留空 = 默认）"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn primary" onClick={() => void handleSaveConfig()}>
                保存配置
              </button>
              {configStatus && (
                <span className="sub" style={{ color: 'var(--success, #30a46c)' }}>
                  {configStatus}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ---------- 检查更新 ---------- */}
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>检查更新</h3>
          {updateInfo && (
            <div className="sub">
              当前版本：v{updateInfo.current_version} · GitHub 最新正式版：{updateInfo.latest_tag}
            </div>
          )}
          {updateInfo?.has_update && (
            <div className="sub">
              发现新版本，安装包 {updateInfo.asset_name}（{formatBytes(updateInfo.asset_size)}）
            </div>
          )}
          {updateInfo && !updateInfo.has_update && <div className="sub">已是最新版本 ✅</div>}
          {updatePhase === 'checking' && <div className="sub">正在检查 GitHub 最新版本…</div>}
          {updatePhase === 'downloading' && (
            <div className="sub">
              {pct !== null
                ? `下载中… ${pct}%（${formatBytes(progress?.received)} / ${formatBytes(progress?.total)}）`
                : '下载中…'}
            </div>
          )}
          {updatePhase === 'downloaded' && (
            <div className="sub">
              下载完成：{installerPath}
              <br />
              点击「启动安装程序」，按安装向导完成升级后重启应用。
            </div>
          )}
          {updatePhase === 'error' && (
            <div className="sub" style={{ color: 'var(--danger, #e5484d)' }}>
              检查/更新失败：{updateError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn small"
              disabled={updatePhase === 'checking' || updatePhase === 'downloading' || updatePhase === 'downloaded'}
              onClick={() => void handleCheckUpdate()}
            >
              检查更新
            </button>
            {updateInfo?.has_update && updatePhase !== 'downloaded' && (
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
          {updateInfo?.body && (
            <div style={{ marginTop: 12 }}>
              <div className="sub" style={{ fontWeight: 600 }}>
                更新内容
              </div>
              <pre className="sub" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                {updateInfo.body.slice(0, 2000)}
              </pre>
            </div>
          )}
        </section>

        {/* ---------- 关于 ---------- */}
        <section className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>关于</h3>
          <div className="sub">CoBeing 桌面端 v2.0.2</div>
          <div className="sub">架构：Tauri 2 原生桌面 + 内置内核（免装 Node.js）</div>
          <div className="sub">模型：DeepSeek（API Key 在本页配置，或环境变量 DEEPSEEK_API_KEY）</div>
        </section>
      </div>
    </div>
  )
}
