# Frontend A Theme Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved A-style frontend polish: theme-driven chat bubbles, left/right avatars, user nickname/avatar settings, and a B-style workbench theme.

**Architecture:** Keep the existing React/Zustand/Tailwind v4 structure. Add a small user profile store and shared chat presentation components, then refactor chat views and new-feature tabs to consume theme tokens instead of hardcoded colors. Preserve the current layout while tightening spacing, proportions, and visibility.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind v4 theme tokens, Vite, lucide-react, pnpm.

---

## Scope Check

This plan implements one coherent frontend upgrade. It touches theme presets, settings UI, chat rendering, new Agent enhancement tabs, and documentation, but all changes serve the same visible product outcome: A-style layout polish with reliable theme and user identity support.

Backend behavior is intentionally out of scope except for running project-required builds. User profile data is frontend-only in this version.

## File Structure

Create:
- `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.ts` — pure user profile types, normalization, and avatar fallback helpers.
- `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.test.ts` — focused helper tests run directly with Vitest.
- `D:\agent-codes\CoBeing\gui-v2\src\stores\userProfile.ts` — Zustand store backed by `localStorage`.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatAvatar.tsx` — shared avatar renderer for user, Butler, Agents, and group members.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatMessageFrame.tsx` — shared left/right message row and bubble frame.
- `D:\agent-codes\CoBeing\gui-v2\src\components\settings\UserProfileSection.tsx` — settings page for nickname/avatar and live bubble preview.
- `D:\agent-codes\CoBeing\gui-v2\public\themes\executive-workbench.json` — B-style workbench palette as a theme.

Modify:
- `D:\agent-codes\CoBeing\gui-v2\public\themes\manifest.json` — add the new theme id.
- `D:\agent-codes\CoBeing\gui-v2\src\stores\settings.ts` — add `user` settings section.
- `D:\agent-codes\CoBeing\gui-v2\src\components\settings\SettingsView.tsx` — add the user settings menu and section.
- `D:\agent-codes\CoBeing\gui-v2\src\components\settings\ThemeSelector.tsx` — show chat bubble color preview.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatView.tsx` — use shared message frame, avatars, user profile, and theme tokens.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\GroupMessageBubble.tsx` — same avatar/theme treatment for group messages.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\GroupChatView.tsx` — thinking bubble avatar and settings icon cleanup.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\TaskReceiptCard.tsx` — polish card spacing and theme tokens.
- `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx` — keep Butler actions visible with theme-safe icon buttons.
- `D:\agent-codes\CoBeing\gui-v2\src\components\todo\GlobalTodoPanel.tsx` — bring proportions closer to A preview.
- `D:\agent-codes\CoBeing\gui-v2\src\components\agent\CapabilityTab.tsx` — remove tiny fonts and default palette colors.
- `D:\agent-codes\CoBeing\gui-v2\src\components\agent\TaskInboxTab.tsx` — same cleanup.
- `D:\agent-codes\CoBeing\gui-v2\src\components\agent\GrowthProposalsTab.tsx` — same cleanup.
- `D:\agent-codes\CoBeing\gui-v2\src\components\layout\NavBar.tsx` — replace text emoji nav icons with lucide icons.
- `D:\agent-codes\PROGRESS.md` — add detailed change entry after implementation.
- `D:\agent-codes\PROGRESS-LITE.md` — add concise change entry.
- `D:\agent-codes\docs\项目信息\项目现状.md` — describe the visible frontend state.
- `D:\agent-codes\docs\项目信息\使用说明.md` — document user profile and theme switching.
- `D:\agent-codes\STRUCTURE.md` — list new frontend files and theme file.

---

### Task 1: Add User Profile Helpers And Store

**Files:**
- Create: `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.ts`
- Create: `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.test.ts`
- Create: `D:\agent-codes\CoBeing\gui-v2\src\stores\userProfile.ts`

- [ ] **Step 1: Write the failing helper test**

Create `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PROFILE,
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
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm exec vitest run gui-v2/src/lib/userProfile.test.ts
```

Expected: FAIL because `./userProfile` does not exist.

- [ ] **Step 3: Create the pure helper module**

Create `D:\agent-codes\CoBeing\gui-v2\src\lib\userProfile.ts`:

```ts
export type UserAvatarType = "initial" | "emoji" | "image";

export interface UserAvatar {
  type: UserAvatarType;
  value: string;
}

export interface UserProfile {
  nickname: string;
  avatar: UserAvatar;
}

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

export function normalizeUserProfile(input: unknown): UserProfile {
  if (!input || typeof input !== "object") return DEFAULT_USER_PROFILE;
  const raw = input as Partial<UserProfile>;
  const nickname = typeof raw.nickname === "string" ? raw.nickname.trim() : "";
  if (!nickname) return DEFAULT_USER_PROFILE;

  const rawAvatar = raw.avatar && typeof raw.avatar === "object" ? raw.avatar as Partial<UserAvatar> : undefined;
  const type = isAvatarType(rawAvatar?.type) ? rawAvatar.type : "initial";
  const rawValue = typeof rawAvatar?.value === "string" ? rawAvatar.value.trim() : "";
  const value = rawValue || firstDisplayChar(nickname);

  return {
    nickname,
    avatar: { type, value },
  };
}
```

- [ ] **Step 4: Create the Zustand store**

Create `D:\agent-codes\CoBeing\gui-v2\src\stores\userProfile.ts`:

