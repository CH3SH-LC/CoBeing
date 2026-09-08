// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { MainChatView } from './MainChatView'
import { rpc } from '../rpc'

// mock rpc 模块：捕获 mainWindowSpeak 调用，手动触发 notify 回调
const notifyHandlers: Array<(n: unknown) => void> = []
const speakCalls: Array<{ content: string }> = []
const convCalls: Array<{ id?: string }> = []
/** 主对话投影（thinking 显隐测试可改写；默认空） */
let liveMsgs: Array<{ seq: number; actor: string; content: string; ts: number }> = []

let convList: Array<{ id: string; createdAt: number; archivedAt?: number; messageCount: number; current?: boolean; firstUserMessage?: string }> = [
  { id: 'current', createdAt: 1, messageCount: 3, current: true },
]

vi.mock('../rpc', () => ({
  rpc: {
    butlerProjection: vi.fn(async () => ({
      events: [],
      publicMessages: liveMsgs,
      compactions: [],
      context: { estimatedTokens: 12_345, thresholdTokens: 100_000 },
    })),
    mainWindowSpeak: vi.fn(async (content: string) => {
      speakCalls.push({ content })
    }),
    confirmAgent: vi.fn(async () => undefined),
    rejectAgentApproval: vi.fn(async () => undefined),
    newButlerConversation: vi.fn(async () => {
      convCalls.push({})
      convList = [{ id: 'current', createdAt: Date.now(), messageCount: 1, current: true }]
    }),
    resumeButlerConversation: vi.fn(async (id: string) => {
      convCalls.push({ id })
      convList = [
        { id: 'current', createdAt: 1, messageCount: 10, current: true },
        { id: 'conv-2', createdAt: 300, archivedAt: 400, messageCount: 2, firstUserMessage: '新归档' },
      ]
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

  it('待批准创建卡（approval）：点击批准 → confirmAgent，点击拒绝 → rejectAgentApproval（不回传管家）', async () => {
    const confirmAgent = vi.mocked(rpc).confirmAgent
    const rejectAgentApproval = vi.mocked(rpc).rejectAgentApproval
    render(<MainChatView />)
    await act(async () => {
      notifyHandlers.forEach((cb) =>
        cb({
          type: 'confirm',
          id: 'agent-approval-websearcher',
          question: '管家想创建智能体「websearcher」…是否批准？',
          options: [
            { id: 'approve', label: '批准' },
            { id: 'reject', label: '拒绝' },
          ],
          approval: { name: 'websearcher', role: '网络搜索' },
        }),
      )
    })
    expect(screen.getByText('管家想创建智能体「websearcher」…是否批准？')).toBeTruthy()

    // 批准：直接 confirmAgent，非文本回传
    await act(async () => {
      fireEvent.click(screen.getByText('批准'))
    })
    expect(confirmAgent).toHaveBeenCalledWith('websearcher')
    expect(speakCalls).toHaveLength(0)
    expect(screen.queryByText(/管家想创建智能体/)).toBeNull()

    // 拒绝：再触发一张卡 → rejectAgentApproval
    await act(async () => {
      notifyHandlers.forEach((cb) =>
        cb({
          type: 'confirm',
          id: 'agent-approval-websearcher-2',
          question: '管家想创建智能体「websearcher」…是否批准？',
          options: [
            { id: 'approve', label: '批准' },
            { id: 'reject', label: '拒绝' },
          ],
          approval: { name: 'websearcher', role: '网络搜索' },
        }),
      )
    })
    await act(async () => {
      fireEvent.click(screen.getByText('拒绝'))
    })
    expect(rejectAgentApproval).toHaveBeenCalledWith('websearcher')
    expect(speakCalls).toHaveLength(0)
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

describe('MainChatView 铃音思考中提示（2.0.14）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyHandlers.length = 0
    speakCalls.length = 0
    convCalls.length = 0
    liveMsgs = []
    convList = [{ id: 'current', createdAt: 1, messageCount: 3, current: true }]
  })

  it('发送后显示「铃音思考中…」，但丁回复后消失', async () => {
    render(<MainChatView />)
    // 输入并发送
    const input = screen.getByPlaceholderText(/对铃音说话/)
    await act(async () => {
      fireEvent.change(input, { target: { value: '帮我调研' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
    })
    // 此时尚未见但丁回复 → 思考中可见
    expect(screen.getAllByText('铃音思考中…').length).toBeGreaterThanOrEqual(1)

    // 但丁回复到达（投影新增 butler speak）→ 触发刷新 → 思考中消失
    liveMsgs = [
      { seq: 1, actor: 'user', content: '帮我调研', ts: Date.now() },
      { seq: 2, actor: 'butler', content: '好的，已开始', ts: Date.now() + 100 },
    ]
    await act(async () => {
      notifyHandlers.forEach((cb) => cb({ type: 'update', scope: 'butler', kind: 'reply' }))
    })
    await waitFor(() => expect(screen.queryAllByText('铃音思考中…').length).toBe(0))
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
    expect(screen.getByText(/历史会话只读查看/)).toBeTruthy()
    // 标题显示历史会话 id
    expect(screen.getByText('历史会话 conv-1')).toBeTruthy()
    // 恢复此会话按钮（2.0.8：历史可重新对话）
    expect(screen.getByRole('button', { name: /恢复此会话/ })).toBeTruthy()
    // 输入框不可用（只读模式无发送按钮）
    expect(screen.queryByText('发送')).toBeNull()

    // 恢复历史会话：两段确认 → resume 调用 → 回到当前模式（历史项移除、新归档出现）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /恢复此会话/ }))
    })
    expect(screen.getByRole('button', { name: /确认恢复/ })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /确认恢复/ }))
    })
    expect(convCalls).toContainEqual({ id: 'conv-1' })
    await waitFor(() => expect(screen.getByText('发送')).toBeTruthy())
    expect(screen.getByTestId('conv-conv-2')).toBeTruthy()
    // 恢复后回到当前模式（不再显示历史只读提示）
    expect(screen.queryByText('旧会话消息甲')).toBeNull()
  })
})
