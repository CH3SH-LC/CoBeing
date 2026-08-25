/**
 * 远程控制服务（方案 v1）：面板 manifest / 动作分发 / 截屏 / 剪贴板 / 媒体键 / 电源 / 文件（root 白名单）
 *
 * - PowerShell 环节注入 fake exec 断言脚本内容（媒体键/电源/剪贴板 set）。
 * - 文件操作真实 fs（临时目录）。
 * - 真实验证（仅 win32）：截屏返回 PNG base64、剪贴板 get 返回字符串。
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { RemoteControlService, REMOTE_MAX_FILE_BYTES, type PanelManifest } from '../src/remote-control.js'

const dirs: string[] = []
const roots: string[] = []

function makeService(execScripts: string[] = []): RemoteControlService {
  const root = mkdtempSync(join(tmpdir(), 'cb-remote-'))
  const dataRoot = join(root, 'data')
  mkdirSync(dataRoot, { recursive: true })
  dirs.push(root)
  roots.push(root)
  return new RemoteControlService({
    dataRoot,
    execPwsh: async (script) => {
      execScripts.push(script)
      return ''
    },
  })
}

/** 不注入 execPwsh：走真实 powershell.exe（真实验证用） */
function makeRealService(): RemoteControlService {
  const root = mkdtempSync(join(tmpdir(), 'cb-remote-'))
  const dataRoot = join(root, 'data')
  mkdirSync(dataRoot, { recursive: true })
  dirs.push(root)
  roots.push(root)
  return new RemoteControlService({ dataRoot })
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
  roots.length = 0
})

describe('RemoteControlService 面板', () => {
  test('quick 面板 manifest 结构（三 section：快捷操作/媒体/剪贴板）', () => {
    const svc = makeService()
    const panels = svc.listPanels()
    expect(panels).toHaveLength(1)
    const quick = panels[0]
    expect(quick.id).toBe('quick')
    expect(quick.name).toBe('快捷控制')
    const ids = quick.sections.flatMap((s) => s.controls.map((c) => c.id))
    expect(ids).toContain('screenshot')
    expect(ids).toContain('lock')
    expect(ids).toContain('sleep')
    expect(ids).toContain('playPause')
    expect(ids).toContain('volumeUp')
    expect(ids).toContain('volumeDown')
    expect(ids).toContain('mute')
    expect(ids).toContain('clipboardGet')
    expect(ids).toContain('clipboardSet')
    // 危险操作带二次确认
    const lock = quick.sections[0].controls.find((c) => c.id === 'lock')
    expect(lock?.type === 'button' && lock.confirm).toBeTruthy()
  })

  test('invoke：已注册动作执行；未注册动作业务错误', async () => {
    const scripts: string[] = []
    const svc = makeService(scripts)
    await svc.invoke('quick', 'playPause', undefined)
    expect(scripts[0]).toContain('keybd_event')
    await expect(svc.invoke('quick', 'nope', undefined)).rejects.toThrow('remote action not found')
    await expect(svc.invoke('ghost', 'x', undefined)).rejects.toThrow('remote action not found')
  })

  test('registerPanel：自定义面板可注册并分发（插件扩展面）', async () => {
    const svc = makeService()
    svc.registerPanel(
      { id: 'my', name: '自定义', sections: [{ title: 't', controls: [{ type: 'button', id: 'b', label: 'B' }] }] },
      { b: () => ({ done: true }) },
    )
    expect(svc.listPanels()).toHaveLength(2)
    await expect(svc.invoke('my', 'b', undefined)).resolves.toEqual({ done: true })
    await expect(svc.invoke('my', 'c', undefined)).rejects.toThrow('remote action not found')
  })
})

