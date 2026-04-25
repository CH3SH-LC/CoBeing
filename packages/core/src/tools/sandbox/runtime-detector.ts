import path from "node:path";

const RUNTIME_MAP: Record<string, string> = {
  ".py": "python3",
  ".js": "node",
  ".ts": "npx tsx",
  ".go": "go run",
  ".sh": "bash",
  ".rb": "ruby",
};

/** 根据文件扩展名检测运行时，未知返回 null */
export function detectRuntime(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return RUNTIME_MAP[ext] ?? null;
}

/** 构建运行命令，未知扩展名返回 null */
export function buildRunCommand(filePath: string): string | null {
  const runtime = detectRuntime(filePath);
  if (!runtime) return null;
  return `${runtime} ${filePath}`;
}