```ts
import { create } from "zustand";
import {
  DEFAULT_USER_PROFILE,
  firstDisplayChar,
  normalizeUserProfile,
  type UserAvatar,
  type UserProfile,
} from "@/lib/userProfile";

const STORAGE_KEY = "cobeing-user-profile";

function readProfile(): UserProfile {
  if (typeof window === "undefined") return DEFAULT_USER_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeUserProfile(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

function writeProfile(profile: UserProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

interface UserProfileState {
  profile: UserProfile;
  setNickname: (nickname: string) => void;
  setAvatar: (avatar: UserAvatar) => void;
  resetProfile: () => void;
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: readProfile(),

  setNickname: (nickname) => {
    const next = normalizeUserProfile({
      ...get().profile,
      nickname,
      avatar: {
        ...get().profile.avatar,
        value: get().profile.avatar.type === "initial"
          ? firstDisplayChar(nickname)
          : get().profile.avatar.value,
      },
    });
    writeProfile(next);
    set({ profile: next });
  },

  setAvatar: (avatar) => {
    const next = normalizeUserProfile({ ...get().profile, avatar });
    writeProfile(next);
    set({ profile: next });
  },

  resetProfile: () => {
    writeProfile(DEFAULT_USER_PROFILE);
    set({ profile: DEFAULT_USER_PROFILE });
  },
}));
```

- [ ] **Step 5: Run the helper test and GUI build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm exec vitest run gui-v2/src/lib/userProfile.test.ts
pnpm --filter cobeing-gui build
```

Expected: helper test PASS; GUI build completes without TypeScript errors.

- [ ] **Step 6: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/lib/userProfile.ts gui-v2/src/lib/userProfile.test.ts gui-v2/src/stores/userProfile.ts
git commit -m "feat(gui): add user profile store"
```

Expected: commit contains only the three files from this task.

---

### Task 2: Add Shared Chat Avatar And Message Frame Components

**Files:**
- Create: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatAvatar.tsx`
- Create: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatMessageFrame.tsx`

- [ ] **Step 1: Create the shared avatar component**

Create `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatAvatar.tsx`:

```tsx
import { firstDisplayChar, type UserAvatar } from "@/lib/userProfile";
import { cn } from "@/lib/utils";

interface ChatAvatarProps {
  name: string;
  avatar?: UserAvatar;
  tone?: "user" | "assistant" | "group" | "muted";
  className?: string;
}

const toneClass: Record<NonNullable<ChatAvatarProps["tone"]>, string> = {
  user: "bg-accent/12 text-accent",
  assistant: "bg-success/12 text-success",
  group: "bg-purple/12 text-purple",
  muted: "bg-elevated text-txt-sub",
};

export function ChatAvatar({ name, avatar, tone = "assistant", className }: ChatAvatarProps) {
  const label = avatar?.value?.trim() || firstDisplayChar(name);

  if (avatar?.type === "image" && avatar.value.trim()) {
    return (
      <div
        className={cn(
          "h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-bdr/40 bg-elevated",
          className,
        )}
        title={name}
      >
        <img
          src={avatar.value}
          alt={name}
          className="h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-10 w-10 shrink-0 rounded-xl border border-bdr/30 flex items-center justify-center text-sm font-semibold",
        toneClass[tone],
        className,
      )}
      title={name}
    >
      {label}
    </div>
  );
}
```

- [ ] **Step 2: Create the shared message frame**

Create `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatMessageFrame.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "./ChatAvatar";
import type { UserAvatar } from "@/lib/userProfile";

interface ChatMessageFrameProps {
  side: "left" | "right";
  senderName: string;
  timestamp?: string;
  status?: ReactNode;
  avatar?: UserAvatar;
  avatarTone?: "user" | "assistant" | "group" | "muted";
  bubbleTone: "user" | "assistant" | "system" | "tool";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const bubbleToneClass: Record<ChatMessageFrameProps["bubbleTone"], string> = {
  user: "bg-msg-user rounded-br-md",
  assistant: "bg-msg-assistant rounded-bl-md",
  system: "bg-msg-system",
  tool: "bg-msg-tool",
};

export function ChatMessageFrame({
  side,
  senderName,
  timestamp,
  status,
  avatar,
  avatarTone,
  bubbleTone,
  children,
  footer,
  className,
}: ChatMessageFrameProps) {
  const isRight = side === "right";

  return (
    <div
      className={cn(
        "flex w-full items-end gap-3",
        isRight ? "justify-end" : "justify-start",
        className,
      )}
      style={isRight ? { paddingRight: 24 } : { paddingLeft: 24 }}
    >
      {!isRight && (
        <ChatAvatar name={senderName} avatar={avatar} tone={avatarTone ?? "assistant"} />
      )}
      <div
        className={cn(
          "max-w-[min(70%,720px)] rounded-2xl text-sm text-txt shadow-sm",
          bubbleToneClass[bubbleTone],
        )}
        style={{ padding: "16px 24px", lineHeight: 1.65 }}
      >
        <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
          <span
            className={cn(
              "text-sm font-semibold",
              isRight ? "text-accent" : avatarTone === "group" ? "text-purple" : "text-success",
            )}
          >
            {senderName}
          </span>
          {timestamp && <span className="text-xs text-txt-muted">{timestamp}</span>}
          {status}
        </div>
        {children}
        {footer}
      </div>
      {isRight && (
        <ChatAvatar name={senderName} avatar={avatar} tone={avatarTone ?? "user"} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run GUI build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes; no unused import or prop errors.

- [ ] **Step 4: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components/chat/ChatAvatar.tsx gui-v2/src/components/chat/ChatMessageFrame.tsx
git commit -m "feat(gui): add shared chat message frame"
```

Expected: commit contains only the two shared chat component files.

---

### Task 3: Add User Settings UI

**Files:**
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\stores\settings.ts`
- Create: `D:\agent-codes\CoBeing\gui-v2\src\components\settings\UserProfileSection.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\settings\SettingsView.tsx`

- [ ] **Step 1: Extend the settings section type**

Modify `D:\agent-codes\CoBeing\gui-v2\src\stores\settings.ts`:

```ts
export type SettingsSection = "user" | "general" | "theme" | "providers" | "channels" | "sandbox" | "logs" | "search" | "export" | "about" | `plugin:${string}`;
```

Keep the default `settingsSection` as `"theme"` unless the user explicitly wants the settings page to open on user profile.

- [ ] **Step 2: Create the user profile settings section**

Create `D:\agent-codes\CoBeing\gui-v2\src\components\settings\UserProfileSection.tsx`:

```tsx
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { ChatMessageFrame } from "@/components/chat/ChatMessageFrame";
import { useUserProfileStore } from "@/stores/userProfile";
import type { UserAvatarType } from "@/lib/userProfile";

