import { describe, it, expect } from "vitest";
import { resolveSecurityConfig, buildSecurityArgs } from "./security.js";
import type { SecurityConfig } from "@cobeing/shared";

describe("security", () => {
  describe("resolveSecurityConfig", () => {
    it("returns default config when undefined", () => {
      const result = resolveSecurityConfig(undefined);
      expect(result).toEqual({
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      });
    });

    it("passes through SecurityConfig unchanged", () => {
      const config: SecurityConfig = {
        enabled: false,
        noNewPrivileges: false,
        readOnlyRootfs: false,
        dropAllCapabilities: false,
      };
      const result = resolveSecurityConfig(config);
      expect(result).toEqual(config);
    });
  });

  describe("buildSecurityArgs", () => {
    it("returns empty array when security disabled", () => {
      const config: SecurityConfig = {
        enabled: false,
        noNewPrivileges: false,
        readOnlyRootfs: false,
        dropAllCapabilities: false,
      };
      const result = buildSecurityArgs(config);
      expect(result).toEqual([]);
    });

    it("returns all security flags when enabled", () => {
      const config: SecurityConfig = {
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      };
      const result = buildSecurityArgs(config);
      expect(result).toContain("--security-opt=no-new-privileges:true");
      expect(result).toContain("--read-only");
      expect(result).toContain("--cap-drop=ALL");
      expect(result).toContain("--tmpfs");
    });

    it("includes tmpfs for /tmp and /var/tmp", () => {
      const config: SecurityConfig = {
        enabled: true,
        noNewPrivileges: true,
        readOnlyRootfs: true,
        dropAllCapabilities: true,
      };
      const result = buildSecurityArgs(config);
      const tmpfsArgs = result.filter(a => a === "--tmpfs");
      expect(tmpfsArgs.length).toBe(2);
    });
  });
});
