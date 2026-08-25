/**
 * persistent-bash 真实持久会话测试（node-pty）
 *
 * - 真实环境验证：echo 输出、跨调用变量持久性、超时重置。
 * - 命令语法按探测到的 shell 模式（bash / powershell）适配。
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { PersistentBash } from '../src/tools/bash.js'

const shells: PersistentBash[] = []

async function makeShell(): Promise<PersistentBash> {
  const dir = mkdtempSync(join(tmpdir(), 'cb-bash-'))
  const shell = new PersistentBash(dir)
  // 触发模式探测
  await shell.exec('echo probe')
  shells.push(shell)
  return shell
}

afterEach(() => {
  while (shells.length) shells.pop()?.dispose()
})

describe('persistent-bash (node-pty)', () => {
  test('执行简单命令并返回输出', async () => {
    const shell = await makeShell()
    const result = await shell.exec('echo hello-cb')
    expect(result.ok).toBe(true)
    expect(result.output).toContain('hello-cb')
  }, 30_000)

  test('环境变量跨调用持久（核心持久性语义）', async () => {
    const shell = await makeShell()
    const mode = shell.mode
    const setCmd = mode === 'bash' ? 'export CB_PERSIST=42' : '$env:CB_PERSIST = "42"'
    const getCmd = mode === 'bash' ? 'echo $CB_PERSIST' : 'echo $env:CB_PERSIST'
    const first = await shell.exec(setCmd)
    expect(first.ok).toBe(true)
    const second = await shell.exec(getCmd)
    expect(second.ok).toBe(true)
    expect(second.output).toContain('42')
  }, 30_000)

  test('cwd 跨调用持久', async () => {
    const shell = await makeShell()
    const mode = shell.mode
    const setCmd = mode === 'bash' ? 'export CB_CWD=$(pwd)' : '$env:CB_CWD = (Get-Location).Path'
    const getCmd = mode === 'bash' ? 'echo $CB_CWD' : 'echo $env:CB_CWD'
    expect((await shell.exec(setCmd)).ok).toBe(true)
    const second = await shell.exec(getCmd)
    expect(second.ok).toBe(true)
    expect(second.output.trim()).not.toBe('')
  }, 30_000)

  test('超时后会话关闭并返回 reset 标记', async () => {
    const shell = await makeShell()
    const sleepCmd = shell.mode === 'bash' ? 'sleep 10' : 'Start-Sleep -Seconds 10'
    const result = await shell.exec(sleepCmd, 500)
    expect(result.ok).toBe(false)
    expect(result.reset).toBe(true)
    expect(result.output).toContain('timeout')
  }, 15_000)

  test('输出截断保留最早前缀', async () => {
    const shell = await makeShell()
    const seqCmd = shell.mode === 'bash'
      ? 'seq 1 5000 | sed "s/^/line-/"'
      : '1..5000 | ForEach-Object { "line-$_" }'
    const result = await shell.exec(seqCmd)
    expect(result.ok).toBe(true)
    expect(result.output).toContain('line-1')
    expect(result.output).toContain('truncated')
  }, 60_000)

  test('语法错误命令不挂起（标记行独立提交）', async () => {
    const shell = await makeShell()
    // PowerShell 5.1 不支持 bash 风格 && —— 整行语法拒绝；修复前会挂起等超时
    const badCmd = shell.mode === 'bash'
      ? 'true && echo never'
      : 'Write-Host "x" && Write-Host "y"'
    const result = await shell.exec(badCmd, 8000)
    expect(result.ok).toBe(true) // 标记行仍执行，命令返回而非超时
    expect(result.reset).toBeUndefined()
  }, 20_000)

  test('引号路径 + cd 组合命令正常执行', async () => {
    const shell = await makeShell()
    const mode = shell.mode
    const cmd = mode === 'bash'
      ? `cd "${shell.cwdForTest}" && pwd`
      : `Set-Location "${shell.cwdForTest}"; (Get-Location).Path`
    const result = await shell.exec(cmd, 8000)
    expect(result.ok).toBe(true)
    expect(result.output).toContain(shell.cwdForTest)
  }, 20_000)
})