const AVATAR_TYPES: Array<{ value: UserAvatarType; label: string; hint: string }> = [
  { value: "initial", label: "首字", hint: "使用昵称的第一个字符" },
  { value: "emoji", label: "文字/Emoji", hint: "例如：诚、LC、✨" },
  { value: "image", label: "图片 URL", hint: "使用可访问的图片地址" },
];

export function UserProfileSection() {
  const profile = useUserProfileStore((s) => s.profile);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const resetProfile = useUserProfileStore((s) => s.resetProfile);

  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">用户</h2>
      <p className="text-sm text-txt-muted mb-6">设置你在聊天气泡中显示的昵称和头像</p>

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(320px, 460px) minmax(360px, 1fr)" }}>
        <div className="rounded-xl bg-elevated" style={{ padding: 20 }}>
          <label className="block text-sm font-medium text-txt" style={{ marginBottom: 8 }}>
            昵称
          </label>
          <input
            value={profile.nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="w-full rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            style={{ padding: "10px 14px" }}
            placeholder="输入你的昵称"
          />

          <div style={{ marginTop: 20 }}>
            <label className="block text-sm font-medium text-txt" style={{ marginBottom: 10 }}>
              头像类型
            </label>
            <div className="grid grid-cols-3" style={{ gap: 8 }}>
              {AVATAR_TYPES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setAvatar({ type: item.value, value: profile.avatar.value })}
                  className={`rounded-lg border text-sm transition-colors ${
                    profile.avatar.type === item.value
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-bdr/40 bg-surface-solid text-txt-sub hover:bg-hover"
                  }`}
                  style={{ padding: "10px 8px" }}
                  title={item.hint}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-sm font-medium text-txt" style={{ marginTop: 20, marginBottom: 8 }}>
            头像内容
          </label>
          <input
            value={profile.avatar.value}
            onChange={(event) => setAvatar({ ...profile.avatar, value: event.target.value })}
            className="w-full rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
            style={{ padding: "10px 14px" }}
            placeholder={profile.avatar.type === "image" ? "https://..." : "例如：诚 / LC / ✨"}
          />

          <button
            type="button"
            onClick={resetProfile}
            className="rounded-lg bg-surface-solid text-sm text-txt-sub hover:bg-hover transition-colors"
            style={{ marginTop: 20, padding: "10px 14px" }}
          >
            恢复默认
          </button>
        </div>

        <div className="rounded-xl bg-surface border border-bdr/40" style={{ padding: 24, boxShadow: "var(--shadow-surface)" }}>
          <div className="text-sm font-medium text-txt" style={{ marginBottom: 16 }}>
            气泡预览
          </div>
          <div className="flex flex-col" style={{ gap: 24 }}>
            <ChatMessageFrame
              side="right"
              senderName={profile.nickname}
              avatar={profile.avatar}
              avatarTone="user"
              bubbleTone="user"
              timestamp="刚刚"
            >
              <div className="whitespace-pre-wrap">这是你发送的消息。切换主题后，这个气泡颜色会跟着变化。</div>
            </ChatMessageFrame>
            <div className="flex items-center gap-3 rounded-xl bg-elevated" style={{ padding: 16 }}>
              <ChatAvatar name={profile.nickname} avatar={profile.avatar} tone="user" />
              <div>
                <div className="text-sm font-medium text-txt">{profile.nickname}</div>
                <div className="text-sm text-txt-muted">当前头像会显示在用户气泡右侧</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the section into SettingsView**

Modify imports in `D:\agent-codes\CoBeing\gui-v2\src\components\settings\SettingsView.tsx`:

```ts
import { UserProfileSection } from "./UserProfileSection";
```

Modify `MENU_SECTIONS` so user settings appear near the top:

```ts
const MENU_SECTIONS = [
  { id: "user" as const, label: "用户", group: "" },
  { id: "general" as const, label: "常规", group: "" },
  { id: "theme" as const, label: "主题", group: "" },
  { id: "providers" as const, label: "Providers", group: "连接" },
  { id: "channels" as const, label: "Channels", group: "连接" },
  { id: "sandbox" as const, label: "沙箱监控", group: "运维" },
  { id: "search" as const, label: "搜索对话", group: "数据" },
  { id: "logs" as const, label: "日志", group: "数据" },
  { id: "export" as const, label: "导出数据", group: "数据" },
  { id: "about" as const, label: "关于", group: "数据" },
];
```

Render the section before general:

```tsx
{settingsSection === "user" && <UserProfileSection />}
{settingsSection === "general" && <GeneralSection />}
```

- [ ] **Step 4: Run GUI build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes; no `SettingsSection` union mismatch.

- [ ] **Step 5: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/stores/settings.ts gui-v2/src/components/settings/SettingsView.tsx gui-v2/src/components/settings/UserProfileSection.tsx
git commit -m "feat(gui): add user profile settings"
```

Expected: commit contains only the settings and user profile UI files.

---

### Task 4: Add Executive Workbench Theme And Theme Preview

**Files:**
- Create: `D:\agent-codes\CoBeing\gui-v2\public\themes\executive-workbench.json`
- Modify: `D:\agent-codes\CoBeing\gui-v2\public\themes\manifest.json`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\settings\ThemeSelector.tsx`

- [ ] **Step 1: Create the new theme file**

Create `D:\agent-codes\CoBeing\gui-v2\public\themes\executive-workbench.json`:

```json
{
  "name": "工作台棕金",
  "description": "来自方案 B 的高级工作台配色：纸感基底、深色导航、赤铜强调和橄榄绿助手气泡",
  "base": {
    "gradient-from": "#FBF7EF",
    "gradient-to": "#E7DED2",
    "gradient-angle": 135
  },
  "surface": {
    "bg": "rgba(255,252,246,0.78)",
    "bg-solid": "#FFFAF2",
    "elevated": "#F2E8DA",
    "hover": "#EFE1D0",
    "input": "#FFFCF6",
    "border": "rgba(74,58,43,0.18)",
    "shadow": "0 18px 46px rgba(35,25,16,0.10), 0 4px 14px rgba(35,25,16,0.06)",
    "shadow-lg": "0 28px 70px rgba(35,25,16,0.16), 0 8px 22px rgba(35,25,16,0.10)"
  },
  "content": {
    "accent": "#B63F4C",
    "accent-warm": "#A56C2C",
    "accent-dim": "#F7DCE0",
    "txt": "#171412",
    "txt-sub": "#4B423A",
    "txt-muted": "#766B60",
    "success": "#4D7C5D",
    "warning": "#A56C2C",
    "danger": "#B63F4C",
    "purple": "#365C84"
  },
  "chat": {
    "msg-user": "#FFF3F1",
    "msg-assistant": "#F1F8ED",
    "msg-system": "#FFF8E8",
    "msg-tool": "#F4ECD8"
  },
  "misc": {
    "scrollbar": "#D8CBBC",
    "scrollbar-hover": "#B7A692",
    "overlay": "rgba(35,25,16,0.28)",
    "code-bg": "#F2E8DA",
    "selection-bg": "#B63F4C",
    "selection-fg": "#FFFAF2",
    "divider": "#E0D3C3"
  }
}
```

- [ ] **Step 2: Add the theme to the manifest**

Modify `D:\agent-codes\CoBeing\gui-v2\public\themes\manifest.json`:

```json
["sakura-mint", "amber-dawn", "lavender-rain", "executive-workbench", "ink-jade", "amethyst-night", "ember-gold"]
```

- [ ] **Step 3: Add bubble color previews to ThemeSelector**

In `D:\agent-codes\CoBeing\gui-v2\src\components\settings\ThemeSelector.tsx`, inside each theme button after the description block and before preview dots, add:

```tsx
<div className="flex items-center gap-2 shrink-0">
  <div
    className="rounded-full border border-bdr/30"
    style={{ width: 28, height: 18, backgroundColor: preset.chat["msg-user"] }}
    title="用户气泡"
  />
  <div
    className="rounded-full border border-bdr/30"
    style={{ width: 28, height: 18, backgroundColor: preset.chat["msg-assistant"] }}
    title="助手气泡"
  />
</div>
```

Keep the existing color dots after this preview.

- [ ] **Step 4: Validate JSON and build**

Run from `D:\agent-codes\CoBeing`:

```powershell
Get-Content .\gui-v2\public\themes\executive-workbench.json -Raw | ConvertFrom-Json | Out-Null
Get-Content .\gui-v2\public\themes\manifest.json -Raw | ConvertFrom-Json | Out-Null
pnpm --filter cobeing-gui build
```

Expected: both JSON commands complete silently; GUI build passes.

- [ ] **Step 5: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/public/themes/executive-workbench.json gui-v2/public/themes/manifest.json gui-v2/src/components/settings/ThemeSelector.tsx
git commit -m "feat(gui): add workbench theme"
```

Expected: commit contains only theme files and theme preview UI.

---

### Task 5: Refactor ChatView To Use User Profile, Avatars, And Theme Tokens

**Files:**
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatView.tsx`

- [ ] **Step 1: Add imports**

In `ChatView.tsx`, add:

```ts
import { ChatMessageFrame } from "./ChatMessageFrame";
import { useUserProfileStore } from "@/stores/userProfile";
```

- [ ] **Step 2: Replace the independent chat MessageBubble implementation**

Replace the existing `MessageBubble` function in `ChatView.tsx` with:

```tsx
function MessageBubble({ msg }: { msg: LogMessage }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const profile = useUserProfileStore((s) => s.profile);

  if (msg.direction === "system") {
    return (
      <div className="flex justify-center" style={{ padding: "8px 0" }}>
        <div className="rounded-full bg-msg-system/80 text-sm text-accent-warm" style={{ padding: "8px 20px" }}>
          {msg.content}
        </div>
      </div>
    );
  }

  const isUser = msg.direction === "in";
  const senderName = isUser ? profile.nickname : getSenderDisplay(msg, activeConv, agents);
  const status = isUser && msg.status && msg.status !== "done"
    ? <span className={`text-xs ${statusStyle(msg.status)}`}>{statusLabel[msg.status]}</span>
    : null;
  const error = isUser && msg.status === "error" && msg.errorMessage
    ? <span className="text-xs text-danger" title={msg.errorMessage}>({msg.errorMessage.slice(0, 30)})</span>
    : null;

  return (
    <ChatMessageFrame
      side={isUser ? "right" : "left"}
      senderName={senderName}
      timestamp={formatTime(msg.timestamp)}
      status={<>{status}{error}</>}
      avatar={isUser ? profile.avatar : undefined}
      avatarTone={isUser ? "user" : "assistant"}
      bubbleTone={isUser ? "user" : "assistant"}
    >
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
        <ToolCallsGroup toolCalls={msg.toolCalls} />
      )}
      <div className="text-sm text-txt leading-relaxed">
        {isUser ? <div className="whitespace-pre-wrap">{msg.content}</div> : <MarkdownContent content={msg.content} />}
      </div>
      {!isUser && msg.metadata?.taskReceipt && (
        <TaskReceiptCard receipt={msg.metadata.taskReceipt as TaskReceipt} />
      )}
    </ChatMessageFrame>
  );
}
```

- [ ] **Step 3: Replace the independent chat ThinkingBubble implementation**

Replace `ThinkingBubble` in `ChatView.tsx` with:

```tsx
function ThinkingBubble({ buffer }: { buffer: string }) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const agents = useAgentsStore((s) => s.agents);
  const senderName = getSenderDisplay({ direction: "out" } as LogMessage, activeConv, agents);

  return (
    <ChatMessageFrame
      side="left"
      senderName={buffer ? `${senderName} (回复中)` : "思考中"}
      avatarTone="assistant"
      bubbleTone="assistant"
      status={
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
        </span>
      }
    >
      <div className="text-sm text-txt leading-relaxed">
        {buffer ? <MarkdownContent content={buffer} /> : "思考中..."}
      </div>
    </ChatMessageFrame>
  );
}
```

- [ ] **Step 4: Keep message list spacing aligned with A**

In `MessageList`, keep the message list unframed and use:

```tsx
<div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: "24px 20px" }}>
  <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
```

Expected: no separate panel background is added to the messages container.

- [ ] **Step 5: Run build and a targeted static scan**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
rg -n "bg-msg-user|bg-msg-assistant|bg-msg-system|bg-msg-tool" gui-v2/src/components/chat/ChatView.tsx gui-v2/src/components/chat/ChatMessageFrame.tsx
```

Expected: build passes; scan shows chat bubble token usage in `ChatMessageFrame.tsx` and system bubble usage in `ChatView.tsx`.

- [ ] **Step 6: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components/chat/ChatView.tsx
git commit -m "feat(gui): theme independent chat bubbles"
```

Expected: commit contains only `ChatView.tsx`.

---

### Task 6: Refactor Group Chat Bubbles And Thinking State

**Files:**
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\GroupMessageBubble.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\GroupChatView.tsx`

- [ ] **Step 1: Add imports to GroupMessageBubble**

Add:

```ts
import { ChatMessageFrame } from "./ChatMessageFrame";
import { useUserProfileStore } from "@/stores/userProfile";
```

- [ ] **Step 2: Replace user group message rendering**

Inside `GroupMessageBubble`, replace the `if (isUser) { ... }` block with:

```tsx
if (isUser) {
  const profile = useUserProfileStore.getState().profile;
  const status = msg.status && msg.status !== "done"
    ? <span className={`text-xs ${statusStyle(msg.status)}`}>{statusLabel[msg.status]}</span>
    : null;
  const error = msg.status === "error" && msg.errorMessage
    ? <span className="text-xs text-danger" title={msg.errorMessage}>({msg.errorMessage.slice(0, 30)})</span>
    : null;

  return (
    <ChatMessageFrame
      side="right"
      senderName={profile.nickname}
      timestamp={formatTime(msg.timestamp)}
      status={<>{status}{error}</>}
      avatar={profile.avatar}
      avatarTone="user"
      bubbleTone="user"
    >
      <div className="text-sm text-txt leading-relaxed whitespace-pre-wrap">
        <MessageContent content={msg.content} />
      </div>
    </ChatMessageFrame>
  );
}
```

Then convert it to use a hook at the top-level of the component instead of `getState()` if the initial edit triggers hook-rule concerns. The final component should call:

```ts
const profile = useUserProfileStore((s) => s.profile);
```

before any conditional returns.

- [ ] **Step 3: Replace agent group message rendering**

Replace the final Agent message return with:

```tsx
return (
  <div className="flex justify-start" style={{ paddingLeft: 24 }}>
    <div className="max-w-[min(70%,720px)] flex items-end gap-3">
      <ChatMessageFrame
        side="left"
        senderName={senderName ?? senderId}
        timestamp={formatTime(msg.timestamp)}
        avatarTone="group"
        bubbleTone="assistant"
        status={
          msg.metadata?.reviewOverridden === true
            ? <span className="text-warning text-xs font-medium" title="审核未通过，已强制发布">审核覆盖</span>
            : null
        }
      >
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <GroupToolCalls toolCalls={msg.toolCalls} />
        )}
        <div className="text-sm text-txt leading-relaxed">
          <MessageContent content={msg.content} />
        </div>
      </ChatMessageFrame>
      <div
        className="w-1 rounded-full self-stretch"
        style={{ backgroundColor: color }}
      />
    </div>
  </div>
);
```

If the nested padding becomes visually too wide, remove the outer `paddingLeft` and rely on `ChatMessageFrame` padding. The final visual requirement is one left avatar plus one themed assistant bubble.

- [ ] **Step 4: Refactor group thinking bubble**

In `GroupChatView.tsx`, import:

```ts
import { ChatMessageFrame } from "./ChatMessageFrame";
```

Replace `GroupThinkingBubble` with:

```tsx
function GroupThinkingBubble({ buffer, getSenderName }: {
  buffer?: string; getSenderName: (id: string) => string;
}) {
  const activeConv = useChatStore((s) => s.activeConversation);
  const senderName = activeConv ? getSenderName(activeConv) : "Assistant";

  return (
    <ChatMessageFrame
      side="left"
      senderName={buffer ? `${senderName} (回复中)` : "思考中"}
      avatarTone="group"
      bubbleTone="assistant"
      status={
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
        </span>
      }
    >
      <div className="text-sm text-txt leading-relaxed">
        {buffer ? <MarkdownContent content={buffer} /> : "思考中..."}
      </div>
    </ChatMessageFrame>
  );
}
```

- [ ] **Step 5: Run build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes; no React hook ordering errors at compile time.

- [ ] **Step 6: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components/chat/GroupMessageBubble.tsx gui-v2/src/components/chat/GroupChatView.tsx
git commit -m "feat(gui): theme group chat bubbles"
```

