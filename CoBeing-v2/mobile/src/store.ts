/**
 * 连接配置持久化（localStorage）
 */

export interface Profile {
  id: string
  name: string
  url: string
  token: string
  /** 公网隧道地址（方案 v2：配对成功后电脑自动推送；断线时作为候补地址自动切换） */
  tunnelUrl?: string
}

const KEY = 'cobeing.profiles.v1'
const ACTIVE_KEY = 'cobeing.profile.active'

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Profile[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveProfiles(profiles: Profile[]): void {
  localStorage.setItem(KEY, JSON.stringify(profiles))
}

export function saveProfile(profile: Profile): Profile[] {
  const profiles = loadProfiles()
  const index = profiles.findIndex((p) => p.id === profile.id)
  if (index >= 0) profiles[index] = profile
  else profiles.push(profile)
  saveProfiles(profiles)
  return profiles
}

export function deleteProfile(id: string): Profile[] {
  const profiles = loadProfiles().filter((p) => p.id !== id)
  saveProfiles(profiles)
  if (getActiveProfileId() === id) setActiveProfileId(profiles[0]?.id ?? null)
  return profiles
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function setActiveProfileId(id: string | null): void {
  if (id === null) localStorage.removeItem(ACTIVE_KEY)
  else localStorage.setItem(ACTIVE_KEY, id)
}

export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId()
  if (!id) return null
  return loadProfiles().find((p) => p.id === id) ?? null
}

/** 更新当前配置的 tunnelUrl（电脑推送新隧道地址时调用；已持久化） */
export function updateActiveTunnelUrl(tunnelUrl: string): Profile | null {
  const profile = getActiveProfile()
  if (!profile) return null
  const updated: Profile = { ...profile, tunnelUrl }
  saveProfile(updated)
  return updated
}

export function newProfileId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 归一化：http→ws / https→wss（cloudflared 隧道地址 https://… 自动转 wss://）；裸地址补 ws:// */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^wss?:\/\//i.test(trimmed)) return trimmed
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https/i, 'wss')
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, 'ws')
  return `ws://${trimmed}`
}
