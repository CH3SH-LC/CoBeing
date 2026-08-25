#!/usr/bin/env node
/**
 * 内核发布打包：esbuild bundle bridge CLI → kernel.mjs（external node-pty）
 * + 复制 node-pty 原生模块目录 + node.exe 便携运行时 → gui/src-tauri/resources/kernel/
 *
 * 产物结构（Tauri bundle.resources 整目录包含）：
 *   resources/kernel/
 *     node.exe                    # Node 便携运行时（免目标机安装 Node）
 *     kernel.mjs                  # 编译后的内核 CLI（bridge+core+types 全 bundle）
 *     node_modules/node-pty/      # 原生模块（lib + prebuilds + conpty agent）
 *
 * 用法：node scripts/build-kernel-dist.mjs
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'gui', 'src-tauri', 'resources', 'kernel')
const ptyDir = join(root, 'node_modules', '.pnpm', 'node-pty@1.1.0', 'node_modules', 'node-pty')

// 1. 清理 + 建目录
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'node_modules'), { recursive: true })

// 2. esbuild bundle（用 store 里的 esbuild 0.28.2）
const esbuildPath = join(root, 'node_modules', '.pnpm', 'esbuild@0.28.2', 'node_modules', 'esbuild')
if (!existsSync(esbuildPath)) throw new Error(`esbuild not found: ${esbuildPath}`)
const esbuild = await import(pathToFileURL(join(esbuildPath, 'lib', 'main.js')).href)
const result = await esbuild.build({
  entryPoints: [join(root, 'packages', 'bridge', 'src', 'cli.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node-pty', 'ws'],
  outfile: join(outDir, 'kernel.mjs'),
  sourcemap: false,
  logLevel: 'warning',
})
if (result.errors.length > 0) throw new Error(`esbuild failed: ${JSON.stringify(result.errors)}`)
console.log(`✓ kernel.mjs 生成（${(await import('node:fs')).statSync(join(outDir, 'kernel.mjs')).size} bytes）`)

// 3. 复制 node-pty（lib + prebuilds + package.json + conpty agent）
if (!existsSync(ptyDir)) throw new Error(`node-pty not found: ${ptyDir}`)
cpSync(ptyDir, join(outDir, 'node_modules', 'node-pty'), {
  recursive: true,
  filter: (src) => {
    // 排除测试与源码 map（保留 lib/prebuilds/package.json）
    if (src.includes('test') || src.endsWith('.map')) return false
    return true
  },
})
console.log('✓ node-pty 原生模块已复制')

// 3b. 复制 ws（CJS 包，external 保留运行时 require 语义）
const wsDir = join(root, 'node_modules', '.pnpm', 'ws@8.21.3', 'node_modules', 'ws')
if (!existsSync(wsDir)) throw new Error(`ws not found: ${wsDir}`)
cpSync(wsDir, join(outDir, 'node_modules', 'ws'), {
  recursive: true,
  filter: (src) => {
    if (src.includes('test') || src.endsWith('.map')) return false
    return true
  },
})
console.log('✓ ws 已复制')

// 4. 复制 node.exe（便携运行时）
const nodeExe = process.execPath
copyFileSync(nodeExe, join(outDir, 'node.exe'))
console.log(`✓ node.exe 已复制（${(await import('node:fs')).statSync(join(outDir, 'node.exe')).size} bytes）`)

// 5. 版本标记
writeFileSync(join(outDir, 'kernel.version.json'), JSON.stringify({ builtAt: new Date().toISOString(), node: process.version }, null, 2))

// 6. 冒烟：打包后的内核能启动（--remote-port 0 随机端口）
console.log('冒烟：打包内核启动测试…')
const smoke = spawnSync(
  join(outDir, 'node.exe'),
  [join(outDir, 'kernel.mjs'), '--data', join(root, 'releases', 'kernel-smoke-data'), '--remote-port', '0'],
  { cwd: outDir, encoding: 'utf8', timeout: 20000, env: { ...process.env } },
)
const out = `${smoke.stdout ?? ''}${smoke.stderr ?? ''}`
if (!/listening on ws/.test(out)) {
  console.error('✗ 内核冒烟失败：', out.slice(-800))
  process.exit(1)
}
console.log(`✓ 内核冒烟通过（listening 已输出）`)
console.log(`产物目录：${outDir}`)
