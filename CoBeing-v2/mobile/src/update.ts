/**
 * 手机端更新模块：从 GitHub Releases 检查最新版 + 下载 APK + 触发系统安装
 *
 * 数据源：https://api.github.com/repos/CH3SH-LC/CoBeing/releases
 * 手机端资产命名：CoBeing-mobile-<版本>-debug.apk
 *
 * 下载（2026-08-29 修复「Failed to fetch」）：
 * - 根因：GitHub 资产响应无 CORS 头（release-assets.githubusercontent.com 返回
 *   access-control-allow-origin: null），WebView fetch 跨域被浏览器拦截。
 * - 修复：改用 @capacitor/filesystem 原生 downloadFile（Android HttpURLConnection，
 *   不走 WebView 网络栈，无 CORS 限制）；直连失败自动尝试国内加速镜像源。
 */

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { registerPlugin } from '@capacitor/core'

/** 当前 App 版本（与 mobile/package.json version 同步） */
export const APP_VERSION = '2.0.11'

export const GITHUB_RELEASES_API = 'https://api.github.com/repos/CH3SH-LC/CoBeing/releases'

/** APK 下载源链：直连 GitHub → 国内加速镜像（逐个尝试，任一成功即止） */
export const DOWNLOAD_SOURCES: Array<(url: string) => string> = [
  (url) => url,
  (url) => `https://ghfast.top/${url}`,
  (url) => `https://gh-proxy.com/${url}`,
]

/** 下载执行器（原生 downloadFile 封装；测试注入） */
export interface DownloadExecutor {
  download(url: string, path: string): Promise<void>
}

/** 默认下载实现：Capacitor 原生 downloadFile（Android HttpURLConnection，无 CORS 限制） */
const defaultDownloadImpl: DownloadExecutor = {
  async download(url: string, path: string): Promise<void> {
    // 清理旧文件：避免上次失败残留导致安装旧包
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Cache })
    } catch {
      // 不存在/已删除
    }
    await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true })
  },
}

let downloadImpl: DownloadExecutor = defaultDownloadImpl

/** 测试注入下载实现（undefined 恢复默认原生实现） */
export function setDownloadImplForTest(impl: DownloadExecutor | undefined): void {
  downloadImpl = impl ?? defaultDownloadImpl
}

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

/**
 * 下载 APK 到应用 cache 目录（原生网络栈 + 镜像 fallback），返回 cache 相对路径。
 * 说明：GitHub 资产响应无 CORS 头，WebView fetch 会被拦截（Failed to fetch）——
 * 必须走 Capacitor 原生下载；直连失败自动尝试镜像源。
 */
export async function downloadApk(url: string, fileName: string): Promise<string> {
  const path = `updates/${fileName}`
  const errors: string[] = []
  for (const build of DOWNLOAD_SOURCES) {
    const target = build(url)
    try {
      await downloadImpl.download(target, path)
      return path
    } catch (error) {
      errors.push(`${target.replace(/^https?:\/\//, '').split('/')[0]}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`APK 下载失败（直连与镜像源均不可达）：${errors.join('；')}。请检查网络后重试`)
}

/** 触发系统安装（返回是否已启动安装界面；Android 8+ 需用户允许未知来源） */
export async function installApk(cachePath: string): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('当前平台暂不支持应用内安装 APK（仅 Android）')
  }
  const res = await ApkInstaller.install({ path: cachePath })
  return res.installed
}

/** 字节数人性化显示 */
export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
