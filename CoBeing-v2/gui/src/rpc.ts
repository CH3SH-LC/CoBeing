/**
 * JSON-RPC 客户端：前端 ↔ Rust 桥（rpc_call command）↔ 内核 stdio
 *
 * - request(): invoke rpc_call，Rust 侧把内核响应/错误转成 Promise 结果
 * - notify / kernel-exited：Rust 侧事件推送
 * - Rust 桥契约：rpc_call(method, params) -> Result<Value, String>
 *   （RPC error 格式 "[code] message"，传输错误 "rpc error: ..."）
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AgentDef,
  ConversationInfo,
  ExperienceEntryDto,
  GroupMeta,
  GroupStatus,
  NotifyPayload,
  ProjectionDto,
  RemoteStatus,
} from './types'

export interface RpcResult {
  ok: boolean
  /** ok=true 时为 result 值；ok=false 时为错误消息 */
  value: unknown
}

export class RpcClient {
  /** 通用请求；返回 result 值；错误时抛出 Error（含 [code] 前缀） */
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return (await invoke('rpc_call', { method, params })) as T
  }

  // ---------- 内核 ----------
  ping(): Promise<{ pong: boolean }> {
    return this.request('ping')
  }

  getKernelStatus(): Promise<boolean> {
    return invoke('get_kernel_status')
  }

  // ---------- 主对话（但丁） ----------
  mainWindowSpeak(content: string, opts: { group?: string; mention?: string[]; task?: string } = {}): Promise<void> {
    return this.request('mainWindowSpeak', { content, ...opts })
  }

  butlerProjection(): Promise<ProjectionDto> {
    return this.request('butlerProjection')
  }

  /** 开启新对话窗口：当前会话归档为历史（可回看），重建空会话 */
  newButlerConversation(): Promise<{ id: string }> {
    return this.request('butler/newConversation')
  }

  /** 会话列表：当前会话 + 历史会话（最新在前） */
  listButlerConversations(): Promise<ConversationInfo[]> {
    return this.request('butler/listConversations')
  }

  /** 历史会话只读投影（id='current' 返回当前会话） */
  butlerConversationProjection(id: string): Promise<ProjectionDto> {
    return this.request('butler/conversationProjection', { id })
  }

  // ---------- 群组 ----------
  listGroups(): Promise<GroupMeta[]> {
    return this.request('listGroups')
  }

  createGroup(name: string, label: string[]): Promise<{ name: string; status: string }> {
    return this.request('createGroup', { name, label })
  }

  speakToGroup(
    group: string,
    actor: string,
    content: string,
    opts: { mention?: string[]; task?: string } = {},
  ): Promise<void> {
    return this.request('speakToGroup', { group, actor, content, ...opts })
  }

  groupProjection(group: string): Promise<ProjectionDto> {
    return this.request('groupProjection', { group })
  }

  /** 群组工作状态（成员忙碌标记 + 任务摘要 + 最近活动） */
  groupStatus(group: string): Promise<GroupStatus> {
    return this.request('group/status', { group })
  }

  archiveGroup(name: string): Promise<void> {
    return this.request('archiveGroup', { name })
  }

  listArchivedGroups(filter: { since?: number; until?: number; keyword?: string } = {}): Promise<GroupMeta[]> {
    return this.request('listArchivedGroups', filter)
  }

  // ---------- 智能体管理 ----------
  listAgents(): Promise<AgentDef[]> {
    return this.request('listAgents')
  }

  requestCreateAgent(def: AgentDef): Promise<void> {
    return this.request('requestCreateAgent', { def })
  }

  listPendingApprovals(): Promise<AgentDef[]> {
    return this.request('listPendingApprovals')
  }

  confirmAgent(name: string): Promise<void> {
    return this.request('confirmAgent', { name })
  }

  destroyAgent(name: string): Promise<void> {
    return this.request('destroyAgent', { name })
  }

  /** 经验档案信息（条目数 / 最近更新时间；智能体名如 butler / writer） */
  experienceInfo(agent: string): Promise<{ agent: string; count: number; lastUpdated?: number }> {
    return this.request('experience/info', { agent })
  }

  /** 经验条目（最新在前；记忆面板） */
  experienceEntries(agent: string, limit = 20): Promise<ExperienceEntryDto[]> {
    return this.request('experience/entries', { agent, limit })
  }

  /** 经验关键词检索（content/source/tags 子串匹配） */
  experienceSearch(agent: string, keyword: string, limit = 20): Promise<ExperienceEntryDto[]> {
    return this.request('experience/search', { agent, keyword, limit })
  }

  /** E2E 测试设施：自检报告写入数据目录（仅自检模式使用） */
  e2eReport(content: string): Promise<string> {
    return invoke('e2e_report', { content })
  }

  // ---------- 远程互联（方案 v2：手机连接/自动配对状态） ----------
  remoteStatus(): Promise<RemoteStatus> {
    return this.request('remote/status')
  }

  /** 撤销设备配对（解除后该手机需重新配对） */
  pairRevoke(deviceId: string): Promise<boolean> {
    return this.request('pair/revoke', { deviceId })
  }
}

export const rpc = new RpcClient()

/** 订阅内核 notify（用户通知 / ask-user 确认请求）；返回取消函数 */
export function onKernelNotify(cb: (n: NotifyPayload) => void): Promise<UnlistenFn> {
  return listen<NotifyPayload>('jsonrpc-notify', (event) => cb(event.payload))
}

/** 订阅内核退出事件；返回取消函数 */
export function onKernelExited(cb: (e: { code: number | null }) => void): Promise<UnlistenFn> {
  return listen('kernel-exited', (event) => cb(event.payload as { code: number | null }))
}

/** 在浏览器/测试环境（无 Tauri API）下是否可用 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
