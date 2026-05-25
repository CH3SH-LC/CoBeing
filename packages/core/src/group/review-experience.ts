import type { Agent } from '../agent/agent.js'
import { Group } from './group.js'

export async function injectReviewExperience(
  agent: Agent,
  group: Group,
  reason: string,
  exhausted: boolean
): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10)
  const status = exhausted ? '轮次耗尽强制发布' : '已根据反馈修正后通过'

  const entry = [
    `## ${dateStr} 审核反馈（群组：${group.config.name}）`,
    '',
    `向群组发送消息时审核未通过：`,
    `- 原因：${reason}`,
    `- 处理结果：${status}`,
    '',
  ].join('\n')

  try {
    agent.files.appendMemoryIndex(entry)
  } catch (err) {
    // 经验注入失败不应阻塞主流程
    console.warn(`[Review] 经验注入失败: ${err}`)
  }
}