Expected: commit contains only the two group chat files.

---

### Task 7: Polish New Feature Panels And Remove Non-Theme Styling

**Files:**
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\agent\CapabilityTab.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\agent\TaskInboxTab.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\agent\GrowthProposalsTab.tsx`

- [ ] **Step 1: Replace tiny text and default colors in CapabilityTab**

In `CapabilityTab.tsx`, use these token-based chip helpers near the top:

```tsx
function Chip({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "success" | "warning" | "muted" }) {
  const cls = {
    accent: "bg-accent/10 text-accent",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    muted: "bg-elevated text-txt-sub",
  }[tone];
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>{children}</span>;
}
```

Replace `text-[10px]` chips with:

```tsx
<Chip key={d}>{d}</Chip>
<Chip key={s} tone="success">{s}</Chip>
<Chip key={l} tone="warning">{l}</Chip>
```

Use `style={{ padding: 20 }}` for the root content and `gap: 16` for section spacing.

- [ ] **Step 2: Replace TaskInboxTab status colors**

In `TaskInboxTab.tsx`, replace `STATUS_LABELS` with:

```ts
const STATUS_LABELS: Record<AgentTaskStatus, { text: string; className: string }> = {
  pending: { text: "待处理", className: "bg-elevated text-txt-sub" },
  running: { text: "执行中", className: "bg-accent/10 text-accent" },
  blocked: { text: "阻塞", className: "bg-warning/10 text-warning" },
  waiting_user: { text: "等待用户", className: "bg-warning/10 text-warning" },
  waiting_dependency: { text: "等待依赖", className: "bg-purple/10 text-purple" },
  completed: { text: "已完成", className: "bg-success/10 text-success" },
  failed: { text: "失败", className: "bg-danger/10 text-danger" },
  cancelled: { text: "已取消", className: "bg-elevated text-txt-muted" },
};
```

Replace filter buttons with:

```tsx
className={`rounded-lg text-sm transition-colors ${
  filter === f ? "bg-accent text-white" : "bg-elevated text-txt-sub hover:bg-hover"
}`}
style={{ padding: "7px 12px" }}
```

Replace task rows with:

```tsx
<div key={item.id} className="rounded-xl border border-bdr/40 bg-surface" style={{ padding: 14 }}>
```

Replace status badge with:

```tsx
<span className={`px-2 py-1 rounded-full text-xs font-medium ${sl.className}`}>{sl.text}</span>
```

- [ ] **Step 3: Replace GrowthProposalsTab colors and tiny text**

In `GrowthProposalsTab.tsx`, replace `RISK_LABELS` and `STATUS_LABELS` with theme classes:

```ts
const RISK_LABELS: Record<string, { text: string; className: string }> = {
  low: { text: "低", className: "text-success" },
  medium: { text: "中", className: "text-warning" },
  high: { text: "高", className: "text-danger" },
};

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  pending: { text: "待审批", className: "text-warning" },
  approved: { text: "已批准", className: "text-success" },
  rejected: { text: "已拒绝", className: "text-danger" },
  applied: { text: "已应用", className: "text-accent" },
};
```

Replace proposal rows with:

```tsx
<div key={proposal.id} className="rounded-xl border border-bdr/40 bg-surface" style={{ padding: 16 }}>
```

Replace the patch preview with:

```tsx
<pre className="mt-2 rounded-lg bg-elevated text-xs text-txt-sub overflow-x-auto max-h-40" style={{ padding: 12 }}>
  {proposal.proposedPatch.slice(0, 500)}
