/**
 * group 域 WS 命令 handler — 从 ws-server.ts 的 switch 迁移
 * create_group / destroy_group / add_group_member / remove_group_member /
 * get_group_workspace / get_group_workspace_file / save_group_workspace_file /
 * get_group_history / get_group_health
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger, DEFAULT_MODEL, DEFAULT_PROVIDER, MAX_GROUP_NAME_LENGTH, updateGroupMembers } from "@cobeing/shared";
import { ButlerRegistry } from "../../agent/butler-registry.js";
import { runGroupCreator } from "../../agent/tool-agent/creator.js";
import { isSafeId, isSafeLeafFilename, resolveWithin } from "../security.js";
import { buildGroupCreatorDraftNote } from "../types.js";
import type { HandlerRegistrar } from "./types.js";

const log = createLogger("ws-server");

export function registerGroupHandlers(register: HandlerRegistrar): void {
  register("create_group", async function (ws, msg) {
    const { name, members, topic } = msg.payload as {
      name: string; members: string[]; topic?: string;
    };
    if (!name || !members || members.length === 0) {
      this.sendToClient(ws, { type: "error", payload: { message: "name and members are required" } });
      return;
    }
    // Name length + character validation
    if (name.length > MAX_GROUP_NAME_LENGTH) {
      this.sendToClient(ws, { type: "error", payload: { message: `群组名称不能超过 ${MAX_GROUP_NAME_LENGTH} 个字符` } });
      return;
    }
    if (!/^[\w一-鿿㐀-䶿 -]+$/.test(name)) {
      this.sendToClient(ws, { type: "error", payload: { message: "群组名称只能包含字母、数字、中文、连字符、下划线和空格" } });
      return;
    }
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (this.groupManager?.get(id)) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group already exists: ${id}` } });
      return;
    }

    // 强制要求群主智能体
    const hostAgent = this.agentRegistry?.get("host");
    if (!hostAgent) {
      this.sendToClient(ws, { type: "error", payload: { message: "群主智能体不可用，无法创建群组" } });
      return;
    }

    const allMembers = ["host", ...members.filter(m => m !== "host")];

    this.groupManager!.create({
      id,
      name,
      members: allMembers,
      owner: "host",
      topic,
    });

    // 为初始成员注入群组通信工具
    for (const memberId of allMembers) {
      const mAgent = this.agentRegistry?.get(memberId);
      if (mAgent && this.groupManager) {
        mAgent.injectGroupTools((gid) => this.groupManager!.get(gid));
      }
    }

    // Update ButlerRegistry
    const butlerReg = new ButlerRegistry(this.dataRoot);
    butlerReg.registerGroup({
      id,
      name,
      members: allMembers,
    });

    this.logMessage("system", `Group created: ${name} (${id})`);
    this.sendToClient(ws, { type: "group_created", payload: { id, name } });
    this.broadcastState();

    // 用 Creator ToolAgent 生成群组初始草案，调用方负责应用，失败不阻塞创建。
    let creatorDraftNote = "";
    const newGroup = this.groupManager!.get(id);
    if (newGroup) {
      const creatorProvider = this.providerResolver?.(DEFAULT_PROVIDER);
      if (creatorProvider) {
        try {
          const draft = await runGroupCreator(creatorProvider, DEFAULT_MODEL, {
            name,
            topic,
            members: allMembers.map(memberId => {
              const member = this.agentRegistry?.get(memberId);
              return {
                id: memberId,
                name: member?.name ?? memberId,
                role: (member as any)?.config?.role,
              };
            }),
          });

          if (draft.guide) {
            fs.writeFileSync(newGroup.workspace.paths.guide, draft.guide, "utf-8");
          }
          if (draft.plan) {
            newGroup.workspace.writeFile("plan", draft.plan);
          }

          creatorDraftNote = buildGroupCreatorDraftNote(draft);
        } catch (err) {
          log.warn("GroupCreator generation failed for %s, keeping default group templates: %s", id, err);
        }
      } else {
        log.warn("GroupCreator skipped for %s: default provider %s not found", id, DEFAULT_PROVIDER);
      }
    }

    // 唤醒群主与用户对接（不唤醒组员）
    if (newGroup) {
      newGroup.postMessage("system", `@host 新群组"${name}"已创建，成员包括：${allMembers.map(m => {
        const a = this.agentRegistry?.get(m);
        return a?.name ?? m;
      }).join("、")}。

【重要】在开始任何工作之前，你必须先与用户沟通：
1. 向用户打招呼，介绍群组已创建及其成员
2. 了解用户的具体需求和期望目标
3. 讨论任务范围和优先级
4. 获得用户确认后再开始规划和分配工作
${creatorDraftNote}

不要自行决定任务方向或直接开始工作——必须先征求用户意见。`);
    }
  });

  register("destroy_group", function (ws, msg) {
    const { groupId } = msg.payload as { groupId: string };
    if (!groupId) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
      return;
    }
    const group = this.groupManager?.get(groupId);
    if (!group) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${groupId}` } });
      return;
    }
    // 发送解散通知
    const groupName = group.config.name;
    const memberNames = group.config.members.map((m: string) => {
      const a = this.agentRegistry?.get(m);
      return a?.name ?? m;
    }).join("、");
    try {
      group.postMessage("system", `[系统] 群组 "${groupName}" 已被解散。前成员: ${memberNames}。相关文件已清理。`);
    } catch {}
    this.groupManager!.delete(groupId);
    const butlerReg = new ButlerRegistry(this.dataRoot);
    butlerReg.unregisterGroup(groupId);
    this.logMessage("system", `Group destroyed: ${groupId}`);
    this.sendToClient(ws, { type: "group_destroyed", payload: { groupId } });
    this.broadcastState();
  });

  register("add_group_member", function (ws, msg) {
    const { groupId: addGId, agentId: addAId } = msg.payload as { groupId: string; agentId: string };
    if (!addGId || !addAId) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId and agentId are required" } });
      return;
    }
    const addGroup = this.groupManager?.get(addGId);
    if (!addGroup) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${addGId}` } });
      return;
    }
    addGroup.addMember(addAId);
    // 为新成员注入群组通信工具
    const addAgent = this.agentRegistry?.get(addAId);
    if (addAgent && this.groupManager) {
      addAgent.injectGroupTools((gid) => this.groupManager!.get(gid));
    }
    // 更新 master registry
    updateGroupMembers(this.dataRoot, addGId, addGroup.config.members);
    this.groupManager!.saveGroup(addGId);
    // Update ButlerRegistry
    const addButlerReg = new ButlerRegistry(this.dataRoot);
    const addGEntry = addButlerReg.parseGroupsRegistry().find(g => g.id === addGId);
    if (addGEntry) {
      addButlerReg.registerGroup({ ...addGEntry, members: [...addGEntry.members, addAId] });
    }
    this.sendToClient(ws, { type: "member_added", payload: { groupId: addGId, agentId: addAId } });
    this.broadcastState();
  });

  register("remove_group_member", function (ws, msg) {
    const { groupId: rmGId, agentId: rmAId } = msg.payload as { groupId: string; agentId: string };
    if (!rmGId || !rmAId) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId and agentId are required" } });
      return;
    }
    // 群主不可被移除
    if (rmAId === "host") {
      this.sendToClient(ws, { type: "error", payload: { message: "群主不可被移除" } });
      return;
    }
    const rmGroup = this.groupManager?.get(rmGId);
    if (!rmGroup) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${rmGId}` } });
      return;
    }
    rmGroup.removeMember(rmAId);
    // 更新 master registry
    updateGroupMembers(this.dataRoot, rmGId, rmGroup.config.members);
    this.groupManager!.saveGroup(rmGId);
    // Update ButlerRegistry
    const rmButlerReg = new ButlerRegistry(this.dataRoot);
    const rmGEntry = rmButlerReg.parseGroupsRegistry().find(g => g.id === rmGId);
    if (rmGEntry) {
      rmButlerReg.registerGroup({ ...rmGEntry, members: rmGEntry.members.filter(m => m !== rmAId) });
    }
    this.sendToClient(ws, { type: "member_removed", payload: { groupId: rmGId, agentId: rmAId } });
    this.broadcastState();
  });

  register("get_group_workspace", function (ws, msg) {
    const { groupId: wsGId } = msg.payload as { groupId: string };
    if (!wsGId) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
      return;
    }
    const wsGroup = this.groupManager?.get(wsGId);
    if (!wsGroup) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${wsGId}` } });
      return;
    }
    const summary = wsGroup.workspace.getSummary();
    this.sendToClient(ws, {
      type: "group_workspace",
      payload: { groupId: wsGId, docs: summary },
    });
  });

  register("get_group_workspace_file", function (ws, msg) {
    const { groupId: gfGId, filename: gfName } = msg.payload as { groupId: string; filename: string };
    if (!gfGId || !gfName) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId and filename are required" } });
      return;
    }
    if (!isSafeId(gfGId) || !isSafeLeafFilename(gfName)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
      return;
    }
    const gfGroup = this.groupManager?.get(gfGId);
    if (!gfGroup) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${gfGId}` } });
      return;
    }
    const gfPath = resolveWithin(path.join(this.dataRoot, "groups", gfGId), gfName);
    const content = fs.existsSync(gfPath) ? fs.readFileSync(gfPath, "utf-8") : "";
    this.sendToClient(ws, {
      type: "group_workspace_file",
      payload: { groupId: gfGId, filename: gfName, content },
    });
  });

  register("save_group_workspace_file", function (ws, msg) {
    const { groupId: sfGId, filename: sfName, content: sfContent } = msg.payload as {
      groupId: string; filename: string; content: string;
    };
    if (!sfGId || !sfName || sfContent === undefined) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId, filename and content are required" } });
      return;
    }
    if (!isSafeId(sfGId) || !isSafeLeafFilename(sfName)) {
      this.sendToClient(ws, { type: "error", payload: { message: "Invalid filename" } });
      return;
    }
    const sfGroup = this.groupManager?.get(sfGId);
    if (!sfGroup) {
      this.sendToClient(ws, { type: "error", payload: { message: `Group not found: ${sfGId}` } });
      return;
    }
    const sfDir = path.join(this.dataRoot, "groups", sfGId);
    if (!fs.existsSync(sfDir)) fs.mkdirSync(sfDir, { recursive: true });
    fs.writeFileSync(resolveWithin(sfDir, sfName), sfContent, "utf-8");
    this.sendToClient(ws, {
      type: "group_workspace_file_saved",
      payload: { groupId: sfGId, filename: sfName },
    });
  });

  register("get_group_history", function (ws, msg) {
    const { groupId, before, limit } = msg.payload as { groupId: string; before?: number; limit?: number };
    if (!groupId) {
      this.sendToClient(ws, { type: "error", payload: { message: "groupId is required" } });
      return;
    }
    const ghGroup = this.groupManager?.get(groupId);
    if (!ghGroup) {
      this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: [], hasMore: false } });
      return;
    }
    const db = ghGroup.groupDb;
    if (!db) {
      this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: [], hasMore: false } });
      return;
    }
    const actualLimit = Math.min(limit ?? 50, 100);
    const stored = db.getAllMessages({ before, limit: actualLimit });
    const hasMore = stored.length > actualLimit;
    const msgs = stored.slice(0, actualLimit);
    const formatted = msgs.map((m) => ({
      direction: "out" as const,
      content: m.content,
      timestamp: m.timestamp,
      senderId: m.from_agent_id,
    }));
    this.sendToClient(ws, { type: "group_history", payload: { groupId, messages: formatted, hasMore } });
  });

  register("get_group_health", function (ws, msg) {
    const { groupId: hlGroupId } = msg.payload as { groupId: string };
    const gm2 = this.groupManager;
    if (!gm2) { this.sendToClient(ws, { type: "error", payload: { message: "GroupManager 未初始化" } }); return; }
    const g2 = gm2.get(hlGroupId);
    if (!g2) { this.sendToClient(ws, { type: "error", payload: { message: `群组未找到: ${hlGroupId}` } }); return; }

    // TODO 完成率
    const todoStore = this.groupManager?.getGroupTodoStore?.(hlGroupId);
    let totalTodos = 0; let completedTodos = 0; let longestPendingHours = 0;
    if (todoStore) {
      const all = todoStore.list();
      totalTodos = all.length;
      completedTodos = all.filter((t: any) => t.status === "completed").length;
      const now = Date.now();
      let oldestPending = Infinity;
      for (const t of all) {
        if (t.status !== "completed") {
          const triggerTime = new Date(t.triggerAt).getTime();
          if (triggerTime < oldestPending) oldestPending = triggerTime;
        }
      }
      if (oldestPending < Infinity) {
        longestPendingHours = Math.round((now - oldestPending) / 3600000 * 10) / 10;
      }
    }

    // 成员参与度
    const memberActivity: Array<{ agentId: string; name: string; messageCount: number; lastActive: string | null }> = [];
    for (const m of g2.config.members) {
      const agent = this.agentRegistry?.get(m);
      const history = (g2 as any).ctxV2?.getMessages?.() ?? [];
      const agentMsgs = history.filter((msg: any) => msg.fromAgentId === m);
      const lastMsg = agentMsgs.length > 0 ? agentMsgs[agentMsgs.length - 1] : null;
      memberActivity.push({
        agentId: m,
        name: agent?.name ?? m,
        messageCount: agentMsgs.length,
        lastActive: lastMsg?.timestamp ? new Date(lastMsg.timestamp).toISOString() : null,
      });
    }

    // 群组状态
    const status = (g2 as any).status ?? "active";
    const createdAt = (g2 as any).createdAt ?? "";

    this.sendToClient(ws, {
      type: "group_health",
      payload: {
        groupId: hlGroupId,
        status,
        createdAt,
        memberCount: g2.config.members.length,
        memberActivity,
        todoStats: { total: totalTodos, completed: completedTodos, completionRate: totalTodos > 0 ? Math.round(completedTodos / totalTodos * 100) : 0 },
        longestPendingHours,
      },
    });
  });
}
