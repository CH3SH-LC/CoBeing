import { useMemo, useState, useEffect } from "react";
import { useSettingsStore, type CloseBehavior } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { ThemeSelector } from "./ThemeSelector";
import { UserProfileSection } from "./UserProfileSection";
import { ProvidersSection } from "./ProvidersSection";
import { ChannelsSection } from "./ChannelsSection";
import { LogsSection } from "./LogsSection";
import { SandboxMonitor } from "../sandbox/SandboxMonitor";
import { ChatSearch } from "./ChatSearch";
import { getWsClient } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

const MENU_SECTIONS = [
  { id: "user" as const, label: "个人资料", group: "" },
  { id: "general" as const, label: "常规", group: "" },
  { id: "theme" as const, label: "主题", group: "" },
  { id: "providers" as const, label: "Providers", group: "连接" },
  { id: "channels" as const, label: "Channels", group: "连接" },
  { id: "sandbox" as const, label: "沙箱监控", group: "运维" },
  { id: "search" as const, label: "搜索对话", group: "数据" },
  { id: "logs" as const, label: "日志", group: "数据" },
  { id: "export" as const, label: "导出数据", group: "数据" },
  { id: "about" as const, label: "关于", group: "数据" },
];

export function SettingsView() {
  const settingsSection = useSettingsStore((s) => s.settingsSection);
  const setSettingsSection = useSettingsStore((s) => s.setSettingsSection);
  const pluginSettingsPanels = usePluginsStore((s) => s.settingsPanels);

  const dynamicMenuSections = useMemo(() => {
    if (pluginSettingsPanels.length === 0) return MENU_SECTIONS;
    return [
      ...MENU_SECTIONS,
      ...pluginSettingsPanels.map(ext => ({
        id: `plugin:${ext.id}` as any,
        label: ext.label,
        group: "插件",
      })),
    ];
  }, [pluginSettingsPanels]);

  return (
    <div className="flex h-full min-w-0 max-[760px]:flex-col" style={{ gap: 20 }}>
      {/* Left menu */}
      <div className="w-52 shrink-0 rounded-xl bg-elevated overflow-y-auto border border-bdr/30 max-[760px]:w-full max-[760px]:max-h-44"
           style={{ padding: 20 }}>
        <div className="text-sm text-txt-muted font-medium" style={{ marginBottom: 16 }}>设置</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {dynamicMenuSections.map((item, idx) => {
            const showGroup = item.group && (idx === 0 || dynamicMenuSections[idx - 1].group !== item.group);
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
      <div className="min-w-0 flex-1 overflow-y-auto"
           style={{ padding: 12 }}>
        {settingsSection === "user" && <UserProfileSection />}
        {settingsSection === "general" && <GeneralSection />}
        {settingsSection === "theme" && <ThemeSection />}
        {settingsSection === "providers" && <ProvidersSection />}
        {settingsSection === "channels" && <ChannelsSection />}
        {settingsSection === "sandbox" && <SandboxSection />}
        {settingsSection === "logs" && <LogsSection />}
        {settingsSection === "search" && <SearchSection />}
        {settingsSection === "export" && <ExportSection />}
        {settingsSection === "about" && <AboutSection />}

        {/* Plugin-provided settings panels */}
        {(() => {
          const match = pluginSettingsPanels.find(
            ext => settingsSection === `plugin:${ext.id}`
          );
          if (!match) return null;
          return (
            <div key={match.id}>
              <h2 className="text-lg font-semibold text-txt mb-1">{match.label}</h2>
              <p className="text-sm text-txt-muted mb-6">由插件提供</p>
              <div className="text-sm text-txt-muted">路径: {match.componentPath}</div>
            </div>
          );
        })()}
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
        <div className="rounded-xl bg-elevated border border-bdr/30" style={{ padding: 20 }}>
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

        <div className="rounded-xl bg-elevated border border-bdr/30" style={{ padding: 20 }}>
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

function SearchSection() {
  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">搜索对话</h2>
      <p className="text-sm text-txt-muted mb-6">全文搜索群组对话和 Agent 聊天历史</p>
      <ChatSearch />
    </div>
  );
}

function ExportSection() {
  const handleExport = (type: string, id?: string) => {
    const ws = getWsClient();
    ws?.send({ type: "export_data", payload: { exportType: type, exportAgentId: id, exportGroupId: id } });
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-txt mb-1">导出数据</h2>
      <p className="text-sm text-txt-muted mb-6">将 CoBeing 数据导出为 JSON 文件，便于备份和迁移</p>
      <div className="flex flex-col max-w-md" style={{ gap: 12 }}>
        <button
          onClick={() => handleExport("all")}
          className="rounded-xl bg-elevated text-left transition-colors hover:bg-hover"
          style={{ padding: "16px 20px" }}
        >
          <div className="text-sm font-medium text-txt">导出全部数据</div>
          <div className="text-xs text-txt-muted mt-1">包含所有 Agent、群组和配置</div>
        </button>
        <button
          onClick={() => handleExport("agent", "butler")}
          className="rounded-xl bg-elevated text-left transition-colors hover:bg-hover"
          style={{ padding: "16px 20px" }}
        >
          <div className="text-sm font-medium text-txt">导出管家数据</div>
          <div className="text-xs text-txt-muted mt-1">仅导出 butler Agent 数据</div>
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  const [version, setVersion] = useState("1.4.0");

  useEffect(() => {
    // Fetch version from get_config
    const client = getWsClient();
    if (client) {
      client.send({ type: "get_config", payload: {} });
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.version) {
        setVersion(detail.version);
      }
    };
    window.addEventListener("ws-config-loaded", handler);

    return () => window.removeEventListener("ws-config-loaded", handler);
  }, []);

  const handleTutorial = () => {
    const openFn = (window as any).__cobeingOpenTutorial;
    if (openFn) openFn();
  };

  return (
    <div className="flex flex-col items-center text-center" style={{ paddingTop: 40 }}>
      <div className="text-5xl mb-4">🦾</div>
      <h2 className="text-xl font-bold text-txt mb-1">CoBeing</h2>
      <div className="text-3xl font-extrabold text-accent mb-2">v{version}</div>
      <p className="text-sm text-txt-muted mb-6">多 Agent 协作框架</p>
      <div className="flex gap-4 text-xs text-txt-muted mb-8">
        <span>React + Tauri</span>
        <span>·</span>
        <span>TypeScript</span>
        <span>·</span>
        <span>WebSocket</span>
      </div>
      <button
        onClick={handleTutorial}
        className="rounded-xl px-6 py-2.5 text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
      >
        📖 重新打开教程
      </button>
    </div>
  );
}
