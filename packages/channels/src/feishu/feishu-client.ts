/**
 * 飞书 API 客户端
 */
import crypto from "node:crypto";
import { createLogger } from "@cobeing/shared";

const log = createLogger("feishu-client");

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
}

export class FeishuClient {
  private config: FeishuConfig;
  private tenantToken: string = "";
  private tokenExpiry = 0;

  constructor(config: FeishuConfig) {
    this.config = config;
  }

  /** 获取 tenant_access_token */
  async getTenantToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tokenExpiry) {
      return this.tenantToken;
    }

    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    const data = await res.json() as { tenant_access_token?: string; expire?: number; code?: number; msg?: string };

    if (!data.tenant_access_token) {
      throw new Error(`Feishu token error: ${data.code} ${data.msg}`);
    }

    this.tenantToken = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire ?? 7000) * 1000;
    return this.tenantToken;
  }

  /** 发送文本消息 */
  async sendMessage(receiveId: string, receiveType: "open_id" | "chat_id", content: string): Promise<void> {
    const token = await this.getTenantToken();
    const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=" + receiveType, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: content }),
      }),
    });

    const data = await res.json() as { code?: number; msg?: string };
    if (data.code && data.code !== 0) {
      log.error("Feishu send failed: %d %s", data.code, data.msg);
    }
  }

  /** 解密飞书事件（AES-CBC） */
  decryptEvent(encrypted: string): string {
    if (!this.config.encryptKey) return encrypted;

    const key = Buffer.from(this.config.encryptKey + "=", "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.slice(0, 16));
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
