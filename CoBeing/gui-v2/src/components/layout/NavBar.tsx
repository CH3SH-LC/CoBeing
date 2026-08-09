import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useChatStore } from "@/stores/chat";
import type { ViewType } from "@/lib/types";
import mainIcon from "@/assets/main-icon.png";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

const NAV_ITEMS: { icon: string; view: ViewType; label: string }[] = [
  { icon: "🤖", view: "butler", label: "管家" },
  { icon: "👤", view: "agents", label: "智能体" },
  { icon: "👥", view: "groups", label: "群组" },
  { icon: "📊", view: "dashboard", label: "仪表盘" },
  { icon: "🧩", view: "extensions", label: "扩展" },
  { icon: "⚙️", view: "settings", label: "设置" },
];

/** 常驻入口（决策 #11 / spec #6：GUI 只对外暴露管家） */
const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => i.view === "butler" || i.view === "settings");
/** 折叠入口（默认收进「⋯」菜单，进阶模式开关恢复全量） */
const COLLAPSED_NAV_ITEMS = NAV_ITEMS.filter((i) => i.view !== "butler" && i.view !== "settings");

function NavButton({ item, activeView, onSelect }: {
  item: { icon: string; view: ViewType; label: string };
  activeView: ViewType;
  onSelect: (view: ViewType) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item.view)}
      className={cn(
        "rounded-xl flex items-center justify-center transition-all duration-150 relative",
        "hover:bg-hover",
        activeView === item.view ? "bg-accent/15 text-accent" : "text-txt-muted",
      )}
      style={{ width: 44, height: 44, fontSize: 20 }}
      title={item.label}
    >
      {item.icon}
    </button>
  );
}

export function NavBar() {
  const activeView = useSettingsStore((s) => s.activeView);
  const setActiveView = useSettingsStore((s) => s.setActiveView);
  const advancedNav = useSettingsStore((s) => s.advancedNav);
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

      {advancedNav ? (
        NAV_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} activeView={activeView} onSelect={setActiveView} />
        ))
      ) : (
        <>
          {PRIMARY_NAV_ITEMS.map((item) => (
            <NavButton key={item.view} item={item} activeView={activeView} onSelect={setActiveView} />
          ))}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={cn(
                  "rounded-xl flex items-center justify-center transition-all duration-150",
                  "hover:bg-hover text-txt-muted",
                )}
                style={{ width: 44, height: 44, fontSize: 20 }}
                title="更多"
                aria-label="更多"
              >
                ⋯
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="right"
                align="start"
                sideOffset={6}
                className="bg-surface-solid border border-bdr/50 rounded-xl shadow-xl z-[70]"
                style={{ padding: 6, minWidth: 140 }}
              >
                {COLLAPSED_NAV_ITEMS.map((item) => (
                  <DropdownMenu.Item
                    key={item.view}
                    onSelect={() => setActiveView(item.view)}
                    className={cn(
                      "outline-none cursor-pointer rounded-lg flex items-center transition-colors",
                      "text-sm hover:bg-hover",
                      activeView === item.view ? "text-accent font-medium" : "text-txt-sub",
                    )}
                    style={{ padding: "9px 12px", gap: 10 }}
                  >
                    <span style={{ fontSize: 16 }}>{item.icon}</span>
                    <span>{item.label}</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </>
      )}
    </nav>
  );
}
