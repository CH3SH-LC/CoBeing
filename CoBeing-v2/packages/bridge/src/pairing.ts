/**
 * 自动配对服务（方案 v2：局域网发现 → 手机确认 → 密钥交换）
 *
 * - 手机经 WS 连接在未鉴权阶段发 `pair/request {deviceId, deviceName}`；
 *   本服务校验后生成/更新配对记录（持久化 <dataRoot>/remote.pairs.json），
 *   并向手机返回服务器 token + 连接信息（LAN 地址）。
 * - token 与手动模式同一把（<dataRoot>/remote.token）：拿到 token 的手机走标准 auth。
 * - 同一 deviceId 重新配对 = 刷新记录（token 不变，直接可用）；revoke 解除配对。
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PairRecord {
  deviceId: string
  deviceName: string
  /** 该设备最后配对时间 */
  pairedAt: number
}

export interface PairRequestParams {
  deviceId: string
  deviceName: string
}

export interface PairResult {
  token: string
  server: {
    name: string
    version: string
    dataRoot: string
    lanUrl: string
    protocol: 'cobeing-ws/1'
  }
}

export interface PairingServiceOptions {
  dataRoot: string
  /** 服务器全局 token（与 remote.token 同一把；所有配对共用） */
  token: string
  name: string
  version: string
  lanUrl: string
  onPaired?: (record: PairRecord) => void
  onRevoked?: (deviceId: string, deviceName: string) => void
}

const DEVICE_ID_MAX = 128
const DEVICE_NAME_MAX = 64

export class PairingService {
  private records: PairRecord[] = []
  private readonly pairsFile: string
  private readonly opts: PairingServiceOptions

  constructor(opts: PairingServiceOptions) {
    this.opts = opts
    this.pairsFile = join(opts.dataRoot, 'remote.pairs.json')
    this.records = this.load()
  }

  /**
   * 处理 pair/request。失败抛 Error（remote 层映射 -32000/-32602）。
   * 成功：记录持久化 + onPaired 回调（供广播 notify），返回 token 与服务器信息。
   */
  handlePairRequest(params: unknown): PairResult {
    if (!isObject(params) || typeof params.deviceId !== 'string' || typeof params.deviceName !== 'string') {
      throw new Error('invalid params: deviceId and deviceName are required')
    }
    const deviceId = params.deviceId.trim()
    const deviceName = params.deviceName.trim().slice(0, DEVICE_NAME_MAX)
    if (deviceId.length < 8 || deviceId.length > DEVICE_ID_MAX) {
      throw new Error('invalid params: deviceId must be 8-128 chars')
    }
    if (!deviceName) {
      throw new Error('invalid params: deviceName is required')
    }
    const now = Date.now()
    const existing = this.records.find((r) => r.deviceId === deviceId)
    if (existing) {
      existing.deviceName = deviceName
      existing.pairedAt = now
    } else {
      this.records.push({ deviceId, deviceName, pairedAt: now })
    }
    this.persist()
    this.opts.onPaired?.(existing ?? this.records[this.records.length - 1])
    return {
      token: this.opts.token,
      server: {
        name: this.opts.name,
        version: this.opts.version,
        dataRoot: this.opts.dataRoot,
        lanUrl: this.opts.lanUrl,
        protocol: 'cobeing-ws/1',
      },
    }
  }

  /** 已配对设备列表（按配对时间倒序） */
  list(): PairRecord[] {
    return [...this.records].sort((a, b) => b.pairedAt - a.pairedAt)
  }

  /** 更新 LAN 地址（remote 端口确定后调用；配对应答携带实际地址） */
  setLanUrl(lanUrl: string): void {
    this.opts.lanUrl = lanUrl
  }

  /** 解除配对；返回是否找到并移除 */
  revoke(deviceId: string): boolean {
    const index = this.records.findIndex((r) => r.deviceId === deviceId)
    if (index < 0) return false
    const [removed] = this.records.splice(index, 1)
    this.persist()
    this.opts.onRevoked?.(removed.deviceId, removed.deviceName)
    return true
  }

  // ---------- 持久化 ----------

  private load(): PairRecord[] {
    try {
      // 同步读（构造期）：文件不存在/损坏 → 空列表
      const raw = readFileSync(this.pairsFile, 'utf8')
      const parsed = JSON.parse(raw) as PairRecord[]
      return Array.isArray(parsed)
        ? parsed.filter((r) => isObject(r) && typeof r.deviceId === 'string' && typeof r.deviceName === 'string')
        : []
    } catch {
      return []
    }
  }

  /** 同步持久化（配对低频；同步写保证调用返回后文件已落盘，重启恢复可靠） */
  private persist(): void {
    try {
      mkdirSync(this.opts.dataRoot, { recursive: true })
      const tmp = `${this.pairsFile}.tmp`
      writeFileSync(tmp, JSON.stringify(this.records, null, 2))
      renameSync(tmp, this.pairsFile)
    } catch {
      // 持久化失败不阻断配对（记录在内存中仍生效）
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 生成随机设备配对码（预留：未来可做 6 位确认码二次校验） */
export function randomPairCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()
}
