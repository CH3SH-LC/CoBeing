/**
 * Observability 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * get_dashboard / get_llm_stats / get_tool_stats / get_screener_stats /
 * get_agent_timeline / search_conversation / export_data
 */
import fs from "node:fs";
import path from "node:path";
import { isSafeId } from "../security.js";
import type { HandlerRegistrar } from "./types.js";

export function registerObservabilityHandlers(register: HandlerRegistrar): void {
  register("get_dashboard", function (ws, msg) {
    const { groupId: gId } = (msg.payload as { groupId?: string }) ?? {};
    const rt = (globalThis as any).__cobeing?.runtime;
    if (!rt?.observabilityDB) {
      this.sendToClient(ws, { type: "dashboard", payload: { error: "Observability not available" } });
      return;
    }
    this.sendToClient(ws, { type: "dashboard", payload: rt.observabilityDB.getDashboard(gId) });
  });

  register("get_llm_stats", function (ws, msg) {
    const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
    const rt = (globalThis as any).__cobeing?.runtime;
    if (!rt?.observabilityDB) {
      this.sendToClient(ws, { type: "llm_stats", payload: { error: "Observability not available" } });
      return;
    }
    this.sendToClient(ws, { type: "llm_stats", payload: rt.observabilityDB.getLLMStats({ agentId, groupId, since, limit }) });
  });

  register("get_tool_stats", function (ws, msg) {
    const { agentId, groupId, since, limit } = (msg.payload as any) ?? {};
    const rt = (globalThis as any).__cobeing?.runtime;
    if (!rt?.observabilityDB) {
      this.sendToClient(ws, { type: "tool_stats", payload: { error: "Observability not available" } });
      return;
    }
    this.sendToClient(ws, { type: "tool_stats", payload: rt.observabilityDB.getToolStats({ agentId, groupId, since, limit }) });
  });

  register("get_screener_stats", function (ws, msg) {
    const { groupId: scrGroupId } = msg.payload as { groupId: string };
    const gm = this.groupManager;
    if (!gm) { this.sendToClient(ws, { type: "error", payload: { message: "GroupManager 未初始化" } }); return; }
    const g = gm.get(scrGroupId);
    if (!g) { this.sendToClient(ws, { type: "error", payload: { message: `群组未找到: ${scrGroupId}` } }); return; }
    const screener = (g as any).screener;
    if (!screener?.getStats) {
      this.sendToClient(ws, { type: "screener_stats", payload: { groupId: scrGroupId, totalChecked: 0, totalFiltered: 0, estimatedTokensSaved: 0 } });
    } else {
      this.sendToClient(ws, { type: "screener_stats", payload: { groupId: scrGroupId, ...screener.getStats() } });
    }
  });

  register("get_agent_timeline", function (ws, msg) {
    const { agentId: tlAgentId, limit: tlLimit } = msg.payload as { agentId: string; limit?: number };
    const obsDb = (globalThis as any).__cobeingObsDb;
    if (!obsDb) { this.sendToClient(ws, { type: "error", payload: { message: "Observability DB 未初始化" } }); return; }
    try {
      const { calls } = obsDb.getToolStats({ agentId: tlAgentId, limit: tlLimit ?? 50 });
      this.sendToClient(ws, { type: "agent_timeline", payload: { agentId: tlAgentId, events: calls } });
    } catch { this.sendToClient(ws, { type: "agent_timeline", payload: { agentId: tlAgentId, events: [] } }); }
  });

  register("search_conversation", async function (ws, msg) {
    const { query, groupId: scGroupId, session: scSession } = msg.payload as { query: string; groupId?: string; session?: string };
    if (!query?.trim()) { this.sendToClient(ws, { type: "error", payload: { message: "query required" } }); return; }
    try {
      const agentId = "butler";
      const agentDir = path.join(this.dataRoot, "agents", agentId);
      const { MemoryStore } = await import("../../memory/memory-store.js");
      const store = MemoryStore.createLazy(agentDir);
      await store.ready();
      const results = store.searchHistory(query, scSession ?? scGroupId, 20);
      this.sendToClient(ws, { type: "search_results", payload: { query, results } });
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: `搜索失败: ${err.message}` } });
    }
  });

  register("export_data", function (ws, msg) {
    const { exportType, exportAgentId, exportGroupId } = msg.payload as { exportType: string; exportAgentId?: string; exportGroupId?: string };
    try {
      // 路径穿越防护
      if (exportAgentId && !isSafeId(exportAgentId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 agentId" } }); return; }
      if (exportGroupId && !isSafeId(exportGroupId)) { this.sendToClient(ws, { type: "error", payload: { message: "非法 groupId" } }); return; }

      const files: Array<{ path: string; content: string }> = [];
      let targetDir: string;

      if (exportType === "agent" && exportAgentId) {
        targetDir = path.join(this.dataRoot, "agents", exportAgentId);
      } else if (exportType === "group" && exportGroupId) {
        targetDir = path.join(this.dataRoot, "groups", exportGroupId);
      } else {
        targetDir = this.dataRoot;
      }

      // 二次确认目标目录在 dataRoot 内
      const normalizedTarget = path.resolve(targetDir);
      const normalizedRoot = path.resolve(this.dataRoot);
      if (!normalizedTarget.startsWith(normalizedRoot)) {
        this.sendToClient(ws, { type: "error", payload: { message: "导出路径超出数据目录" } });
        return;
      }

      if (fs.existsSync(targetDir)) {
        const collectFiles = (dir: string, prefix: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, entry.name);
            const rel = path.join(prefix, entry.name);
            if (entry.isDirectory()) {
              collectFiles(fp, rel);
            } else if (entry.isFile() && !entry.name.endsWith(".db") && !entry.name.endsWith(".db-wal") && !entry.name.endsWith(".db-shm")) {
              try {
                const content = fs.readFileSync(fp, "utf-8");
                if (content.length < 500_000) {
                  files.push({ path: rel, content });
                } else {
                  files.push({ path: rel, content: `[文件过大 ${content.length} chars，已省略]` });
                }
              } catch {
                files.push({ path: rel, content: "[二进制文件，已省略]" });
              }
            }
          }
        };
        collectFiles(targetDir, "");
      }

      const json = JSON.stringify({ exportType, exportedAt: new Date().toISOString(), files });
      this.sendToClient(ws, { type: "export_result", payload: { exportType, data: json, fileCount: files.length } });
    } catch (err: any) {
      this.sendToClient(ws, { type: "error", payload: { message: `导出失败: ${err.message}` } });
    }
  });
}
