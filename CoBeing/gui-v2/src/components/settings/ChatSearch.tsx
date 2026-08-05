import { useState, useEffect, useCallback } from "react";
import { getWsClient } from "../../hooks/useWebSocket";

interface SearchResult {
  id: number;
  session: string;
  role: string;
  content: string;
  snippet?: string;
  tool_name: string | null;
  timestamp: number;
}

export function ChatSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(() => {
    if (!query.trim()) return;
    setLoading(true);
    const ws = getWsClient();
    ws?.send({ type: "search_conversation", payload: { query: query.trim() } });
  }, [query]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === "search_results") {
        setResults(msg.payload?.results || []);
        setLoading(false);
        setSearched(true);
      }
    };
    window.addEventListener("ws-search-results", handler);
    return () => window.removeEventListener("ws-search-results", handler);
  }, []);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* 搜索框 */}
      <div className="flex items-center rounded-xl bg-elevated border border-bdr/40" style={{ padding: 8, gap: 8 }}>
        <input
          className="flex-1 bg-transparent text-sm text-txt outline-none"
          style={{ padding: "10px 14px" }}
          placeholder="搜索对话历史..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSearched(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
        />
        <button
          className="rounded-lg bg-accent text-white text-sm font-medium"
          style={{ padding: "8px 16px" }}
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "搜索中..." : "搜索"}
        </button>
      </div>

      {/* 结果 */}
      <div className="flex flex-col" style={{ gap: 10 }}>
        {!searched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: 32, gap: 8 }}>
            <div className="text-3xl">🔍</div>
            <p className="text-sm text-txt-muted">输入关键词搜索全部对话历史，支持消息内容与工具调用</p>
          </div>
        )}
        {searched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: 32, gap: 8 }}>
            <div className="text-3xl">😕</div>
            <p className="text-sm text-txt-muted">无匹配结果，换个关键词试试</p>
          </div>
        )}

        {results.map((r) => {
          const display = r.snippet || r.content.slice(0, 200);
          const time = new Date(r.timestamp).toLocaleString("zh-CN");

          return (
            <div key={r.id} className="rounded-xl bg-elevated" style={{ padding: "14px 16px" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-accent">{r.role === "user" ? "用户" : r.role === "assistant" ? "助手" : r.tool_name || r.role}</span>
                <span className="text-xs text-txt-muted">{time}</span>
              </div>
              <p className="text-sm text-txt leading-relaxed whitespace-pre-wrap">
                <HighlightMatch text={display} query={query} />
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded px-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 30%, transparent)", color: "var(--color-warning-fg)" }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
