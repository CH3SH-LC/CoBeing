import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runE2E, type E2EStep } from './e2e'

vi.mock('./settings', () => {
  const state: { sources: Array<{ id: string; name: string; api_key: string; base_url: string; model: string }>; active_source: string } = {
    sources: [],
    active_source: '',
  }
  return {
    getModelConfigs: vi.fn(async () => ({
      sources: state.sources.map((s) => ({ ...s })),
      active_source: state.active_source,
    })),
    saveModelSource: vi.fn(async (src: { id: string; name: string; api_key: string; base_url: string; model: string }) => {
      const exists = state.sources.some((s) => s.id === src.id)
      if (exists) {
        state.sources = state.sources.map((s) => (s.id === src.id ? { ...src } : s))
      } else {
        state.sources.push({ ...src })
        if (state.sources.length === 1 || !state.active_source) state.active_source = src.id
      }
    }),
    setActiveModelSource: vi.fn(async (id: string) => {
      state.active_source = id
    }),
    deleteModelSource: vi.fn(async (id: string) => {
      state.sources = state.sources.filter((s) => s.id !== id)
      if (state.active_source === id) state.active_source = ''
    }),
    __resetSettings: () => {
      state.sources = []
      state.active_source = ''
    },
  }
})

vi.mock('./rpc', () => {
  const state = {
    butlerReplies: [] as string[],
    groupReplies: [] as string[],
    confirmed: false,
    archived: false,
    destroyed: false,
  }
  const rpc = {
    ping: vi.fn(async () => ({ pong: true })),
    requestCreateAgent: vi.fn(async () => undefined),
    listPendingApprovals: vi.fn(async () => [{ name: 'e2e-tester', role: 'x', createdAt: 1 }]),
    confirmAgent: vi.fn(async () => {
      state.confirmed = true
    }),
    listAgents: vi.fn(async () => {
      if (state.destroyed) return []
      return state.confirmed ? [{ name: 'e2e-tester', role: 'x', createdAt: 1 }] : []
    }),
    butlerProjection: vi.fn(async () => {
      const msgs = state.butlerReplies.map((c, i) => ({ seq: 10 + i, actor: 'butler', content: c, ts: 1700000000000 + i * 1000 }))
      return { events: [], publicMessages: msgs, compactions: [] }
    }),
    mainWindowSpeak: vi.fn(async (content: string) => {
      state.butlerReplies.push(`(mock) 收到：${content}`)
    }),
    newButlerConversation: vi.fn(async () => {
      state.butlerReplies = []
      return { id: 'conv-1' }
    }),
    listButlerConversations: vi.fn(async () => [
      { id: 'current', createdAt: 1, messageCount: 1, current: true },
      { id: 'conv-1', createdAt: 1, archivedAt: 2, messageCount: 2 },
    ]),
    butlerConversationProjection: vi.fn(async () => ({
      events: [],
      publicMessages: [{ seq: 1, actor: 'user', content: '旧会话消息', ts: 1700000000000 }],
      compactions: [],
    })),
    createGroup: vi.fn(async () => ({ name: 'e2e-smoke', status: 'working' })),
    speakToGroup: vi.fn(async () => {
      state.groupReplies.push('(mock) 你好，我是 e2e-tester')
    }),
    groupProjection: vi.fn(async () => {
      const msgs = state.groupReplies.map((c, i) => ({ seq: i + 1, actor: 'e2e-tester', content: c, ts: 1700000000000 + i * 1000 }))
      return { events: [], publicMessages: msgs, compactions: [] }
    }),
    archiveGroup: vi.fn(async () => {
      state.archived = true
    }),
    listArchivedGroups: vi.fn(async () =>
      state.archived ? [{ name: 'e2e-smoke', label: ['user', 'butler', 'e2e-tester'], space: 'x', spaceMode: 'default', status: 'archived', createdAt: 1 }] : [],
    ),
    destroyAgent: vi.fn(async () => {
      state.destroyed = true
    }),
    e2eReport: vi.fn(async () => ''),
  }
  return {
    rpc,
    __resetState: () => {
      state.butlerReplies = []
      state.groupReplies = []
      state.confirmed = false
      state.archived = false
      state.destroyed = false
    },
  }
})

import { rpc } from './rpc'
import * as rpcModule from './rpc'
import * as settingsModule from './settings'

const resetState = () => {
  ;(rpcModule as unknown as { __resetState(): void }).__resetState()
  ;(settingsModule as unknown as { __resetSettings(): void }).__resetSettings()
}

describe('runE2E', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('全流程通过：9 步全 pass', async () => {
    const steps: E2EStep[] = []
    const result = await runE2E((i, s) => {
      steps[i] = s
    })
    expect(result).toBe(true)
    expect(steps.every((s) => s.state === 'pass')).toBe(true)
    expect(steps).toHaveLength(9)
    expect(rpc.ping).toHaveBeenCalled()
    expect(rpc.confirmAgent).toHaveBeenCalledWith('e2e-tester')
    expect(rpc.newButlerConversation).toHaveBeenCalled()
    expect(rpc.createGroup).toHaveBeenCalledWith('e2e-smoke', ['user', 'butler', 'e2e-tester'])
    expect(rpc.speakToGroup).toHaveBeenCalledWith('e2e-smoke', 'user', '请 e2e-tester 写一句问候语', {
      mention: ['e2e-tester'],
      task: '写一句问候语',
    })
    expect(rpc.archiveGroup).toHaveBeenCalledWith('e2e-smoke')
    expect(rpc.destroyAgent).toHaveBeenCalledWith('e2e-tester')
    expect(rpc.e2eReport).toHaveBeenCalledWith(expect.stringContaining('"ok": true'))
    expect(settingsModule.getModelConfigs).toHaveBeenCalled()
    expect(settingsModule.saveModelSource).toHaveBeenCalledTimes(1)
    expect(settingsModule.setActiveModelSource).toHaveBeenCalledTimes(1)
    expect(settingsModule.deleteModelSource).toHaveBeenCalledTimes(1)
  })

  it('ping 失败立即终止并标记 fail', async () => {
    vi.mocked(rpc.ping).mockRejectedValueOnce(new Error('rpc error: timeout'))
    const steps: E2EStep[] = []
    const result = await runE2E((i, s) => {
      steps[i] = s
    })
    expect(result).toBe(false)
    expect(steps[0].state).toBe('fail')
    expect(steps[1]).toBeUndefined()
  })

  it('但丁 30s 无回复则步骤 3 失败', async () => {
    vi.mocked(rpc.mainWindowSpeak).mockImplementationOnce(async () => undefined)
    const steps: E2EStep[] = []
    const result = await runE2E(
      (i, s) => {
        steps[i] = s
      },
      { timeoutMs: 120 },
    )
    expect(result).toBe(false)
    expect(steps[2].state).toBe('fail')
  })
})