</pre>
```

Replace action buttons with:

```tsx
className="rounded-lg bg-success/10 text-success hover:bg-success/20 text-sm font-medium"
style={{ padding: "8px 12px" }}
```

and:

```tsx
className="rounded-lg bg-danger/10 text-danger hover:bg-danger/20 text-sm font-medium"
style={{ padding: "8px 12px" }}
```

- [ ] **Step 4: Run static scan and build**

Run from `D:\agent-codes\CoBeing`:

```powershell
rg -n "text-\[(9|10|11)px\]|bg-card2|border-border|bg-green-|bg-red-|bg-blue-|bg-gray-|bg-yellow-" gui-v2/src/components/agent
pnpm --filter cobeing-gui build
```

Expected: scan returns no matches for the three Agent enhancement files; GUI build passes.

- [ ] **Step 5: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components/agent/CapabilityTab.tsx gui-v2/src/components/agent/TaskInboxTab.tsx gui-v2/src/components/agent/GrowthProposalsTab.tsx
git commit -m "style(gui): polish agent enhancement tabs"
```

Expected: commit contains only the three Agent tab files.

---

### Task 8: Polish Feature Visibility, Navigation Icons, And Task Cards

**Files:**
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\layout\NavBar.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\TaskReceiptCard.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\chat\ChatInputActions.tsx`
- Modify: `D:\agent-codes\CoBeing\gui-v2\src\components\todo\GlobalTodoPanel.tsx`

- [ ] **Step 1: Replace NavBar emoji icons with lucide icons**

Modify `NavBar.tsx` imports:

```ts
import { Bot, Boxes, ChartNoAxesColumnIncreasing, Puzzle, Settings, ShieldCheck, Users } from "lucide-react";
```

Replace `NAV_ITEMS`:

```tsx
const NAV_ITEMS: { icon: React.ComponentType<{ size?: number }>; view: ViewType; label: string }[] = [
  { icon: ShieldCheck, view: "butler", label: "管家" },
  { icon: Bot, view: "agents", label: "智能体" },
  { icon: Users, view: "groups", label: "群组" },
  { icon: ChartNoAxesColumnIncreasing, view: "dashboard", label: "仪表盘" },
  { icon: Puzzle, view: "extensions", label: "扩展" },
  { icon: Settings, view: "settings", label: "设置" },
];
```

Inside the map:

```tsx
const Icon = item.icon;
```

Render:

```tsx
<Icon size={20} />
```

If `Boxes` is unused after the edit, remove it from imports.

- [ ] **Step 2: Polish TaskReceiptCard spacing**

In `TaskReceiptCard.tsx`, keep the status config theme-based and update the root:

```tsx
<div className="rounded-xl bg-msg-tool border border-bdr/30" style={{ padding: "14px 16px", marginTop: 14 }}>
```

Replace small title text with:

```tsx
<p className="text-sm text-txt font-medium truncate">{receipt.title}</p>
<p className="text-sm text-txt-muted truncate">
  {receipt.assigneeType === "group" ? "群组" : "Agent"}：{receipt.assigneeName}
