import { describe, it, expect } from "vitest";
import { mentionsUser, extractMentions } from "./helpers";

describe("mentionsUser — 群组内 @用户 唤醒识别", () => {
  it("识别中文别名 @用户", () => {
    expect(mentionsUser(extractMentions("@用户 请确认预算区间"))).toBe(true);
  });

  it("识别 @主人 / @老板 / @user（大小写不敏感）", () => {
    expect(mentionsUser(["主人"])).toBe(true);
    expect(mentionsUser(["老板"])).toBe(true);
    expect(mentionsUser(["User"])).toBe(true);
  });

  it("agent 互相 @ 不算用户唤醒（低打扰）", () => {
    expect(mentionsUser(["前端工程师", "设计师"])).toBe(false);
    expect(mentionsUser(["all"])).toBe(false);
  });

  it("普通群组回复（无 @）不算用户唤醒", () => {
    expect(mentionsUser([])).toBe(false);
  });
});
