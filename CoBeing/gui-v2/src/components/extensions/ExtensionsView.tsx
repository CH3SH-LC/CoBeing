import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";
import type { ExtensionsTab } from "@/lib/types";
import { SkillsTab } from "./SkillsTab";
import { McpsTab } from "./McpsTab";
import { PluginsTab } from "./PluginsTab";
import { MarketTab } from "./MarketTab";

const TABS: { id: ExtensionsTab; label: string; icon: string }[] = [
  { id: "skills", label: "技能", icon: "📦" },
  { id: "mcps", label: "MCPs", icon: "🔌" },
  { id: "plugins", label: "插件", icon: "🧩" },
  { id: "market", label: "Market", icon: "🛍️" },
];

export function ExtensionsView() {
  const activeTab = useExtensionsStore((s) => s.activeTab);
  const setActiveTab = useExtensionsStore((s) => s.setActiveTab);

  return (
    <div className="flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex shrink-0 rounded-xl bg-elevated border border-bdr/30"
           style={{ padding: "4px", marginBottom: 18 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "text-sm font-medium transition-colors rounded-lg",
              activeTab === tab.id
                ? "bg-surface text-accent"
                : "text-txt-muted hover:bg-hover hover:text-txt"
            )}
            style={{ padding: "10px 16px" }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content area */}
      <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "mcps" && <McpsTab />}
        {activeTab === "plugins" && <PluginsTab />}
        {activeTab === "market" && <MarketTab />}
      </div>
    </div>
  );
}
