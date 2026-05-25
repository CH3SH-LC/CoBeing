import { create } from "zustand";
import type { SkillInfo } from "@/lib/types";

interface SkillsStore {
  skills: SkillInfo[];
  selectedSkill: string | null;
  executionResult: string | null;
  executing: boolean;

  setSkills: (skills: SkillInfo[]) => void;
  selectSkill: (name: string | null) => void;
  setExecutionResult: (result: string | null) => void;
  setExecuting: (val: boolean) => void;
}

export const useSkillsStore = create<SkillsStore>((set) => ({
  skills: [],
  selectedSkill: null,
  executionResult: null,
  executing: false,

  setSkills: (skills) => set({ skills }),
  selectSkill: (name) => set({ selectedSkill: name }),
  setExecutionResult: (result) => set({ executionResult: result }),
  setExecuting: (val) => set({ executing: val }),
}));
