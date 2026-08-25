/**
 * 远程控制服务（手机端/远程控制面，方案 v1）
 *
 * - 面板注册器：面板 manifest + 动作分发——插件扩展面：新增控制能力 = 内核侧注册面板/动作，
 *   手机 app 按 manifest 泛化渲染，无需发版。
 * - 内置动作：截屏 / 剪贴板 / 媒体键 / 电源（锁屏·睡眠）/ 文件浏览·下载·上传（root 白名单）。
 * - PowerShell 执行可注入（测试替换）；文件操作走 node fs（root 逃逸拒绝）。
 */

import { spawn } from 'node:child_process'
import { readdir, readFile, stat, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, resolve, sep, extname, basename } from 'node:path'

export const REMOTE_SERVER_NAME = 'CoBeing Kernel'
export const REMOTE_SERVER_VERSION = '2.0.0'
/** 下载/上传单文件上限（20MB） */
export const REMOTE_MAX_FILE_BYTES = 20 * 1024 * 1024
/** 目录列表条目上限 */
const REMOTE_MAX_ENTRIES = 1000

// ---------- 面板契约（app 泛化渲染依据） ----------

export type PanelControl =
  | { type: 'button'; id: string; label: string; icon?: string; confirm?: string }
  | { type: 'toggle'; id: string; label: string; value: boolean }
  | { type: 'input'; id: string; label: string; placeholder?: string }
  | { type: 'display'; id: string; label: string; value?: string }

export interface PanelSection {
  title: string
  controls: PanelControl[]
}

export interface PanelManifest {
  id: string
  name: string
  icon?: string
  sections: PanelSection[]
}

export type PanelActionHandler = (params: unknown) => Promise<unknown> | unknown

