import { Settings } from "lucide-react";
import { SurfaceCard } from "@/components/layout/Surface";
import { startNewConversation } from "@/hooks/useChatPersistence";
import { ChatAvatar } from "./ChatAvatar";

/** 副标题：provider/model 未加载时显示「连接中…」，status 为空时隐藏状态段 */
function formatAgentSubtitle(provider?: string, model?: string, status?: string): string {
  if (!provider && !model) return "连接中…";
  const line = `${provider ?? "未知"} / ${model ?? "未知"}`;
  return status ? `${line} · ${status}` : line;
}

export function ChatHeader({ name, status, model, provider, connected, isGroup, memberCount, showConfigButton, configOpen, onToggleConfig, activeView, convId }: {
  name?: string; status?: string; model?: string; provider?: string;
  connected: boolean; isGroup: boolean; memberCount?: number;
  showConfigButton: boolean; configOpen: boolean; onToggleConfig: () => void; activeView: string;
  convId?: string | null;
}) {
  const statusColors: Record<string, string> = {
    idle: "bg-success", running: "bg-warning animate-pulse", error: "bg-danger",
  };

  return (
    <SurfaceCard className="flex items-center shrink-0" padding="16px 24px">
      {name ? (
        <>
          <div className="relative shrink-0">
            <ChatAvatar name={isGroup ? "群" : name} tone={isGroup ? "group" : "user"} />
            {!isGroup && status && (
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface-solid ${statusColors[status] ?? "bg-txt-muted"}`} />
            )}
          </div>
          <div className="min-w-0" style={{ marginLeft: 16 }}>
            <p className={`truncate text-sm font-medium ${isGroup ? "text-purple" : "text-txt"}`}>{name}</p>
            <p className="text-xs text-txt-muted" style={{ marginTop: 4 }}>
              {isGroup ? `${memberCount ?? 0} 成员` : formatAgentSubtitle(provider, model, status)}
            </p>
          </div>
        </>
      ) : (
        <div className="flex-1 text-center" style={{ padding: "8px 0" }}>
          <p className="text-sm text-txt-muted">
            {activeView === "butler" ? "管家已就绪" : "选择一个 Agent 或群组开始对话"}
          </p>
        </div>
      )}
      <div className="ml-auto flex items-center" style={{ gap: 12 }}>
        {showConfigButton && (
          <button
            onClick={() => { startNewConversation(convId ?? undefined); }}
            className="rounded-lg flex items-center justify-center text-sm transition-colors text-txt-sub hover:bg-hover hover:text-txt"
            style={{ padding: "8px 14px" }}
          >
            + 新对话
          </button>
        )}
        {showConfigButton && (
          <button
            onClick={onToggleConfig}
            className={`rounded-lg flex items-center justify-center text-sm transition-colors ${
              configOpen ? "bg-accent/15 text-accent" : "text-txt-muted hover:bg-hover hover:text-txt"
            }`}
            style={{ width: 36, height: 36 }}
          >
            <Settings size={16} />
          </button>
        )}
        <div className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-success" : "bg-danger"}`} />
        <span className="text-xs text-txt-muted">{connected ? "已连接" : "离线"}</span>
      </div>
    </SurfaceCard>
  );
}
