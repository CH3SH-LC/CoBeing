import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupOrphanDirectories, readMasterRegistry, writeMasterRegistry } from "./master-registry.js";

describe("cleanupOrphanDirectories", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("keeps a registered group when the registry key differs from entry.id", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-registry-test-"));
    tmpDirs.push(dataRoot);
    const groupId = "高三语文课";
    const groupDir = path.join(dataRoot, "groups", groupId);
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, "config.json"), JSON.stringify({
      id: groupId,
      name: groupId,
      owner: "host",
      members: ["host", "高三语文教师"],
      status: "active",
    }));
    writeMasterRegistry(dataRoot, {
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {
        butler: { id: "butler", name: "Butler", role: "butler", status: "active", createdAt: new Date().toISOString() },
        host: { id: "host", name: "Host", role: "host", status: "active", createdAt: new Date().toISOString() },
      },
      groups: {
        [`${groupId}.deleted.123`]: {
          id: groupId,
          name: groupId,
          owner: "host",
          members: ["host", "高三语文教师"],
          status: "active",
          createdAt: new Date().toISOString(),
        },
      },
    });

    cleanupOrphanDirectories(dataRoot);

    expect(fs.existsSync(groupDir)).toBe(true);
    expect(fs.existsSync(path.join(groupDir, "config.json"))).toBe(true);
    const registry = readMasterRegistry(dataRoot);
    expect(registry.groups[groupId]).toBeDefined();
    expect(registry.groups[`${groupId}.deleted.123`]).toBeUndefined();
  });

  it("does not adopt an agent directory marked for deletion", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-registry-test-"));
    tmpDirs.push(dataRoot);
    const agentDir = path.join(dataRoot, "agents", "ghost-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "CHARACTER.md"), "ghost");
    fs.writeFileSync(path.join(agentDir, "JOB.md"), "ghost");
    fs.writeFileSync(path.join(agentDir, ".cobeing-delete.json"), JSON.stringify({
      kind: "agent",
      id: "ghost-agent",
      markedAt: new Date().toISOString(),
    }));
    writeMasterRegistry(dataRoot, {
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {
        butler: { id: "butler", name: "Butler", role: "butler", status: "active", createdAt: new Date().toISOString() },
        host: { id: "host", name: "Host", role: "host", status: "active", createdAt: new Date().toISOString() },
      },
      groups: {},
    });

    cleanupOrphanDirectories(dataRoot);

    const registry = readMasterRegistry(dataRoot);
    expect(registry.agents["ghost-agent"]).toBeUndefined();
    expect(fs.existsSync(path.join(agentDir, "config.json"))).toBe(false);
  });

  it("removes non-system registry entries whose data directories are gone", () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cobeing-registry-test-"));
    tmpDirs.push(dataRoot);
    writeMasterRegistry(dataRoot, {
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {
        butler: { id: "butler", name: "Butler", role: "butler", status: "active", createdAt: new Date().toISOString() },
        host: { id: "host", name: "Host", role: "host", status: "active", createdAt: new Date().toISOString() },
        "manual-deleted-agent": {
          id: "manual-deleted-agent",
          name: "Manual Deleted Agent",
          role: "worker",
          status: "active",
          createdAt: new Date().toISOString(),
        },
      },
      groups: {
        "manual-deleted-group": {
          id: "manual-deleted-group",
          name: "Manual Deleted Group",
          owner: "host",
          members: ["host"],
          status: "active",
          createdAt: new Date().toISOString(),
        },
      },
    });

    cleanupOrphanDirectories(dataRoot);

    const registry = readMasterRegistry(dataRoot);
    expect(registry.agents["manual-deleted-agent"]).toBeUndefined();
    expect(registry.groups["manual-deleted-group"]).toBeUndefined();
    expect(registry.agents.butler).toBeDefined();
    expect(registry.agents.host).toBeDefined();
  });
});
