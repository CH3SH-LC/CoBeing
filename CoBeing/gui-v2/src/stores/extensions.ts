import { create } from "zustand";
import type { ExtensionsTab } from "@/lib/types";

interface ExtensionsStore {
  activeTab: ExtensionsTab;
  selectedItem: string | null;
  searchQuery: string;

  setActiveTab: (tab: ExtensionsTab) => void;
  setSelectedItem: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
}

export const useExtensionsStore = create<ExtensionsStore>((set) => ({
  activeTab: "skills",
  selectedItem: null,
  searchQuery: "",

  setActiveTab: (tab) => set({ activeTab: tab, selectedItem: null, searchQuery: "" }),
  setSelectedItem: (id) => set({ selectedItem: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
