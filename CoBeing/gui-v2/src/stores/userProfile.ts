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
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn("Failed to persist user profile", error);
  }
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
