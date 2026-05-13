/**
 * QQ Bot 工具定义 — 供 Agent 调用的 MCP 工具
 *
 * 所有工具在沙箱模式下（未配置凭据）返回模拟数据，可正常开发测试。
 */
import type { QQClient } from "./qq-client.js";

interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

export function makeTools(client: QQClient): Tool[] {
  return [
    // ================================================================
    //  消息收发
    // ================================================================

    {
      name: "qq_send_friend_message",
      description: `向指定用户发送好友消息（纯文本）。
注意频控: 主动推送每月 4 条，被动回复 5 分钟内最多 5 条。
参数 openId 为用户标识。传入被回复消息的 msgId 可用被动回复额度。`,
      inputSchema: {
        type: "object",
        properties: {
          openId: { type: "string", description: "目标用户的 openId" },
          content: { type: "string", description: "消息内容，纯文本" },
          msgId: { type: "string", description: "被回复消息的 msg_id（传入可占被动回复额度）" },
        },
        required: ["openId", "content"],
      },
      async execute(params) {
        const { openId, content, msgId } = params as any;
        if (!openId) return { content: "错误: 缺少 openId", isError: true };
        if (!content) return { content: "错误: 缺少消息内容", isError: true };
        try {
          const r = await client.sendFriendMessage(openId, content, msgId);
          return { content: `好友消息已发送 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `发送失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_send_group_message",
      description: `向指定群发送群消息（纯文本）。
注意频控: 主动推送每月 4 条，被动回复 5 分钟内最多 5 条。
groupOpenId 通过 qq_get_groups 获取。传入 msgId 可占被动回复额度。`,
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "目标群的 group_openid" },
          content: { type: "string", description: "消息内容，纯文本" },
          msgId: { type: "string", description: "被回复消息的 msg_id" },
        },
        required: ["groupOpenId", "content"],
      },
      async execute(params) {
        const { groupOpenId, content, msgId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!content) return { content: "错误: 缺少消息内容", isError: true };
        try {
          const r = await client.sendGroupMessage(groupOpenId, content, msgId);
          return { content: `群消息已发送 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `发送失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_send_markdown_message",
      description: `发送 Markdown 格式消息（支持好友/群）。
支持标题、列表、表格、代码块、引用、加粗等 Markdown 语法。`,
      inputSchema: {
        type: "object",
        properties: {
          targetType: { type: "string", description: '"friend" 或 "group"' },
          openId: { type: "string", description: "好友 openId 或群 group_openid" },
          markdown: { type: "string", description: "Markdown 格式内容" },
          msgId: { type: "string", description: "被回复消息的 msg_id" },
        },
        required: ["targetType", "openId", "markdown"],
      },
      async execute(params) {
        const { targetType, openId, markdown, msgId } = params as any;
        if (!["friend", "group"].includes(targetType)) return { content: "错误: targetType 需为 friend 或 group", isError: true };
        if (!openId) return { content: "错误: 缺少 openId", isError: true };
        if (!markdown) return { content: "错误: 缺少 markdown 内容", isError: true };
        try {
          const r = await client.sendMarkdownMessage({ type: targetType, openId }, markdown, msgId);
          return { content: `Markdown 消息已发送 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `发送失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_send_image",
      description: `发送图片消息（支持好友/群）。
imageUrl 需为可公开访问的图片 URL。限制: 图片最大 30MB。`,
      inputSchema: {
        type: "object",
        properties: {
          targetType: { type: "string", description: '"friend" 或 "group"' },
          openId: { type: "string", description: "好友 openId 或群 group_openid" },
          imageUrl: { type: "string", description: "图片的公开 URL" },
          msgId: { type: "string", description: "被回复消息的 msg_id" },
        },
        required: ["targetType", "openId", "imageUrl"],
      },
      async execute(params) {
        const { targetType, openId, imageUrl, msgId } = params as any;
        if (!["friend", "group"].includes(targetType)) return { content: "错误: targetType 需为 friend 或 group", isError: true };
        if (!openId) return { content: "错误: 缺少 openId", isError: true };
        if (!imageUrl) return { content: "错误: 缺少图片 URL", isError: true };
        try {
          const r = await client.sendImageMessage({ type: targetType, openId }, imageUrl, msgId);
          return { content: `图片消息已发送 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `发送失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_send_rich_message",
      description: `发送富媒体组合消息（文字 + 图片 + 文件组合）。
适用于需要同时发送文本和图片的场景。`,
      inputSchema: {
        type: "object",
        properties: {
          targetType: { type: "string", description: '"friend" 或 "group"' },
          openId: { type: "string", description: "好友 openId 或群 group_openid" },
          text: { type: "string", description: "文本内容（可选）" },
          imageUrl: { type: "string", description: "图片 URL（可选）" },
          fileId: { type: "string", description: "已上传文件的 file_id（可选）" },
          fileType: { type: "number", description: "文件类型: 1=图片, 2=视频, 3=语音" },
          msgId: { type: "string", description: "被回复消息的 msg_id" },
        },
        required: ["targetType", "openId"],
      },
      async execute(params) {
        const { targetType, openId, text, imageUrl, fileId, fileType, msgId } = params as any;
        if (!["friend", "group"].includes(targetType)) return { content: "错误: targetType 需为 friend 或 group", isError: true };
        if (!openId) return { content: "错误: 缺少 openId", isError: true };
        try {
          const r = await client.sendRichMediaMessage({ type: targetType, openId }, { text, imageUrl, fileId, fileType }, msgId);
          return { content: `富媒体消息已发送 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `发送失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_withdraw_message",
      description: "撤回群消息。需要机器人有管理员权限，且只能撤回 2 分钟内的消息。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          msgId: { type: "string", description: "要撤回的消息 ID" },
        },
        required: ["groupOpenId", "msgId"],
      },
      async execute(params) {
        const { groupOpenId, msgId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!msgId) return { content: "错误: 缺少 msgId", isError: true };
        const ok = await client.withdrawGroupMessage(groupOpenId, msgId);
        return ok
          ? { content: "消息已撤回" }
          : { content: "撤回失败（可能超过 2 分钟或权限不足）", isError: true };
      },
    },

    {
      name: "qq_get_message_history",
      description: `获取指定群最近的消息记录。
返回消息 ID、发送者、内容和附件信息。可用于了解群内讨论上下文。`,
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          limit: { type: "number", description: "获取条数，默认 20，最大 50" },
        },
        required: ["groupOpenId"],
      },
      async execute(params) {
        const { groupOpenId, limit = 20 } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        try {
          const msgs = await client.getGroupMessageHistory(groupOpenId, Math.min(limit, 50));
          if (msgs.length === 0) return { content: "暂无消息记录" };
          const lines = msgs.map(m =>
            `[${new Date(m.timestamp).toLocaleString()}] ${m.fromName || m.fromId}: ${m.content.slice(0, 200)}${m.attachments?.length ? ` (${m.attachments.length} 个附件)` : ""}`
          );
          return { content: `群消息记录 (${msgs.length} 条):\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  文件工具
    // ================================================================

    {
      name: "qq_upload_file",
      description: `向指定群上传文件。
注意: QQ Bot 仅支持接收 pdf、doc、txt 格式的文件。
文件需先通过 web-fetch 或其他方式获取到可公开访问的 URL。`,
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "目标群的 group_openid" },
          fileUrl: { type: "string", description: "文件的公开可访问 URL" },
          fileName: { type: "string", description: "文件名含扩展名，如 report.pdf" },
        },
        required: ["groupOpenId", "fileUrl", "fileName"],
      },
      async execute(params) {
        const { groupOpenId, fileUrl, fileName } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!fileUrl) return { content: "错误: 缺少文件 URL", isError: true };
        const allowedExts = ["pdf", "doc", "docx", "txt"];
        const ext = fileName?.split(".").pop()?.toLowerCase();
        if (ext && !allowedExts.includes(ext)) {
          return { content: `不支持的文件类型 .${ext}，仅支持: ${allowedExts.join(", ")}`, isError: true };
        }
        try {
          const r = await client.uploadGroupFile(groupOpenId, fileUrl, fileName);
          return { content: `文件已上传 (id: ${r.id || "unknown"})` };
        } catch (err: any) {
          return { content: `上传失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  群组管理
    // ================================================================

    {
      name: "qq_get_groups",
      description: "获取机器人加入的所有群列表。返回 group_openid、群名称和成员数。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        try {
          const groups = await client.getGroups();
          if (groups.length === 0) return { content: "机器人未加入任何群" };
          const lines = groups.map(g =>
            `- ${g.group_name} (openId: ${g.group_openid})${g.member_count ? ` [${g.member_count} 人]` : ""}`
          );
          return { content: `已加入的群 (${groups.length}):\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_get_group_info",
      description: "获取指定群的详细信息，包括群名称、描述、成员数量等。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
        },
        required: ["groupOpenId"],
      },
      async execute(params) {
        const { groupOpenId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        try {
          const info = await client.getGroupInfo(groupOpenId);
          const lines = [
            `群名称: ${info.group_name}`,
            `openId: ${info.group_openid}`,
            ...(info.group_desc ? [`描述: ${info.group_desc}`] : []),
            ...(info.member_count ? [`成员数: ${info.member_count}`] : []),
            ...(info.max_member_count ? [`最大成员: ${info.max_member_count}`] : []),
          ];
          return { content: `群信息:\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_get_group_members",
      description: "获取指定群的成员列表。返回成员 openId、名称和角色。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          limit: { type: "number", description: "最多获取数量，默认 50" },
        },
        required: ["groupOpenId"],
      },
      async execute(params) {
        const { groupOpenId, limit = 50 } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        try {
          const members = await client.getGroupMembers(groupOpenId, Math.min(limit, 200));
          if (members.length === 0) return { content: "群暂无成员" };
          const lines = members.map(m =>
            `- ${m.member_name || m.member_openid}${m.roles?.length ? ` [${m.roles.join(", ")}]` : ""} (openId: ${m.member_openid})`
          );
          return { content: `群成员 (${members.length}):\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_get_member_info",
      description: "获取群内指定成员的信息。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          memberOpenId: { type: "string", description: "成员的 member_openid" },
        },
        required: ["groupOpenId", "memberOpenId"],
      },
      async execute(params) {
        const { groupOpenId, memberOpenId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!memberOpenId) return { content: "错误: 缺少 memberOpenId", isError: true };
        try {
          const info = await client.getGroupMemberInfo(groupOpenId, memberOpenId);
          const lines = [
            `openId: ${info.member_openid}`,
            `名称: ${info.member_name || "未知"}`,
            `角色: ${info.roles?.join(", ") || "普通成员"}`,
            ...(info.joined_at ? [`加入时间: ${info.joined_at}`] : []),
          ];
          return { content: `成员信息:\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_kick_member",
      description: "将指定成员移出群。需要机器人是群管理员或群主。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          memberOpenId: { type: "string", description: "要移除的成员 openId" },
          reason: { type: "string", description: "移除原因（可选，仅记录）" },
        },
        required: ["groupOpenId", "memberOpenId"],
      },
      async execute(params) {
        const { groupOpenId, memberOpenId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!memberOpenId) return { content: "错误: 缺少 memberOpenId", isError: true };
        const ok = await client.kickGroupMember(groupOpenId, memberOpenId);
        return ok
          ? { content: `已移出成员 ${memberOpenId}` }
          : { content: "移出失败（权限不足或成员不存在）", isError: true };
      },
    },

    {
      name: "qq_mute_member",
      description: `禁言/解除禁言群成员。需要机器人是群管理员或群主。
durationMs = 0 解除禁言，= -1 永久禁言，> 0 禁言指定毫秒数。`,
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          memberOpenId: { type: "string", description: "目标成员 openId" },
          durationMs: { type: "number", description: "禁言毫秒数（0=解禁, -1=永久, 60000=1分钟）" },
          reason: { type: "string", description: "禁言原因（可选，仅记录）" },
        },
        required: ["groupOpenId", "memberOpenId", "durationMs"],
      },
      async execute(params) {
        const { groupOpenId, memberOpenId, durationMs } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!memberOpenId) return { content: "错误: 缺少 memberOpenId", isError: true };
        const ok = await client.muteGroupMember(groupOpenId, memberOpenId, durationMs);
        const label = durationMs === 0 ? "解除禁言" : durationMs === -1 ? "永久禁言" : `禁言 ${Math.round(durationMs / 1000)} 秒`;
        return ok
          ? { content: `已${label} ${memberOpenId}` }
          : { content: `${label}失败（权限不足）`, isError: true };
      },
    },

    {
      name: "qq_set_group_admin",
      description: "设置/取消群管理员。需要使用机器人的 appId 为群主。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
          memberOpenId: { type: "string", description: "目标成员 openId" },
          isAdmin: { type: "boolean", description: "true=设为管理员, false=取消管理员" },
        },
        required: ["groupOpenId", "memberOpenId", "isAdmin"],
      },
      async execute(params) {
        const { groupOpenId, memberOpenId, isAdmin } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        if (!memberOpenId) return { content: "错误: 缺少 memberOpenId", isError: true };
        const ok = await client.setGroupAdmin(groupOpenId, memberOpenId, isAdmin);
        return ok
          ? { content: `已${isAdmin ? "设为" : "取消"}管理员 (${memberOpenId})` }
          : { content: "操作失败（权限不足）", isError: true };
      },
    },

    {
      name: "qq_get_announcements",
      description: "获取群公告列表。",
      inputSchema: {
        type: "object",
        properties: {
          groupOpenId: { type: "string", description: "群的 group_openid" },
        },
        required: ["groupOpenId"],
      },
      async execute(params) {
        const { groupOpenId } = params as any;
        if (!groupOpenId) return { content: "错误: 缺少 groupOpenId", isError: true };
        try {
          const anns = await client.getGroupAnnouncements(groupOpenId);
          if (anns.length === 0) return { content: "该群暂无公告" };
          const lines = anns.map(a =>
            `---\n标题: ${a.title}\n内容: ${a.content.slice(0, 500)}${a.content.length > 500 ? "..." : ""}\n发布于: ${new Date(a.createdAt).toLocaleString()}`
          );
          return { content: `群公告 (${anns.length}):\n${lines.join("\n")}` };
        } catch (err: any) {
          return { content: `获取失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  事件通知
    // ================================================================

    {
      name: "qq_connect_gateway",
      description: "连接到 QQ Bot 事件网关，开始接收实时消息和通知（如新消息、@机器人、群事件等）。必须先连接才能使用事件轮询工具。",
      inputSchema: {
        type: "object",
        properties: {
          wsUrl: { type: "string", description: "WebSocket 网关地址（可选，默认自动获取）" },
        },
      },
      async execute(params) {
        const { wsUrl } = params as any;
        if (client.wsConnected) return { content: "事件网关已连接" };
        try {
          await client.connectGateway(wsUrl || undefined);
          return { content: "事件网关连接请求已发送，状态变为连接中..." };
        } catch (err: any) {
          return { content: `连接失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "qq_disconnect_gateway",
      description: "断开 QQ Bot 事件网关连接。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        client.disconnectGateway();
        return { content: "事件网关已断开" };
      },
    },

    {
      name: "qq_poll_events",
      description: `轮询获取最近的 QQ Bot 实时事件（消费即清空）。
事件类型包括: C2C_MESSAGE_CREATE(好友消息)、GROUP_AT_MESSAGE_CREATE(@机器人消息)、GROUP_MESSAGE_REJECTED(消息被拒)等。
需先调用 qq_connect_gateway 连接网关。`,
      inputSchema: {
        type: "object",
        properties: {
          includeRaw: { type: "boolean", description: "是否包含原始 JSON（默认 false）" },
        },
      },
      async execute(params) {
        const { includeRaw } = params as any;
        if (!client.wsConnected && client.sandbox) {
          return { content: `[沙箱] 模拟事件:\n暂无新事件` };
        }
        if (!client.wsConnected) {
          return { content: "事件网关未连接，请先调用 qq_connect_gateway", isError: true };
        }
        const events = client.pollEvents();
        if (events.length === 0) return { content: "暂无新事件" };
        const lines = events.map(e =>
          `[${new Date(e.timestamp).toLocaleString()}] ${e.type}${includeRaw ? `\n  数据: ${JSON.stringify(e.data).slice(0, 500)}` : ""}`
        );
        return { content: `新事件 (${events.length}):\n${lines.join("\n")}` };
      },
    },

    {
      name: "qq_poll_messages",
      description: `轮询获取最近的 QQ Bot 消息（消费即清空）。
返回好友私聊和群 @ 消息的内容、发送者和附件。
需先调用 qq_connect_gateway 连接网关。`,
      inputSchema: {
        type: "object",
        properties: {
          includeAttachments: { type: "boolean", description: "是否包含附件信息（默认 true）" },
        },
      },
      async execute(params) {
        const { includeAttachments = true } = params as any;
        if (!client.wsConnected && client.sandbox) {
          return { content: `[沙箱] 模拟消息:\n- [沙箱] 用户: 这是一条测试消息` };
        }
        if (!client.wsConnected) {
          return { content: "事件网关未连接，请先调用 qq_connect_gateway", isError: true };
        }
        const msgs = client.pollMessages();
        if (msgs.length === 0) return { content: "暂无新消息" };
        const lines = msgs.map(m => {
          const group = m.groupOpenId ? ` [群: ${m.groupOpenId}]` : " [私聊]";
          const attach = (includeAttachments && m.attachments?.length)
            ? `\n  附件: ${m.attachments.map(a => a.fileName || a.url).join(", ")}`
            : "";
          return `[${new Date(m.timestamp).toLocaleString()}]${group} ${m.fromName || m.fromId}: ${m.content.slice(0, 300)}${attach}`;
        });
        return { content: `新消息 (${msgs.length}):\n${lines.join("\n")}` };
      },
    },

    {
      name: "qq_event_status",
      description: "获取事件网关的连接状态和统计信息。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const status = client.wsConnected ? "已连接" : "未连接";
        const cached = client.lastEvents.length;
        const msgs = client.lastMessages.length;
        return {
          content: [
            `事件网关: ${status}${client.sandbox ? " [沙箱模式]" : ""}`,
            `缓存事件数: ${cached}`,
            `缓存消息数: ${msgs}`,
            "",
            "可用事件类型:",
            "- C2C_MESSAGE_CREATE: 好友私聊消息",
            "- GROUP_AT_MESSAGE_CREATE: 群 @ 消息",
            "- GROUP_MESSAGE_REJECTED: 消息被拒",
            "- C2C_MSG_REJECT: 私聊消息被拒",
            "",
            "使用流程:",
            "1. qq_connect_gateway → 2. qq_poll_messages/events → 3. qq_send_*_message 回复",
          ].join("\n"),
        };
      },
    },

    // ================================================================
    //  Bot 状态
    // ================================================================

    {
      name: "qq_bot_status",
      description: "获取 QQ Bot 的整体状态、连接信息和频控提醒。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const mode = client.sandbox ? "沙箱模式（未配置凭据）" : "在线模式";
        const ws = client.wsConnected ? "事件网关已连接" : "事件网关未连接";
        return {
          content: [
            `QQ Bot 状态: ${mode}`,
            `WebSocket: ${ws}`,
            "",
            "可用工具:",
            "- 消息: 文本/Markdown/图片/富媒体/撤回/历史",
            "- 群组: 列表/详情/成员/踢出/禁言/管理/公告",
            "- 事件: 网关连接/事件轮询/消息轮询",
            "- 文件: 群文件上传",
            "",
            "频控提醒:",
            "- 主动推送消息: 每月 4 条/用户/群",
            "- 被动回复: 5 分钟内最多 5 条",
            "- 文件类型限制: pdf, doc, txt",
            "- 图片最大 30MB, 视频最大 100MB",
          ].join("\n"),
        };
      },
    },
  ];
}
