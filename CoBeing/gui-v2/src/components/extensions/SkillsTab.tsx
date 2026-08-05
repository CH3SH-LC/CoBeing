import { useState, useEffect, useCallback, useMemo } from "react";
import { getWsClient } from "@/hooks/useWebSocket";
import { useExtensionsStore } from "@/stores/extensions";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/shared/ToggleSwitch";
import { SearchInput } from "@/components/shared/SearchInput";

interface SkillInfo {
  name: string;
  description?: string;
  toolCount?: number;
}

export function SkillsTab() {
  const selectedItem = useExtensionsStore((s) => s.selectedItem);
  const setSelectedItem = useExtensionsStore((s) => s.setSelectedItem);
  const searchQuery = useExtensionsStore((s) => s.searchQuery);
  const setSearchQuery = useExtensionsStore((s) => s.setSearchQuery);

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillWhitelist, setSkillWhitelist] = useState<Set<string>>(new Set());
  const [skillDoc, setSkillDoc] = useState<string>("");
  // 技能执行：任务输入 / 执行中状态 / 结果与错误
  const [execOpen, setExecOpen] = useState(false);
  const [execTask, setExecTask] = useState("");
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // Fetch skills on mount
  const fetchSkills = useCallback(() => {
    const client = getWsClient();
    if (!client) return;
    client.send({ type: "get_skills", payload: {} });
  }, []);

  useEffect(() => {
    fetchSkills();
    // Listen for skill_list event
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.payload?.skills) {
        setSkills(detail.payload.skills);
      }
    };
    window.addEventListener("ws-skill-list", handler);
    return () => window.removeEventListener("ws-skill-list", handler);
  }, [fetchSkills]);

  // Fetch skill doc when selected
  useEffect(() => {
    if (!selectedItem) { setSkillDoc(""); return; }
    const client = getWsClient();
    if (!client) return;
    client.send({ type: "get_skill_doc", payload: { name: selectedItem } });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.payload?.name === selectedItem) {
        setSkillDoc(detail.payload.content ?? "");
      }
    };
    window.addEventListener("ws-skill-doc", handler);
    return () => window.removeEventListener("ws-skill-doc", handler);
  }, [selectedItem]);

  // Toggle skill — send update_config to modify skillWhitelist
  // Uses functional setState to avoid stale closure on skillWhitelist
  const toggleSkill = useCallback((name: string, enabled: boolean) => {
    setSkillWhitelist(prev => {
      const next = new Set(prev);
      if (enabled) next.add(name); else next.delete(name);
      const client = getWsClient();
      client?.send({ type: "update_config", payload: { path: "skillWhitelist", value: [...next] } });
      return next;
    });
  }, []);

  // 监听技能执行结果与全局错误（execute_skill 失败时后端广播 error）
  useEffect(() => {
    const onResult = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const p = detail?.payload;
      if (p?.name === selectedItem) {
        setExecResult(typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? ""));
        setExecError(null);
        setExecuting(false);
      }
    };
    const onError = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const p = detail?.payload;
      if (executing) {
        setExecError(p?.message || "执行失败，请检查后端日志");
        setExecuting(false);
      }
    };
    window.addEventListener("ws-skill-result", onResult);
    window.addEventListener("ws-error", onError);
    return () => {
      window.removeEventListener("ws-skill-result", onResult);
      window.removeEventListener("ws-error", onError);
    };
  }, [selectedItem, executing]);

  const handleExecute = useCallback(() => {
    const target = skills.find((s) => s.name === selectedItem);
    if (!target || !execTask.trim() || executing) return;
    setExecuting(true);
    setExecResult(null);
    setExecError(null);
    getWsClient()?.send({
      type: "execute_skill",
      payload: { name: target.name, task: execTask.trim() },
    });
  }, [skills, selectedItem, execTask, executing]);

  const handleSelect = useCallback((id: string) => () => setSelectedItem(id), [setSelectedItem]);

  const filtered = useMemo(() =>
    skills.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [skills, searchQuery]
  );

  const selected = skills.find(s => s.name === selectedItem);

  return (
    <div className="flex-1 flex min-h-0" style={{ gap: 16 }}>
      {/* Left: skill list */}
      <div className="w-60 shrink-0 rounded-xl bg-surface border border-bdr/40 flex flex-col"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <SearchInput placeholder="🔍 搜索技能..." value={searchQuery} onChange={setSearchQuery} />
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 8px 8px" }}>
          {filtered.map((skill) => (
            <button
              key={skill.name}
              onClick={handleSelect(skill.name)}
              className={cn(
                "w-full flex items-center justify-between rounded-lg text-sm transition-colors",
                selectedItem === skill.name
                  ? "bg-accent/10 text-accent"
                  : "text-txt-sub hover:bg-hover"
              )}
              style={{ padding: "14px 20px", marginBottom: 2 }}
            >
              <span className="truncate text-left">{skill.name}</span>
              <ToggleSwitch
                checked={skillWhitelist.has(skill.name)}
                onChange={(v) => toggleSkill(skill.name, v)}
              />
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center text-center" style={{ padding: "32px 8px", gap: 8 }}>
              <div className="text-3xl">📘</div>
              <p className="text-sm text-txt-muted">无匹配技能</p>
            </div>
          )}
        </div>
        {/* Create skill card */}
        <div style={{ padding: "4px 8px 8px" }}>
          <button
            onClick={() => setSelectedItem("__new__")}
            className="w-full rounded-lg border border-dashed border-accent/50 text-accent text-sm
                       hover:bg-accent/5 transition-colors"
            style={{ padding: "10px" }}
          >
            + 创建技能
          </button>
        </div>
      </div>

      {/* Right: detail window */}
      <div className="flex-1 rounded-xl bg-surface border border-bdr/40 overflow-y-auto"
           style={{ boxShadow: "var(--shadow-surface)", padding: 24 }}>
        {selectedItem === "__new__" ? (
          <CreateSkillForm onCreated={(name) => { fetchSkills(); setSelectedItem(name); }} />
        ) : selected ? (
          <div>
            <h3 className="text-lg font-semibold text-txt">{selected.name}</h3>
            {selected.description && (
              <p className="text-sm text-txt-muted mt-1">{selected.description}</p>
            )}
            {selected.toolCount != null && (
              <span className="inline-block mt-2 rounded-full px-3 py-0.5 text-xs bg-accent/10 text-accent">
                {selected.toolCount} 个工具
              </span>
            )}
            <div className="mt-6 p-4 rounded-xl bg-elevated">
              <pre className="text-sm text-txt-sub whitespace-pre-wrap font-mono">
                {skillDoc || "加载中..."}
              </pre>
            </div>
            {/* 执行技能：输入任务 → execute_skill → 展示结果 */}
            <div className="mt-6 rounded-xl bg-elevated border border-bdr/30" style={{ padding: 16 }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
                <span className="text-sm font-medium text-txt">执行技能</span>
                <button
                  onClick={() => setExecOpen(!execOpen)}
                  className="text-sm text-txt-muted hover:text-txt transition-colors rounded-lg hover:bg-hover"
                  style={{ padding: "6px 10px" }}
                >
                  {execOpen ? "收起 ▲" : "展开 ▼"}
                </button>
              </div>
              {execOpen && (
                <div className="flex flex-col" style={{ gap: 10 }}>
                  <textarea
                    value={execTask}
                    onChange={(e) => setExecTask(e.target.value)}
                    rows={3}
                    placeholder={`描述要交给「${selected.name}」处理的任务...`}
                    className="w-full rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 resize-none"
                    style={{ padding: "10px 14px" }}
                  />
                  <div className="flex items-center" style={{ gap: 12 }}>
                    <button
                      onClick={handleExecute}
                      disabled={!execTask.trim() || executing}
                      className="rounded-lg px-5 py-2 text-sm bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                    >
                      {executing ? "执行中..." : "开始执行"}
                    </button>
                    {executing && (
                      <span className="text-xs text-txt-muted inline-flex items-center gap-2">
                        <span className="inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        正在调用 LLM 处理...
                      </span>
                    )}
                  </div>
                  {execError && (
                    <div className="rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger" style={{ padding: "10px 14px" }}>
                      ⚠ {execError}
                    </div>
                  )}
                  {execResult !== null && (
                    <div className="rounded-lg bg-success/10 border border-success/30" style={{ padding: "10px 14px" }}>
                      <div className="text-xs font-medium text-success" style={{ marginBottom: 6 }}>✅ 执行完成</div>
                      <pre className="text-sm text-txt whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">{execResult}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-txt-muted">选择一项技能查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateSkillForm({ onCreated }: { onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    const client = getWsClient();
    client?.send({ type: "skill_create", payload: { name: name.trim(), description: desc.trim(), prompt: body } });
    onCreated(name.trim());
    setName("");
    setDesc("");
    setBody("");
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-txt mb-4">创建技能</h3>
      <div className="space-y-4 max-w-md">
        <div>
          <label className="text-sm text-txt-sub block mb-1">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
            placeholder="my-skill" />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">描述</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt"
            placeholder="技能描述..." />
        </div>
        <div>
          <label className="text-sm text-txt-sub block mb-1">SKILL.md 正文</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt font-mono"
            placeholder="# 技能名称\n\n技能指令..." />
        </div>
        <button onClick={handleCreate}
          className="rounded-lg px-4 py-2 text-sm bg-accent text-white hover:opacity-90">
          创建
        </button>
      </div>
    </div>
  );
}
