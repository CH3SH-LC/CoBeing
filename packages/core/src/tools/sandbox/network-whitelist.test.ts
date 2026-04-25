import { describe, it, expect } from "vitest";
import { resolveNetworkConfig, PRESET_DOMAIN_GROUPS } from "./network-whitelist.js";
import type { NetworkConfig } from "@cobeing/shared";

describe("network-whitelist", () => {
  describe("resolveNetworkConfig", () => {
    it("converts legacy boolean true to NetworkConfig", () => {
      const result = resolveNetworkConfig(true as any);
      expect(result).toEqual({ enabled: true, mode: "all" });
    });

    it("converts legacy boolean false to NetworkConfig", () => {
      const result = resolveNetworkConfig(false as any);
      expect(result).toEqual({ enabled: false, mode: "none" });
    });

    it("passes through NetworkConfig unchanged", () => {
      const config: NetworkConfig = {
        enabled: true,
        mode: "whitelist",
        allowDomains: ["github.com"],
      };
      const result = resolveNetworkConfig(config);
      expect(result).toEqual(config);
    });

    it("merges preset domain groups", () => {
      const config: NetworkConfig = {
        enabled: true,
        mode: "whitelist",
        domainGroups: [PRESET_DOMAIN_GROUPS[0]],
      };
      const result = resolveNetworkConfig(config);
      expect(result.allowDomains).toContain("github.com");
    });
  });

  describe("PRESET_DOMAIN_GROUPS", () => {
    it("has dev-tools group", () => {
      const group = PRESET_DOMAIN_GROUPS.find(g => g.id === "dev-tools");
      expect(group).toBeDefined();
      expect(group!.domains).toContain("github.com");
    });

    it("has package-managers group", () => {
      const group = PRESET_DOMAIN_GROUPS.find(g => g.id === "package-managers");
      expect(group).toBeDefined();
      expect(group!.domains).toContain("registry.npmjs.org");
    });
  });
});
