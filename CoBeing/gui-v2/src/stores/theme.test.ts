import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadBuiltInTheme, mergeThemePresets, validateTheme, type ThemePreset } from "./theme";

const themesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/themes");

function readTheme(id: string): ThemePreset {
  return JSON.parse(readFileSync(resolve(themesDir, `${id}.json`), "utf8")) as ThemePreset;
}

function readManifest(): string[] {
  return JSON.parse(readFileSync(resolve(themesDir, "manifest.json"), "utf8")) as string[];
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("built-in themes", () => {
  it("keeps Sakura Mint as the first/default theme and includes Executive Workbench", () => {
    const manifest = readManifest();

    expect(manifest[0]).toBe("sakura-mint");
    expect(manifest).toContain("executive-workbench");
  });

  it("defines theme-controlled chat bubble colors for every built-in theme", () => {
    for (const id of readManifest()) {
      const theme = readTheme(id);

      expect(theme.chat["msg-user"], `${id} user bubble`).toMatch(/^#/);
      expect(theme.chat["msg-assistant"], `${id} assistant bubble`).toMatch(/^#/);
      expect(theme.chat["msg-system"], `${id} system bubble`).toBeTruthy();
      expect(theme.chat["msg-tool"], `${id} tool bubble`).toBeTruthy();
      expect(theme.chat["msg-user"], `${id} user/assistant should differ`).not.toBe(theme.chat["msg-assistant"]);
    }
  });

  it("requires chat bubble tokens when validating imported themes", () => {
    const theme = readTheme("sakura-mint");
    const missingChat = {
      ...theme,
      chat: { ...theme.chat, "msg-user": "" },
    };

    expect(validateTheme(missingChat).missing).toContain("chat.msg-user");
  });

  it("keeps Sakura Mint candy-like while separating background, panels, and bubbles", () => {
    const theme = readTheme("sakura-mint");

    expect(theme.base["gradient-from"]).not.toBe("#FFFFFF");
    expect(theme.base["gradient-to"]).not.toBe("#FFFFFF");
    expect(relativeLuminance(theme.base["gradient-from"])).toBeGreaterThan(0.72);
    expect(relativeLuminance(theme.base["gradient-to"])).toBeGreaterThan(0.82);
    expect(theme.surface.bg).toMatch(/rgba\(255,255,255,0\.8[4-8]\)/);
    expect(colorDistance(theme.chat["msg-user"], theme.surface.elevated)).toBeGreaterThan(28);
    expect(colorDistance(theme.chat["msg-assistant"], theme.surface.elevated)).toBeGreaterThan(36);
    expect(theme.surface.shadow).toContain("0 20px 48px");
  });

  it("loads built-in theme files without browser cache so shipped palette updates apply", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(readTheme("sakura-mint")), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await loadBuiltInTheme("sakura-mint");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toHaveLength(1);
    expect(String(calls[0].url)).toBe("/themes/sakura-mint.json");
    expect(calls[0].init?.cache).toBe("no-store");
  });

  it("keeps built-in theme ids from being overwritten by stale persisted custom themes", () => {
    const currentSakura = readTheme("sakura-mint");
    const staleSakura = {
      ...currentSakura,
      base: {
        ...currentSakura.base,
        "gradient-from": "#999999",
      },
    };
    const customTheme = readTheme("executive-workbench");

    const merged = mergeThemePresets(
      { "sakura-mint": currentSakura },
      {
        "sakura-mint": staleSakura,
        "custom-workbench": customTheme,
      },
    );

    expect(merged["sakura-mint"].base["gradient-from"]).toBe(currentSakura.base["gradient-from"]);
    expect(merged["custom-workbench"]).toBe(customTheme);
  });
});
