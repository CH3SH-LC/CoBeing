// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MainChatView } from './MainChatView'

// mock rpc 模块：捕获 mainWindowSpeak 调用，手动触发 notify 回调
const notifyHandlers: Array<(n: unknown) => void> = []
const speakCalls: Array<{ content: string }> = []
const convCalls: Array<{ id?: string }> = []

let convList: Array<{ id: string; createdAt: number; archivedAt?: number; messageCount: number; current?: boolean; firstUserMessage?: string }> = [
  { id: 'current', createdAt: 1, messageCount: 3, current: true },
]

vi.mock('../rpc', () => ({
  rpc: {
    butlerProjection: vi.fn(async () => ({ events: [], publicMessages: [], compactions: [], context: { estimatedTokens: 12_345, thresholdTokens: 100_000 } })),
    mainWindowSpeak: vi.fn(async (content: string) => {
      speakCalls.push({ content })
    }),
    newButlerConversation: vi.fn(async () => {
      convCalls.push({})
      convList = [{ id: 'current', createdAt: Date.now(), messageCount: 1, current: true }]
    }),
    listButlerConversations: vi.fn(async () => convList),
    butlerConversationProjection: vi.fn(async (id: string) => {
      convCalls.push({ id })
      return {
        events: [],
        publicMessages: [
          { seq: 1, actor: 'user', content: '旧会话消息甲', ts: 1700000000000 },
          { seq: 2, actor: 'butler', content: '旧会话回复乙', ts: 1700000060000 },
        ],
        compactions: [],
      }
    }),
  },
  onKernelNotify: vi.fn(async (cb: (n: unknown) => void) => {
    notifyHandlers.push(cb)
    return () => undefined
  }),
}))

describe('MainChatView 确认卡片（ask-user）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyHandlers.length = 0
    speakCalls.length = 0
    convCalls.length = 0
    convList = [{ id: 'current', createdAt: 1, messageCount: 3, current: true }]
  })

  it('收到 confirm 通知渲染确认卡片（问题 + 选项按钮）', async () => {
    render(<MainChatView />)
    await act(async () => {
      notifyHandlers.forEach((cb) =>
        cb({
          type: 'confirm',
          id: 'ask-1',
          question: '用哪个群组？',
          options: [
            { id: 'reuse', label: '复用旅行调研群' },
            { id: 'create', label: '新建群组' },
          ],
        }),
      )
    })
    expect(screen.getByText('用哪个群组？')).toBeTruthy()
    expect(screen.getByText('复用旅行调研群')).toBeTruthy()
    expect(screen.getByText('新建群组')).toBeTruthy()
  })

  it('点击选项 → mainWindowSpeak 回传【确认答复】并移除卡片', async () => {
    render(<MainChatView />)
    await act(async () => {
      notifyHandlers.forEach((cb) =>
        cb({
          type: 'confirm',
          id: 'ask-1',
          question: '用哪个群组？',
          options: [{ id: 'create', label: '新建群组' }],
        }),
      )
    })
    await act(async () => {
      fireEvent.click(screen.getByText('新建群组'))
    })
    expect(speakCalls).toHaveLength(1)
    expect(speakCalls[0]!.content).toBe('【确认答复】新建群组')
    // 卡片已移除
    expect(screen.queryByText('用哪个群组？')).toBeNull()
  })

  it('text 通知进入通知流（不渲染为卡片）', async () => {
    render(<MainChatView />)
    await act(async () => {
      notifyHandlers.forEach((cb) => cb({ type: 'text', content: '[g1 → 管家] report: 任务完成' }))
    })
    expect(screen.getByText('[g1 → 管家] report: 任务完成')).toBeTruthy()
    expect(screen.queryByText('用哪个群组？')).toBeNull()
  })
})

describe('MainChatView 会话管理（新对话窗口）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyHandlers.length = 0
    speakCalls.length = 0
    convCalls.length = 0
    convList = [{ id: 'current', createdAt: 1, messageCount: 3, current: true }]
  })

  it('上下文进度 badge 显示估算 token / 阈值', async () => {
    render(<MainChatView />)
    await waitFor(() => expect(screen.getByText('上下文 12.3k / 100.0k')).toBeTruthy())
  })

  it('新对话两段确认：首次点击进入确认态，二次点击调用 RPC 并回到当前会话', async () => {
    render(<MainChatView />)
    await waitFor(() => expect(screen.getByText('新对话')).toBeTruthy())

    // 第一次点击：进入确认态（按钮变「确认开启？」）
    await act(async () => {
      fireEvent.click(screen.getByText('新对话'))
    })
    expect(screen.getByText('确认开启？')).toBeTruthy()
    expect(convCalls).toHaveLength(0)

    // 第二次点击：执行
    await act(async () => {
      fireEvent.click(screen.getByText('确认开启？'))
    })
    expect(convCalls).toHaveLength(1)
    expect(convCalls[0]).toEqual({})
    // 会话列表刷新为仅当前会话
    await waitFor(() => expect(screen.getByText('当前会话')).toBeTruthy())
  })

  it('取消按钮退出确认态（不调用 RPC）', async () => {
    render(<MainChatView />)
    await waitFor(() => expect(screen.getByText('新对话')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('新对话'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('取消'))
    })
    expect(screen.queryByText('确认开启？')).toBeNull()
    expect(convCalls).toHaveLength(0)
  })

  it('会话列表：当前 + 历史；点击历史 → 只读投影 + 返回当前', async () => {
    convList = [
      { id: 'current', createdAt: 1, messageCount: 3, current: true },
      { id: 'conv-1', createdAt: 100, archivedAt: 200, messageCount: 8, firstUserMessage: '旧任务' },
    ]
    render(<MainChatView />)
    await waitFor(() => expect(screen.getByTestId('conv-current')).toBeTruthy())

    // 点击历史会话 → 请求历史投影 + 只读模式
    await act(async () => {
      fireEvent.click(screen.getByTestId('conv-conv-1'))
    })
    expect(convCalls).toContainEqual({ id: 'conv-1' })
    await waitFor(() => expect(screen.getByText('旧会话消息甲')).toBeTruthy())
    expect(screen.getByText('历史会话只读查看（点击「返回当前会话」继续对话）')).toBeTruthy()
    // 标题显示历史会话 id
    expect(screen.getByText('历史会话 conv-1')).toBeTruthy()
    // 输入框不可用（只读模式无发送按钮）
    expect(screen.queryByText('发送')).toBeNull()

    // 返回当前会话
    await act(async () => {
      fireEvent.click(screen.getByText('返回当前会话'))
    })
    expect(screen.queryByText('旧会话消息甲')).toBeNull()
    expect(screen.getByText('发送')).toBeTruthy()
  })
})
