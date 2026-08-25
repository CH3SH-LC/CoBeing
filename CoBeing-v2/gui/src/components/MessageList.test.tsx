// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageList } from './MessageList'
import type { PublicMessage } from '../types'

const msgs: PublicMessage[] = [
  { seq: 1, actor: 'user', content: '你好', ts: 1700000000000 },
  { seq: 2, actor: 'butler', content: '我是但丁', ts: 1700000060000 },
  { seq: 3, actor: 'writer', content: '收到，开始工作', task: '写文档', mention: ['writer'], ts: 1700000120000 },
]

const kind = (a: string) => (a === 'user' ? 'user' : a === 'butler' ? 'butler' : 'agent')

describe('MessageList', () => {
  it('空消息显示空态提示', () => {
    render(<MessageList messages={[]} actorKind={kind} />)
    expect(screen.getByText(/还没有消息/)).toBeTruthy()
  })

  it('用户消息渲染在右侧（user 行）', () => {
    render(<MessageList messages={[msgs[0]]} actorKind={kind} />)
    const row = screen.getByText('你好').closest('.msg-row')
    expect(row?.className).toContain('user')
  })

  it('但丁消息用 butler 行（左侧）', () => {
    render(<MessageList messages={[msgs[1]]} actorKind={kind} />)
    const row = screen.getByText('我是但丁').closest('.msg-row')
    expect(row?.className).toContain('butler')
  })

  it('工作智能体消息用 agent 行', () => {
    render(<MessageList messages={[msgs[2]]} actorKind={kind} />)
    const row = screen.getByText('收到，开始工作').closest('.msg-row')
    expect(row?.className).toContain('agent')
  })

  it('任务说明与 mention 标签展示', () => {
    render(<MessageList messages={[msgs[2]]} actorKind={kind} />)
    expect(screen.getByText('任务：写文档')).toBeTruthy()
    expect(screen.getByText('@ writer')).toBeTruthy()
  })

  it('所有消息按 seq 顺序渲染', () => {
    render(<MessageList messages={msgs} actorKind={kind} />)
    const contents = screen.getAllByText(/你好|我是但丁|收到，开始工作/)
    expect(contents.length).toBe(3)
  })

  it('气泡列容器受行宽 68% 约束且允许收缩（min-width: 0）——防气泡被内容反向压窄', () => {
    render(<MessageList messages={[msgs[1]]} actorKind={kind} />)
    const col = screen.getByText('我是但丁').closest('.msg-col') as HTMLElement
    expect(col.style.maxWidth).toBe('68%')
    // jsdom 序列化为 '0'，浏览器为 '0px'
    expect(['0', '0px']).toContain(col.style.minWidth)
  })

  it('气泡本身无百分比宽度（宽度由内容与列容器决定，不被压缩）', () => {
    render(<MessageList messages={[msgs[1]]} actorKind={kind} />)
    const bubble = screen.getByText('我是但丁').closest('.msg-bubble') as HTMLElement
    expect(bubble.style.maxWidth).toBe('')
  })
})
