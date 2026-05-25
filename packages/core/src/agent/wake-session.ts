import { AgentTrace, AgentTraceToolCall } from "@cobeing/shared";

/**
 * Agent 唤醒周期轨迹记录器
 *
 * 在群组审核场景中，Reviewer 需要审查 Agent 在本次唤醒周期内的全部工作轨迹：
 * 思考过程（LLM 输出文本）、工具调用及结果、最终回复。
 *
 * WakeSession 在 Agent 的 run() 群组模式下初始化，通过 ConversationLoop 的事件
 * 自动记录所有轨迹数据，最终通过 getTrace() 输出供审核系统使用。
 */
export class WakeSession {
  readonly startTime: number = Date.now();
  private _thinking: string[] = [];
  private _toolCalls: AgentTraceToolCall[] = [];
  finalMessage: string = "";

  /** 记录 LLM 输出文本（每块 content/reasoning） */
  recordThinking(text: string): void {
    this._thinking.push(text);
  }

  /** 记录工具调用及其执行结果 */
  recordToolCall(
    tool: string,
    args: Record<string, unknown>,
    result: string,
  ): void {
    this._toolCalls.push({ tool, args, result });
  }

  /** 获取完整轨迹（返回副本，外部修改不影响已录数据） */
  getTrace(): AgentTrace {
    return {
      thinking: [...this._thinking],
      toolCalls: [...this._toolCalls],
      finalMessage: this.finalMessage,
    };
  }

  /** 重置轨迹（新唤醒周期开始前调用） */
  reset(): void {
    this._thinking = [];
    this._toolCalls = [];
    this.finalMessage = "";
  }
}
