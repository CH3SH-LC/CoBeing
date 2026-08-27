#!/usr/bin/env node
/**
 * 内核桥 CLI（bin: cobeing-kernel）
 *
 * - JSON-RPC 2.0 over stdio：stdin 逐行请求，stdout 逐行响应 + 用户通知通知。
 * - 远程 WS（方案 v1）：--remote-port <n> 启动 WebSocket 远程服务器（默认 127.0.0.1；--remote-host 0.0.0.0 供局域网手机直连），
 *   token 默认读/建 <dataRoot>/remote.token（--remote-token 可显式指定）；
 *   --remote-root <dir> 追加远程文件根（可重复）。通知同时广播给已鉴权 WS 连接。
 * - 用法：tsx packages/bridge/src/cli.ts [--data <dir>] [--remote-port <n>] [--remote-host <ip>] [--remote-token <t>] [--remote-root <dir>]
 * - 顶层 await（ESM）。停止：stop 方法 → kernel.stop + 进程自然退出；stdin EOF → 优雅退出。
 */

import { createInterface } from 'node:readline'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { NotifyPayload } from '@cobeing/types'
import { Kernel, DeepSeekProvider } from '@cobeing/core'
import { BridgeServer, type BridgeTransport } from './server.js'
import { RemoteServer } from './remote.js'
import { loadModelConfig } from './model-config.js'

export interface CliOptions {
  dataRoot: string
  remotePort?: number
  remoteToken?: string
  remoteRoots: string[]
  remoteHost?: string
}

function parseArgs(argv: string[]): CliOptions {
  let dataRoot = process.env.COBEING_DATA_ROOT ?? './data'
  let remotePort: number | undefined
  let remoteToken: string | undefined
  let remoteHost: string | undefined
  const remoteRoots: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--data') {
      dataRoot = argv[++i] || dataRoot
    } else if (arg?.startsWith('--data=')) {
      const value = arg.slice('--data='.length)
      if (value) dataRoot = value
    } else if (arg === '--remote-port') {
      const value = Number(argv[++i])
      // 0 = 随机端口（测试用）；有效范围 0-65535
      if (Number.isInteger(value) && value >= 0 && value < 65536) remotePort = value
    } else if (arg?.startsWith('--remote-port=')) {
      const value = Number(arg.slice('--remote-port='.length))
      if (Number.isInteger(value) && value >= 0 && value < 65536) remotePort = value
    } else if (arg === '--remote-host') {
      remoteHost = argv[++i]
    } else if (arg?.startsWith('--remote-host=')) {
      remoteHost = arg.slice('--remote-host='.length)
    } else if (arg === '--remote-token') {
      remoteToken = argv[++i]
    } else if (arg?.startsWith('--remote-token=')) {
      remoteToken = arg.slice('--remote-token='.length)
    } else if (arg === '--remote-root') {
      const value = argv[++i]
      if (value) remoteRoots.push(value)
    } else if (arg?.startsWith('--remote-root=')) {
      const value = arg.slice('--remote-root='.length)
      if (value) remoteRoots.push(value)
    }
  }
  return { dataRoot, remotePort, remoteToken, remoteRoots, remoteHost }
}

/** 读取或创建远程 token（<dataRoot>/remote.token）；创建时打印到 stderr（stdout 是协议通道，不能污染） */
async function loadOrCreateToken(dataRoot: string, explicit?: string): Promise<string> {
  if (explicit) return explicit
  const file = join(dataRoot, 'remote.token')
  try {
    const existing = (await readFile(file, 'utf8')).trim()
    if (existing) return existing
  } catch {
    // 不存在 → 创建
  }
  const token = randomBytes(24).toString('base64url')
  await mkdir(dataRoot, { recursive: true })
  await writeFile(file, token, { mode: 0o600 })
  process.stderr.write(`[remote] token file created: ${file}\n`)
  return token
}

export async function main(options: CliOptions = parseArgs(process.argv.slice(2))): Promise<void> {
  const { dataRoot } = options
  // 模型配置：GUI 设置界面写入的 model-config.json 优先；缺省字段回退环境变量
  const fileCfg = await loadModelConfig(dataRoot)
  const apiKey = fileCfg.api_key ?? process.env.DEEPSEEK_API_KEY
  const hasKey = Boolean(apiKey)

  // 远程服务器（kernel 构造后、start 前创建；通知广播闭包引用）
  let remote: RemoteServer | undefined

  const kernel = new Kernel(dataRoot, {
    providers: hasKey
      ? [new DeepSeekProvider({ apiKey, baseUrl: fileCfg.base_url, model: fileCfg.model })]
      : [],
    // 但丁默认 provider/model：真实 key 存在用 deepseek，否则 mock
    butlerProvider: hasKey ? 'deepseek' : 'mock',
    butlerModel: hasKey ? (fileCfg.model ?? 'deepseek-chat') : 'mock-model',
    remoteRoots: options.remoteRoots,
    notifyUser: (payload: NotifyPayload) => {
      writeLine(JSON.stringify({ jsonrpc: '2.0', method: 'notify', params: payload }))
      // 双向不阻塞：同一通知同时广播给所有已鉴权 WS 连接
      remote?.broadcast(payload)
    },
  })

  const stdioTransport: BridgeTransport = {
    send(line: string): void {
      writeLine(line)
    },
    onLine(cb: (line: string) => void): () => void {
      const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
      rl.on('line', cb)
      rl.on('close', () => {
        // stdin EOF（Ctrl-D / 管道关闭）→ 优雅停止。
        // 远程 WS 模式（--remote-port）下进程是网络服务器：stdin 可能天然关闭
        // （如 stdio 'ignore' 启动/后台运行），此时不自动停止，避免启动即自杀。
        if (options.remotePort === undefined) {
          void kernel.stop()
        }
      })
      return () => rl.close()
    },
  }

  const server = new BridgeServer(kernel, stdioTransport)
  // stop 方法已在内核侧执行 kernel.stop()；关闭远程服务器后自然退出
  server.setOnStop(() => {
    void remote?.stop()
  })

  // 先启动内核（含 working 群组恢复），再开放远程 WS 服务——
  // 否则客户端在恢复完成前查询 listGroups 会看到空列表（启动竞态，verify-sync 并行负载下复现）
  await kernel.start()
  server.noteKernelStarted()

  // 远程 WS 服务器（可选）
  if (options.remotePort !== undefined) {
    const token = await loadOrCreateToken(dataRoot, options.remoteToken)
    const host = options.remoteHost ?? '127.0.0.1'
    remote = new RemoteServer({ kernel, port: options.remotePort, token, host })
    const { port } = await remote.start()
    process.stderr.write(
      `[remote] listening on ws://${host}:${port} (LAN: ws://<电脑IP>:${port}; 外网: cloudflared 隧道 + wss)\n`,
    )
    process.stderr.write(`[remote] token=${token}\n`)
    if (options.remoteRoots.length > 0) {
      process.stderr.write(`[remote] extra roots: ${options.remoteRoots.join(', ')}\n`)
    }
  }

  // 开始逐行处理（CLI 侧直启，故标记 started 防 start RPC 重复启动）
  server.start()
}

function writeLine(line: string): void {
  // 保证单行输出（防御：内容中裸换行替换为空格，避免破坏行协议）
  process.stdout.write(line.replace(/\r?\n/g, ' ') + '\n')
}

export { writeLine }

// bin 直接运行：顶层 await 装配并启动（ESM）
await main()
