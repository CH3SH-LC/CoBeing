/**
 * 模型配置文件加载（model-config.json）：解析规则 + 文件回退语义
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { parseModelConfig, loadModelConfig } from '../src/model-config.js'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'cb-modelcfg-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('parseModelConfig', () => {
  test('解析完整合法 JSON', () => {
    const cfg = parseModelConfig('{"api_key":"sk-abc","base_url":"https://x.com","model":"deepseek-chat"}')
    expect(cfg).toEqual({ api_key: 'sk-abc', base_url: 'https://x.com', model: 'deepseek-chat' })
  })

  test('空字符串字段被丢弃（不覆盖环境变量）', () => {
    const cfg = parseModelConfig('{"api_key":"","base_url":"  ","model":"deepseek-chat"}')
    expect(cfg).toEqual({ model: 'deepseek-chat' })
  })

  test('非法 JSON 返回空配置（不抛错）', () => {
    expect(parseModelConfig('{ not json !!')).toEqual({})
    expect(parseModelConfig('')).toEqual({})
  })

  test('非对象 JSON 返回空配置', () => {
    expect(parseModelConfig('"hello"')).toEqual({})
    expect(parseModelConfig('42')).toEqual({})
  })

  test('字段值类型非法时丢弃', () => {
    const cfg = parseModelConfig('{"api_key":123,"base_url":null,"model":["a"]}')
    expect(cfg).toEqual({})
  })

  test('值首尾空白被修剪', () => {
    const cfg = parseModelConfig('{"api_key":"  sk-abc  ","model":"  deepseek-chat  "}')
    expect(cfg).toEqual({ api_key: 'sk-abc', model: 'deepseek-chat' })
  })
})

describe('loadModelConfig', () => {
  test('读取磁盘配置文件', async () => {
    const d = tmp()
    writeFileSync(join(d, 'model-config.json'), '{"api_key":"sk-disk","model":"m1"}', 'utf8')
    const cfg = await loadModelConfig(d)
    expect(cfg).toEqual({ api_key: 'sk-disk', model: 'm1' })
  })

  test('文件不存在返回空配置（回退环境变量）', async () => {
    const cfg = await loadModelConfig(tmp())
    expect(cfg).toEqual({})
  })

  test('文件损坏返回空配置（容错启动）', async () => {
    const d = tmp()
    writeFileSync(join(d, 'model-config.json'), '{{{', 'utf8')
    expect(await loadModelConfig(d)).toEqual({})
  })
})
