#!/usr/bin/env node
/**
 * path-guard 专项真实验证：不经 LLM，直接调用编译后工具验证
 * 1. 误用路径（data/... 前缀）在 5 个工具上全部被拦截
 * 2. 正常工作目录内相对路径不被误伤（回归）
 * 3. 绝对路径/逃逸路径走 containment 检查（既有防线仍在）
 */
import fs from "node:fs";
import path from "node:path";
import { readFileTool } from "../packages/core/dist/tools/read-file.js";
import { writeFileTool } from "../packages/core/dist/tools/write-file.js";
import { editFileTool } from "../packages/core/dist/tools/edit-file.js";
import { globTool } from "../packages/core/dist/tools/glob.js";
import { grepTool } from "../packages/core/dist/tools/grep.js";

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// 临时工作目录
const workDir = path.resolve("data-sim-chenmo/pg-verify-workspace");
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });
fs.writeFileSync(path.join(workDir, "note.md"), "hello from path-guard verify");

const ctx = { workingDir: workDir, agentId: "verify-agent", memory: {} as any, groupId: undefined as any };

const MISUSE_PATHS = [
  "data/coreagents/butler/workspace/日程.md",
  "data/agents/张三/note.md",
  "data/groups/某群/workspace/x.md",
  "data\\coreagents\\butler\\workspace\\日程.md", // Windows 反斜杠
  "coreagents/butler/JOB.md",
  "agents/xxx/note.md",
  "skills/foo.md",
];

async function main() {
  console.log("=== 1. 误用路径拦截（5 工具 × 7 路径） ===");
  let blocked = 0, total = 0;
  const isBlocked = (r: any) => r?.isError === true && String(r?.content || "").includes("误引用");
  // write-file
  for (const p of MISUSE_PATHS) {
    total++;
    const r: any = await writeFileTool.execute({ path: p, content: "x" }, ctx as any);
    if (isBlocked(r)) blocked++;
    else check(`write-file 拦截 ${p}`, false, `isError=${r?.isError} msg=${String(r?.content).slice(0, 60)}`);
  }
  // read-file
  for (const p of MISUSE_PATHS) {
    total++;
    const r: any = await readFileTool.execute({ path: p }, ctx as any);
    if (isBlocked(r)) blocked++;
    else check(`read-file 拦截 ${p}`, false, JSON.stringify(r).slice(0, 80));
  }
  // edit-file
  for (const p of MISUSE_PATHS) {
    total++;
    const r: any = await editFileTool.execute({ path: p, editType: "replace", search: "x", replace: "y" }, ctx as any);
    if (isBlocked(r)) blocked++;
    else check(`edit-file 拦截 ${p}`, false, JSON.stringify(r).slice(0, 80));
  }
  // glob（误用路径在 path 参数——搜索目录；pattern 是文件名模式）
  for (const p of MISUSE_PATHS) {
    total++;
    try {
      const r: any = await globTool.execute({ pattern: "**/*", path: p }, ctx as any);
      if (r?.isError === true && String(r?.content || r?.message || "").includes("误引用")) blocked++;
      else check(`glob path 拦截 ${p}`, false, JSON.stringify(r).slice(0, 80));
    } catch (e: any) {
      if (String(e?.message || e).includes("误引用")) blocked++;
      else check(`glob path 拦截 ${p}`, false, `throw=${String(e?.message || e).slice(0, 60)}`);
    }
  }
  // grep（误用路径在 path 参数）
  for (const p of MISUSE_PATHS) {
    total++;
    try {
      const r: any = await grepTool.execute({ pattern: "x", path: p }, ctx as any);
      if (r?.isError === true && String(r?.content || r?.message || "").includes("误引用")) blocked++;
      else check(`grep path 拦截 ${p}`, false, JSON.stringify(r).slice(0, 80));
    } catch (e: any) {
      if (String(e?.message || e).includes("误引用")) blocked++;
      else check(`grep path 拦截 ${p}`, false, `throw=${String(e?.message || e).slice(0, 60)}`);
    }
  }
  check(`误用路径全部拦截（${blocked}/${total}）`, blocked === total, `未拦截 ${total - blocked} 个`);

  console.log("\n=== 2. 正常相对路径回归（5 工具） ===");
  // write
  const w: any = await writeFileTool.execute({ path: "sub/深目录/文件.md", content: "内容" }, ctx as any);
  check("write-file 正常相对路径", w?.isError !== true && fs.existsSync(path.join(workDir, "sub/深目录/文件.md")), String(w?.content || "").slice(0, 60));
  // read
  const r: any = await readFileTool.execute({ path: "note.md" }, ctx as any);
  check("read-file 正常相对路径", r?.isError !== true && String(r?.content || "").includes("hello"), String(r?.content || "").slice(0, 40));
  // edit（old_string/new_string 语义）
  const e: any = await editFileTool.execute({ path: "note.md", old_string: "hello", new_string: "hello appended" }, ctx as any);
  check("edit-file 正常相对路径", e?.isError !== true && fs.readFileSync(path.join(workDir, "note.md"), "utf8").includes("appended"), String(e?.content || "").slice(0, 60));
  // glob（`**` 模式既有重复行为不在此验证范围——只断言正常路径不被拦截）
  const g: any = await globTool.execute({ pattern: "**/*.md" }, ctx as any);
  const gStr = String(g?.content || "");
  const gOk = g?.isError !== true && gStr.includes("note.md") && !gStr.includes("误引用");
  check("glob 正常相对路径不被拦截", gOk, gStr.slice(0, 60));
  // grep
  const gr: any = await grepTool.execute({ pattern: "hello", path: "." }, ctx as any);
  check("grep 正常相对路径", gr?.isError !== true && JSON.stringify(gr?.content || "").includes("hello"), String(gr?.content || "").slice(0, 60));

  console.log("\n=== 3. 绝对路径/逃逸仍走 containment（既有防线） ===");
  const abs: any = await writeFileTool.execute({ path: "D:/tmp-escape-test/x.md", content: "x" }, ctx as any);
  check("绝对路径被 containment 拒绝", abs?.isError === true, String(abs?.content || "").slice(0, 80));
  const esc: any = await writeFileTool.execute({ path: "../escape.md", content: "x" }, ctx as any);
  check("../ 逃逸被 containment 拒绝", esc?.isError === true, String(esc?.content || "").slice(0, 80));

  console.log("\n=== 结果汇总 ===");
  const allOk = results.every(r2 => r2.ok);
  for (const r2 of results) console.log(`  ${r2.ok ? "✅" : "❌"} ${r2.name}${r2.detail ? ` — ${r2.detail}` : ""}`);
  console.log(allOk ? "\n🎉 path-guard 专项验证全部通过" : `\n⚠️ ${results.filter(r2 => !r2.ok).length} 项失败`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
