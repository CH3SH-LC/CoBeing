/**
 * 检查更新弹窗（电脑端）：检查 GitHub Releases → 显示版本信息 → 下载安装包 → 启动安装程序
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '../components/Modal'
import {
  checkUpdate,
  downloadInstaller,
  launchInstaller,
  onDownloadProgress,
  formatBytes,
  type DesktopUpdateInfo,
} from '../update'

type Phase = 'checking' | 'idle' | 'downloading' | 'downloaded' | 'error'

export function UpdateModal({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<DesktopUpdateInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('checking')
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null)
  const [installerPath, setInstallerPath] = useState('')
  const [error, setError] = useState('')
  const unlistenRef = useRef<(() => void) | undefined>(undefined)

  const refresh = useCallback(async () => {
    setPhase('checking')
    setError('')
    try {
      const res = await checkUpdate()
      setInfo(res)
      setPhase('idle')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
    void onDownloadProgress((p) => setProgress(p)).then((fn) => {
      unlistenRef.current = fn
    })
    return () => {
      unlistenRef.current?.()
    }
  }, [refresh])

  const handleDownload = async () => {
    if (!info) return
    setPhase('downloading')
    setProgress(null)
    setError('')
    try {
      const path = await downloadInstaller(info.asset_url, info.asset_name)
      setInstallerPath(path)
      setPhase('downloaded')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }

  const handleInstall = async () => {
    if (!installerPath) return
    setError('')
    try {
      await launchInstaller(installerPath)
      setPhase('idle')
      // 安装程序已启动，关闭弹窗（安装完成后需重启应用）
      onClose()
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null

  return (
    <Modal
      title="检查更新"
      onClose={onClose}
      actions={
        phase === 'idle' && info?.has_update ? (
          <button className="btn" onClick={() => void handleDownload()}>
            下载并安装 {info.latest_tag}
          </button>
        ) : phase === 'downloaded' ? (
          <button className="btn" onClick={() => void handleInstall()}>
            启动安装程序
          </button>
        ) : null
      }
    >
      {phase === 'checking' && <div className="sub">正在检查 GitHub 最新版本…</div>}

      {phase === 'error' && (
        <div>
          <div className="sub" style={{ color: 'var(--danger, #e5484d)' }}>
            检查更新失败：{error}
          </div>
          <button className="btn small" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      {info && (
        <div className="update-info">
          <div className="sub">
            当前版本：v{info.current_version} · GitHub 最新正式版：{info.latest_tag}
          </div>
          {info.has_update ? (
            <>
              <div className="sub" style={{ marginTop: 8 }}>
                发现新版本，安装包 {info.asset_name}（{formatBytes(info.asset_size)}）
              </div>
              {phase === 'downloading' && (
                <div className="sub" style={{ marginTop: 8 }}>
                  {pct !== null ? `下载中… ${pct}%（${formatBytes(progress?.received)} / ${formatBytes(progress?.total)}）` : '下载中…'}
                </div>
              )}
              {phase === 'downloaded' && (
                <div className="sub" style={{ marginTop: 8 }}>
                  下载完成：{installerPath}
                  <br />
                  点击「启动安装程序」，按安装向导完成升级后重启应用。
                </div>
              )}
              {info.body && (
                <div className="update-notes" style={{ marginTop: 12 }}>
                  <div className="sub" style={{ fontWeight: 600 }}>更新内容</div>
                  <pre className="sub" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                    {info.body.slice(0, 2000)}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div className="sub" style={{ marginTop: 8 }}>
              已是最新版本 ✅
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
