/**
 * Claude Code MCP 工具定义
 *
 * 全部采用异步轮询模式：Claude Code 任务可长达数分钟，而 CoBeing MCPClient
 * 每次请求有 30s 硬超时，因此 start 立即返回 task_id，由 LLM 反复调 status/result
 * 轮询直至终态。
 *
 * 工具面:
 *   claude_code_start   — 提交编码任务，立即返回 task_id
 *   claude_code_status  — 查任务状态 + 部分输出
 *   claude_code_result  — 等待任务完成（内部最多等 ~25s，超时返回当前状态）
 *   claude_code_cancel  — 中止任务
 *   claude_code_list    — 列出全部任务
 */
import { createLogger } from "@cobeing/shared";
import type { ClaudeCodeTaskManager } from "./task-manager.js";
import type { StartParams, TaskRecord } from "./types.js";

const log = createLogger("claude-code-tools");

interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 任务记录的文本化摘要（供 LLM 读） */
function summarize(rec: TaskRecord): string {
  const lines = [
    `任务: ${rec.id}`,
    `状态: ${rec.state}`,
    `工作目录: ${rec.cwd}`,
    `提示词: ${truncate(rec.prompt, 200)}`,
    `轮数上限: ${rec.maxTurns ?? "-"}  预算: ${rec.maxBudgetUsd ? "$" + rec.maxBudgetUsd : "-"} 模型: ${rec.model ?? "-"}`,
  ];
  if (rec.output.length) {
    lines.push(`输出: ${truncate(rec.output.join(""), 3000)}`);
  }
  if (rec.state === "completed") {
    lines.push(`结果: ${truncate(rec.result ?? "(空)", 4000)}`);
    if (rec.totalCostUsd !== undefined) lines.push(`成本: $${rec.totalCostUsd.toFixed(4)}`);
  }
  if (rec.state === "failed" && rec.error) {
    lines.push(`错误: ${truncate(rec.error, 2000)}`);
  }
  if (rec.sessionId) lines.push(`会话: ${rec.sessionId}`);
  return lines.join("\n");
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const numOrStr = (v: unknown): number | undefined =>
  typeof v === "number" ? (Number.isFinite(v) ? v : undefined)
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
  : undefined;
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : undefined;

export function makeTools(manager: ClaudeCodeTaskManager): Tool[] {
  return [
    {
      name: "claude_code_start",
      description: `把编码任务委托给 Claude Code 完整 agent 循环执行（它自己推理、读写文件、跑命令、修 bug）。

调用后立即返回 task_id，任务在后台执行。随后用 claude_code_status / claude_code_result 轮询直至完成。
working_dir 必须存在且为绝对路径——Claude Code 只在其中工作。
permission_mode 默认 bypassPermissions（完全自治），工作目录即边界。
建议始终设置 max_budget_usd（默认 $2）与 max_turns（默认 50）控制成本。
若希望延续上一次会话的上下文，传入上次结果中的 session_id。`,
      inputSchema: {
        type: "object",
        properties: {
          working_dir: { type: "string", description: "Claude Code 工作目录（必填，绝对路径，必须存在）" },
          prompt: { type: "string", description: "编码任务描述（必填），如：修复 src/add.ts 中的求和 bug 并跑测试" },
          system_prompt: { type: "string", description: "覆盖系统提示词（可选，默认用 Claude Code 内置编码 agent 行为）" },
          permission_mode: {
            type: "string",
            description: "权限模式: bypassPermissions(完全自治,默认) / acceptEdits / default / plan / dontAsk",
            enum: ["bypassPermissions", "acceptEdits", "default", "plan", "dontAsk"],
          },
          allowed_tools: {
            type: "array",
            description: "自动放行工具列表（可选），如 ['Read','Edit','Bash','Grep','Glob','Write']",
            items: { type: "string" },
          },
          max_turns: { type: "number", description: "最大对话轮数（默认 50）" },
          max_budget_usd: { type: "number", description: "最大预算 USD（默认 $2）" },
          model: { type: "string", description: "模型名，如 claude-sonnet-5 / claude-opus-4-8（默认 CLI 默认模型）" },
          session_id: { type: "string", description: "延续此前任务的会话（可选，传上次 claude_code_status 返回的会话 ID）" },
        },
        required: ["working_dir", "prompt"],
      },
      async execute(params) {
        const workingDir = str(params.working_dir);
        const prompt = str(params.prompt);
        const startParams: StartParams = {
          workingDir,
          prompt,
          systemPrompt: str(params.system_prompt),
          permissionMode: str(params.permission_mode),
          allowedTools: strArr(params.allowed_tools),
          maxTurns: numOrStr(params.max_turns),
          maxBudgetUsd: numOrStr(params.max_budget_usd),
          model: str(params.model),
          sessionId: str(params.session_id),
        };
        const result = manager.start(startParams);
        if (!result.ok) {
          return { content: `claude_code_start 拒绝: ${result.error}`, isError: true };
        }
        return {
          content: [
            `任务已提交: ${result.taskId}`,
            `工作目录: ${workingDir}`,
            "用 claude_code_status 查询进度，或 claude_code_result 等待完成。",
          ].join("\n"),
        };
      },
    },

    {
      name: "claude_code_status",
      description: `查询一个 Claude Code 编码任务的当前状态与部分输出。

返回状态: running / completed / failed / cancelled。
running 时可用 claude_code_result 等待完成。`,
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "claude_code_start 返回的任务 ID" },
        },
        required: ["task_id"],
      },
      async execute(params) {
        const id = str(params.task_id);
        if (!id) return { content: "错误: 缺少 task_id", isError: true };
        const rec = manager.status(id);
        if (!rec) return { content: `任务不存在: ${id}`, isError: true };
        return { content: summarize(rec) };
      },
    },

    {
      name: "claude_code_result",
      description: `等待一个 Claude Code 编码任务完成并返回最终结果。

内部最多等待 timeout_ms（默认 25000ms，受 CoBeing 单次工具调用上限约束）。
若超时任务仍在 running，返回当前状态，可再次调用本工具继续等待。`,
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "claude_code_start 返回的任务 ID" },
          timeout_ms: { type: "number", description: "本次最多等待毫秒数，默认 25000" },
        },
        required: ["task_id"],
      },
      async execute(params) {
        const id = str(params.task_id);
        if (!id) return { content: "错误: 缺少 task_id", isError: true };
        const timeoutMs = Math.min(numOrStr(params.timeout_ms) ?? 25000, 28000);
        const rec = await manager.result(id, timeoutMs);
        if (!rec) return { content: `任务不存在: ${id}`, isError: true };
        return { content: summarize(rec) };
      },
    },

    {
      name: "claude_code_cancel",
      description: "中止一个正在运行的 Claude Code 编码任务。",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "claude_code_start 返回的任务 ID" },
        },
        required: ["task_id"],
      },
      async execute(params) {
        const id = str(params.task_id);
        if (!id) return { content: "错误: 缺少 task_id", isError: true };
        const result = manager.cancel(id);
        return result.ok
          ? { content: `任务 ${id} 已取消` }
          : { content: `取消失败: ${result.error}`, isError: true };
      },
    },

    {
      name: "claude_code_list",
      description: "列出所有 Claude Code 编码任务及其状态。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const records = manager.list();
        if (records.length === 0) {
          return { content: "当前没有 Claude Code 任务" };
        }
        const lines = records.map((r) => {
          const cost = r.totalCostUsd !== undefined ? ` $${r.totalCostUsd.toFixed(4)}` : "";
          const extra = r.error ? ` (${truncate(r.error, 80)})` : "";
          return `- ${r.id} [${r.state}] ${truncate(r.prompt, 60)}${cost}${extra}`;
        });
        return { content: `共 ${records.length} 个任务:\n` + lines.join("\n") };
      },
    },
  ];
}
