import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings";

const VIEW_KEYS = ["butler", "agents", "groups", "skills", "settings"] as const;

export function useKeyboardShortcuts() {
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const setCreateAgentDialogOpen = useSettingsStore((s) => s.setCreateAgentDialogOpen);
  const setCreateGroupDialogOpen = useSettingsStore((s) => s.setCreateGroupDialogOpen);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl+1~5: switch view
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const idx = parseInt(e.key) - 1;
        if (idx >= 0 && idx < VIEW_KEYS.length) {
          e.preventDefault();
          setActiveView(VIEW_KEYS[idx]);
          return;
        }
      }

      // Ctrl+N: new agent/group
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        const activeView = useSettingsStore.getState().activeView;
        if (activeView === "groups") {
          setCreateGroupDialogOpen(true);
        } else {
          setCreateAgentDialogOpen(true);
        }
        return;
      }

      // Escape: close detail panel
      if (e.key === "Escape") {
        setDetailPanelOpen(false);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveView, setCreateAgentDialogOpen, setCreateGroupDialogOpen, setDetailPanelOpen]);
}
