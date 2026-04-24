import { useSettingsStore, type CloseBehavior } from "@/stores/settings";
import { ThemeSelector } from "./ThemeSelector";
import { ProvidersSection } from "./ProvidersSection";
import { ChannelsSection } from "./ChannelsSection";
import { McpSection } from "./McpSection";
import { LogsSection } from "./LogsSection";
import { SandboxMonitor } from "../sandbox/SandboxMonitor";
import { cn } from "@/lib/utils";
import mainIcon from "@/assets/main-icon.png";

const MENU_SECTIONS = [
  { id: "general" as const, label: "常规", group: "" },
  { id: "theme" as const, label: "主题", group: "" },
  { id: "providers" as const, label: "Providers", group: "连接" },
  { id: "channels" as const, label: "Channels", group: "连接" },
  { id: "mcp" as const, label: "MCP 服务器", group: "连接" },
  { id: "sandbox" as const, label: "沙箱监控", group: "运维" },
  { id: "logs" as const, label: "日志", group: "数据" },
  { id: "about" as const, label: "关于", group: "数据" },
];

export function SettingsView() {
  const settingsSection = useSettingsStore((s) => s.settingsSection);
  const setSettingsSection = useSettingsStore((s) => s.setSettingsSection);

  return (
    <div className="flex h-full" style={{ padding: 20, gap: 20 }}>
      {/* Left menu */}
      <div className="w-52 shrink-0 rounded-xl bg-surface overflow-y-auto border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)", padding: 20 }}>
        <div className="text-sm text-txt-muted font-medium" style={{ marginBottom: 16 }}>设置</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {MENU_SECTIONS.map((item, idx) => {
            const showGroup = item.group && (idx === 0 || MENU_SECTIONS[idx - 1].group !== item.group);
            return (
              <div key={item.id}>
                {showGroup && (
                  <div className="text-xs text-txt-muted" style={{ padding: "20px 12px 8px" }}>
                    ── {item.group} ──
                  </div>
                )}
                <button
                  onClick={() => setSettingsSection(item.id)}
                  className={cn(
                    "w-full text-left rounded-lg text-sm transition-colors",
                    settingsSection === item.id
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-txt-sub hover:bg-hover hover:text-txt"
                  )}
                  style={{ padding: "10px 12px" }}
                >
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right content — rounded container */}
      <div className="flex-1 rounded-xl bg-surface overflow-y-auto border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)", padding: 32 }}>
        {settingsSection === "general" && <GeneralSection />}
        {settingsSection === "theme" && <ThemeSection />}
        {settingsSection === "providers" && <ProvidersSection />}
        {settingsSection === "channels" && <ChannelsSection />}
        {settingsSection === "mcp" && <McpSection />}
        {settingsSection === "sandbox" && <SandboxSection />}
        {settingsSection === "logs" && <LogsSection />}
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

function SandboxSection() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">沙箱监控</h2>
      <p className="text-sm text-txt-muted mb-6">查看和管理智能体沙箱容器状态</p>
      <SandboxMonitor />
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
        <div className="p-4 rounded-xl bg-elevated">
          <label className="text-sm font-medium text-txt block mb-2">关闭行为</label>
          <select
            value={closeBehavior}
            onChange={(e) => setCloseBehavior(e.target.value as CloseBehavior)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            <option value="minimize">最小化到系统托盘</option>
            <option value="close">直接退出程序</option>
          </select>
          <p className="text-xs text-txt-muted mt-2">
            {closeBehavior === "minimize"
              ? "关闭窗口时程序将继续在后台运行"
              : "关闭窗口时程序将完全退出"}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-elevated">
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
                  notifications.enabled ? "bg-accent" : "bg-input border border-bdr"
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
                  notifications.sound ? "bg-accent" : "bg-input border border-bdr"
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

function AboutSection() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-4">关于</h2>
      <div className="space-y-3 max-w-md">
        <div className="p-4 rounded-xl bg-elevated flex items-center gap-3">
          <img src={mainIcon} alt="" style={{ width: 36, height: 36 }} />
          <div>
            <div className="text-xl font-bold text-accent font-display mb-1">CoBeing</div>
            <div className="text-sm text-txt-sub">多 Agent 协作框架</div>
          </div>
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
    <div className="p-3 rounded-xl bg-elevated">
      <div className="text-xs text-txt-muted">{label}</div>
      <div className="text-sm text-txt font-medium mt-0.5">{value}</div>
    </div>
  );
}
