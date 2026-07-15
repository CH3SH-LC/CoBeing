/**
 * 跨平台文件系统工具
 * Windows 上 fs.rmSync 对含非 ASCII 路径可能静默失败，用手动递归替代
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("fs-utils");

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 200;
export const DELETE_MARKER_FILENAME = ".cobeing-delete.json";

export interface DeleteMarker {
  kind: "agent" | "group";
  id: string;
  markedAt: string;
  reason?: string;
}

export function hasDeleteMarker(dir: string): boolean {
  return fs.existsSync(path.join(dir, DELETE_MARKER_FILENAME));
}

export function writeDeleteMarker(dir: string, marker: Omit<DeleteMarker, "markedAt"> & { markedAt?: string }): void {
  fs.mkdirSync(dir, { recursive: true });
  const fullMarker: DeleteMarker = {
    ...marker,
    markedAt: marker.markedAt ?? new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, DELETE_MARKER_FILENAME), JSON.stringify(fullMarker, null, 2) + "\n", "utf-8");
}

export function markDirectoryForDeletion(dir: string, marker: Omit<DeleteMarker, "markedAt"> & { markedAt?: string }): string | null {
  if (!fs.existsSync(dir)) return null;
  writeDeleteMarker(dir, marker);
  const deletedDir = `${dir}.deleted.${Date.now()}`;
  try {
    fs.renameSync(dir, deletedDir);
    return deletedDir;
  } catch {
    return null;
  }
}

/** 带重试的单文件删除（处理 Windows 文件锁定） */
function unlinkWithRetry(filePath: string): void {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (err: any) {
      if (attempt === MAX_RETRIES) throw err;
      if (err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOTEMPTY") {
        log.debug("File locked, retrying %d/%d: %s", attempt, MAX_RETRIES, filePath);
        const start = Date.now();
        while (Date.now() - start < RETRY_DELAY_MS) { /* busy-wait */ }
        continue;
      }
      throw err;
    }
  }
}

/** 带重试的目录删除 */
function rmdirWithRetry(dir: string): void {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.rmdirSync(dir);
      return;
    } catch (err: any) {
      if (attempt === MAX_RETRIES) throw err;
      if (err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOTEMPTY" || err.code === "ENOENT") {
        if (err.code === "ENOENT") return;
        log.debug("Dir locked, retrying %d/%d: %s", attempt, MAX_RETRIES, dir);
        const start = Date.now();
        while (Date.now() - start < RETRY_DELAY_MS) { /* wait */ }
        continue;
      }
      throw err;
    }
  }
}

/**
 * 删除单个文件：先尝试原生重试，失败后 rename → unlink（rename 在 Windows 上通常
 * 不受文件锁阻塞，因为锁针对的是文件内容而非目录条目）
 */
function deleteFileWithFallback(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // rename-then-delete: rename often works when unlink fails on Windows
    const renamedPath = filePath + ".to-delete." + Date.now();
    try {
      fs.renameSync(filePath, renamedPath);
      try {
        fs.rmSync(renamedPath, { force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        unlinkWithRetry(renamedPath);
      }
    } catch {
      unlinkWithRetry(filePath);
    }
  }
}

/**
 * 清理 SQLite 数据库的辅助文件（-wal, -shm, -journal）
 * 在 close() 后调用，作为 journal_mode=DELETE 的兜底
 */
export function cleanupSQLiteAuxFiles(dbPath: string): void {
  // Windows: rename (not delete) to avoid touching Better-SQLite3 memory mappings
  for (const ext of ["-wal", "-shm", "-journal"]) {
    const auxPath = dbPath + ext;
    if (fs.existsSync(auxPath)) {
      try {
        fs.renameSync(auxPath, auxPath + ".orphan." + Date.now());
      } catch {
        try { deleteFileWithFallback(auxPath); } catch { /* stuck */ }
      }
    }
  }
}

/** 递归删除目录（Node.js 22+ 原生重试 + rename 兜底） */
export function rmDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rmDirRecursive(full);
    } else {
      deleteFileWithFallback(full);
    }
  }
  // 删除空目录
  try {
    fs.rmdirSync(dir);
  } catch {
    rmdirWithRetry(dir);
  }
}

/**
 * 强制删除目录或文件 — 多轮重试 + rename 兜底 + 事后验证
 * 用于 Agent/群组销毁路径，确保数据目录真正被清理
 */
export function rmDirForce(dir: string): void {
  if (!fs.existsSync(dir)) {
    log.info("rmDirForce: path does not exist, nothing to delete: %s", dir);
    return;
  }

  let lastErr: Error | null = null;
  for (let round = 0; round < 3; round++) {
    try {
      // 第一轮：正常递归删除
      rmDirRecursive(dir);
    } catch (e: any) {
      lastErr = e;
      log.warn("rmDirForce round %d failed: %s — retrying", round + 1, e.message);
    }

    if (!fs.existsSync(dir)) {
      log.info("rmDirForce: deleted %s", dir);
      return;
    }

    // 目录仍存在 — 逐项 rename 兜底
    if (round < 2) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          const renamed = full + ".orphan." + Date.now();
          try { fs.renameSync(full, renamed); } catch { /* try next */ }
        }
      } catch { /* can't read dir */ }
      // 短暂等待，让 OS 释放锁
      const waitStart = Date.now();
      while (Date.now() - waitStart < 500) { /* busy-wait */ }
    }
  }

  const stillExists = fs.existsSync(dir);
  const errMsg = lastErr ? lastErr.message : "unknown";
  if (stillExists) {
    log.error("rmDirForce FAILED to delete %s after 3 rounds (last error: %s)", dir, errMsg);
    throw new Error(`Cannot delete directory after 3 rounds: ${dir} (${errMsg})`);
  }
}

/**
 * 预启动清理：在任何 SQLite 连接建立之前，强制删除所有标记为待删除的残留目录和文件。
 *
 * 扫描 data/agents/ 和 data/groups/ 下的：
 * - *.deleted.* 目录（删除时的 rename 兜底）
 * - *.orphan.* 目录/文件（SQLite auxiliary file rename 兜底）
 *
 * 必须在进程启动最早阶段调用（runtime 构造函数第一行），此时无任何 SQLite 连接，
 * Windows 文件锁不会阻止删除。
 */
export function cleanupPendingDeletions(dataRoot: string): void {
  const subdirs = ["agents", "groups", "coreagents"];

  for (const sub of subdirs) {
    const dir = path.join(dataRoot, sub);
    if (!fs.existsSync(dir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const isMarked =
        entry.name.includes(".deleted.") ||
        entry.name.includes(".orphan.") ||
        entry.name.includes(".pending-delete.");

      const full = path.join(dir, entry.name);
      const shouldDelete = isMarked || (entry.isDirectory() && hasDeleteMarker(full));

      if (!shouldDelete) continue;

      if (entry.isDirectory()) {
        log.info("Pre-startup cleanup: removing marked directory %s", full);
        try {
          rmDirForce(full);
        } catch (e: any) {
          log.error("Pre-startup cleanup failed for %s: %s — will retry next start", full, e.message);
        }
      } else if (entry.isFile()) {
        try {
          deleteFileWithFallback(full);
        } catch {
          try {
            fs.renameSync(full, full + ".orphan." + Date.now());
          } catch { /* stuck */ }
        }
      }
    }
  }
}
