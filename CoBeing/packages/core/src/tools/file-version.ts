/**
 * 并发写防护 — 文件版本 CAS（Compare-And-Swap）
 *
 * 多 Agent 同时操作同一工作区文件时，静默覆写会丢数据。
 * 方案：read-file 返回文件版本摘要（mtimeMs:size），write/edit-file 可选携带
 * baseVersion；写入前校验当前版本与基准是否一致，不一致则拒绝并提示重新读取。
 * （决策 #2 / spec #1：写前版本检查，最低成本实现，单进程内存，无需落盘。）
 */
import fs from "node:fs";

/** 计算文件版本摘要（mtimeMs:size）。文件不存在返回 undefined。 */
export function computeFileVersion(filePath: string): string | undefined {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return undefined;
  }
}

/**
 * 校验 baseVersion 与当前版本是否一致。
 * 返回 undefined = 一致或文件不存在（新建场景）；返回 string = 当前版本（发生冲突）。
 */
export function checkFileVersion(filePath: string, baseVersion: string): string | undefined {
  const current = computeFileVersion(filePath);
  if (current === undefined) return undefined; // 文件不存在（首次新建）不校验
  if (current !== baseVersion) return current;
  return undefined;
}

/** 版本提示行（read-file 返回末尾附上，供 LLM 写回时携带） */
export function formatVersionLine(filePath: string): string {
  const version = computeFileVersion(filePath);
  return version ? `\n[file-version: ${version}]` : "";
}