export interface RemoteControlOptions {
  /** 默认文件根（未显式指定 roots 时使用） */
  dataRoot: string
  /** 允许的文件根（追加到 dataRoot 之外的可访问目录） */
  roots?: string[]
  /** PowerShell 执行注入（默认 spawn powershell.exe；测试可替换） */
  execPwsh?: (script: string) => Promise<string>
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  log: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export class RemoteControlService {
  readonly dataRoot: string
  private roots: string[]
  private execPwsh: (script: string) => Promise<string>
  private panels = new Map<string, PanelManifest>()
  /** action key: `${panel}:${action}` → handler */
  private actions = new Map<string, PanelActionHandler>()

  constructor(opts: RemoteControlOptions) {
    this.dataRoot = opts.dataRoot
    this.roots = [opts.dataRoot, ...(opts.roots ?? [])].map((r) => resolve(r))
    this.execPwsh = opts.execPwsh ?? defaultExecPwsh
    this.registerBuiltinPanels()
  }

  // ---------- 面板（插件扩展面） ----------

  /** 注册面板：manifest + 动作表；动作经 remote/invoke 分发 */
  registerPanel(manifest: PanelManifest, actions: Record<string, PanelActionHandler>): void {
    this.panels.set(manifest.id, manifest)
    for (const [action, handler] of Object.entries(actions)) {
      this.actions.set(`${manifest.id}:${action}`, handler)
    }
  }

  listPanels(): PanelManifest[] {
    return [...this.panels.values()]
  }

  /** 执行面板动作；未注册 → 业务错误 */
  async invoke(panel: string, action: string, params: unknown): Promise<unknown> {
    const handler = this.actions.get(`${panel}:${action}`)
    if (!handler) throw new Error(`remote action not found: ${panel}/${action}`)
    return handler(params)
  }

  // ---------- 内置动作（quick 面板） ----------

  private registerBuiltinPanels(): void {
    this.registerPanel(
      {
        id: 'quick',
        name: '快捷控制',
        icon: '⚡',
        sections: [
          {
            title: '快捷操作',
            controls: [
              { type: 'button', id: 'screenshot', label: '截屏', icon: '📷' },
              { type: 'button', id: 'lock', label: '锁屏', icon: '🔒', confirm: '锁定电脑？' },
              { type: 'button', id: 'sleep', label: '睡眠', icon: '😴', confirm: '让电脑进入睡眠？' },
            ],
          },
          {
            title: '媒体',
            controls: [
              { type: 'button', id: 'playPause', label: '播放/暂停', icon: '⏯️' },
              { type: 'button', id: 'volumeUp', label: '音量 +', icon: '🔊' },
              { type: 'button', id: 'volumeDown', label: '音量 -', icon: '🔉' },
              { type: 'button', id: 'mute', label: '静音', icon: '🔇' },
            ],
          },
          {
            title: '剪贴板',
            controls: [
              { type: 'button', id: 'clipboardGet', label: '获取剪贴板', icon: '📋' },
              { type: 'input', id: 'clipboardSet', label: '发送文本到电脑剪贴板', placeholder: '输入要发送的内容' },
            ],
          },
        ],
      },
      {
        screenshot: () => this.screenshot(),
        lock: () => this.power('lock'),
        sleep: () => this.power('sleep'),
        playPause: () => this.media('playPause'),
        volumeUp: () => this.media('volumeUp'),
        volumeDown: () => this.media('volumeDown'),
        mute: () => this.media('mute'),
        clipboardGet: () => this.clipboard('get'),
        clipboardSet: (params) => this.clipboard('set', (params as { text?: string })?.text ?? ''),
      },
    )
  }

  // ---------- 服务器信息 ----------

  info(): { name: string; version: string; dataRoot: string; roots: string[]; platform: string } {
    return {
      name: REMOTE_SERVER_NAME,
      version: REMOTE_SERVER_VERSION,
      dataRoot: this.dataRoot,
      roots: [...this.roots],
      platform: process.platform,
    }
  }

  listRoots(): string[] {
    return [...this.roots]
  }

  // ---------- 截屏 ----------

  async screenshot(): Promise<{ mime: string; base64: string }> {
    const script = [
      "Add-Type -AssemblyName System.Drawing",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$b=[System.Windows.Forms.SystemInformation]::VirtualScreen",
      "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height",
      "$g=[System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size)",
      "$p=Join-Path $env:TEMP ('cb-shot-'+[guid]::NewGuid().ToString('N')+'.png')",
      "$bmp.Save($p,[System.Drawing.Imaging.ImageFormat]::Png)",
      "$g.Dispose();$bmp.Dispose()",
      "Write-Output $p",
    ].join(';')
    const out = (await this.execPwsh(script)).trim()
    if (!out) throw new Error('screenshot failed: no output')
    const file = out.split(/\r?\n/).pop()?.trim() ?? ''
    try {
      const data = await readFile(file)
      await unlink(file).catch(() => undefined)
      return { mime: 'image/png', base64: data.toString('base64') }
    } catch (error) {
      throw new Error(`screenshot failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---------- 剪贴板 ----------

  async clipboard(op: 'get' | 'set', text?: string): Promise<{ text: string } | null> {
    if (op === 'get') {
      const out = (await this.execPwsh('Get-Clipboard -Raw')).trim()
      return { text: out }
    }
    const escaped = (text ?? '').replace(/'/g, "''")
    await this.execPwsh(`Set-Clipboard -Value '${escaped}'`)
    return null
  }

  // ---------- 媒体键 / 电源 ----------

  /** 虚拟键码：音量+/音量-/静音/播放暂停 */
  private static readonly MEDIA_KEYS: Record<string, number> = {
    volumeUp: 0xaf,
    volumeDown: 0xae,
    mute: 0xad,
    playPause: 0xb3,
  }

  async media(op: 'volumeUp' | 'volumeDown' | 'mute' | 'playPause'): Promise<null> {
    const key = RemoteControlService.MEDIA_KEYS[op]
    if (key === undefined) throw new Error(`unknown media op: ${op}`)
    const script = [
      "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class K{[DllImport(\"user32.dll\")]public static extern void keybd_event(byte b,byte s,uint f,System.UIntPtr x);}'",
      `[K]::keybd_event(${key},0,0,[System.UIntPtr]::Zero)`,
      `[K]::keybd_event(${key},0,2,[System.UIntPtr]::Zero)`,
    ].join(';')
    await this.execPwsh(script)
    return null
  }

  async power(op: 'lock' | 'sleep'): Promise<null> {
    if (op === 'lock') {
      await this.execPwsh('rundll32.exe user32.dll,LockWorkStation')
    } else if (op === 'sleep') {
      await this.execPwsh('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
    } else {
      throw new Error(`unknown power op: ${op}`)
    }
    return null
  }

  // ---------- 文件（root 白名单） ----------

  /** root 索引（remote/listFiles 的 root 参数 = 绝对路径或 roots 数组下标字符串均可） */
  private resolveRoot(rootParam: string): string {
    const index = Number.parseInt(rootParam, 10)
    if (Number.isInteger(index) && index >= 0 && index < this.roots.length) return this.roots[index]
    const resolved = resolve(rootParam)
    if (this.roots.includes(resolved)) return resolved
    throw new Error(`root not allowed: ${rootParam}`)
  }

  /** 相对路径约束在 root 内（拒绝 .. 逃逸） */
  private resolveWithin(root: string, rel: string): string {
    const target = resolve(root, rel.replace(/\//g, sep))
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`path escapes root: ${rel}`)
    }
    return target
  }

  async listFiles(
    rootParam: string,
    rel: string,
  ): Promise<{ root: string; path: string; entries: { name: string; isDir: boolean; size: number; mtime: number }[] }> {
    const root = this.resolveRoot(rootParam)
    const dir = this.resolveWithin(root, rel)
    const names = await readdir(dir, { withFileTypes: true })
    const entries = await Promise.all(
      names.slice(0, REMOTE_MAX_ENTRIES).map(async (d) => {
        let size = 0
        let mtime = 0
        try {
          const s = await stat(join(dir, d.name))
          size = s.size
          mtime = s.mtimeMs
        } catch {
          // 无权限/并发删除：保持 0
        }
        return { name: d.name, isDir: d.isDirectory(), size, mtime }
      }),
    )
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    return { root, path: rel, entries }
  }

  async download(rootParam: string, rel: string): Promise<{ name: string; size: number; mime: string; base64: string }> {
    const root = this.resolveRoot(rootParam)
    const file = this.resolveWithin(root, rel)
    const s = await stat(file)
    if (!s.isFile()) throw new Error('not a file')
    if (s.size > REMOTE_MAX_FILE_BYTES) throw new Error(`file too large: ${s.size} > ${REMOTE_MAX_FILE_BYTES}`)
    const data = await readFile(file)
    return {
      name: basename(file),
      size: data.length,
      mime: MIME_BY_EXT[extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream',
      base64: data.toString('base64'),
    }
  }

  async upload(rootParam: string, dirRel: string, name: string, base64: string): Promise<{ path: string; size: number }> {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw new Error(`invalid file name: ${name}`)
    }
    const root = this.resolveRoot(rootParam)
    const dir = this.resolveWithin(root, dirRel)
    const data = Buffer.from(base64, 'base64')
    if (data.length > REMOTE_MAX_FILE_BYTES) throw new Error(`file too large: ${data.length} > ${REMOTE_MAX_FILE_BYTES}`)
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, data)
    return { path: file, size: data.length }
  }
}

// ---------- PowerShell 执行（默认实现） ----------

function defaultExecPwsh(script: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`powershell exited ${code}: ${stderr.trim().slice(0, 500) || stdout.trim().slice(0, 500)}`))
    })
  })
}
