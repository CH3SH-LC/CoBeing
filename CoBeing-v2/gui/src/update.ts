/**
 * 电脑端更新模块：检查 GitHub Releases 新版本 + 下载安装包 + 启动安装程序
 *
 * 数据源：https://api.github.com/repos/CH3SH-LC/CoBeing/releases（Rust 侧代理）
 * 资产命名：CoBeing.v2_<版本>_x64-setup.exe
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface DesktopUpdateInfo {
  latest_tag: string
  published_at: string
  body: string
  asset_name: string
  asset_url: string
  asset_size: number
  has_update: boolean
  current_version: string
}

export interface DownloadProgress {
  received: number
  total: number
}

/** 检查电脑端是否有新版本（Rust 命令：GitHub API + 版本比较） */
export function checkUpdate(): Promise<DesktopUpdateInfo> {
  return invoke('check_update')
}

/** 下载安装包到应用数据目录 updates/，返回本地路径（Rust 命令：GitHub→镜像 多源链+续传+完整性校验） */
export function downloadInstaller(url: string, assetName: string, expectedSize: number): Promise<string> {
  return invoke('download_installer', { url, assetName, expectedSize })
}

/** 启动已下载的 NSIS 安装程序（Rust 命令） */
export function launchInstaller(path: string): Promise<void> {
  return invoke('launch_installer', { path })
}

/** 订阅下载进度事件；返回取消函数 */
export function onDownloadProgress(cb: (p: DownloadProgress) => void): Promise<UnlistenFn> {
  return listen<DownloadProgress>('update-progress', (event) => cb(event.payload))
}

/** 字节数人性化显示（<1MB 显示 KB，否则 MB） */
export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
