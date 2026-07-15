import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { GroupButlerBindingStore } from "./butler-binding-store.js";

describe("GroupButlerBindingStore", () => {
  let tmpDir: string;
  let store: GroupButlerBindingStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "butler-binding-test-"));
    store = new GroupButlerBindingStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("creates a binding with defaults", () => {
      const binding = store.create("group-1");
      expect(binding.groupId).toBe("group-1");
      expect(binding.butlerId).toBe("butler");
      expect(binding.alias).toBe("管家");
      expect(binding.enabled).toBe(true);
      expect(binding.allowedEvents).toHaveLength(6);
      expect(binding.escalationPolicy.blocked).toBe("notify");
    });

    it("returns existing binding if already exists", () => {
      const first = store.create("group-1", { alias: "custom" });
      const second = store.create("group-1", { alias: "ignored" });
      expect(second.alias).toBe("custom");
      expect(store.count).toBe(1);
    });

    it("accepts custom overrides", () => {
      const binding = store.create("group-1", {
        alias: "自定义管家",
        enabled: false,
      });
      expect(binding.alias).toBe("自定义管家");
      expect(binding.enabled).toBe(false);
    });
  });

  describe("get", () => {
    it("returns binding by groupId", () => {
      store.create("group-1");
      expect(store.get("group-1")?.groupId).toBe("group-1");
    });

    it("returns undefined for missing", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates enabled flag", () => {
      store.create("group-1");
      const updated = store.update("group-1", { enabled: false });
      expect(updated?.enabled).toBe(false);
    });

    it("returns undefined for missing group", () => {
      expect(store.update("nonexistent", { enabled: false })).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes and returns true", () => {
      store.create("group-1");
      expect(store.delete("group-1")).toBe(true);
      expect(store.get("group-1")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all bindings", () => {
      store.create("g1");
      store.create("g2");
      expect(store.list()).toHaveLength(2);
    });
  });

  describe("listEnabled", () => {
    it("returns only enabled bindings", () => {
      store.create("g1");
      store.create("g2", { enabled: false });
      const enabled = store.listEnabled();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].groupId).toBe("g1");
    });
  });

  describe("count", () => {
    it("returns binding count", () => {
      expect(store.count).toBe(0);
      store.create("g1");
      expect(store.count).toBe(1);
    });
  });

  describe("persistence round-trip", () => {
    it("survives store re-creation", () => {
      const s1 = new GroupButlerBindingStore(tmpDir);
      s1.create("group-1", { alias: "test" });

      const s2 = new GroupButlerBindingStore(tmpDir);
      const loaded = s2.get("group-1");
      expect(loaded?.alias).toBe("test");
    });
  });
});
