/**
 * SecretStore — API Key 加密存储
 *
 * 使用 AES-256-GCM 加密，密钥基于机器特征派生。
 * 加密后以 "enc:" 前缀存储，向后兼容明文。
 */
import crypto from "node:crypto";
import os from "node:os";
import { createLogger } from "@cobeing/shared";

const log = createLogger("secret-store");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "enc:";

/** 基于机器特征派生 32 字节密钥 */
function deriveKey(): Buffer {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const seed = `cobeing:${hostname}:${username}`;
  return crypto.createHash("sha256").update(seed).digest();
}

const KEY = deriveKey();

/** 加密明文，返回 "enc:" 前缀的 base64 字符串 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: iv + authTag + encrypted, base64 编码
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return PREFIX + combined.toString("base64");
}

/** 解密 "enc:" 前缀的字符串。非前缀则原样返回（向后兼容） */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  try {
    const combined = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    log.error("Failed to decrypt API key: %s", err);
    return ciphertext;
  }
}

/** 判断是否为加密值 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