</p>
```

Replace artifact icon text with a simple themed bullet:

```tsx
<span className="h-2 w-2 rounded-full bg-accent/60 shrink-0" />
```

- [ ] **Step 3: Keep Butler quick actions visible and theme-safe**

In `ChatInputActions.tsx`, update `btnClass` and `btnStyle`:

```ts
const btnClass = "text-sm text-txt-sub hover:text-txt hover:bg-hover rounded-lg transition-colors flex items-center gap-1.5";
const btnStyle = { padding: "7px 10px" };
```

Replace menu rows from `text-xs` to `text-sm` for target names, while keeping section hints as `text-xs`.

- [ ] **Step 4: Bring GlobalTodoPanel closer to A proportions**

In `GlobalTodoPanel.tsx`, update the aside style:

```tsx
style={{ width: 260, padding: "20px 16px", gap: 16, overflowY: "auto" }}
```

Wrap content in a floating panel:

```tsx
<div className="rounded-xl bg-surface border border-bdr/40 flex flex-col" style={{ boxShadow: "var(--shadow-surface)", padding: 18, gap: 16 }}>
```

Move the current title, stat chips, and task list inside that wrapper. Keep rows at least `padding: "12px 14px"` and row title class `text-sm`.

- [ ] **Step 5: Run build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes; no unused lucide imports.

- [ ] **Step 6: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components/layout/NavBar.tsx gui-v2/src/components/chat/TaskReceiptCard.tsx gui-v2/src/components/chat/ChatInputActions.tsx gui-v2/src/components/todo/GlobalTodoPanel.tsx
git commit -m "style(gui): polish visible task controls"
```