describe('RemoteControlService 媒体/电源（脚本断言）', () => {
  test('媒体键：音量+/音量-/静音/播放暂停 → keybd_event 按下+抬起', async () => {
    const cases: [string, number][] = [
      ['volumeUp', 0xaf],
      ['volumeDown', 0xae],
      ['mute', 0xad],
      ['playPause', 0xb3],
    ]
    for (const [op, key] of cases) {
      const scripts: string[] = []
      const svc = makeService(scripts)
      await svc.media(op as never)
      expect(scripts[0]).toContain(`keybd_event(${key},0,0`)
      expect(scripts[0]).toContain(`keybd_event(${key},0,2`)
    }
  })

  test('电源：lock → rundll32 LockWorkStation；sleep → SetSuspendState', async () => {
    const scripts: string[] = []
    const svc = makeService(scripts)
    await svc.power('lock')
    await svc.power('sleep')
    expect(scripts[0]).toContain('LockWorkStation')
    expect(scripts[1]).toContain('SetSuspendState 0,1,0')
  })

  test('剪贴板 set：单引号转义；get 返回文本', async () => {
    const scripts: string[] = []
    const svc = makeService(scripts)
    await svc.clipboard('set', "it's ok")
    expect(scripts[0]).toBe("Set-Clipboard -Value 'it''s ok'")
  })
})

describe('RemoteControlService 文件（root 白名单）', () => {
  test('listFiles：目录优先排序 + size/mtime；信息返回 roots', async () => {
    const svc = makeService()
    const dataRoot = svc.dataRoot
    writeFileSync(join(dataRoot, 'a.txt'), 'hello')
    mkdirSync(join(dataRoot, 'sub'))
    const result = await svc.listFiles(dataRoot, '')
    expect(result.entries.map((e) => e.name)).toEqual(['sub', 'a.txt'])
    const a = result.entries.find((e) => e.name === 'a.txt')
    expect(a?.isDir).toBe(false)
    expect(a?.size).toBe(5)
    expect(svc.listRoots()).toContain(dataRoot)
    const info = svc.info()
    expect(info.name).toBe('CoBeing Kernel')
    expect(info.dataRoot).toBe(dataRoot)
  })

  test('download：base64 往返 + mime 推断；upload：写盘往返', async () => {
    const svc = makeService()
    const dataRoot = svc.dataRoot
    writeFileSync(join(dataRoot, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const dl = await svc.download(dataRoot, 'pic.png')
    expect(dl.mime).toBe('image/png')
    expect(dl.base64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))
    expect(dl.name).toBe('pic.png')

    const up = await svc.upload(dataRoot, 'incoming', 'note.txt', Buffer.from('hi').toString('base64'))
    expect(up.size).toBe(2)
    const list = await svc.listFiles(dataRoot, 'incoming')
    expect(list.entries.map((e) => e.name)).toContain('note.txt')
  })

  test('安全：root 逃逸 / 路径逃逸 / 非法文件名 / 超大文件拒绝', async () => {
    const svc = makeService()
    await expect(svc.listFiles('/definitely/not/allowed', '')).rejects.toThrow('root not allowed')
    await expect(svc.listFiles(svc.dataRoot, '../escape')).rejects.toThrow('path escapes root')
    await expect(svc.listFiles(svc.dataRoot, 'a/../../escape')).rejects.toThrow('path escapes root')
    await expect(svc.upload(svc.dataRoot, '', '../evil.txt', 'AA==')).rejects.toThrow('invalid file name')
    await expect(
      svc.upload(svc.dataRoot, '', 'ok.bin', Buffer.alloc(REMOTE_MAX_FILE_BYTES + 1).toString('base64')),
    ).rejects.toThrow('file too large')
  })

  test('download：目录拒绝', async () => {
    const svc = makeService()
    mkdirSync(join(svc.dataRoot, 'dir'))
    await expect(svc.download(svc.dataRoot, 'dir')).rejects.toThrow('not a file')
  })
})

describe('RemoteControlService 真实 PowerShell（win32）', () => {
  const isWin = process.platform === 'win32'
  test.skipIf(!isWin)('截屏：真实 CopyFromScreen 返回 PNG base64', async () => {
    const svc = makeRealService()
    const shot = await svc.screenshot()
    expect(shot.mime).toBe('image/png')
    const header = Buffer.from(shot.base64, 'base64').subarray(0, 8).toString('hex')
    expect(header).toBe('89504e470d0a1a0a')
  }, 20000)

  test.skipIf(!isWin)('剪贴板 get：真实读取返回字符串', async () => {
    const svc = makeRealService()
    const result = await svc.clipboard('get')
    expect(typeof result?.text).toBe('string')
  }, 15000)
})

// 类型引用（防 manifest 契约漂移）
const _manifest: PanelManifest = { id: 'x', name: 'x', sections: [] }
void _manifest
