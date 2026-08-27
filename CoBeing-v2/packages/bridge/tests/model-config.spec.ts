/**
 * 模型配置文件加载（model-config.json v2 多来源）：解析规则 + 旧格式迁移 + active 选择
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { parseModelConfig, loadModelConfig, pickActiveSource } from '../src/model-config.js'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'cb-modelcfg-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('parseModelConfig (v2 多来源)', () => {
  test('解析完整多来源 JSON', () => {
    const cfg = parseModelConfig(
      '{"sources":[{"id":"a","name":"官方","api_key":"sk-a","base_url":"https://x.com","model":"deepseek-v4-flash"},{"id":"b","name":"备选","api_key":"sk-b","model":"deepseek-v4-pro"}],"active_source":"b"}',
    )
    expect(cfg.sources).toHaveLength(2)
    expect(cfg.sources[0]).toEqual({ id: 'a', name: '官方', api_key: 'sk-a', base_url: 'https://x.com', model: 'deepseek-v4-flash' })
    expect(cfg.sources[1]).toEqual({ id: 'b', name: '备选', api_key: 'sk-b', model: 'deepseek-v4-pro' })
    expect(cfg.active_source).toBe('b')
  })

  test('空字符串字段被丢弃（不覆盖环境变量）', () => {
    const cfg = parseModelConfig('{"sources":[{"id":"a","name":"x","api_key":"","base_url":"  ","model":"deepseek-v4-flash"}]}')
    expect(cfg.sources[0]).toEqual({ id: 'a', name: 'x', model: 'deepseek-v4-flash' })
  })

  test('非法 JSON 返回空配置（不抛错）', () => {
    expect(parseModelConfig('{ not json !!')).toEqual({ sources: [] })
    expect(parseModelConfig('')).toEqual({ sources: [] })
  })

  test('无 id 的来源被丢弃', () => {
    const cfg = parseModelConfig('{"sources":[{"name":"x","api_key":"k"},{"id":"ok","api_key":"k2"}]}')
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0].id).toBe('ok')
  })

  test('值首尾空白被修剪', () => {
    const cfg = parseModelConfig('{"sources":[{"id":" a ","name":" n ","api_key":"  sk  ","model":"  deepseek-v4-flash  "}]}')
    expect(cfg.sources[0]).toEqual({ id: 'a', name: 'n', api_key: 'sk', model: 'deepseek-v4-flash' })
  })
})

describe('旧格式迁移（v2.0.2 单来源）', () => {
  test('旧格式 {api_key,base_url,model} → 单来源 default + active', () => {
    const cfg = parseModelConfig('{"api_key":"sk-old","base_url":"https://api.deepseek.com","model":"deepseek-v4-flash"}')
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0]).toEqual({ id: 'default', name: 'DeepSeek 官方', api_key: 'sk-old', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash' })
    expect(cfg.active_source).toBe('default')
  })

  test('旧格式空字段 → 仍迁移为单来源（无 key）', () => {
    const cfg = parseModelConfig('{"api_key":"","base_url":"","model":""}')
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0].api_key).toBeUndefined()
    expect(cfg.active_source).toBe('default')
  })

  test('空对象不迁移（视为未配置）', () => {
    expect(parseModelConfig('{}')).toEqual({ sources: [] })
  })
})

describe('pickActiveSource', () => {
  test('按 active_source 选择来源', () => {
    const cfg = parseModelConfig('{"sources":[{"id":"a","api_key":"k1"},{"id":"b","api_key":"k2"}],"active_source":"b"}')
    expect(pickActiveSource(cfg)?.api_key).toBe('k2')
  })

  test('active_source 缺失/不匹配 → undefined（回退环境变量）', () => {
    const cfg = parseModelConfig('{"sources":[{"id":"a","api_key":"k1"}]}')
    expect(pickActiveSource(cfg)).toBeUndefined()
    const cfg2 = parseModelConfig('{"sources":[{"id":"a","api_key":"k1"}],"active_source":"zzz"}')
    expect(pickActiveSource(cfg2)).toBeUndefined()
  })
})

describe('loadModelConfig', () => {
  test('读取磁盘配置文件（v2）', async () => {
    const d = tmp()
    writeFileSync(join(d, 'model-config.json'), '{"sources":[{"id":"disk","name":"D","api_key":"sk-disk","model":"m1"}],"active_source":"disk"}', 'utf8')
    const cfg = await loadModelConfig(d)
    expect(pickActiveSource(cfg)?.api_key).toBe('sk-disk')
  })

  test('读取磁盘旧格式自动迁移', async () => {
    const d = tmp()
    writeFileSync(join(d, 'model-config.json'), '{"api_key":"sk-legacy","model":"deepseek-v4-flash"}', 'utf8')
    const cfg = await loadModelConfig(d)
    expect(pickActiveSource(cfg)?.api_key).toBe('sk-legacy')
    expect(pickActiveSource(cfg)?.id).toBe('default')
  })

  test('文件不存在返回空配置（回退环境变量）', async () => {
    const cfg = await loadModelConfig(tmp())
    expect(cfg).toEqual({ sources: [] })
  })

  test('文件损坏返回空配置（容错启动）', async () => {
    const d = tmp()
    writeFileSync(join(d, 'model-config.json'), '{{{', 'utf8')
    expect(await loadModelConfig(d)).toEqual({ sources: [] })
  })
})
