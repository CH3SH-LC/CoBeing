/**
 * 企业微信 API 客户端
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("wecom-client");

export interface WeComConfig {
  corpId: string;
  agentId: string;
  secret: string;
}

export class WeComClient {
  private config: WeComConfig;
  private accessToken: string = "";
  private tokenExpiry = 0;

  constructor(config: WeComConfig) {
    this.config = config;
  }

  /** 获取 access_token（自动缓存） */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`;
    const res = await fetch(url);
    const data = await res.json() as { access_token?: string; errcode?: number; errmsg?: string };

    if (data.errcode && data.errcode !== 0) {
      throw new Error(`WeCom token error: ${data.errcode} ${data.errmsg}`);
    }

    this.accessToken = data.access_token ?? "";
    this.tokenExpiry = Date.now() + 7000 * 1000; // 约 2 小时
    return this.accessToken;
  }

  /** 发送文本消息 */
  async sendText(userOrParty: string, content: string, isParty = false): Promise<void> {
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {
      msgtype: "text",
      agentid: this.config.agentId,
      text: { content },
    };

    if (isParty) {
      body.toparty = userOrParty;
    } else {
      body.touser = userOrParty;
    }

    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await res.json() as { errcode?: number; errmsg?: string };

    if (data.errcode && data.errcode !== 0) {
      log.error("WeCom send failed: %d %s", data.errcode, data.errmsg);
    }
  }

  /** 发送 Markdown 消息 */
  async sendMarkdown(userOrParty: string, content: string, isParty = false): Promise<void> {
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {
      msgtype: "markdown",
      agentid: this.config.agentId,
      markdown: { content },
    };

    if (isParty) {
      body.toparty = userOrParty;
    } else {
      body.touser = userOrParty;
    }

    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await res.json() as { errcode?: number; errmsg?: string };

    if (data.errcode && data.errcode !== 0) {
      log.error("WeCom markdown send failed: %d %s", data.errcode, data.errmsg);
    }
  }
}
