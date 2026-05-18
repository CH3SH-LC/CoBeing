import { ReviewInput, ReviewResult } from '@cobeing/shared'
import { Agent } from '../agent/agent.js'
import { Group } from './group.js'

export interface ReviewContext {
  agentId: string
  groupId: string
  reviewRetryCount: number
}

export async function reviewPipeline(
  group: Group,
  agent: Agent,
  message: string,
  ctx: ReviewContext
): Promise<{ result: ReviewResult; retryCount: number }> {
  const reviewer = group.reviewerAgent
  if (!reviewer) {
    return { result: { pass: true, reason: '' }, retryCount: ctx.reviewRetryCount }
  }

  const trace = agent.wakeSession?.getTrace()
  if (!trace) {
    return { result: { pass: true, reason: '' }, retryCount: ctx.reviewRetryCount }
  }
  trace.finalMessage = message

  const recentMessages = group.getRecentMessages(10)
  const mentions = group.getMentionsFor(agent.id)
  const workspace = group.workspace

  // 使用 AgentFiles 的公共方法获取 JOB.md
  const jobMd = agent.files.readJob()

  // 从 workspace 读取文件并截断
  const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s
  const taskMd = truncate(workspace.readTask() ?? '', 1000)
  const planMd = truncate(workspace.readPlan() ?? '', 1000)
  const progressMd = truncate(workspace.readProgress() ?? '', 1000)

  const input: ReviewInput = {
    agentJobMd: jobMd,
    agentTrace: trace,
    groupRecentMessages: recentMessages.map(m => `[${m.fromAgentId}]: ${m.content}`),
    agentMentions: mentions.map(m => `[${m.fromAgentId}]: ${m.content}`),
    groupTaskMd: taskMd,
    groupPlanMd: planMd,
    groupProgressMd: progressMd,
  }

  const reviewResult = await reviewer.reviewOnce(input)
  const retryCount = ctx.reviewRetryCount + 1

  return { result: reviewResult, retryCount }
}
