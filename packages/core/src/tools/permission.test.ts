import { describe, it, expect } from "vitest";
import { PermissionEnforcer } from "./permission.js";
import type { ToolsConfig, WorkspaceBinding } from "@cobeing/shared";

const TOOL_CONFIG: ToolsConfig = {
  defaultPermission: "workspace-readwrite",
  enabled: ["bash", "read-file", "write-file", "edit-file", "glob"],
  permissions: {
    "bash": { "read-only": "deny", "workspace-readwrite": "allow" },
    "write-file": { "read-only": "deny" },
  },
};

const WS = "/data/agents/test/workspace";

describe("PermissionEnforcer — 5-level", () => {
  // ─── L4: FullAccess ───
  it("full-access allows everything", () => {
    const e = new PermissionEnforcer({ mode: "full-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf /" })).toEqual({ allowed: true });
    expect(e.check("write-file", { path: "/etc/passwd" })).toEqual({ allowed: true });
  });

  // ─── L0: ReadOnly ───
  it("read-only denies all write tools", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(false);
    expect(e.check("edit-file", { path: `${WS}/out.txt` }).allowed).toBe(false);
  });

  it("read-only allows read tools", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("read-file", { path: "/etc/hosts" }).allowed).toBe(true);
    expect(e.check("glob", { pattern: "*.ts" }).allowed).toBe(true);
  });

  it("read-only allows only read-only bash commands", () => {
    const e = new PermissionEnforcer({ mode: "read-only" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "ls -la" }).allowed).toBe(true);
    expect(e.check("bash", { command: "cat file.txt" }).allowed).toBe(true);
    expect(e.check("bash", { command: "rm file.txt" }).allowed).toBe(false);
  });

  // ─── L1: WorkspaceReadWrite ───
  it("workspace-readwrite allows writes within workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(true);
    expect(e.check("write-file", { path: "relative.txt" }).allowed).toBe(true);
  });

  it("workspace-readwrite blocks writes outside workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("write-file", { path: "/etc/passwd" }).allowed).toBe(false);
    expect(e.check("write-file", { path: "../other/file.txt" }).allowed).toBe(false);
  });

  it("workspace-readwrite allows general bash (non-dangerous, non-high-risk)", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "ls" }).allowed).toBe(true);
    expect(e.check("bash", { command: "npm install" }).allowed).toBe(true);
    expect(e.check("bash", { command: "mkdir newdir" }).allowed).toBe(true);
  });

  it("workspace-readwrite denies high-risk bash", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf node_modules" }).allowed).toBe(false);
    expect(e.check("bash", { command: "sudo systemctl restart" }).allowed).toBe(false);
  });

  it("workspace-readwrite denies path escape bash", () => {
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "cat /etc/hosts" }).allowed).toBe(false);
  });

  // ─── L2: WorkspaceAccess ───
  it("workspace-access allows bash writes within workspace", () => {
    const e = new PermissionEnforcer({ mode: "workspace-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "npm install" }).allowed).toBe(true);
    expect(e.check("bash", { command: "mkdir newdir" }).allowed).toBe(true);
    expect(e.check("bash", { command: "git commit -m 'msg'" }).allowed).toBe(true);
  });

  it("workspace-access still blocks system path escape in bash", () => {
    const e = new PermissionEnforcer({ mode: "workspace-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "cat /etc/passwd" }).allowed).toBe(false);
  });

  // ─── L3: BasicAccess ───
  it("basic-access allows high-risk commands", () => {
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf ./build" }).allowed).toBe(true);
    expect(e.check("bash", { command: "git push --force" }).allowed).toBe(true);
  });

  it("basic-access still blocks extreme danger", () => {
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS);
    expect(e.check("bash", { command: "rm -rf /" }).allowed).toBe(false);
    expect(e.check("bash", { command: "sudo su" }).allowed).toBe(false);
  });

  // ─── Multi-binding ───
  it("basic-access allows writes to user-bound directories", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/project", mode: "readwrite", label: "project" },
    ];
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/project/file.ts" }).allowed).toBe(true);
  });

  it("basic-access denies writes to readonly-bound directories", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/docs", mode: "readonly", label: "docs" },
    ];
    const e = new PermissionEnforcer({ mode: "basic-access" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/docs/file.md" }).allowed).toBe(false);
    expect(e.check("read-file", { path: "/external/docs/file.md" }).allowed).toBe(true);
  });

  it("workspace-readwrite ignores user bindings for writes", () => {
    const bindings: WorkspaceBinding[] = [
      { path: "/external/project", mode: "readwrite", label: "project" },
    ];
    const e = new PermissionEnforcer({ mode: "workspace-readwrite" }, TOOL_CONFIG, WS, undefined, bindings);
    expect(e.check("write-file", { path: "/external/project/file.ts" }).allowed).toBe(false);
  });

  // ─── Allow/Deny lists ───
  it("explicit deny overrides all", () => {
    const e = new PermissionEnforcer(
      { mode: "full-access", deny: ["bash"] }, TOOL_CONFIG, WS,
    );
    expect(e.check("bash", { command: "ls" }).allowed).toBe(false);
  });

  it("explicit allow in policy overrides mode", () => {
    const e = new PermissionEnforcer(
      { mode: "read-only", allow: ["write-file"] }, TOOL_CONFIG, WS,
    );
    expect(e.check("write-file", { path: `${WS}/out.txt` }).allowed).toBe(true);
  });

  it("default binding (group workspace) allows writes at workspace-readwrite", () => {
    const e = new PermissionEnforcer(
      { mode: "workspace-readwrite" }, TOOL_CONFIG, WS, "/data/groups/g1/workspace",
    );
    expect(e.check("write-file", { path: "/data/groups/g1/workspace/task.md" }).allowed).toBe(true);
  });
});
