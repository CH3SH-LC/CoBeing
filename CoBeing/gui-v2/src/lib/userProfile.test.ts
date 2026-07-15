import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PROFILE,
  createAvatarDraftForType,
  firstDisplayChar,
  normalizeUserProfile,
} from "./userProfile";

describe("userProfile helpers", () => {
  it("falls back to the default profile when input is invalid", () => {
    expect(normalizeUserProfile(null)).toEqual(DEFAULT_USER_PROFILE);
    expect(normalizeUserProfile({ nickname: "", avatar: { type: "emoji", value: "" } })).toEqual(DEFAULT_USER_PROFILE);
  });

  it("trims nickname and keeps explicit emoji avatar", () => {
    expect(normalizeUserProfile({
      nickname: "  刘诚  ",
      avatar: { type: "emoji", value: " LC " },
    })).toEqual({
      nickname: "刘诚",
      avatar: { type: "emoji", value: "LC" },
    });
  });

  it("uses the first visible character for initials", () => {
    expect(firstDisplayChar(" 刘诚 ")).toBe("刘");
    expect(firstDisplayChar("Codex")).toBe("C");
    expect(firstDisplayChar("")).toBe("我");
  });

  it("normalizes an empty initial avatar from the nickname", () => {
    expect(normalizeUserProfile({
      nickname: "CoBeing",
      avatar: { type: "initial", value: "" },
    })).toEqual({
      nickname: "CoBeing",
      avatar: { type: "initial", value: "C" },
    });
  });

  it("ignores avatar value when avatar type is invalid", () => {
    expect(normalizeUserProfile({
      nickname: "Alice",
      avatar: { type: "bad", value: "ZZ" },
    })).toEqual({
      nickname: "Alice",
      avatar: { type: "initial", value: "A" },
    });
  });

  it("normalizes an empty emoji avatar to the nickname initial", () => {
    expect(normalizeUserProfile({
      nickname: "Alice",
      avatar: { type: "emoji", value: "" },
    })).toEqual({
      nickname: "Alice",
      avatar: { type: "initial", value: "A" },
    });
  });

  it("normalizes an empty image avatar to the nickname initial", () => {
    expect(normalizeUserProfile({
      nickname: "Mira",
      avatar: { type: "image", value: "   " },
    })).toEqual({
      nickname: "Mira",
      avatar: { type: "initial", value: "M" },
    });
  });

  it("creates an editable image avatar draft when switching from another type", () => {
    const draft = createAvatarDraftForType("image", {
      nickname: "Mira",
      avatar: { type: "initial", value: "M" },
    });

    expect(draft.type).toBe("image");
    expect(draft.value).toMatch(/^data:image\/svg\+xml/);
    expect(normalizeUserProfile({ nickname: "Mira", avatar: draft }).avatar.type).toBe("image");
  });

  it("keeps initials and emoji avatar drafts compact", () => {
    expect(createAvatarDraftForType("initial", {
      nickname: " Mira ",
      avatar: { type: "image", value: "https://example.com/avatar.png" },
    })).toEqual({ type: "initial", value: "M" });

    expect(createAvatarDraftForType("emoji", {
      nickname: "Mira",
      avatar: { type: "image", value: "https://example.com/avatar.png" },
    })).toEqual({ type: "emoji", value: "🌸" });
  });
});
