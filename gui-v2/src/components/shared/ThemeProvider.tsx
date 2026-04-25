import { useEffect } from "react";
import { useThemeStore } from "@/stores/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const loadThemes = useThemeStore((s) => s.loadThemes);
  const loaded = useThemeStore((s) => s.loaded);

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  // Wait for theme to load before rendering, to avoid flash
  if (!loaded) {
    return null;
  }

  return <>{children}</>;
}
