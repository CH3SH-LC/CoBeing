/**
 * 核心实体模型：智能体定义（名录）、群组元数据、上下文组装结果、经验条目
 */

/** 智能体定义（名录条目；创建时冻结，运行期不变） */
export interface AgentDef {
  /** 唯一名字（label 用，如 websearcher） */
  name: string
  /** 角色描述（JOB 摘要，供管家 mention 路由） */
  role: string
  /** 冻结的定义段文本（完整 JOB / 角色意识说明，注入系统提示[定义]段） */
  basePrompt?: string
  /** 附加工具白名单（原体默认 4 个之外的能力，如 web/search/mcp:*） */
  tools?: string[]
  provider?: string
  model?: string
  maxTokens?: number
  createdAt: number
  /** 经验档案路径（data/memory/<name>.md）由存储层推导 */
}

/** 群组空间模式 */
export type SpaceMode = 'default' | 'custom' | 'unrestricted'

/** 群组元数据 */
export interface GroupMeta {
  name: string
  /** 成员名称标签集合（label ≥ 3：user + butler + ≥1 工作智能体） */
  label: string[]
  /** 群组空间绝对路径（默认 <data>/group/<name>/） */
  space: string
  spaceMode: SpaceMode
  status: 'working' | 'archived' | 'destroyed'
  createdAt: number
  archivedAt?: number
  taskSummary?: string
}

/** mention 目标：'user' / 'butler' / <智能体名> / '@all' */
export type MentionTarget = string

/** 组装后的独立上下文（原体视角；组装公式见原体规格 §4.1） */
export interface AssembledContext {
  /** 冻结三段系统提示（基座 + 协议 + 定义） */
  system: string
  /** 公共上下文文本（逻辑顺序 = 事件 seq 顺序） */
  publicMessages: string[]
  /** 自己的私密文本（最新在前，追加于发言之前） */
  privateMessages: string[]
  /** 最近工具结果（截断后） */
  toolResults: string[]
  /** 按需调取的记忆（recall 结果） */
  memory?: string
}

/** 经验条目（条目式纯文档 md 的原子单元） */
export interface ExperienceEntry {
  id: string
  ts: number
  /** 来源（群组 / 任务） */
  source: string
  content: string
  tags?: string[]
}
