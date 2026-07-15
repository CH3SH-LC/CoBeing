import { describe, it, expect, vi } from "vitest";
import { ContainerPool } from "./container-pool.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("./network-whitelist.js", () => ({
  buildNetworkArgs: vi.fn((network, _agentId) => {
    if (!network.enabled || network.mode === "none") {
      return ["--network=none"];
    }
    return [];
  }),
}));

vi.mock("./security.js", () => ({
  buildSecurityArgs: vi.fn((security) => {
    if (!security.enabled) return [];
    const args: string[] = [];
    if (security.noNewPrivileges) args.push("--security-opt=no-new-privileges:true");
    if (security.readOnlyRootfs) {
      args.push("--read-only");
      args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=100m");
      args.push("--tmpfs", "/var/tmp:rw,noexec,nosuid,size=100m");
    }
    if (security.dropAllCapabilities) args.push("--cap-drop=ALL");
    return args;
  }),
}));

describe("ContainerPool", () => {
  const defaultConfig = {
    memory: "512m",
    cpus: 1,
    network: { enabled: true, mode: "all" as const },
    bindings: [],
    timeout: 30,
  };

  it("constructs with correct defaults", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", defaultConfig, "/data/agents/agent-1");
    expect(pool.getStatus().containerId).toBeNull();
    expect(pool.getStatus().running).toBe(false);
  });

  it("builds correct docker create args", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", {
      ...defaultConfig,
      memory: "1g",
      cpus: 2,
      network: { enabled: false, mode: "none" as const },
      bindings: ["/host/path:/container/path"],
    }, "/data/agents/agent-1");

    const args = (pool as any).buildCreateArgs("/data/agents/agent-1");
    expect(args).toContain("--memory=1g");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--network=none");
    expect(args).toContain("-v");
    expect(args).toContain("/host/path:/container/path");
  });

  it("builds args without --network=none when network is enabled", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", {
      ...defaultConfig,
      network: { enabled: true, mode: "all" as const },
    }, "/data/agents/agent-1");
    const args = (pool as any).buildCreateArgs("/data/agents/agent-1");
    expect(args).not.toContain("--network=none");
  });

  it("uses default memory and cpus", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", defaultConfig, "/data/agents/agent-1");
    const args = (pool as any).buildCreateArgs("/data/agents/agent-1");
    expect(args).toContain("--memory=512m");
    expect(args).toContain("--cpus=1");
  });
});