Expected: commit contains only navigation, task card, quick action, and Global task panel files.

---

### Task 9: Full UI Static Sweep

**Files:**
- Modify any touched UI file under `D:\agent-codes\CoBeing\gui-v2\src\components` that still violates the explicit UI rules.

- [ ] **Step 1: Run the UI rule scan**

Run from `D:\agent-codes\CoBeing`:

```powershell
rg -n "text-\[(9|10|11)px\]|bg-card2|border-border|bg-green-|bg-red-|bg-blue-|bg-gray-|bg-yellow-|focus:ring-2|ring-2" gui-v2/src/components
```

Expected before cleanup: matches may remain in settings/logs/workspace binding or older components.

- [ ] **Step 2: Apply mechanical replacements**

Use these replacement rules:

```text
text-[10px] -> text-xs
text-[11px] -> text-xs
bg-card2 -> bg-elevated
border-border -> border-bdr/40
bg-green-500/10 -> bg-success/10
text-green-500 -> text-success
text-green-600 -> text-success
bg-red-500/10 -> bg-danger/10
text-red-500 -> text-danger
bg-blue-500/10 -> bg-accent/10
text-blue-500 -> text-accent
bg-gray-500/10 -> bg-elevated
text-gray-500 -> text-txt-muted
bg-yellow-500/10 -> bg-warning/10
text-yellow-600 -> text-warning
focus:ring-2 focus:ring-accent/50 -> focus:border-accent/50
```

Apply only where the replacement preserves meaning. For code snippets and monospace paths, `text-xs` remains acceptable under the project UI preference.

- [ ] **Step 3: Re-run the UI rule scan**

Run:

```powershell
rg -n "text-\[(9|10|11)px\]|bg-card2|border-border|bg-green-|bg-red-|bg-blue-|bg-gray-|bg-yellow-|focus:ring-2|ring-2" gui-v2/src/components
```

Expected: no matches, or only clearly justified monospace code cases. If justified cases remain, list exact file and reason in the implementation summary.

- [ ] **Step 4: Run GUI build**

Run:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes.

- [ ] **Step 5: Commit touched files only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree:

```powershell
git add gui-v2/src/components
git commit -m "style(gui): enforce theme token ui rules"
```

Expected: commit contains only files actually cleaned by the scan.

---

### Task 10: End-To-End Visual Verification

**Files:**
- No source files unless verification finds a defect.

- [ ] **Step 1: Start the GUI dev server**

Run from `D:\agent-codes\CoBeing\gui-v2`:

```powershell
pnpm dev --host 127.0.0.1
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 2: Verify the main scenarios manually**

Open the Vite URL and check:

```text
1. Default theme is 樱花薄荷.
2. User message bubble uses the user chat token and shows avatar on the right.
3. Assistant, Butler, and Agent bubbles show avatars on the left.
4. User settings page lets nickname and avatar change immediately.
5. Chat bubbles update when nickname/avatar changes.
6. Theme page shows chat bubble previews.
7. Switching to 工作台棕金 changes user, assistant, system, and tool bubble colors.
8. Butler page shows Global task panel and quick actions.
9. Agent detail panel shows 能力 / 任务 / 成长 tabs with readable text.
10. Group chat preserves left Agent avatars and right user avatar.
```

- [ ] **Step 3: Stop the dev server**

Stop the Vite process with `Ctrl+C` in its terminal.

Expected: no long-running dev server remains.

- [ ] **Step 4: Run production build**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm --filter cobeing-gui build
```

Expected: build passes.

---

### Task 11: Required Project Documentation Sync

**Files:**
- Modify: `D:\agent-codes\PROGRESS.md`
- Modify: `D:\agent-codes\PROGRESS-LITE.md`
- Modify: `D:\agent-codes\docs\项目信息\项目现状.md`
- Modify: `D:\agent-codes\docs\项目信息\使用说明.md`
- Modify: `D:\agent-codes\STRUCTURE.md`

- [ ] **Step 1: Update PROGRESS.md**

Add a new entry near the top:

