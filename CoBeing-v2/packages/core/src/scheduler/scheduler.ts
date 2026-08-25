/**
 * 工具调度器（移植 dsh `tool-calls.ts` 六语义，架构 §3）
 *
 * 1. 按执行模式分类（排他屏障 / 并行安全池，有界 maxParallel）
 * 2. 结果按模型序提交（committed 只推进连续槽位）
 * 3. abort 收敛：停止新派发 + 排干已启动 + 未派发调用写合成结果
 * 4. 调度器失败：等待已启动派发 settle 后抛错，不虚构工具结果
 * 5. 并行池中后续调用重新分类（注册表变化可产生新屏障）
 * 6. 单个工具失败只落槽位（turn 级错误），不终止整个循环
 */

import type { ToolRegistry, ToolResult, ToolRunContext } from '@cobeing/types'

export interface PlannedToolCall {
  callId: string
  name: string
  args: unknown
}

export interface SchedulerHooks {
  /** 记录 tool/call 事件 */
  onCall(call: PlannedToolCall): Promise<void>
  /** 记录 tool/result 事件 */
  onResult(call: PlannedToolCall, result: ToolResult): Promise<void>
  /** 记录合成错误结果（abort 前未派发） */
  onSynthetic(call: PlannedToolCall): Promise<void>
}

export interface ExecuteOutcome {
  concluded: boolean
  aborted: boolean
}

export class ToolScheduler {
  constructor(
    private registry: ToolRegistry,
    private maxParallel = 10,
  ) {}

  async execute(
    calls: PlannedToolCall[],
    ctx: ToolRunContext,
    hooks: SchedulerHooks,
    signal: AbortSignal,
  ): Promise<ExecuteOutcome> {
    let next = 0
    let concluded = false
    while (next < calls.length) {
      const first = calls[next]!
      const mode = this.registry.executionMode(first.name)
      const group = mode === 'parallel' ? calls.slice(next) : [first]
      const outcome = await this.runGroup(group, mode, ctx, hooks, signal)
      next += outcome.consumed
      concluded ||= outcome.concluded
      if (outcome.aborted) {
        for (const call of calls.slice(next)) await hooks.onSynthetic(call)
        return { concluded, aborted: true }
      }
    }
    return { concluded, aborted: false }
  }

  private async runGroup(
    group: PlannedToolCall[],
    mode: 'exclusive' | 'parallel',
    ctx: ToolRunContext,
    hooks: SchedulerHooks,
    signal: AbortSignal,
  ): Promise<{ consumed: number; aborted: boolean; concluded: boolean }> {
    const slots: (ToolResult | undefined)[] = group.map(() => undefined)
    let nextToStart = 0
    let committed = 0
    let started = 0
    let aborted = signal.aborted
    let concluded = false
    let schedulerError: unknown

    const throwSchedulerError = (): void => {
      if (schedulerError !== undefined) throw schedulerError
    }

    /** 模型序提交：只推进连续槽位 */
    const commitReady = async (): Promise<void> => {
      while (committed < group.length) {
        const slot = slots[committed]
        if (slot === undefined) break
        const call = group[committed]!
        await hooks.onCall(call)
        await hooks.onResult(call, slot)
        concluded ||= slot.concludesTurn === true
        committed++
      }
    }

    const inFlight = new Map<number, Promise<number>>()

    const startCall = async (index: number): Promise<void> => {
      const call = group[index]!
      started++
      const tool = this.registry.get(call.name)
      if (!tool) {
        slots[index] = {
          ok: false,
          content: `[TOOL_NOT_FOUND] tool not found: ${call.name}`,
          error: { message: 'tool not found', code: 'TOOL_NOT_FOUND' },
        }
        return
      }
      const promise = Promise.resolve()
        .then(() => tool.execute(call.args, ctx))
        .then(
          (result) => {
            slots[index] = result
            return index
          },
          (error: unknown) => {
            schedulerError ??= error
            return index
          },
        )
      inFlight.set(index, promise)
    }

    const fillPool = async (): Promise<void> => {
      while (!aborted && nextToStart < group.length && inFlight.size < this.maxParallel) {
        // 并行组中后续调用重新分类：注册表变化可产生新屏障
        if (
          nextToStart > 0
          && mode === 'parallel'
          && this.registry.executionMode(group[nextToStart]!.name) !== 'parallel'
        ) break
        await startCall(nextToStart)
        nextToStart++
        throwSchedulerError()
        await commitReady()
        throwSchedulerError()
        if (signal.aborted) aborted = true
      }
    }

    try {
      await fillPool()
      while (inFlight.size > 0) {
        const settled = await Promise.race(inFlight.values())
        inFlight.delete(settled)
        throwSchedulerError()
        await commitReady()
        throwSchedulerError()
        if (signal.aborted) aborted = true
        await fillPool()
      }
    } catch (error) {
      schedulerError ??= error
      await Promise.allSettled(inFlight.values())
      throw schedulerError
    }

    if (aborted) {
      // 已启动调用已 settle；未启动的写合成结果
      for (const call of group.slice(started)) await hooks.onSynthetic(call)
      return { consumed: group.length, aborted: true, concluded }
    }
    if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
    return { consumed: started, aborted: false, concluded }
  }
}
