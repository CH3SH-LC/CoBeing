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
  for (const ext of ["-wal", "-shm", "-journal"]) {
    const auxPath = dbPath + ext;
    if (fs.existsSync(auxPath)) {
      try {
        deleteFileWithFallback(auxPath);
      } catch {
        // rename as last resort to prevent blocking directory deletion
        try {
          fs.renameSync(auxPath, auxPath + ".orphan." + Date.now());
        } catch { /* truly stuck */ }
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
