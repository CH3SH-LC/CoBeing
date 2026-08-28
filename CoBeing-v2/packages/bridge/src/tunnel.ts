/**
 * cloudflared 隧道自动管理（方案 v2：配对成功后自动构建公网连接）
 *
 * - 探测 cloudflared：环境变量 COBEING_CLOUDFLARED → PATH → <toolsDir>/cloudflared(.exe)
 * - 缺失时自动下载（GitHub latest release；Windows amd64 直链）
 * - 启动 `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate --protocol http2`
 *   （http2：QUIC/UDP 在国内网络/代理 fake-ip 环境常被丢弃，TCP 更稳——与 remote.ps1 同策略）
 * - 轮询子进程日志抓取 https://<随机>.trycloudflare.com 地址，就绪后回调 onUrl
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { join } from 'node:path'

export interface TunnelManagerOptions {
  /** 本地 WS 端口（隧道转发目标） */
  port: number
  /** cloudflared 安装目录（默认 <cwd>/tools） */
  toolsDir?: string
  /** cloudflared 缺失时自动下载（默认 true） */
  download?: boolean
  protocol?: 'http2' | 'quic'
  /** URL 抓取超时 ms（默认 90s） */
  timeoutMs?: number
  /** 子进程日志行回调 */
  onLog?: (line: string) => void
  /** 子进程启动器（测试注入；默认 node:child_process spawn） */
  spawnImpl?: typeof spawn
}

const TUNNEL_URL_RE = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/

export class TunnelManager {
  private child: ChildProcess | undefined
  private url: string | null = null
  private startedUrl: string | null = null
  private readonly opts: TunnelManagerOptions
  private readonly spawnFn: typeof spawn

  constructor(opts: TunnelManagerOptions) {
    this.opts = opts
    this.spawnFn = opts.spawnImpl ?? spawn
  }

  get tunnelUrl(): string | null {
    return this.url
  }

  get running(): boolean {
    return this.child !== undefined && this.child.exitCode === null && this.child.signalCode === null
  }

  /**
   * 启动隧道并等待 URL 就绪。幂等：
   * - 已在运行且已拿到 URL → 立即返回当前 URL
   * - 已在运行但 URL 未就绪 → 等待就绪/超时
   */
  start(): Promise<{ url: string }> {
    if (this.startedUrl) return Promise.resolve({ url: this.startedUrl })
    if (this.running) return this.waitForUrl()
    return this.launch()
  }

  /** 等待已运行的隧道产出 URL（上限 timeoutMs） */
  private waitForUrl(): Promise<{ url: string }> {
    const timeoutMs = this.opts.timeoutMs ?? 90_000
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve, reject) => {
      const check = (): void => {
        if (this.url) {
          this.startedUrl = this.url
          resolve({ url: this.url })
          return
        }
        if (!this.running || Date.now() > deadline) {
          reject(new Error('等待隧道地址超时'))
          return
        }
        setTimeout(check, 300)
      }
      check()
    })
  }

  /** 停止隧道（幂等） */
  stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return Promise.resolve()
    return new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已退出
        }
      }, 3000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolvePromise()
      })
      try {
        child.kill()
      } catch {
        resolvePromise()
      }
    })
  }

  // ---------- 内部 ----------

  private launch(): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      void this.launchAsync().then(
        (u) => {
          this.startedUrl = u
          resolve({ url: u })
        },
        (e) => reject(e),
      )
    })
  }

  private async launchAsync(): Promise<string> {
    const bin = await this.resolveBinary()
    const child = this.spawnFn(
      bin,
      ['tunnel', '--url', `http://127.0.0.1:${this.opts.port}`, '--no-autoupdate', '--protocol', this.opts.protocol ?? 'http2'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    this.child = child
    this.url = null

    let buffer = ''
    const collect = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      // 保留尾部（跨 chunk 匹配）
      if (buffer.length > 16 * 1024) buffer = buffer.slice(-16 * 1024)
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        this.opts.onLog?.(line)
        const match = TUNNEL_URL_RE.exec(line)
        if (match && !this.url) {
          this.url = match[1] ? `https://${match[1]}` : match[0]
        }
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    const timeoutMs = this.opts.timeoutMs ?? 90_000
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.stop()
        reject(new Error('cloudflared 启动超时：90s 内未获取隧道地址（检查网络/防火墙）'))
      }, timeoutMs)
      timer.unref?.()
      const check = (): void => {
        if (this.url) {
          clearTimeout(timer)
          resolve(this.url)
          return
        }
        if (child.exitCode !== null) {
          clearTimeout(timer)
          reject(new Error(`cloudflared 进程退出（code=${child.exitCode}），检查网络或日志`))
          return
        }
        setTimeout(check, 300)
      }
      check()
    })
  }

  private async resolveBinary(): Promise<string> {
    const envBin = process.env.COBEING_CLOUDFLARED
    if (envBin) return envBin
    // PATH 探测
    const pathBin = await findOnPath('cloudflared')
    if (pathBin) return pathBin
    const toolsDir = this.opts.toolsDir ?? join(process.cwd(), 'tools')
    const local = process.platform === 'win32' ? join(toolsDir, 'cloudflared.exe') : join(toolsDir, 'cloudflared')
    try {
      await stat(local)
      return local
    } catch {
      // 不存在 → 下载
    }
    if (this.opts.download === false) throw new Error(`cloudflared 不存在：${local}（可设置 COBEING_CLOUDFLARED 或放入 tools/）`)
    return this.download(toolsDir, local)
  }

  private async download(toolsDir: string, target: string): Promise<string> {
    await mkdir(toolsDir, { recursive: true })
    const isWin = process.platform === 'win32'
    const asset = isWin
      ? 'cloudflared-windows-amd64.exe'
      : process.platform === 'darwin'
        ? 'cloudflared-darwin-amd64.tgz'
        : 'cloudflared-linux-amd64'
    const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`
    this.opts.onLog?.(`[tunnel] 下载 cloudflared（GitHub 直连约 50MB，慢属正常）: ${url}`)
    const response = await fetch(url)
    if (!response.ok || !response.body) throw new Error(`cloudflared 下载失败（HTTP ${response.status}）`)
    const tmp = `${target}.download`
    const file = createWriteStream(tmp)
    await new Promise<void>((resolvePromise, reject) => {
      Readable.fromWeb(response.body as never)
        .pipe(file)
        .on('finish', () => resolvePromise())
        .on('error', reject)
    })
    await rename(tmp, target)
    return target
  }
}

// ---------- 工具 ----------

function findOnPath(name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
    const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, `${name}${ext}`)
        if (existsSync(candidate)) {
          resolve(candidate)
          return
        }
      }
    }
    resolve(undefined)
  })
}
