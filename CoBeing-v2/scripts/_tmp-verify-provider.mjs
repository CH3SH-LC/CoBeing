/**
 * 临时验证：安装版内核 + 真实数据目录 → provider 加载与真实调用
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import os from 'node:os'
import { join } from 'node:path'

const kernelDir = 'D:\\cobeing\\resources\\kernel'
const dataRoot = join(os.homedir(), 'AppData', 'Roaming', 'com.cobeing.v2')

const child = spawn(join(kernelDir, 'node.exe'), [join(kernelDir, 'kernel.mjs'), '--data', dataRoot], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: kernelDir,
})
let stderr = ''
child.stderr.on('data', (d) => (stderr += d.toString('utf8')))
const rl = createInterface({ input: child.stdout })

let seq = 0
const pending = new Map()
rl.on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      p(msg)
    }
  }
  if (msg.method === 'notify') {
    console.log('[notify]', JSON.stringify(msg.params).slice(0, 200))
  }
})

function req(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await sleep(1500)
  const ping = await req('ping')
  console.log('ping:', JSON.stringify(ping))

  // 但丁真实对话（等待回复）
  console.log('\n[mainWindowSpeak] 发送：请简单回复“真实调用测试”四个字')
  await req('mainWindowSpeak', { content: '请简单回复：真实调用测试' })
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    const proj = await req('butlerProjection')
    const msgs = proj.result?.publicMessages ?? []
    const last = msgs[msgs.length - 1]
    if (last && last.actor === 'butler') {
      console.log('[但丁回复]', last.content.slice(0, 300))
      break
    }
    if (i === 39) console.log('[超时] 40 轮未等到但丁回复')
  }

  const status = await req('remote/status')
  console.log('\nremote/status（provider 相关不可见，看内核 stderr 末尾）')
} finally {
  child.kill()
  await sleep(500)
  console.log('\n===== 内核 stderr（末尾 40 行）=====')
  console.log(stderr.split('\n').slice(-40).join('\n'))
}
