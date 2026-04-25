import { useThemeStore } from "@/stores/theme";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

export function ThemeSelector() {
  const current = useThemeStore((s) => s.current);
  const presets = useThemeStore((s) => s.presets);
  const setTheme = useThemeStore((s) => s.setTheme);
  const exportTheme = useThemeStore((s) => s.exportTheme);
  const importTheme = useThemeStore((s) => s.importTheme);
  const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);
  const isCustomTheme = useThemeStore((s) => s.isCustomTheme);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const entries = Object.entries(presets);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportSuccess(false);
    const result = await importTheme(file);
    if (result.ok) {
      setImportSuccess(true);
      setTimeout(() => setImportSuccess(false), 3000);
    } else {
      setImportError(result.error || "导入失败");
    }
    // Reset input so same file can be re-imported
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-txt-muted font-medium">选择主题</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportTheme(current)}
            className="px-2.5 py-1 rounded-lg bg-elevated text-xs text-txt-sub hover:bg-hover transition-colors"
          >
            导出当前
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
          >
            导入主题
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </div>

      {importError && (
        <div className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{importError}</div>
      )}
      {importSuccess && (
        <div className="px-3 py-2 rounded-lg bg-success/10 text-success text-xs">主题导入成功</div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {entries.map(([id, preset]) => {
          const active = current === id;
          const custom = isCustomTheme(id);
          const s = preset.surface;
          const c = preset.content;

          return (
            <div key={id} className="flex items-stretch gap-2">
              <button
                onClick={() => setTheme(id)}
                className={cn(
                  "flex-1 flex items-center gap-4 p-3 rounded-xl transition-all text-left border",
                  active
                    ? "border-accent/50"
                    : "border-transparent hover:border-bdr/40"
                )}
                style={{
                  backgroundColor: s["bg-solid"],
                  boxShadow: active ? "var(--shadow-surface)" : "none",
                }}
              >
                {/* Color preview strip */}
                <div className="flex shrink-0 rounded-lg overflow-hidden" style={{ width: 48, height: 48 }}>
                  <div style={{ width: 12, height: 48, backgroundColor: preset.base["gradient-from"] }} />
                  <div style={{ width: 12, height: 48, backgroundColor: s["bg-solid"] }} />
                  <div style={{ width: 12, height: 48, backgroundColor: c.accent }} />
                  <div style={{ width: 12, height: 48, backgroundColor: c.purple }} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: c.txt }}>
                      {preset.name}
                    </span>
                    {active && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: c.accent, color: "#FFFFFF" }}
                      >
                        当前
                      </span>
                    )}
                    {custom && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-elevated text-txt-muted font-medium">
                        自定义
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: c["txt-muted"] }}>
                    {preset.description || "用户导入的主题"}
                  </div>
                </div>

                {/* Preview dots */}
                <div className="flex gap-1 shrink-0">
                  {[c.accent, c.purple, c.danger, c.warning, c.success].map((color, i) => (
                    <div
                      key={i}
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </button>

              {/* Delete button for custom themes */}
              {custom && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCustomTheme(id); }}
                  className="px-2 rounded-lg text-txt-muted hover:bg-danger/10 hover:text-danger transition-colors text-xs"
                  title="删除主题"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
