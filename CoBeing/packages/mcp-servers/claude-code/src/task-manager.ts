/**
 * ClaudeCodeTaskManager — 编码任务状态机
 *
 * 把一次 Claude Code 执行（可能 1-10 分钟）包装成可轮询的异步任务：
 * start() 立即返回 taskId，runner 后台执行，onOutput 流式累积，
 * status/result/cancel/list 对外查询与控制。
 *
 * 工作目录纪律：workingDir 必填 + 绝对路径 + 必须存在，缺失即 fail-fast 拒绝，
 * 绝不静默兜底 process.cwd()。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@cobeing/shared";
import type {
  CancelResult,
  ClaudeCodeRunner,
  ClaudeCodeRunOptions,
  ClaudeCodeRunResult,
  PermissionMode,
  StartParams,
  StartResult,
  TaskManagerOptions,
  TaskRecord,
  TaskState,
} from "./types.js";

const log = createLogger("claude-code-task-manager");

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ClaudeCodeTaskManager {
  private tasks = new Map<string, TaskRecord>();
  private controllers = new Map<string, AbortController>();

  constructor(
    private runner: ClaudeCodeRunner,
    private options: TaskManagerOptions = {},
  ) {}

  // ================================================================
  //  start
  // ================================================================

  start(params: StartParams): StartResult {
    // --- 工作目录校验（fail-fast） ---
    const workingDir = params.workingDir;
    if (!workingDir || typeof workingDir !== "string" || workingDir.trim() === "") {
      return { ok: false, error: "工作目录无效: workingDir 必须是非空字符串" };
    }
    if (!path.isAbsolute(workingDir)) {
      return { ok: false, error: `工作目录无效: 必须是绝对路径，收到 "${workingDir}"` };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(workingDir);
    } catch {
      return { ok: false, error: `工作目录不存在: ${workingDir}` };
    }
    if (!stat.isDirectory()) {
      return { ok: false, error: `工作目录不是目录: ${workingDir}` };
    }

    // --- 提示词校验 ---
    const prompt = params.prompt;
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      return { ok: false, error: "提示词无效: prompt 必须是非空字符串" };
    }

    // --- 数值校验 ---
    if (params.maxTurns !== undefined && (!Number.isFinite(params.maxTurns) || params.maxTurns <= 0)) {
      return { ok: false, error: `maxTurns 必须为正数，收到 ${params.maxTurns}` };
    }
    if (params.maxBudgetUsd !== undefined && (!Number.isFinite(params.maxBudgetUsd) || params.maxBudgetUsd <= 0)) {
      return { ok: false, error: `maxBudgetUsd 必须为正数，收到 ${params.maxBudgetUsd}` };
    }

    // --- 权限模式校验 ---
    if (params.permissionMode !== undefined && !PERMISSION_MODES.includes(params.permissionMode as PermissionMode)) {
      return { ok: false, error: `permissionMode 无效: ${params.permissionMode}（可用: ${PERMISSION_MODES.join("/")}）` };
    }

    const id = randomUUID();
    const now = Date.now();
    const maxTurns = params.maxTurns ?? this.options.defaultMaxTurns;
    const maxBudgetUsd = params.maxBudgetUsd ?? this.options.defaultMaxBudgetUsd;
    const permissionMode =
      (params.permissionMode as PermissionMode | undefined) ?? this.options.defaultPermissionMode;

    const record: TaskRecord = {
      id,
      state: "running",
      cwd: workingDir,
      prompt,
      createdAt: now,
      updatedAt: now,
      output: [],
      maxTurns,
      maxBudgetUsd,
      model: params.model,
      permissionMode,
    };
    this.tasks.set(id, record);

    const controller = new AbortController();
    this.controllers.set(id, controller);

    const runOptions: ClaudeCodeRunOptions = {
      cwd: workingDir,
      prompt,
      systemPrompt: params.systemPrompt,
      permissionMode,
      allowedTools: params.allowedTools,
      maxTurns,
      maxBudgetUsd,
      model: params.model,
      sessionId: params.sessionId,
      signal: controller.signal,
      onOutput: (text: string) => {
        record.output.push(text);
        record.updatedAt = Date.now();
      },
    };

    // 后台执行，不阻塞 start 返回
    this.runner
      .run(runOptions)
      .then((result) => this.applyResult(id, result))
      .catch((err: Error) => {
        // 未在取消路径下抛出 → failed；已取消 → cancelled
        this.applyResult(id, {
          state: controller.signal.aborted ? "cancelled" : "failed",
          error: err.message,
        });
      });

    log.info("[%s] started cwd=%s maxTurns=%s budget=%s", id, workingDir, maxTurns ?? "-", maxBudgetUsd ?? "-");
    return { ok: true, taskId: id };
  }

  // ================================================================
  //  查询与控制
  // ================================================================

  status(taskId: string): TaskRecord | undefined {
    const rec = this.tasks.get(taskId);
    return rec ? this.snapshot(rec) : undefined;
  }

  /** 轮询等待结果：终态快路径直接返回；运行中等待至 timeoutMs，超时返回当前记录 */
  async result(taskId: string, timeoutMs = 25000): Promise<TaskRecord | undefined> {
    const rec = this.tasks.get(taskId);
    if (!rec) return undefined;
    const deadline = Date.now() + timeoutMs;
    while (rec.state === "running" && Date.now() < deadline) {
      await sleep(this.options.pollIntervalMs ?? 500);
    }
    return this.snapshot(rec);
  }

  cancel(taskId: string): CancelResult {
    const rec = this.tasks.get(taskId);
    if (!rec) return { ok: false, error: `任务不存在: ${taskId}` };
    if (rec.state !== "running") return { ok: false, error: `任务已处于 ${rec.state} 状态，无法取消` };

    rec.state = "cancelled";
    rec.updatedAt = Date.now();
    this.controllers.get(taskId)?.abort();
    this.controllers.delete(taskId);
    log.info("[%s] cancelled by request", taskId);
    return { ok: true };
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].map((r) => this.snapshot(r));
  }

  // ================================================================
  //  内部
  // ================================================================

  /** 应用 runner 结果到记录；已取消的任务不允许被后续结果覆盖 */
  private applyResult(id: string, result: ClaudeCodeRunResult): void {
    const rec = this.tasks.get(id);
    if (!rec) return;
    if (rec.state === "cancelled") return; // cancel() 已置为终态，忽略迟到的 runner 结果
    if (rec.state !== "running") return;

    rec.updatedAt = Date.now();
    if (result.sessionId) rec.sessionId = result.sessionId;

    switch (result.state) {
      case "completed":
        rec.state = "completed";
        rec.result = result.result;
        rec.totalCostUsd = result.totalCostUsd;
        log.info("[%s] completed cost=%s", id, result.totalCostUsd ?? "-");
        break;
      case "failed":
        rec.state = "failed";
        rec.error = result.error;
        log.warn("[%s] failed: %s", id, result.error);
        break;
      case "cancelled":
        rec.state = "cancelled";
        break;
    }
    this.controllers.delete(id);
  }

  private snapshot(rec: TaskRecord): TaskRecord {
    // 输出累计上限，防长时间任务内存膨胀
    const maxChars = this.options.maxOutputChars ?? 20000;
    const joined = rec.output.join("");
    const output = joined.length > maxChars ? [`…${joined.slice(-maxChars)}`] : rec.output;
    return { ...rec, output };
  }
}

export type { TaskState };
