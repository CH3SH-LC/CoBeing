/**
 * ChatView 组件测试：输入条渲染/发送/历史只读
 *
 * 回归保护：composer 曾被底部 fixed Tab 遮挡不可见（布局 bug）——
 * 组件层断言输入条在已连接时始终渲染、历史回看时不渲染。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatView } from './ChatView'

const mocks = vi.hoisted(() => ({
  projection: vi.fn(),
  listConversations: vi.fn(),
  speak: vi.fn(),
}))

vi.mock('../rpc', () => ({
  client: {
    butlerConversationProjection: mocks.projection,
    listButlerConversations: mocks.listConversations,
    mainWindowSpeak: mocks.speak,
    onNotify: vi.fn(() => () => undefined),
  },
}))

vi.mock('../App', () => ({
  useAppState: () => ({ status: 'connected' }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ push: vi.fn() }),
}))

describe('ChatView', () => {
  beforeEach(() => {
    mocks.projection.mockResolvedValue({ publicMessages: [], compactions: [] })
    mocks.listConversations.mockResolvedValue([])
    mocks.speak.mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('已连接时渲染输入条（composer：输入框 + 发送按钮）', async () => {
    render(<ChatView />)
    // 输入条不依赖投影，同步可断言
    const textarea = screen.getByPlaceholderText('给铃音发消息…（Enter 发送）')
    expect(textarea).toBeTruthy()
    expect(screen.getByText('发送')).toBeTruthy()
    // 投影请求已发出（对话页打开即加载）
    await waitFor(() => expect(mocks.projection).toHaveBeenCalledWith('current'))
  })

  it('发送消息调用 mainWindowSpeak', async () => {
    render(<ChatView />)
    const textarea = screen.getByPlaceholderText('给铃音发消息…（Enter 发送）')
    fireEvent.change(textarea, { target: { value: '你好铃音' } })
    fireEvent.click(screen.getByText('发送'))
    await waitFor(() => expect(mocks.speak).toHaveBeenCalledWith('你好铃音'))
  })

  it('历史会话只读：打开历史会话后输入条隐藏', async () => {
    mocks.listConversations.mockResolvedValue([
      { id: 'conv-1', createdAt: 1000, messageCount: 2, firstUserMessage: '历史问题' },
    ])
    mocks.projection.mockResolvedValue({
      publicMessages: [
        { seq: 1, actor: 'user', content: '历史问题', ts: 1700000000000 },
        { seq: 2, actor: 'butler', content: '历史回答', ts: 1700000060000 },
      ],
      compactions: [],
    })
    render(<ChatView />)
    // 打开会话列表 → 打开历史会话
    fireEvent.click(screen.getByText('会话'))
    await waitFor(() => expect(screen.getByText('打开')).toBeTruthy())
    fireEvent.click(screen.getByText('打开'))
    // 历史只读：无输入条，显示"返回当前"
    await waitFor(() => expect(screen.getByText('返回当前')).toBeTruthy())
    expect(screen.queryByPlaceholderText('给铃音发消息…（Enter 发送）')).toBeNull()
    // 返回当前 → 输入条恢复
    fireEvent.click(screen.getByText('返回当前'))
    await waitFor(() => expect(screen.getByPlaceholderText('给铃音发消息…（Enter 发送）')).toBeTruthy())
  })
})
