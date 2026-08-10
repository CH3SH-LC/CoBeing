/**
 * Claude Code SDK Runner — 把 @anthropic-ai/claude-agent-sdk 的 query() 封装成 ClaudeCodeRunner
 *
 * query() 驱动 Claude Code 完整 agent 循环：模型自己推理、调用工具（读写文件/Bash 等）、
 * 多轮直至完成。本封装把流式输出（stream_event 文本增量）转成 onOutput 回调，
 * 把终态 result 消息转成 completed/failed 结果。
 *
 * 环境变量:
 *   CLAUDE_CODE_PATH          — 覆盖 Claude Code 可执行文件路径（默认用 SDK 自带）
 *   ANTHROPIC_API_KEY         — API 计费密钥（可选，缺省用 CLI 既有登录态）
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import { createLogger } from "@cobeing/shared";
import type {
  ClaudeCodeRunner,
  ClaudeCodeRunOptions,
  ClaudeCodeRunResult,
} from "./types.js";

const log = createLogger("claude-code-sdk");

/**
 * CoBeing 的 StdioTransport 用白名单 env 启动本 server（仅 PATH/SystemRoot/TEMP/TMP + config env）。
 * Claude Code 在 Windows 靠 %USERPROFILE%\.claude 找登录态，缺 USERPROFILE/HOME 会认证失败。
 * 这里给 query 子进程补一个完整 env：继承本进程 + 兜底 homedir。
 */
function buildSubprocessEnv(): Record<string, string> {
  const home = os.homedir();
  return {
    ...(process.env as Record<string, string>),
    ...(process.env.USERPROFILE ? {} : { USERPROFILE: home }),
    ...(process.env.HOME ? {} : { HOME: home }),
  };
}

export interface SdkRunnerOptions {
  /** Claude Code 可执行文件路径（缺省用 SDK 内置） */
  pathToClaudeCodeExecutable?: string;
}

export function makeSdkRunner(options: SdkRunnerOptions = {}): ClaudeCodeRunner {
  const executable =
    options.pathToClaudeCodeExecutable ?? process.env.CLAUDE_CODE_PATH;

  return {
    async run(opts: ClaudeCodeRunOptions): Promise<ClaudeCodeRunResult> {
      // signal → abortController 桥接
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (opts.signal) {
        if (opts.signal.aborted) controller.abort();
        else opts.signal.addEventListener("abort", onAbort, { once: true });
      }

      const isBypass = opts.permissionMode === "bypassPermissions";

      try {
        for await (const msg of query({
          prompt: opts.prompt,
          options: {
            cwd: opts.cwd,
            env: buildSubprocessEnv(),
            ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
            permissionMode: opts.permissionMode,
            // bypassPermissions 必须显式声明（SDK 安全阀）
            ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
            ...(opts.allowedTools?.length ? { allowedTools: opts.allowedTools } : {}),
            ...(opts.maxTurns ? { maxTurns: opts.maxTurns } : {}),
            ...(opts.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            ...(opts.sessionId ? { resume: opts.sessionId } : {}),
            ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
            abortController: controller,
            includePartialMessages: true,
          },
        })) {
          // 流式文本增量
          if (msg.type === "stream_event") {
            const ev = msg.event;
            if (
              ev.type === "content_block_delta" &&
              ev.delta?.type === "text_delta" &&
              typeof ev.delta.text === "string" &&
              ev.delta.text
            ) {
              opts.onOutput?.(ev.delta.text);
            }
            continue;
          }

          // 终态（SDKResultMessage 用 subtype 判别，is_error 无法收窄类型）
          if (msg.type === "result") {
            if (msg.subtype === "success") {
              return {
                state: "completed",
                result: msg.result,
                sessionId: msg.session_id,
                totalCostUsd: msg.total_cost_usd,
              };
            }
            const detail = msg.errors?.join("\n") || msg.subtype;
            log.warn("execution error subtype=%s", msg.subtype);
            return { state: "failed", error: detail, sessionId: msg.session_id };
          }
        }

        return { state: "failed", error: "Claude Code 执行结束但未返回结果消息" };
      } catch (err) {
        // 取消路径
        if (controller.signal.aborted || opts.signal?.aborted) {
          return { state: "cancelled" };
        }
        const message = err instanceof Error ? err.message : String(err);
        log.error("query error: %s", message);
        return { state: "failed", error: message };
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
