#!/usr/bin/env node
/**
 * 清空 PVZ 真实测试残留数据（保留系统核心 butler/host）。
 * 用法: npx tsx scripts/clear-pvz-test-data.ts
 * 清空项：用户 Agent / 群组 / 观测 / 管家任务状态 / registry 用户条目 /
 *         管家与群主记忆 / 测试日志
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataRoot = path.join(root, "data");
const logDir = path.join(root, "docs", "log");

function rm(p: string) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

// 1. 用户 Agent（保留 butler/host 系统目录）
const agentsDir = path.join(dataRoot, "agents");
if (fs.existsSync(agentsDir)) {
  for (const id of fs.readdirSync(agentsDir)) {
    if (!["butler", "host"].includes(id)) rm(path.join(agentsDir, id));
  }
}
console.log("1. 用户 Agent ✓");

// 2. 用户群组
const groupsDir = path.join(dataRoot, "groups");
if (fs.existsSync(groupsDir)) {
  for (const id of fs.readdirSync(groupsDir)) {
    rm(path.join(groupsDir, id));
  }
}
console.log("2. 群组 ✓");

// 3. 观测数据
rm(path.join(dataRoot, "observability", "observability.db"));
rm(path.join(dataRoot, "observability", "observability.db-shm"));
rm(path.join(dataRoot, "observability", "observability.db-wal"));
console.log("3. 观测 ✓");

// 4. 测试日志
for (const f of ["pvz-retest.log", "start-core.log"]) {
  rm(path.join(logDir, f));
}
if (fs.existsSync(logDir)) {
  for (const f of fs.readdirSync(logDir)) {
    if (/^real-test-pvz-/.test(f)) rm(path.join(logDir, f));
  }
}
console.log("4. 测试日志 ✓");

// 5. registry 用户条目 + 管家任务状态 + 注册表 md + host inbox
const registryPath = path.join(dataRoot, "registry.json");
if (fs.existsSync(registryPath)) {
  const reg = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  for (const id of Object.keys(reg.agents || {})) {
    if (!["butler", "host"].includes(id)) delete reg.agents[id];
  }
  reg.groups = {};
  reg.updatedAt = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(reg, null, 2) + "\n");
}
const butlerDir = path.join(dataRoot, "coreagents", "butler");
for (const f of ["butler-tasks.json", "global-todos.json", "butler-bindings.json"]) {
  fs.writeFileSync(path.join(butlerDir, f), "[]\n");
}
fs.writeFileSync(path.join(butlerDir, "AGENTS_REGISTRY.md"), "# Agent 注册表\n\n");
fs.writeFileSync(path.join(butlerDir, "GROUPS_REGISTRY.md"), "# 群组注册表\n\n");
fs.writeFileSync(path.join(dataRoot, "coreagents", "host", "inbox.json"), '{\n  "active": [],\n  "archived": []\n}\n');
console.log("5. registry + 任务状态 ✓");

// 6. 管家与群主记忆（memory.db + 按日 md）
for (const agent of ["butler", "host"]) {
  const dir = path.join(dataRoot, "coreagents", agent);
  rm(path.join(dir, "memory.db"));
  rm(path.join(dir, "memory.db-shm"));
  rm(path.join(dir, "memory.db-wal"));
  const memoryDir = path.join(dir, "memory");
  if (fs.existsSync(memoryDir)) {
    for (const f of fs.readdirSync(memoryDir)) rm(path.join(memoryDir, f));
  }
}
rm(path.join(dataRoot, "agents", "host", "TODO.json"));
rm(path.join(dataRoot, "agents", "butler", "TODO.json"));
console.log("6. 管家/群主记忆 ✓");

console.log("\n清理完成，系统核心（butler/host/toolagents/skills/plugins/market）保留。");
