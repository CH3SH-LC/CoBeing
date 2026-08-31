/**
 * 设置视图：连接配置管理（多配置保存/切换）+ 自动发现配对（方案 v2）+ 关于 + 检查更新
 */

import { useState } from 'react'
import { client } from '../rpc'
import { useAppState } from '../App'
import { useToast } from '../components/Toast'
import {
  deleteProfile,
  getActiveProfileId,
  loadProfiles,
  newProfileId,
  normalizeUrl,
  saveProfile,
  setActiveProfileId,
  type Profile,
} from '../store'
import { scanLanDevices, type LanDevice } from '../lan-discovery'
import { getDeviceId, getDeviceName, pairRequest } from '../pairing'
import {
  checkMobileUpdate,
  downloadApk,
  installApk,
  formatBytes,
  type MobileUpdateInfo,
} from '../update'

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error'
type ScanPhase = 'idle' | 'scanning' | 'pairing' | 'error'

export function SettingsView() {
  const { status, hello, reconnect } = useAppState()
  const toast = useToast()
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [active, setActive] = useState<string | null>(getActiveProfileId)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')

  // 自动发现配对（方案 v2）
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [devices, setDevices] = useState<LanDevice[]>([])
  const [scanError, setScanError] = useState('')
  const [pairingDevice, setPairingDevice] = useState<LanDevice | null>(null)

  // 更新状态
  const [updateInfo, setUpdateInfo] = useState<MobileUpdateInfo | null>(null)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('idle')
  const [updateError, setUpdateError] = useState('')

  const handleScan = async () => {
    setScanPhase('scanning')
    setScanError('')
    setDevices([])
    try {
      const found = await scanLanDevices()
      setDevices(found)
      setScanPhase('idle')
      if (found.length === 0) toast.push('未发现电脑（请确认电脑已启动且在同一 WiFi）', 3500)
    } catch (e) {
      setScanError(String(e))
      setScanPhase('error')
    }
  }

  const handlePair = async (device: LanDevice) => {
    setPairingDevice(device)
    setScanPhase('pairing')
    setScanError('')
    try {
      // 手机确认后 → 密钥交换（电脑返回 token + LAN 地址）
      const result = await pairRequest(device.lanUrl, {
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
      })
      const profile: Profile = {
        id: newProfileId(),
        name: result.server.name || device.name || '我的电脑',
        url: normalizeUrl(result.server.lanUrl || device.lanUrl),
        token: result.token,
      }
      saveProfile(profile)
      setProfiles(loadProfiles())
      setActiveProfileId(profile.id)
      setActive(profile.id)
      client.connect(profile.url, profile.token)
      setScanPhase('idle')
      setPairingDevice(null)
      setDevices([])
      toast.push(`配对成功：${profile.name}，已自动连接`, 4000)
    } catch (e) {
      setScanError(`配对失败：${e instanceof Error ? e.message : String(e)}`)
      setScanPhase('error')
      setPairingDevice(null)
    }
  }

  const handleCheckUpdate = async () => {
    setUpdatePhase('checking')
    setUpdateError('')
    try {
      const info = await checkMobileUpdate()
      setUpdateInfo(info)
      setUpdatePhase('idle')
    } catch (e) {
      setUpdateError(String(e))
      setUpdatePhase('error')
    }
  }

  const handleDownloadInstall = async () => {
    if (!updateInfo) return
    setUpdatePhase('downloading')
    setUpdateError('')
    try {
      const cachePath = await downloadApk(updateInfo.asset_url, updateInfo.asset_name)
      setUpdatePhase('downloaded')
      await installApk(cachePath)
      toast.push('已启动系统安装界面，请按提示完成安装', 4000)
    } catch (e) {
      setUpdateError(String(e))
      setUpdatePhase('error')
    }
  }

  const startEdit = (p: Profile | null) => {
    setEditing(p ?? { id: newProfileId(), name: '', url: '', token: '' })
    setName(p?.name ?? '')
    setUrl(p?.url ?? '')
    setToken(p?.token ?? '')
  }

  const save = () => {
    if (!editing) return
    const normalized = normalizeUrl(url)
    if (!name.trim() || !normalized || !token.trim()) {
      toast.push('名称、服务器地址、token 均必填', 3000)
      return
    }
    const profile: Profile = { id: editing.id, name: name.trim(), url: normalized, token: token.trim() }
    const list = saveProfile(profile)
    setProfiles(list)
    if (!getActiveProfileId()) {
      setActiveProfileId(profile.id)
      setActive(profile.id)
    }
    setEditing(null)
    toast.push('配置已保存')
  }

  const select = (p: Profile) => {
    setActiveProfileId(p.id)
    setActive(p.id)
    client.connect(p.url, p.token)
    toast.push(`已连接 ${p.name}`)
  }

  const remove = (id: string) => {
    if (getActiveProfileId() === id) client.close()
    setProfiles(deleteProfile(id))
    setActive(getActiveProfileId())
    toast.push('配置已删除')
  }

  const activeProfile = profiles.find((p) => p.id === active) ?? null

  return (
    <div className="page">
      <div className="topbar">
        <div className="title">设置</div>
        <button className="btn small secondary" onClick={() => void reconnect()}>
          重连
        </button>
      </div>
      <div className="page-body">
        <div className="card">
          <h3>连接状态</h3>
          <div className="sub">状态：{status}</div>
          {hello && (
            <>
              <div className="sub">服务器：{hello.name} v{hello.version}</div>
              <div className="sub">数据目录：{hello.dataRoot}</div>
              <div className="sub">智能体：{hello.agentCount} 个 · 协议 {hello.protocol}</div>
            </>
          )}
        </div>

        {/* ===== 自动发现电脑（方案 v2：零配置配对） ===== */}
        <div className="section-title">自动发现电脑</div>
        <div className="card">
          <div className="sub" style={{ marginBottom: 8 }}>
            与电脑在同一 WiFi 时，扫描即可发现并一键配对（配对后自动交换密钥并连接；电脑会同步构建公网隧道，离开家也能连）。
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={scanPhase === 'scanning' || scanPhase === 'pairing'} onClick={() => void handleScan()}>
            {scanPhase === 'scanning' ? '🔍 正在扫描局域网…' : scanPhase === 'pairing' ? `⏳ 正在与 ${pairingDevice?.name ?? '电脑'} 配对…` : '📡 扫描局域网电脑'}
          </button>
          {scanError && <div className="sub" style={{ color: 'var(--danger, #e5484d)', marginTop: 8 }}>{scanError}</div>}
          {devices.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {devices.map((d) => (
                <div key={d.id} className="card" style={{ padding: '10px 12px', marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="grow">
                      <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>🖥️ {d.name}</div>
                      <div className="sub">v{d.version || '?'} · {d.host}:{d.wsPort}</div>
                    </div>
                    <button className="btn small primary" disabled={scanPhase === 'pairing'} onClick={() => void handlePair(d)}>
                      配对
                    </button>
                  </div>
                </div>
              ))}
              <div className="sub" style={{ marginTop: 8 }}>
                👆 点击「配对」即表示确认与此电脑互联；密钥将在确认后自动交换。
              </div>
            </div>
          )}
        </div>

        <div className="section-title">服务器配置</div>
        {profiles.map((p) => (
          <div key={p.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="grow">
                <div className="title">{p.name}{active === p.id ? '（当前）' : ''}</div>
                <div className="sub">{p.url}</div>
                <div className="sub">token：{p.token.slice(0, 6)}…{p.token.slice(-4)}</div>
              </div>
              <button className="btn small secondary" disabled={active === p.id} onClick={() => select(p)}>
                连接
              </button>
              <button className="btn small ghost" onClick={() => startEdit(p)}>
                编辑
              </button>
              <button className="btn small danger" onClick={() => remove(p.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
        {!editing && (
          <button className="btn" style={{ width: '100%' }} onClick={() => startEdit(null)}>
            + 添加服务器
          </button>
        )}

        {editing && (
          <div className="card">
            <h3>{activeProfile || profiles.some((p) => p.id === editing.id) ? `编辑：${editing.name || '新配置'}` : '添加服务器'}</h3>
            <div className="field">
              <label>配置名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="家里电脑 / 公司电脑" />
            </div>
            <div className="field">
              <label>服务器地址</label>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.5:7843 或 https://xxx.trycloudflare.com" />
            </div>
            <div className="field">
              <label>Token（电脑端启动时打印；局域网与隧道同一个）</label>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="粘贴 token" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={save}>
                保存
              </button>
              <button className="btn ghost" onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <h3>关于</h3>
          <div className="sub">CoBeing 手机端 v2.0.10（方案 v1 + 自动配对）</div>
          <div className="sub">协议：cobeing-ws/1 · JSON-RPC 2.0 over WebSocket（全双工）</div>
          <div className="sub">互联：局域网自动发现 + 一键配对 + cloudflared 公网隧道</div>
          <div className="sub">插件扩展：控制面板由电脑内核 manifest 驱动，无需升级 App</div>
        </div>

        <div className="card">
          <h3>检查更新</h3>
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
          {updateInfo && !updateInfo.has_update && (
            <div className="sub">已是最新版本 ✅</div>
          )}
          {updatePhase === 'checking' && <div className="sub">正在检查 GitHub 最新版本…</div>}
          {updatePhase === 'downloading' && <div className="sub">正在下载 APK…</div>}
          {updatePhase === 'downloaded' && <div className="sub">下载完成，正在启动系统安装…</div>}
          {updatePhase === 'error' && (
            <div className="sub" style={{ color: 'var(--danger, #e5484d)' }}>检查/更新失败：{updateError}</div>
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
                onClick={() => void handleDownloadInstall()}
              >
                下载并安装
              </button>
            )}
            {updatePhase === 'error' && (
              <button className="btn small secondary" onClick={() => void handleCheckUpdate()}>
                重试
              </button>
            )}
          </div>
          {updatePhase === 'downloaded' && (
            <div className="sub" style={{ marginTop: 8 }}>
              若未出现安装界面，请在系统设置中允许「CoBeing 安装未知应用」，然后再次点击「下载并安装」。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
