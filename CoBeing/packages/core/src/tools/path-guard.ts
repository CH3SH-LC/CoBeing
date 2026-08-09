/**
 * Path Guard — 防止 Agent 把数据目录相对路径（data/...、coreagents/... 等）误当工作目录内相对路径使用。
 *
 * 背景：Agent 的工作目录是 data/<category>/<id>/workspace。提示词要求使用工作目录内的相对路径
 * （如 note.md、docs/note.md）。但 LLM 有时会写出 "data/coreagents/butler/workspace/日程.md" 这种
 * 形似"项目根相对路径"的参数，而工具以 workingDir 为基准 path.resolve() 拼接，造成
 * workspace/data/coreagents/butler/workspace/日程.md 的双重嵌套污染。
 *
 * 判定：resolve 后相对 workingDir 的 rel 首段若属于数据保留目录段（data/coreagents/agents/...），
 * 说明该路径引用了数据目录结构，属于误用。正常的工作目录内相对路径 rel 首段只会是文件名或子目录名。
 */
import path from "node:path";

export const DATA_DIR_SEGMENTS = new Set([
  "data",
  "coreagents",
  "agents",
  "groups",
  "toolagents",
  "tools",
  "skills",
  "plugins",
  "market",
  "data-sim-chenmo", // 模拟测试数据目录（陈默专项）
]);

/** 备份/测试残留目录段：如 data-sim-chenmo.bak-20260808、data.bak 等 */
const BACKUP_SUFFIX_RE = /\.bak(?:-[\w.-]+)?$/i;

/**
 * 检测路径参数是否误引用了数据目录结构。
 * @returns 命中返回错误提示（供工具作为 isError 返回），合法返回 null。
 */
export function detectDataPathMisuse(workingDir: string, rawPath: string): string | null {
  if (typeof rawPath !== "string" || rawPath.length === 0) return null;
  // 绝对路径不属于"误用 data 前缀"，交给 containment 检查处理
  if (path.isAbsolute(rawPath)) return null;
  const filePath = path.resolve(workingDir, rawPath);
  const rel = path.relative(workingDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // 交给 containment 检查
  const segs = rel.split(/[\\/]/).filter(Boolean);
  if (segs.length > 0 && (DATA_DIR_SEGMENTS.has(segs[0]) || BACKUP_SUFFIX_RE.test(segs[0]))) {
    return `路径误引用了数据目录（"${rawPath}"）：请只使用工作目录内的相对路径（如 note.md、docs/note.md），不要以 data/ 或 coreagents/ 等开头写完整路径。`;
  }
  return null;
}
