/**
 * 控制台视图：远程控制面板（服务器驱动 manifest 泛化渲染，插件扩展面）
 *
 * - button → remote/invoke（confirm 二次确认）；toggle/input → 状态提交
 * - display → 只读显示（结果回填）
 * - 截屏动作特判：结果 base64 全屏查看
 * - 文件：roots 浏览 → 下载（@capacitor/filesystem 保存到设备）/ 上传（文件选择）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../rpc'
import { useAppState } from '../App'
import { useToast } from '../components/Toast'
import type { FileEntry, ListFilesResult, PanelControl, PanelManifest } from '../types'
import { Filesystem, Directory } from '@capacitor/filesystem'

interface InputState {
  [key: string]: string
}

export function ConsoleView() {
  const { status } = useAppState()
  const toast = useToast()
  const [panels, setPanels] = useState<PanelManifest[]>([])
  const [inputs, setInputs] = useState<InputState>({})
  const [shot, setShot] = useState<string | null>(null)
  const [shotLoading, setShotLoading] = useState(false)
  const [fileTab, setFileTab] = useState(false)
  const [roots, setRoots] = useState<string[]>([])
  const [fileRoot, setFileRoot] = useState<string>('')
  const [filePath, setFilePath] = useState('')
  const [files, setFiles] = useState<ListFilesResult | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([client.remotePanels(), client.remoteRoots()])
      setPanels(p)
      setRoots(r)
      if (!fileRoot && r.length > 0) setFileRoot(r[0])
    } catch {
      // 未连接
    }
  }, [fileRoot])

  useEffect(() => {
    void refresh()
  }, [status, refresh])

  const refreshFiles = useCallback(async () => {
    if (!fileRoot) return
    setBusy(true)
    try {
      setFiles(await client.remoteListFiles(fileRoot, filePath))
    } catch (error) {
      toast.push(`读取目录失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    } finally {
      setBusy(false)
    }
  }, [fileRoot, filePath, toast])

  useEffect(() => {
    if (fileTab && fileRoot) void refreshFiles()
  }, [fileTab, fileRoot, filePath, refreshFiles])

  const runAction = async (panel: string, ctrl: PanelControl, extra?: Record<string, unknown>) => {
    if (ctrl.type === 'button' && ctrl.confirm && !window.confirm(ctrl.confirm)) return
    if (ctrl.type === 'input') {
      const value = inputs[ctrl.id] ?? ''
      if (!value.trim()) {
        toast.push(`请输入${ctrl.label}内容`, 3000)
        return
      }
    }
    try {
      setBusy(true)
      if (panel === 'quick' && ctrl.id === 'screenshot') {
        setShotLoading(true)
        const shotResult = await client.remoteScreenshot()
        setShot(`data:${shotResult.mime};base64,${shotResult.base64}`)
        return
      }
      const result = await client.remoteInvoke(panel, ctrl.id, extra ?? (ctrl.type === 'input' ? { text: inputs[ctrl.id] ?? '' } : {}))
      if (ctrl.type === 'display' && typeof result === 'string') {
        setInputs((prev) => ({ ...prev, [ctrl.id]: result }))
      }
      if (panel === 'quick' && ctrl.id === 'clipboardGet') {
        const text = (result as { text?: string } | null)?.text
        if (text !== undefined) toast.push(`剪贴板：${text.slice(0, 60)}`, 4000)
      }
    } catch (error) {
      toast.push(`操作失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    } finally {
      setBusy(false)
      setShotLoading(false)
    }
  }

  const enterDir = (entry: FileEntry) => {
    if (!entry.isDir) return
    const next = filePath ? `${filePath}/${entry.name}` : entry.name
    setFilePath(next)
  }

  const download = async (entry: FileEntry) => {
    try {
      setBusy(true)
      const dl = await client.remoteDownload(fileRoot, filePath ? `${filePath}/${entry.name}` : entry.name)
      if (dl.mime.startsWith('image/')) {
        setShot(`data:${dl.mime};base64,${dl.base64}`)
        return
      }
      await Filesystem.writeFile({
        path: `CoBeing/${dl.name}`,
        data: dl.base64,
        directory: Directory.Documents,
        recursive: true,
      })
      toast.push(`已保存到设备文档目录：CoBeing/${dl.name}`)
    } catch (error) {
      toast.push(`下载失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      toast.push('文件超过 20MB 上限', 4000)
      return
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result ?? '')
        resolve(result.includes(',') ? result.split(',')[1] : result)
      }
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.readAsDataURL(file)
    })
    try {
      setBusy(true)
      const up = await client.remoteUpload(fileRoot, filePath, file.name, base64)
      toast.push(`已上传到电脑：${up.path}`)
      void refreshFiles()
    } catch (error) {
      toast.push(`上传失败：${error instanceof Error ? error.message : String(error)}`, 4000)
    } finally {
      setBusy(false)
    }
  }

  const formatSize = (size: number) => (size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : size >= 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`)

  return (
    <div className="page">
      <div className="topbar">
        <div className="title">控制台</div>
        <button className={`btn small ${fileTab ? 'secondary' : 'ghost'}`} onClick={() => setFileTab((v) => !v)}>
          {fileTab ? '面板' : '文件'}
        </button>
      </div>
      <div className="page-body">
        {!fileTab && (
          <>
            {panels.map((panel) => (
              <div key={panel.id} className="card">
                <h3>
                  {panel.icon ?? ''} {panel.name}
                </h3>
                {panel.sections.map((section, si) => (
                  <div key={si}>
                    <div className="section-title">{section.title}</div>
                    <div className="ctrl-grid">
                      {section.controls.map((ctrl) => {
                        if (ctrl.type === 'button') {
                          return (
                            <button key={ctrl.id} className="ctrl-btn" disabled={busy} onClick={() => void runAction(panel.id, ctrl)}>
                              <span className="ci">{ctrl.icon ?? '🔘'}</span>
                              <span>{ctrl.label}</span>
                            </button>
                          )
                        }
                        if (ctrl.type === 'input') {
                          return (
                            <div key={ctrl.id} style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input
                                placeholder={ctrl.placeholder ?? ctrl.label}
                                value={inputs[ctrl.id] ?? ''}
                                onChange={(e) => setInputs((prev) => ({ ...prev, [ctrl.id]: e.target.value }))}
                                style={{ flex: 1 }}
                              />
                              <button className="btn small" disabled={busy} onClick={() => void runAction(panel.id, ctrl)}>
                                发送
                              </button>
                            </div>
                          )
                        }
                        if (ctrl.type === 'display') {
                          return (
                            <div key={ctrl.id} style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--ink-soft)' }}>
                              {ctrl.label}：{inputs[ctrl.id] ?? ctrl.value ?? '-'}
                            </div>
                          )
                        }
                        return (
                          <button key={ctrl.id} className="ctrl-btn" disabled={busy} onClick={() => void runAction(panel.id, ctrl)}>
                            <span>{ctrl.label}</span>
                            <span>{ctrl.value ? '开' : '关'}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {panels.length === 0 && (
              <div className="empty">
                <div className="big">🎛️</div>
                控制面板来自电脑内核（服务器驱动），连接后自动加载。
              </div>
            )}
          </>
        )}

        {fileTab && (
          <>
            <div className="card">
              <div className="field">
                <label>文件根</label>
                <select value={fileRoot} onChange={(e) => { setFileRoot(e.target.value); setFilePath('') }}>
                  {roots.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row" style={{ padding: '6px 0' }}>
                <div className="grow sub" style={{ wordBreak: 'break-all' }}>
                  📁 {filePath || '/'}
                </div>
                <button className="btn small ghost" disabled={!filePath} onClick={() => setFilePath(filePath.split('/').slice(0, -1).join('/'))}>
                  上级
                </button>
              </div>
            </div>
            <div className="card" style={{ padding: '4px 14px' }}>
              {files?.entries.map((entry) => (
                <div key={entry.name} className="row">
                  <div className="grow" onClick={() => (entry.isDir ? enterDir(entry) : undefined)}>
                    <div className="title">
                      {entry.isDir ? '📂 ' : '📄 '}
                      {entry.name}
                    </div>
                    {!entry.isDir && <div className="sub">{formatSize(entry.size)}</div>}
                  </div>
                  {!entry.isDir && (
                    <button className="btn small secondary" disabled={busy} onClick={() => void download(entry)}>
                      下载
                    </button>
                  )}
                </div>
              ))}
              {files && files.entries.length === 0 && <div className="empty">空目录</div>}
              <div style={{ padding: '8px 0 4px' }}>
                <button className="btn small secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  ⬆ 上传文件（≤20MB）
                </button>
                <input ref={fileInputRef} type="file" hidden onChange={(e) => void onPickFile(e)} />
              </div>
            </div>
          </>
        )}
      </div>

      {shot && (
        <div className="shot-modal" onClick={() => setShot(null)}>
          <img src={shot} alt="截屏" />
          <div className="actions">
            <button className="btn" onClick={() => setShot(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
      {shotLoading && (
        <div className="shot-modal" onClick={() => setShotLoading(false)}>
          <div className="empty" style={{ color: '#fff' }}>
            截屏中…
          </div>
        </div>
      )}
    </div>
  )
}
