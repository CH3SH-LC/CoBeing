/**
 * 插件框架测试（自研 effect 模型）：注册皆 effect、失败回滚、热重载、服务生命周期
 */

import { describe, expect, test } from 'vitest'
import { PluginManager, type PluginDef } from '../src/plugin/manager.js'

describe('PluginManager', () => {
  test('apply 内注册皆 effect：卸载后事件与服务全部清理', () => {
    const manager = new PluginManager()
    let received = 0
    const plugin: PluginDef = {
      id: 'p1',
      apply(fiber) {
        fiber.on('evt', () => {
          received++
        })
        fiber.provide('svc', { hello: 'world' })
      },
    }
    manager.load(plugin)
    expect(manager.getService('svc')).toEqual({ hello: 'world' })
    manager.emit('evt', null)
    expect(received).toBe(1)
    manager.unload('p1')
    expect(manager.getService('svc')).toBeUndefined()
    manager.emit('evt', null)
    expect(received).toBe(1) // 卸载后不再收到
  })

  test('加载失败自动回滚半注册状态', () => {
    const manager = new PluginManager()
    let disposerCalls = 0
    const plugin: PluginDef = {
      id: 'bad',
      apply(fiber) {
        fiber.provide('svc-a', 1)
        fiber.effect(() => {
          disposerCalls++
        })
        throw new Error('boom')
      },
    }
    expect(() => manager.load(plugin)).toThrow(/plugin failed to apply/)
    expect(manager.getService('svc-a')).toBeUndefined()
    expect(disposerCalls).toBe(1) // 已注册的 disposer 也执行了
    expect(manager.list()).toHaveLength(0)
  })

  test('热重载：卸载旧 + 重新 apply（新配置生效）', () => {
    const manager = new PluginManager()
    const configs: unknown[] = []
    const plugin: PluginDef = {
      id: 'hot',
      apply(fiber, config) {
        configs.push(config)
        fiber.provide('cfg', config)
      },
    }
    manager.load(plugin, { v: 1 })
    expect(manager.getService('cfg')).toEqual({ v: 1 })
    const reloaded = manager.reload('hot')
    expect(reloaded.config).toEqual({ v: 1 })
    expect(configs).toHaveLength(2)
    expect(manager.getService('cfg')).toEqual({ v: 1 })
  })

  test('内核级服务 provide 先于插件，插件 require 读取；宿主 disposer 移除', () => {
    const manager = new PluginManager()
    const dispose = manager.provide('kernel', { kind: 'host' })
    const plugin: PluginDef = {
      id: 'consumer',
      apply(fiber) {
        expect(fiber.require<{ kind: string }>('kernel').kind).toBe('host')
      },
    }
    manager.load(plugin)
    dispose()
    expect(manager.getService('kernel')).toBeUndefined()
  })

  test('重复 id 加载抛错；重复服务注册抛错且回滚', () => {
    const manager = new PluginManager()
    manager.load({ id: 'dup', apply() {} })
    expect(() => manager.load({ id: 'dup', apply() {} })).toThrow(/already loaded/)

    const manager2 = new PluginManager()
    manager2.load({ id: 'a', apply(fiber) { fiber.provide('x', 1) } })
    const failing: PluginDef = {
      id: 'b',
      apply(fiber) {
        fiber.provide('x', 2) // 冲突
      },
    }
    expect(() => manager2.load(failing)).toThrow(/service already provided/)
    expect(manager2.list()).toHaveLength(1)
    expect(manager2.getService('x')).toBe(1)
  })

  test('disposeAll 清理全部', () => {
    const manager = new PluginManager()
    manager.load({ id: 'a', apply(fiber) { fiber.provide('sa', 1) } })
    manager.load({ id: 'b', apply(fiber) { fiber.provide('sb', 2) } })
    manager.disposeAll()
    expect(manager.list()).toHaveLength(0)
    expect(manager.getService('sa')).toBeUndefined()
    expect(manager.getService('sb')).toBeUndefined()
  })
})
