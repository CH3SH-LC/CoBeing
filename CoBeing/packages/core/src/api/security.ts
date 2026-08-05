/**
 * API 层安全与脱敏工具 — 从 ws-server.ts 提取
 */
import path from "node:path";

/** 对 API Key 做脱敏：保留前4后4，中间用 **** 替代 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

/** 为 providers 补充 _apiKeyResolved 字段（环境变量解析后的 masked 值） */
export function resolveProviderApiKeys(providers: Record<string, Record<string, unknown>>) {
  for (const prov of Object.values(providers)) {
    if (typeof prov.apiKey === "string" && prov.apiKey) {
      // 已有直接存储的 apiKey（已解密），直接 mask
      prov._apiKeyResolved = maskApiKey(prov.apiKey);
    } else if (typeof prov.apiKeyEnv === "string" && prov.apiKeyEnv) {
      // 尝试从环境变量读取
      const envValue = process.env[prov.apiKeyEnv];
      if (envValue) {
        prov._apiKeyResolved = maskApiKey(envValue);
      }
    }
  }
}

export const SENSITIVE_KEY_RE = /(^api[-_]?key$|token|secret|password|authorization|cookie|^headers?$|^env$)/i;

export function cloneForClient(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneForClient);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      if (typeof child === "string") out[key] = maskApiKey(child);
      else if (Array.isArray(child)) out[key] = child.map(cloneForClient);
      else if (child && typeof child === "object") {
        out[key] = Object.fromEntries(
          Object.entries(child as Record<string, unknown>).map(([childKey, childValue]) => [
            childKey,
            typeof childValue === "string" ? maskApiKey(childValue) : cloneForClient(childValue),
          ]),
        );
      }
      else out[key] = child;
    } else {
      out[key] = cloneForClient(child);
    }
  }
  return out;
}

export function isSafeId(id: string): boolean {
  if (!id || id.length > 128) return false;
  if (id === "." || id === "..") return false;
  if (path.isAbsolute(id)) return false;
  return !/[\\/\x00-\x1F<>:"|?*]|\s$|\.$/u.test(id);
}

export function isSafeLeafFilename(filename: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(filename) && !filename.includes("..") && !path.isAbsolute(filename);
}

export function resolveWithin(baseDir: string, filename: string): string {
  if (!isSafeLeafFilename(filename)) throw new Error("Invalid filename");
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, filename);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal denied");
  }
  return resolvedTarget;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "tauri://localhost" || origin === "http://tauri.localhost" || origin === "https://tauri.localhost") return true;
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    const port = u.port;
    if ((host === "localhost" || host === "127.0.0.1") && (port === "1420" || port === "5173" || port === "4173")) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 按 "a.b.c" 路径设置嵌套对象值（防止原型污染） */
export function setNestedValue(obj: Record<string, unknown>, cfgPath: string, value: unknown): void {
  const keys = cfgPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    // 防止原型污染
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1];
  if (lastKey === "__proto__" || lastKey === "constructor" || lastKey === "prototype") return;
  if (value === null) {
    delete current[lastKey];
    return;
  }
  current[lastKey] = value;
}

export function isSafeConfigPath(cfgPath: string): boolean {
  if (!cfgPath || cfgPath.length > 200) return false;
  const keys = cfgPath.split(".");
  if (keys.length === 0 || keys.length > 8) return false;
  return keys.every(key =>
    /^[A-Za-z0-9_-]+$/.test(key) &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype"
  );
}
