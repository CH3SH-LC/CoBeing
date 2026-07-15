/**
 * SecretStore — API Key 加密存储
 *
 * 使用 AES-256-GCM 加密，密钥基于机器特征派生。
 * 加密后以 "enc:" 前缀存储，向后兼容明文。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createLogger } from "@cobeing/shared";

const log = createLogger("secret-store");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PREFIX = "enc:";

/** 持久化密钥文件路径（用户主目录下，跨项目共享） */
function getKeyFilePath(): string {
  const dir = path.join(os.homedir(), ".cobeing");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "secret-key");
}

/** 基于机器特征 + 持久化随机盐派生 32 字节密钥（新旧双版本） */
function deriveKeys(): { oldKey: Buffer; newKey: Buffer } {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  // 尝试读取持久化密钥文件，不存在则生成
  const keyPath = getKeyFilePath();
  let storedSalt: string;
  try {
    storedSalt = fs.readFileSync(keyPath, "utf-8").trim();
  } catch {
    storedSalt = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(keyPath, storedSalt, "utf-8");
    try { fs.chmodSync(keyPath, 0o600); } catch { /* Windows does not support chmod */ }
    log.info("New secret key generated at %s", keyPath);
  }
  const seed = `cobeing:${hostname}:${username}:${storedSalt}`;

  // Old key: SHA-256 (for backward compatibility with existing encrypted data)
  const oldKey = crypto.createHash("sha256").update(seed).digest();

  // New key: PBKDF2 with 100,000 iterations of SHA-512
  const pbkdf2Salt = crypto.createHash("sha256").update(storedSalt + ":pbkdf2").digest();
  const newKey = crypto.pbkdf2Sync(seed, pbkdf2Salt, 100000, 32, "sha512");

  return { oldKey, newKey };
}

const KEYS = deriveKeys();

/** 加密明文，返回 "enc:" 前缀的 base64 字符串 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEYS.newKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式: iv + authTag + encrypted, base64 编码
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return PREFIX + combined.toString("base64");
}

/** 解密 "enc:" 前缀的字符串。非前缀则原样返回（向后兼容）。
 *  尝试旧密钥（SHA-256）优先，再尝试新密钥（PBKDF2），均失败返回空字符串。 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  const tryDecrypt = (key: Buffer): string | null => {
    try {
      const combined = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  };

  // Try old key first (backward compat for SHA-256 encrypted data), then new key (PBKDF2)
  const result = tryDecrypt(KEYS.oldKey) ?? tryDecrypt(KEYS.newKey);
  if (result === null) {
    log.error("Failed to decrypt API key with both old and new keys");
    return ""; // Return empty string to prevent leaking encrypted data as API keys
  }
  return result;
}

/** 判断是否为加密值 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
