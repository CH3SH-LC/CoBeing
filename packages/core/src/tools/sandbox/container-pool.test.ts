import { describe, it, expect, vi } from "vitest";
import { ContainerPool } from "./container-pool.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

describe("ContainerPool", () => {
  const defaultConfig = {
    memory: "512m",
    cpus: 1,
    network: true,
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
      network: false,
      bindings: ["/host/path:/container/path"],
    }, "/data/agents/agent-1");

    const args = (pool as any).buildCreateArgs("/data/agents/agent-1");
    expect(args).toContain("--memory=1g");
    expect(args).toContain("--cpus=2");
    expect(args).toContain("--network=none");
    expect(args).toContain("-v");
    expect(args).toContain("/host/path:/container/path");
  });

  it("builds args without --network=none when network is true", () => {
    const pool = new ContainerPool("agent-1", "cobeing-sandbox:latest", {
      ...defaultConfig,
      network: true,
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
