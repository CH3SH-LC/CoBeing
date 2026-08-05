import { useEffect, useRef, useState } from "react";
import { useAgentsStore } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings";
import { getWsClient } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AgentConfigTab } from "./AgentConfigTab";

// ── 管家形象区 ──

interface PersonaOption {
  id: string;
  name: string;
}

/** butler_get_personas 未响应（或主线程未接线）时的模板回退列表 */
const FALLBACK_PERSONAS: PersonaOption[] = [
  { id: "亲密朋友", name: "亲密朋友" },
  { id: "专业秘书", name: "专业秘书" },
  { id: "学习陪伴", name: "学习陪伴" },
  { id: "家庭助理", name: "家庭助理" },
];

/**
 * 响应接线契约（主线程在 useWebSocket 中注册并转发为 CustomEvent）：
 * - butler_personas     → window "ws-butler-personas"     {personas:[{id,name}], current}
 * - butler_persona_set  → window "ws-butler-persona-set"  {ok, persona, message?}
 * - butler_style_updated→ window "ws-butler-style-updated"{ok, message?}
 */
function ButlerPersonaSection() {
  const [personas, setPersonas] = useState<PersonaOption[]>(FALLBACK_PERSONAS);
  const [current, setCurrent] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [greeting, setGreeting] = useState("");
  const [applied, setApplied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const onPersonas = (e: Event) => {
      if (!mountedRef.current) return;
      const payload = (e as CustomEvent).detail?.payload;
      if (Array.isArray(payload?.personas) && payload.personas.length > 0) {
        setPersonas(payload.personas);
      }
      if (payload?.current) setCurrent(payload.current);
    };
    const onPersonaSet = (e: Event) => {
      if (!mountedRef.current) return;
      const payload = (e as CustomEvent).detail?.payload;
      if (payload?.ok && payload.persona) {
        setCurrent(payload.persona);
        setApplied(true);
        setTimeout(() => {
          if (mountedRef.current) setApplied(false);
        }, 2000);
      } else {
        setError(payload?.message ?? "模板应用失败");
      }
    };
    const onStyleUpdated = (e: Event) => {
      if (!mountedRef.current) return;
      const payload = (e as CustomEvent).detail?.payload;
      setSaving(false);
      if (payload?.ok) {
        setSaved(true);
        setTimeout(() => {
          if (mountedRef.current) setSaved(false);
        }, 2000);
      } else {
        setError(payload?.message ?? "保存失败");
      }
    };

    window.addEventListener("ws-butler-personas", onPersonas);
    window.addEventListener("ws-butler-persona-set", onPersonaSet);
    window.addEventListener("ws-butler-style-updated", onStyleUpdated);

    // 拉取当前模板列表（事件接线未完成时保持回退列表可用）
    getWsClient()?.send({ type: "butler_get_personas", payload: {} });

    return () => {
      mountedRef.current = false;
      window.removeEventListener("ws-butler-personas", onPersonas);
      window.removeEventListener("ws-butler-persona-set", onPersonaSet);
      window.removeEventListener("ws-butler-style-updated", onStyleUpdated);
    };
  }, []);

  const selectPersona = (id: string) => {
    setError(null);
    setCurrent(id); // 立即本地高亮，事件到达后补确认态
    getWsClient()?.send({ type: "butler_set_persona", payload: { persona: id } });
  };

  const handleSave = () => {
    setError(null);
    setSaving(true);
    getWsClient()?.send({
      type: "butler_update_style",
      payload: {
        nickname: nickname.trim() || undefined,
        greeting: greeting.trim() || undefined,
        apply: true,
      },
    });
    // 事件未接线时的降级：2s 后复位按钮（若事件已到则已复位，不影响确认态）
    setTimeout(() => {
      if (mountedRef.current) setSaving(false);
    }, 2000);
  };

  return (
    <div className="rounded-xl bg-elevated" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <span className="text-sm font-medium text-txt">管家形象</span>
        <span className="text-xs text-txt-muted" style={{ marginLeft: 8 }}>称呼、欢迎语与语气模板</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-txt-sub mb-1.5 block">称呼</label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="如：小管家"
            className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="text-sm text-txt-sub mb-1.5 block">欢迎语</label>
          <input
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder="管家开口的第一句话"
            className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      <div>
        <label className="text-sm text-txt-sub block" style={{ marginBottom: 8 }}>语气模板</label>
        <div className="grid grid-cols-2 gap-2">
          {personas.map((p) => {
            const active = current === p.id;
            return (
              <button
                key={p.id}
                onClick={() => selectPersona(p.id)}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-accent/15 text-accent font-medium"
                    : "bg-hover text-txt-sub hover:bg-elevated",
                )}
              >
                <span className="truncate">{p.name}</span>
                {active && <span className="text-xs shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
        {applied && <p className="text-xs text-success" style={{ marginTop: 8 }}>模板已应用</p>}
        {error && <p className="text-xs text-danger" style={{ marginTop: 8 }}>{error}</p>}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="h-10 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {saving ? "保存中..." : saved ? "✓ 已保存" : "保存形象设置"}
      </button>
    </div>
  );
}

// ── 管家配置浮层 ──

export function ButlerConfigPanel() {
  const detailPanelOpen = useSettingsStore((s) => s.detailPanelOpen);
  const setDetailPanelOpen = useSettingsStore((s) => s.setDetailPanelOpen);
  const activeView = useSettingsStore((s) => s.activeView);
  const agents = useAgentsStore((s) => s.agents);

  // Only show for butler view
  if (activeView !== "butler") return null;

  const butler = agents.find((a) => a.id === "butler");

  return (
    <Sheet open={detailPanelOpen && activeView === "butler"} onOpenChange={setDetailPanelOpen}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm">
                {"\u{1F916}"}
              </div>
              <div>
                <div className="text-base">管家配置</div>
                <div className="text-sm text-txt-muted font-normal">
                  {butler ? `${butler.provider}/${butler.model}` : "核心管理智能体"}
                </div>
              </div>
            </div>
          </SheetTitle>
        </SheetHeader>

        {butler && (
          <div className="flex-1 overflow-y-auto" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>
            <ButlerPersonaSection />
            <AgentConfigTab agent={butler} />
          </div>
        )}

        {!butler && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-txt-muted text-sm">管家 Agent 未找到</p>
              <p className="text-txt-muted text-xs mt-1">请检查后端连接状态</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
