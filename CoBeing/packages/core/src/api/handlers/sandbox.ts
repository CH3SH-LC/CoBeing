/**
 * sandbox 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_sandbox_status / sandbox_action
 */
import type { HandlerRegistrar } from "./types.js";

export function registerSandboxHandlers(register: HandlerRegistrar): void {
  register("get_sandbox_status", async function (ws, _msg) {
    const agents = this.agentRegistry?.list() ?? [];
    const statuses = await Promise.all(agents.map(async agent => {
      const sandboxRunner = (agent as any).sandboxRunner;
      const base = sandboxRunner?.getStatus?.() ?? { containerId: null, running: false };
      // 真实指标：docker stats 采集，不可用时降级为 0（前端隐藏指标展示）
      const metrics = (sandboxRunner as any)?.getMetrics
        ? await sandboxRunner.getMetrics()
        : null;

      return {
        agentId: agent.id,
        agentName: agent.name,
        containerId: base.containerId,
        running: base.running,
        uptime: metrics?.uptime ?? 0,
        memoryUsage: metrics?.memoryUsage ?? 0,
        memoryLimit: metrics?.memoryLimit ?? 0,
        cpuPercent: metrics?.cpuPercent ?? 0,
        diskUsage: 0,
        diskLimit: 0,
      };
    }));

    this.sendToClient(ws, { type: "sandbox_status", payload: statuses });
  });

  register("sandbox_action", async function (ws, msg) {
    const { agentId, action } = msg.payload as { agentId: string; action: "start" | "stop" | "restart" | "delete" };
    const agent = this.agentRegistry?.get(agentId);

    if (!agent) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent not found: ${agentId}` } });
      return;
    }

    const sandboxRunner = (agent as any).sandboxRunner;
    if (!sandboxRunner) {
      this.sendToClient(ws, { type: "error", payload: { message: `Agent ${agentId} has no sandbox` } });
      return;
    }

    try {
      switch (action) {
        case "start":
          // 容器按需启动，在 Agent 首次使用沙箱时自动触发
          break;
        case "stop":
        case "delete":
          await sandboxRunner.destroy();
          break;
        case "restart":
          await sandboxRunner.destroy();
          break;
      }
      this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: true } });
    } catch (err: any) {
      this.sendToClient(ws, { type: "sandbox_action_result", payload: { agentId, action, success: false, error: err.message } });
    }
  });
}
