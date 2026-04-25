import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import type { ViewType } from "@/lib/types";
import mainIcon from "@/assets/main-icon.png";

const NAV_ITEMS: { icon: string; view: ViewType; label: string }[] = [
  { icon: "🤖", view: "butler", label: "管家" },
  { icon: "👤", view: "agents", label: "智能体" },
  { icon: "👥", view: "groups", label: "群组" },
  { icon: "⚡", view: "skills", label: "技能" },
  { icon: "⚙️", view: "settings", label: "设置" },
];

export function NavBar() {
  const activeView = useSettingsStore((s) => s.activeView);
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return (
    <nav
      className="h-full flex flex-col items-center bg-surface-solid shrink-0 border-r border-bdr/30"
      style={{ width: 64, padding: "20px 0", gap: 8, boxShadow: "var(--shadow-surface)" }}
    >
      {totalUnread > 0 && (
        <div className="rounded-full bg-danger text-xs text-white flex items-center justify-center"
             style={{ width: 24, height: 24, marginBottom: 8 }}>
          {totalUnread > 99 ? "99+" : totalUnread}
        </div>
      )}

      <img
        src={mainIcon}
        alt="CoBeing"
        style={{ width: 36, height: 36, marginBottom: 12, display: "block", background: "none" }}
      />

      <div style={{ width: 24, height: 1, backgroundColor: "var(--color-bdr)", marginBottom: 12 }} />

      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          onClick={() => setActiveView(item.view)}
          className={cn(
            "rounded-xl flex items-center justify-center transition-all duration-150 relative",
            "hover:bg-hover",
            activeView === item.view
              ? "bg-accent/15 text-accent"
              : "text-txt-muted"
          )}
          style={{ width: 44, height: 44, fontSize: 20 }}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
