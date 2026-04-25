/**
 * 跨平台文件系统工具
 * Windows 上 fs.rmSync 对含非 ASCII 路径可能静默失败，用手动递归替代
 */
import fs from "node:fs";
import path from "node:path";

/** 递归删除目录（兼容 Windows 非 ASCII 路径） */
export function rmDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rmDirRecursive(full);
    } else {
      fs.unlinkSync(full);
    }
  }
  fs.rmdirSync(dir);
}
