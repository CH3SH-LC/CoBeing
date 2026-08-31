/**
 * MessageList 组件测试：骨架屏 / 日期分隔 / 头像 / 消息渲染
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MessageList, MessageSkeleton } from './MessageList'
import type { ProjectionDto } from '../types'

vi.mock('../rpc', () => ({
  client: { mainWindowSpeak: vi.fn() },
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}))

const today = Date.now()
const proj: ProjectionDto = {
  publicMessages: [
    { seq: 1, actor: 'user', content: '你好', ts: today },
    { seq: 2, actor: 'butler', content: '我是铃音', ts: today + 60_000 },
    { seq: 3, actor: 'writer', content: '收到，开始工作', ts: today - 86_400_000 }, // 昨天
  ],
  compactions: [],
}

describe('MessageList', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('投影未就绪时显示加载骨架屏', () => {
    render(<MessageList projection={null} confirm={null} />)
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
  })

  it('投影为空时显示空态', () => {
    render(<MessageList projection={{ publicMessages: [], compactions: [] }} confirm={null} />)
    expect(screen.getByText('暂无消息')).toBeTruthy()
  })

  it('渲染消息与角色头像', () => {
    render(<MessageList projection={proj} confirm={null} />)
    expect(screen.getByText('你好')).toBeTruthy()
    expect(screen.getByText('我是铃音')).toBeTruthy()
    // 头像首字：user=我（头像+meta 各一处，取 avatar 容器） / butler=铃 / writer=W；meta 显示名铃音
    expect(screen.getAllByText('我').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('铃')).toBeTruthy()
    expect(screen.getByText('W')).toBeTruthy()
    expect(screen.getByText('铃音')).toBeTruthy()
  })

  it('按天显示日期分隔（今天 / 昨天）', () => {
    render(<MessageList projection={proj} confirm={null} />)
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.getByText('昨天')).toBeTruthy()
  })

  it('每条消息显示时间戳（HH:MM 格式）', () => {
    render(<MessageList projection={proj} confirm={null} />)
    const d = new Date(today)
    const hh = String(d.getHours()).padStart(2, '0')
    expect(screen.getAllByText(new RegExp(`^${hh}:`)).length).toBeGreaterThanOrEqual(2)
  })

  it('骨架屏独立渲染 3 个占位', () => {
    render(<MessageSkeleton />)
    expect(screen.getAllByLabelText('加载中').length).toBe(1)
  })
})
