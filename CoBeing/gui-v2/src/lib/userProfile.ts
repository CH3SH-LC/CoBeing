export type UserAvatarType = "initial" | "emoji" | "image";

export interface UserAvatar {
  type: UserAvatarType;
  value: string;
}

export interface UserProfile {
  nickname: string;
  avatar: UserAvatar;
}

const FALLBACK_EMOJI_AVATAR = "🌸";

export const DEFAULT_USER_PROFILE: UserProfile = {
  nickname: "我",
  avatar: { type: "initial", value: "我" },
};

export function firstDisplayChar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_USER_PROFILE.avatar.value;
  return Array.from(trimmed)[0] ?? DEFAULT_USER_PROFILE.avatar.value;
}

function isAvatarType(value: unknown): value is UserAvatarType {
  return value === "initial" || value === "emoji" || value === "image";
}

function looksCompactAvatarText(value: string): boolean {
  const trimmed = value.trim();
  return Array.from(trimmed).length <= 3 && !/^https?:\/\//i.test(trimmed) && !/^data:image\//i.test(trimmed);
}

function createInitialAvatarDataUrl(profile: UserProfile): string {
  const initial = encodeURIComponent(firstDisplayChar(profile.nickname));
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='20' fill='%23FFE8EF'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial,sans-serif' font-size='34' font-weight='700' fill='%23EC4899'%3E${initial}%3C/text%3E%3C/svg%3E`;
}

export function createAvatarDraftForType(type: UserAvatarType, profile: UserProfile): UserAvatar {
  if (type === "initial") {
    return { type, value: firstDisplayChar(profile.nickname) };
  }

  if (type === "emoji") {
    return {
      type,
      value: profile.avatar.type === "emoji" && looksCompactAvatarText(profile.avatar.value)
        ? profile.avatar.value.trim()
        : FALLBACK_EMOJI_AVATAR,
    };
  }

  return {
    type,
    value: profile.avatar.type === "image" && profile.avatar.value.trim()
      ? profile.avatar.value.trim()
      : createInitialAvatarDataUrl(profile),
  };
}

export function normalizeUserProfile(input: unknown): UserProfile {
  if (!input || typeof input !== "object") return DEFAULT_USER_PROFILE;
  const raw = input as Partial<UserProfile>;
  const nickname = typeof raw.nickname === "string" ? raw.nickname.trim() : "";
  if (!nickname) return DEFAULT_USER_PROFILE;

  const rawAvatar = raw.avatar && typeof raw.avatar === "object" ? raw.avatar as Partial<UserAvatar> : undefined;
  const avatarType = rawAvatar?.type;
  const rawValue = isAvatarType(avatarType) && typeof rawAvatar?.value === "string" ? rawAvatar.value.trim() : "";
  const type = rawValue && isAvatarType(avatarType) ? avatarType : "initial";
  const value = rawValue || firstDisplayChar(nickname);

  return {
    nickname,
    avatar: { type, value },
  };
}
