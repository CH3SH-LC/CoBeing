import { useSettingsStore, type CloseBehavior } from "@/stores/settings";
import { ThemeSelector } from "./ThemeSelector";
import { cn } from "@/lib/utils";

const MENU_SECTIONS = [
  { id: "general" as const, label: "常规", group: "" },
  { id: "theme" as const, label: "主题", group: "" },
  { id: "providers" as const, label: "Providers", group: "连接" },
  { id: "channels" as const, label: "Channels", group: "连接" },
  { id: "mcp" as const, label: "MCP 服务器", group: "连接" },
  { id: "logs" as const, label: "日志", group: "数据" },
  { id: "about" as const, label: "关于", group: "数据" },
];

export function SettingsView() {
  const settingsSection = useSettingsStore((s) => s.settingsSection);
  const setSettingsSection = useSettingsStore((s) => s.setSettingsSection);

  return (
    <div className="flex h-full">
      {/* Left menu */}
      <div className="w-52 shrink-0 border-r border-bdr bg-bg-surface p-3 space-y-0.5 overflow-y-auto">
        <div className="text-xs text-txt-muted font-medium px-3 py-2">设置</div>
        {MENU_SECTIONS.map((item, idx) => {
          const showGroup = item.group && (idx === 0 || MENU_SECTIONS[idx - 1].group !== item.group);
          return (
            <div key={item.id}>
              {showGroup && (
                <div className="text-[11px] text-txt-muted px-3 pt-4 pb-1">
                  ── {item.group} ──
                </div>
              )}
              <button
                onClick={() => setSettingsSection(item.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  settingsSection === item.id
                    ? "bg-accent/10 text-accent font-medium"
                    : "text-txt-sub hover:bg-bg-hover hover:text-txt"
                )}
              >
                {item.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Right content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {settingsSection === "general" && <GeneralSection />}
        {settingsSection === "theme" && <ThemeSection />}
        {settingsSection === "providers" && <PlaceholderSection title="Providers" desc="9 家 LLM 配置" />}
        {settingsSection === "channels" && <PlaceholderSection title="Channels" desc="4 个 Channel 配置" />}
        {settingsSection === "mcp" && <PlaceholderSection title="MCP 服务器" desc="添加/删除 MCP 连接" />}
        {settingsSection === "logs" && <PlaceholderSection title="日志" desc="实时日志流" />}
        {settingsSection === "about" && <AboutSection />}
      </div>
    </div>
  );
}

function ThemeSection() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">主题</h2>
      <p className="text-sm text-txt-muted mb-6">选择界面配色方案，即时预览</p>
      <ThemeSelector />
    </div>
  );
}

function GeneralSection() {
  const closeBehavior = useSettingsStore((s) => s.closeBehavior);
  const setCloseBehavior = useSettingsStore((s) => s.setCloseBehavior);
  const notifications = useSettingsStore((s) => s.notifications);
  const setNotifications = useSettingsStore((s) => s.setNotifications);

  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">常规</h2>
      <p className="text-sm text-txt-muted mb-6">应用行为和通知设置</p>

      <div className="space-y-6 max-w-md">
        {/* 关闭行为 */}
        <div>
          <label className="text-sm font-medium text-txt block mb-2">关闭行为</label>
          <select
            value={closeBehavior}
            onChange={(e) => setCloseBehavior(e.target.value as CloseBehavior)}
            className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-bdr text-sm text-txt focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            <option value="minimize">最小化到系统托盘</option>
            <option value="close">直接退出程序</option>
          </select>
          <p className="text-[11px] text-txt-muted mt-1">
            {closeBehavior === "minimize"
              ? "关闭窗口时程序将继续在后台运行"
              : "关闭窗口时程序将完全退出"}
          </p>
        </div>

        {/* 通知设置 */}
        <div>
          <label className="text-sm font-medium text-txt block mb-3">通知</label>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-sm text-txt-sub">新消息通知</span>
              <button
                role="switch"
                aria-checked={notifications.enabled}
                onClick={() => setNotifications({ enabled: !notifications.enabled })}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  notifications.enabled ? "bg-accent" : "bg-bg-elevated border border-bdr"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    notifications.enabled ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm text-txt-sub">通知声音</span>
              <button
                role="switch"
                aria-checked={notifications.sound}
                onClick={() => setNotifications({ sound: !notifications.sound })}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                  notifications.sound ? "bg-accent" : "bg-bg-elevated border border-bdr"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    notifications.sound ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </button>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaceholderSection({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">{title}</h2>
      <p className="text-sm text-txt-muted mb-6">{desc}</p>
      <div className="p-8 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">
        开发中...
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-4">关于</h2>
      <div className="space-y-3">
        <div className="p-4 rounded-xl bg-bg-elevated">
          <div className="text-xl font-bold text-accent font-display mb-1">MyAgents</div>
          <div className="text-sm text-txt-sub">多 Agent 协作框架</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="版本" value="0.1.0" />
          <InfoCard label="前端" value="React + Tauri" />
          <InfoCard label="后端" value="TypeScript Core" />
          <InfoCard label="协议" value="WebSocket" />
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-bg-elevated">
      <div className="text-[11px] text-txt-muted">{label}</div>
      <div className="text-sm text-txt font-medium mt-0.5">{value}</div>
    </div>
  );
}
