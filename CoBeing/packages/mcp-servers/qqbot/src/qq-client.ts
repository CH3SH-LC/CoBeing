/**
 * QQ Bot API Client — 封装 QQ Bot 官方 HTTP API v2
 *
 * 官方文档: https://bot.q.qq.com/wiki/develop/api/
 *
 * 能力:
 *   消息: 文本/Markdown/图片/视频/语音/富媒体/引用回复
 *   群组: 列表/详情/成员管理/禁言/踢出/公告
 *   文件: 上传/类型校验
 *   事件: WebSocket Gateway 连接 + 事件缓存
 *
 * 频控提醒:
 *   主动消息: 每月 4 条/用户/群
 *   被动回复: 5 分钟内最多 5 条
 *   文件类型限制: pdf, doc, txt
 *   图片: 30MB, 视频: 100MB, 语音: 20MB
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("qq-client");

// ======== 类型定义 ========

export interface QQConfig {
  appId: string;
  token: string;
  apiBase: string;
  wsBase?: string;    // WebSocket 网关地址
}

export interface SendMessageResult {
  id?: string;
  timestamp?: number;
}

export interface GroupInfo {
  group_openid: string;
  group_name: string;
  group_desc?: string;
  max_member_count?: number;
  member_count?: number;
}

export interface MemberInfo {
  member_openid: string;
  member_name?: string;
  roles?: string[];
  joined_at?: string;
}

export interface QQEvent {
  id: string;
  type: string;           // "C2C_MESSAGE_CREATE" | "GROUP_AT_MESSAGE_CREATE" | etc.
  timestamp: number;
  data: Record<string, unknown>;
  raw?: string;           // 原始 JSON
}

export interface CachedMessage {
  msgId: string;
  fromId: string;
  fromName?: string;
  groupOpenId?: string;
  content: string;
  attachments?: Array<{ url?: string; fileName?: string; fileType?: string }>;
  timestamp: number;
}

// ======== Client ========

export class QQClient {
  private config: QQConfig;
  private _sandbox: boolean;
  private eventCache: QQEvent[] = [];
  private messageCache: CachedMessage[] = [];
  private maxCacheSize = 200;
  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _wsConnected = false;
  // access_token 换取（QQ 官方 v2 要求先经 getAppAccessToken 换取，再用 QQBot <token> 鉴权）
  private accessToken = "";
  private tokenExpiresAt = 0;

  constructor(config: QQConfig) {
    this.config = config;
    this._sandbox = !config.appId;
  }

  get sandbox(): boolean { return this._sandbox; }
  get wsConnected(): boolean { return this._wsConnected; }
  get lastEvents(): QQEvent[] { return [...this.eventCache]; }
  get lastMessages(): CachedMessage[] { return [...this.messageCache]; }

  // ================================================================
  //  消息发送 (文本)
  // ================================================================

  /** 发送纯文本好友消息 (msg_type: 0) */
  async sendFriendMessage(
    openId: string,
    content: string,
    msgId?: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    return this.post(`/v2/users/${openId}/messages`, {
      content,
      msg_id: msgId,
      msg_type: 0,
    });
  }

  /** 发送纯文本群消息 (msg_type: 0) */
  async sendGroupMessage(
    groupOpenId: string,
    content: string,
    msgId?: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    return this.post(`/v2/groups/${groupOpenId}/messages`, {
      content,
      msg_id: msgId,
      msg_type: 0,
    });
  }

  // ================================================================
  //  富媒体消息
  // ================================================================

  /** 发送 Markdown 消息 (msg_type: 2) */
  async sendMarkdownMessage(
    target: { type: "friend" | "group"; openId: string },
    markdown: string,
    msgId?: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    const path = target.type === "friend"
      ? `/v2/users/${target.openId}/messages`
      : `/v2/groups/${target.openId}/messages`;
    return this.post(path, {
      msg_type: 2,
      content: markdown,
      msg_id: msgId,
    });
  }

  /** 发送图片消息 */
  async sendImageMessage(
    target: { type: "friend" | "group"; openId: string },
    imageUrl: string,
    msgId?: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    const path = target.type === "friend"
      ? `/v2/users/${target.openId}/messages`
      : `/v2/groups/${target.openId}/messages`;
    return this.post(path, {
      msg_type: 3,        // 图片
      content: imageUrl,   // 图片 URL
      msg_id: msgId,
    });
  }

  /** 发送富媒体消息（支持 text + image + file_id 组合） */
  async sendRichMediaMessage(
    target: { type: "friend" | "group"; openId: string },
    params: {
      text?: string;
      imageUrl?: string;
      fileId?: string;
      fileType?: number;  // 1=img, 2=video, 3=voice
    },
    msgId?: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    const path = target.type === "friend"
      ? `/v2/users/${target.openId}/messages`
      : `/v2/groups/${target.openId}/messages`;
    return this.post(path, {
      msg_type: 7,        // 富媒体组合
      content: JSON.stringify({
        ...(params.text ? { text: params.text } : {}),
        ...(params.imageUrl ? { image: params.imageUrl } : {}),
        ...(params.fileId ? { file_id: params.fileId, file_type: params.fileType ?? 1 } : {}),
      }),
      msg_id: msgId,
    });
  }

  // ================================================================
  //  消息操作
  // ================================================================

  /** 撤回群消息 */
  async withdrawGroupMessage(groupOpenId: string, msgId: string): Promise<boolean> {
    if (this._sandbox) return true;
    try {
      await this.delete(`/v2/groups/${groupOpenId}/messages/${msgId}`);
      return true;
    } catch (err: any) {
      log.error("Withdraw failed: %s", err.message);
      return false;
    }
  }

  /** 获取群消息历史 */
  async getGroupMessageHistory(
    groupOpenId: string,
    limit = 20,
    lastMsgId?: string,
  ): Promise<CachedMessage[]> {
    if (this._sandbox) {
      return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
        msgId: `mock_msg_${i}`,
        fromId: `mock_user_${i}`,
        fromName: `[沙箱] 用户${i + 1}`,
        groupOpenId,
        content: `这是第 ${i + 1} 条模拟消息`,
        timestamp: Date.now() - i * 60000,
      }));
    }
    // 从缓存返回
    return this.messageCache
      .filter(m => m.groupOpenId === groupOpenId)
      .slice(-limit);
  }

  // ================================================================
  //  群组管理
  // ================================================================

  /** 获取群列表 */
  async getGroups(): Promise<GroupInfo[]> {
    if (this._sandbox) {
      return [
        { group_openid: "mock_group_001", group_name: "[沙箱] 产品讨论组", member_count: 15, max_member_count: 200 },
        { group_openid: "mock_group_002", group_name: "[沙箱] 技术研发组", member_count: 42, max_member_count: 500 },
        { group_openid: "mock_group_003", group_name: "[沙箱] 项目协作组", member_count: 8, max_member_count: 200 },
      ];
    }
    const result = await this.get("/v2/groups") as { groups: GroupInfo[] };
    return result.groups || [];
  }

  /** 获取群详情 */
  async getGroupInfo(groupOpenId: string): Promise<GroupInfo> {
    if (this._sandbox) {
      return {
        group_openid: groupOpenId,
        group_name: "[沙箱] 测试群组",
        group_desc: "沙箱模式下的测试群组",
        member_count: 10,
        max_member_count: 200,
      };
    }
    return this.get(`/v2/groups/${groupOpenId}`) as Promise<GroupInfo>;
  }

  /** 获取群成员列表 */
  async getGroupMembers(
    groupOpenId: string,
    limit = 50,
    after?: string,
  ): Promise<MemberInfo[]> {
    if (this._sandbox) {
      return [
        { member_openid: "mock_owner", member_name: "[沙箱] 群主", roles: ["owner"], joined_at: new Date().toISOString() },
        { member_openid: "mock_admin", member_name: "[沙箱] 管理员", roles: ["admin"], joined_at: new Date().toISOString() },
        { member_openid: "mock_member1", member_name: "[沙箱] 成员甲", joined_at: new Date().toISOString() },
        { member_openid: "mock_member2", member_name: "[沙箱] 成员乙", joined_at: new Date().toISOString() },
      ];
    }
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set("after", after);
    const result = await this.get(`/v2/groups/${groupOpenId}/members?${params}`) as { members: MemberInfo[] };
    return result.members || [];
  }

  /** 获取单个成员信息 */
  async getGroupMemberInfo(groupOpenId: string, memberOpenId: string): Promise<MemberInfo> {
    if (this._sandbox) {
      return {
        member_openid: memberOpenId,
        member_name: "[沙箱] 成员",
        roles: [],
        joined_at: new Date().toISOString(),
      };
    }
    return this.get(`/v2/groups/${groupOpenId}/members/${memberOpenId}`) as Promise<MemberInfo>;
  }

  /** 踢出群成员（需机器人是群管理员） */
  async kickGroupMember(groupOpenId: string, memberOpenId: string): Promise<boolean> {
    if (this._sandbox) return true;
    try {
      await this.delete(`/v2/groups/${groupOpenId}/members/${memberOpenId}`);
      log.info("Kicked %s from %s", memberOpenId, groupOpenId);
      return true;
    } catch (err: any) {
      log.error("Kick failed: %s", err.message);
      return false;
    }
  }

  /** 禁言成员（毫秒, 0=解除禁言, -1=永久禁言） */
  async muteGroupMember(
    groupOpenId: string,
    memberOpenId: string,
    durationMs: number,
  ): Promise<boolean> {
    if (this._sandbox) return true;
    try {
      await this.patch(`/v2/groups/${groupOpenId}/members/${memberOpenId}/mute`, {
        mute_duration: durationMs === -1 ? "permanent" : String(Math.floor(durationMs / 1000)),
      });
      log.info("Muted %s in %s for %dms", memberOpenId, groupOpenId, durationMs);
      return true;
    } catch (err: any) {
      log.error("Mute failed: %s", err.message);
      return false;
    }
  }

  /** 设置/取消管理员（需机器人是群主） */
  async setGroupAdmin(groupOpenId: string, memberOpenId: string, isAdmin: boolean): Promise<boolean> {
    if (this._sandbox) return true;
    try {
      await this.post(`/v2/groups/${groupOpenId}/members/${memberOpenId}/roles`, {
        roles: isAdmin ? ["admin"] : [],
      });
      log.info("Set admin=%s for %s in %s", isAdmin, memberOpenId, groupOpenId);
      return true;
    } catch (err: any) {
      log.error("Set admin failed: %s", err.message);
      return false;
    }
  }

  /** 获取群公告 */
  async getGroupAnnouncements(groupOpenId: string): Promise<Array<{ id: string; title: string; content: string; createdAt: string }>> {
    if (this._sandbox) {
      return [
        { id: "ann_001", title: "[沙箱] 群公告示例", content: "这是沙箱模式的测试群公告", createdAt: new Date().toISOString() },
      ];
    }
    const result = await this.get(`/v2/groups/${groupOpenId}/announcements`) as {
      announcements: Array<{ id: string; title: string; content: string; createdAt: string }>;
    };
    return result.announcements || [];
  }

  // ================================================================
  //  文件操作
  // ================================================================

  /** 上传群文件 */
  async uploadGroupFile(
    groupOpenId: string,
    fileUrl: string,
    fileName: string,
  ): Promise<SendMessageResult> {
    if (this._sandbox) return this.mockResult();
    return this.post(`/v2/groups/${groupOpenId}/files`, {
      file_type: 1,
      url: fileUrl,
      srv_send_msg: false,
    });
  }

  // ================================================================
  //  WebSocket 事件网关
  // ================================================================

  /** 连接事件网关（接收实时消息和通知） */
  async connectGateway(wsBase?: string): Promise<void> {
    if (this._sandbox || this._wsConnected) return;

    await this.ensureAccessToken();

    const base = wsBase || this.config.wsBase;
    let wsUrl = base;
    if (!wsUrl) {
      // 获取 WebSocket 地址
      const gateway = await this.get("/gateway/bot") as { url: string };
      wsUrl = gateway.url;
    }

    log.info("Connecting to QQ event gateway...");
    this.ws = new WebSocket(wsUrl + "/?app_id=" + this.config.appId);

    this.ws.onopen = () => {
      this._wsConnected = true;
      log.info("QQ event gateway connected");
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        this.handleWSPayload(payload);
      } catch (err: any) {
        log.error("WS message parse error: %s", err.message);
      }
    };

    this.ws.onclose = () => {
      this._wsConnected = false;
      log.warn("QQ event gateway disconnected, reconnecting in 5s...");
      this.scheduleReconnect(wsUrl);
    };

    this.ws.onerror = (err) => {
      log.error("QQ event gateway error: %s", err);
    };
  }

  /** 断开事件网关 */
  disconnectGateway(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._wsConnected = false;
  }

  /** 清空事件缓存 */
  clearEventCache(): void {
    this.eventCache = [];
    this.messageCache = [];
  }

  /** 获取未读事件（轮询用 — 消费即清空） */
  pollEvents(): QQEvent[] {
    const events = [...this.eventCache];
    this.eventCache = [];
    return events;
  }

  /** 获取未读消息（轮询用 — 消费即清空） */
  pollMessages(): CachedMessage[] {
    const msgs = [...this.messageCache];
    this.messageCache = [];
    return msgs;
  }

  // ======== 内部方法 ========

  private handleWSPayload(payload: any): void {
    const { op, t: type, d: data, id: eventId } = payload || {};

    // QQ Gateway 的 OP code:
    // 0: Dispatch (事件分发)
    // 7: Reconnect
    // 9: Invalid Session
    // 10: Hello
    // 11: Heartbeat ACK

    if (op === 10) {
      // Hello — 开始心跳
      const heartbeatInterval = data?.heartbeat_interval || 30000;
      this.startHeartbeat(heartbeatInterval);
      // 发送 Identify（官方 v2：token 为 "QQBot <access_token>"）
      this.ws?.send(JSON.stringify({
        op: 2,
        d: {
          token: `QQBot ${this.accessToken}`,
          intents: 1 << 30, // 全部事件
          shard: [0, 1],
        },
      }));
      return;
    }

    if (op === 0 && type && data) {
      // Dispatch 事件
      const event: QQEvent = {
        id: eventId || `${type}_${Date.now()}`,
        type,
        timestamp: Date.now(),
        data,
        raw: JSON.stringify(payload).slice(0, 5000),
      };
      this.eventCache.push(event);
      if (this.eventCache.length > this.maxCacheSize) {
        this.eventCache.splice(0, this.eventCache.length - this.maxCacheSize);
      }

      // 提取消息到 messageCache
      this.extractMessage(event);
    }

    if (op === 7) {
      // Reconnect
      log.warn("Gateway requested reconnect");
    }

    if (op === 9) {
      // Invalid Session — 需要重新 identify
      log.warn("Invalid session, re-identifying...");
      this.ws?.send(JSON.stringify({
        op: 2,
        d: { token: `QQBot ${this.accessToken}`, intents: 1 << 30, shard: [0, 1] },
      }));
    }
  }

  private extractMessage(event: QQEvent): void {
    let msg: CachedMessage | null = null;

    if (event.type === "C2C_MESSAGE_CREATE") {
      const d = event.data as any;
      msg = {
        msgId: d.id || "",
        fromId: d.author?.user_openid || d.user_openid || "",
        fromName: d.author?.name || "",
        content: d.content || "",
        attachments: d.attachments?.map((a: any) => ({
          url: a.url,
          fileName: a.filename,
          fileType: a.content_type,
        })),
        timestamp: d.timestamp ? new Date(d.timestamp).getTime() : Date.now(),
      };
    }

    if (event.type === "GROUP_AT_MESSAGE_CREATE") {
      const d = event.data as any;
      msg = {
        msgId: d.id || "",
        fromId: d.author?.member_openid || d.group_openid || "",
        fromName: d.author?.name || "",
        groupOpenId: d.group_openid,
        content: d.content || "",
        attachments: d.attachments?.map((a: any) => ({
          url: a.url,
          fileName: a.filename,
          fileType: a.content_type,
        })),
        timestamp: d.timestamp ? new Date(d.timestamp).getTime() : Date.now(),
      };
    }

    if (msg) {
      this.messageCache.push(msg);
      if (this.messageCache.length > this.maxCacheSize) {
        this.messageCache.splice(0, this.messageCache.length - this.maxCacheSize);
      }
    }
  }

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1, d: null }));
      }
    }, intervalMs);
  }

  private scheduleReconnect(wsUrl: string): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wsReconnectTimer = setTimeout(() => {
      log.info("Reconnecting to QQ event gateway...");
      this.connectGateway(wsUrl).catch(err =>
        log.error("Reconnect failed: %s", err.message),
      );
    }, 5000);
  }

  // ======== HTTP 方法 ========

  private async get(path: string): Promise<unknown> {
    const url = `${this.config.apiBase}${path}`;
    log.info("GET %s", url);
    await this.ensureAccessToken();
    const res = await fetch(url, { method: "GET", headers: this.headers() });
    return this.handleResponse(res);
  }

  private async post(path: string, body: unknown): Promise<any> {
    const url = `${this.config.apiBase}${path}`;
    log.info("POST %s", url);
    await this.ensureAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.handleResponse(res);
  }

  private async patch(path: string, body: unknown): Promise<any> {
    const url = `${this.config.apiBase}${path}`;
    log.info("PATCH %s", url);
    await this.ensureAccessToken();
    const res = await fetch(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.handleResponse(res);
  }

  private async delete(path: string): Promise<unknown> {
    const url = `${this.config.apiBase}${path}`;
    log.info("DELETE %s", url);
    await this.ensureAccessToken();
    const res = await fetch(url, { method: "DELETE", headers: this.headers() });
    if (res.status === 204) return {};
    return this.handleResponse(res);
  }

  /** 换取 QQ Bot access_token（官方 v2 鉴权：getAppAccessToken → Authorization: QQBot <token>） */
  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return;
    if (this._sandbox) return;

    const res = await fetch("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.token,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to get app access token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    // 提前 60 秒刷新
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    log.info("QQ Bot access token refreshed, expires in %ds", data.expires_in);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `QQBot ${this.accessToken}`,
      "Content-Type": "application/json",
      "X-Union-Appid": this.config.appId,
    };
  }

  private async handleResponse(res: Response): Promise<any> {
    const text = await res.text();
    if (!text) return {};
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const err = data as { code?: number; message?: string };
      throw new Error(`QQ API error (${err.code || res.status}): ${err.message || text.slice(0, 200)}`);
    }
    return data;
  }

  private mockResult(): SendMessageResult {
    return { id: `mock_${Date.now()}`, timestamp: Date.now() };
  }
}