```md
## 2026-06-11 前端 A 版式、主题化气泡与用户资料

### 变更原因

根据最新功能更新，前端需要保证管家任务、任务回执、Agent 能力/任务/成长建议等能力可见，并统一所有聊天窗口的气泡比例、头像位置、字号和主题适配。

### 修改文件

- `gui-v2/src/lib/userProfile.ts`
- `gui-v2/src/stores/userProfile.ts`
- `gui-v2/src/components/chat/ChatAvatar.tsx`
- `gui-v2/src/components/chat/ChatMessageFrame.tsx`
- `gui-v2/src/components/chat/ChatView.tsx`
- `gui-v2/src/components/chat/GroupMessageBubble.tsx`
- `gui-v2/src/components/chat/GroupChatView.tsx`
- `gui-v2/src/components/settings/UserProfileSection.tsx`
- `gui-v2/src/components/settings/SettingsView.tsx`
- `gui-v2/src/components/settings/ThemeSelector.tsx`
- `gui-v2/public/themes/executive-workbench.json`
- `gui-v2/public/themes/manifest.json`

### 修改摘要

- 采用方案 A 的版式比例作为主界面方向，保持默认樱花薄荷主题。
- 聊天气泡统一走主题 chat token，支持主题切换后同步变化。
- 所有对话窗口增加左右头像：用户右侧，管家/Agent/群组成员左侧。
- 设置页新增用户资料入口，可配置昵称和头像，对话中显示昵称。
- 将方案 B 的工作台配色保留为内置主题“工作台棕金”。
- 清理新功能 Tab 中过小字号和非主题色，保证能力、任务、成长建议可读。

### 验证

- `pnpm exec vitest run gui-v2/src/lib/userProfile.test.ts`
- `pnpm --filter cobeing-gui build`
- UI 静态扫描：无 9-11px 自定义字号、`bg-card2`、`border-border`、默认彩色 Tailwind 类残留于本次触达界面。
```

- [ ] **Step 2: Update PROGRESS-LITE.md**

Add near the top under `2026-06-11`:

```md
- [Change] 前端采用 A 版式精修：聊天气泡支持主题化颜色，新增左右头像和用户昵称/头像设置，并将 B 方案沉淀为“工作台棕金”主题。
```

- [ ] **Step 3: Update 项目现状.md**

Add or adjust the frontend section to state:

```md
- GUI 已支持多主题 chat token，用户/助手/系统/工具气泡随主题切换。
- GUI 设置页包含用户资料入口，可设置昵称与头像；用户消息气泡显示昵称和右侧头像。
- 管家页显示全局任务侧栏，Agent 详情面板包含能力、任务收件箱、成长建议 Tab。
```

- [ ] **Step 4: Update 使用说明.md**

Add user-facing instructions:

```md
### 设置用户昵称和头像

进入“设置 → 用户”，填写昵称并选择头像类型。昵称会显示在用户消息气泡中，头像会显示在气泡右侧。

### 切换主题

进入“设置 → 主题”，选择内置主题。聊天气泡颜色会随主题中的用户、助手、系统、工具气泡 token 变化。“工作台棕金”主题保留了方案 B 的高级工作台配色。
```

- [ ] **Step 5: Update STRUCTURE.md**

Add the new files under the existing GUI tree:

```md
gui-v2/src/lib/userProfile.ts
gui-v2/src/lib/userProfile.test.ts
gui-v2/src/stores/userProfile.ts
gui-v2/src/components/chat/ChatAvatar.tsx
gui-v2/src/components/chat/ChatMessageFrame.tsx
gui-v2/src/components/settings/UserProfileSection.tsx
gui-v2/public/themes/executive-workbench.json
```

- [ ] **Step 6: Run final verification**

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm exec vitest run gui-v2/src/lib/userProfile.test.ts
pnpm --filter cobeing-gui build
```

Expected: test and build pass.

- [ ] **Step 7: Commit touched docs only**

Run from `D:\agent-codes\CoBeing` only if executing in an isolated branch/worktree and docs are inside that worktree. If root docs are outside the Git repository, do not run this commit step.

```powershell
git add ..\PROGRESS.md ..\PROGRESS-LITE.md ..\docs\项目信息\项目现状.md ..\docs\项目信息\使用说明.md ..\STRUCTURE.md
git commit -m "docs: record frontend theme profile update"
```

Expected: if the root docs are not in the Git repository, Git refuses to add them; record that limitation in the implementation summary instead.

---

## Final Verification Checklist

Run from `D:\agent-codes\CoBeing`:

```powershell
pnpm exec vitest run gui-v2/src/lib/userProfile.test.ts
pnpm --filter cobeing-gui build
rg -n "text-\[(9|10|11)px\]|bg-card2|border-border|bg-green-|bg-red-|bg-blue-|bg-gray-|bg-yellow-|focus:ring-2|ring-2" gui-v2/src/components
```

Expected:
- User profile helper tests pass.
- GUI production build passes.
- Static scan has no violations in touched UI files. Any remaining justified matches must be listed with file and reason.

Manual checks:
- Default Sakura Mint theme is still default.
- Workbench theme appears in Settings → Theme.
- Chat bubble colors change when switching themes.
- User nickname and avatar update in message bubbles.
- User avatar appears on the right; Butler/Agent/group member avatars appear on the left.
- Butler Global task panel, task receipt cards, quick actions, Agent enhancement tabs, and Extensions view remain visible and usable.

## Self-Review

Spec coverage:
- A as default layout: covered by Tasks 5, 6, 8, and 10.
- Theme-driven bubbles: covered by Tasks 4, 5, 6, and 10.
- B as theme: covered by Task 4.
- Left/right avatars: covered by Tasks 2, 5, 6, and 10.
- User nickname/avatar settings: covered by Tasks 1 and 3.
- New feature visibility: covered by Tasks 7, 8, and 10.
- Documentation sync: covered by Task 11.

Placeholder scan:
- This plan intentionally contains no incomplete implementation placeholders.

Type consistency:
- `UserProfile`, `UserAvatar`, `UserAvatarType`, `useUserProfileStore`, `ChatAvatar`, and `ChatMessageFrame` names are introduced before downstream tasks use them.
