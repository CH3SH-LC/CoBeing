import { describe, it, expect } from "vitest";
import { PermissionEnforcer } from "./permission.js";
import type { ToolsConfig } from "@cobeing/shared";

describe("PermissionEnforcer", () => {
  const toolConfig: ToolsConfig = {
    defaultPermission: "workspace-write",
    enabled: ["bash", "read-file", "write-file"],
    permissions: {
      "bash": { "workspace-write": "allow", "read-only": "deny" },
      "write-file": { "read-only": "deny" },
    },
  };

  it("full-access allows everything", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "full-access" }, toolConfig, "/workspace",
    );
    expect(enforcer.check("bash", { command: "rm -rf /" })).toEqual({ allowed: true });
    expect(enforcer.check("write-file", { path: "/etc/passwd" })).toEqual({ allowed: true });
  });

  it("read-only denies write tools via tool config", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "read-only" }, toolConfig, "/workspace",
    );
    expect(enforcer.check("bash", { command: "ls" }).allowed).toBe(false);
    expect(enforcer.check("write-file", { path: "/workspace/a.txt" }).allowed).toBe(false);
    expect(enforcer.check("read-file", { path: "/workspace/a.txt" }).allowed).toBe(true);
  });

  it("ask mode uses allow/deny lists", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "ask", allow: ["read-file", "glob"], deny: ["bash"] },
      toolConfig, "/workspace",
    );
    expect(enforcer.check("bash", {}).allowed).toBe(false);
    expect(enforcer.check("read-file", {}).allowed).toBe(true);
    expect(enforcer.check("write-file", {}).allowed).toBe(false); // not in allow list
  });

  it("workspace-write blocks paths outside working dir", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "workspace-write" }, toolConfig, "/workspace",
    );
    expect(enforcer.check("write-file", { path: "/etc/passwd" }).allowed).toBe(false);
    expect(enforcer.check("write-file", { path: "/workspace/file.txt" }).allowed).toBe(true);
  });

  it("workspace-write allows read tools regardless of path", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "workspace-write" }, toolConfig, "/workspace",
    );
    expect(enforcer.check("read-file", { path: "/etc/hosts" }).allowed).toBe(true);
  });

  it("no tool config still works", () => {
    const enforcer = new PermissionEnforcer(
      { mode: "read-only" }, undefined, "/workspace",
    );
    // no tool-level deny mapping, so read-only without explicit deny allows
    expect(enforcer.check("read-file", {}).allowed).toBe(true);
  });
});
