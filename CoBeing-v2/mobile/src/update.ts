/**
 * 手机端更新模块：从 GitHub Releases 检查最新版 + 下载 APK + 触发系统安装
 *
 * 数据源：https://api.github.com/repos/CH3SH-LC/CoBeing/releases
 * 手机端资产命名：CoBeing-mobile-<版本>-debug.apk
 */

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { registerPlugin } from '@capacitor/core'

/** 当前 App 版本（与 mobile/package.json version 同步） */
export const APP_VERSION = '2.0.2'

export const GITHUB_RELEASES_API = 'https://api.github.com/repos/CH3SH-LC/CoBeing/releases'

export interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GithubRelease {
  tag_name: string
  prerelease: boolean
  published_at?: string
  body?: string
  assets: GithubAsset[]
}

export interface MobileUpdateInfo {
  latest_tag: string
  published_at: string
  body: string
  asset_name: string
  asset_url: string
  asset_size: number
  has_update: boolean
  current_version: string
}

/** 简单版本号比较（同 Rust 侧实现：主.次.补丁数字段，忽略预发布后缀） */
export function isNewerVersion(latest: string, current: string): boolean {
  function parse(s: string): number[] {
    const cleaned = s.trim().replace(/^v/i, '')
    return cleaned
      .split(/[.\-+]/)
      .filter((seg) => /^\d+$/.test(seg))
      .slice(0, 3)
      .map(Number)
  }
  const l = parse(latest)
  const c = parse(current)
  for (let i = 0; i < 3; i++) {
    const lv = l[i] ?? 0
    const cv = c[i] ?? 0
    if (lv !== cv) return lv > cv
  }
  return false
}

/** 从 releases 中挑选最新正式版 + 匹配手机端 APK 资产 */
export function pickMobileRelease(releases: GithubRelease[]): { release: GithubRelease; asset: GithubAsset } | null {
  for (const rel of releases) {
    if (rel.prerelease) continue
    const asset = rel.assets.find((a) => a.name.endsWith('.apk') && a.name.includes('CoBeing-mobile'))
    if (asset) return { release: rel, asset }
  }
  return null
}

/** 从 GitHub 拉取 releases（WebView fetch；GitHub API 支持 CORS） */
export async function fetchReleases(): Promise<GithubRelease[]> {
  const res = await fetch(`${GITHUB_RELEASES_API}?per_page=10`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoBeing-Mobile-Updater' },
  })
  if (!res.ok) throw new Error(`GitHub API 请求失败: HTTP ${res.status}`)
  return (await res.json()) as GithubRelease[]
}

/** 检查手机端是否有新版本 */
export async function checkMobileUpdate(): Promise<MobileUpdateInfo> {
  const releases = await fetchReleases()
  const picked = pickMobileRelease(releases)
  if (!picked) throw new Error('未找到可用的正式版 Release')
  const { release, asset } = picked
  const hasUpdate = isNewerVersion(release.tag_name, APP_VERSION)
  return {
    latest_tag: release.tag_name,
    published_at: release.published_at ?? '',
    body: release.body ?? '',
    asset_name: asset.name,
    asset_url: asset.browser_download_url,
    asset_size: asset.size,
    has_update: hasUpdate,
    current_version: APP_VERSION,
  }
}

/** 原生插件：安装已下载到 cache 的 APK（FileProvider + ACTION_VIEW） */
export interface ApkInstallerPlugin {
  install(opts: { path: string }): Promise<{ installed: boolean }>
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')

/** 下载 APK 到应用 cache 目录（APK 较小走 base64 写文件），返回 cache 相对路径 */
export async function downloadApk(url: string, fileName: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`)
  const blob = await res.blob()
  const base64 = await blobToBase64(blob)
  const path = `updates/${fileName}`
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  })
  return path
}

/** 触发系统安装（返回是否已启动安装界面；Android 8+ 需用户允许未知来源） */
export async function installApk(cachePath: string): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('当前平台暂不支持应用内安装 APK（仅 Android）')
  }
  const res = await ApkInstaller.install({ path: cachePath })
  return res.installed
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // data:application/octet-stream;base64,xxxx → 去前缀
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取下载内容失败'))
    reader.readAsDataURL(blob)
  })
}

/** 字节数人性化显示 */
export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
