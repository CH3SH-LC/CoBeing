import { Fragment, useEffect, useState } from "react";
import { useSkillsStore } from "@/stores/skills";
import { getWsClient } from "@/hooks/useWebSocket";
import type { SkillInfo } from "@/lib/types";

export function SkillCenter() {
  const skills = useSkillsStore((s) => s.skills);
  const selectedSkill = useSkillsStore((s) => s.selectedSkill);
  const selectSkill = useSkillsStore((s) => s.selectSkill);
  const setSkills = useSkillsStore((s) => s.setSkills);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.skills) {
        setSkills(detail.payload.skills);
      }
    };
    window.addEventListener("ws-skill-list", handler);
    getWsClient()?.send({ type: "get_skills" });
    return () => window.removeEventListener("ws-skill-list", handler);
  }, [setSkills]);

  const filtered = search
    ? skills.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  const selected = skills.find((s) => s.name === selectedSkill);

  return (
    <div className="flex-1 flex h-full" style={{ padding: 20, gap: 20 }}>
      {/* Left panel: Skill list */}
      <div className="w-72 rounded-xl bg-surface flex flex-col overflow-hidden shrink-0 border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <input
            type="text"
            placeholder="搜索技能..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto" style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column" }}>
          {filtered.map((skill, i) => (
            <Fragment key={skill.name}>
              {i > 0 && <div style={{ height: 2, margin: "0 10px", borderRadius: 1, backgroundColor: "var(--color-divider)", flexShrink: 0 }} />}
              <SkillCard
                skill={skill}
                selected={selectedSkill === skill.name}
                onSelect={() => selectSkill(skill.name)}
              />
            </Fragment>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-xs text-txt-muted">
              {skills.length === 0 ? "暂无技能" : "无匹配结果"}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Skill detail */}
      <div className="flex-1 rounded-xl bg-surface overflow-hidden border border-bdr/40"
           style={{ boxShadow: "var(--shadow-surface)" }}>
        {selected ? (
          <SkillDetailPanel skill={selected} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <p className="text-2xl">{"\u26A1"}</p>
              <p className="text-lg text-accent font-bold font-display mt-2">技能中心</p>
              <p className="text-sm text-txt-muted mt-1">选择一个技能查看详情</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, selected, onSelect }: {
  skill: SkillInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left transition-colors rounded-lg ${
        selected ? "bg-elevated" : "hover:bg-hover"
      }`}
      style={{ padding: "14px 16px" }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-base shrink-0">
          {"\u26A1"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-txt font-medium truncate">{skill.name}</div>
        </div>
      </div>
    </button>
  );
}

function SkillDetailPanel({ skill }: { skill: SkillInfo }) {
  const [skillDoc, setSkillDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.payload?.name === skill.name && detail.payload?.content) {
        setSkillDoc(detail.payload.content);
        setLoading(false);
      }
    };
    window.addEventListener("ws-skill-doc", handler);
    return () => window.removeEventListener("ws-skill-doc", handler);
  }, [skill.name]);

  useEffect(() => {
    setLoading(true);
    setSkillDoc(null);
    getWsClient()?.send({
      type: "get_skill_doc",
      payload: { name: skill.name },
    });
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, [skill.name]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center shrink-0" style={{ padding: "20px 24px", gap: 16 }}>
        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-sm text-accent">
          {"\u26A1"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-txt">{skill.name}</p>
          <p className="text-xs text-txt-muted truncate">{skill.description}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 24px 24px" }}>
        {/* Skill metadata cards */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg bg-elevated" style={{ padding: 16 }}>
            <div className="text-xs text-txt-muted">名称</div>
            <div className="text-sm text-txt font-medium mt-0.5">{skill.name}</div>
          </div>
          <div className="rounded-lg bg-elevated" style={{ padding: 16 }}>
            <div className="text-xs text-txt-muted">工具数量</div>
            <div className="text-sm text-txt font-medium mt-0.5">{skill.tools.length}</div>
          </div>
        </div>

        {skill.tools.length > 0 && (
          <div className="mb-5">
            <div className="text-xs text-txt-muted mb-2">可用工具</div>
            <div className="flex flex-wrap gap-2">
              {skill.tools.map((tool) => (
                <span key={tool} className="px-3 py-1.5 rounded-lg bg-elevated text-xs text-txt-sub">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* SKILL.md document */}
        <div>
          <div className="text-xs text-txt-muted mb-2 font-medium">SKILL.md 核心文档</div>
          {loading ? (
            <div className="rounded-xl bg-elevated text-center" style={{ padding: 24 }}>
              <span className="text-sm text-txt-muted">加载中...</span>
            </div>
          ) : skillDoc ? (
            <div className="rounded-xl bg-elevated overflow-hidden">
              <div className="border-b border-bdr/50 flex items-center gap-2" style={{ padding: "10px 16px" }}>
                <span className="text-xs text-accent font-mono">SKILL.md</span>
                <span className="text-xs text-txt-muted ml-auto">{skill.name}</span>
              </div>
              <pre className="text-sm text-txt leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto max-h-[60vh] overflow-y-auto" style={{ padding: 20 }}>
                {skillDoc}
              </pre>
            </div>
          ) : (
            <div className="rounded-xl bg-elevated text-center" style={{ padding: 24 }}>
              <p className="text-sm text-txt-muted">暂无 SKILL.md 文档</p>
              <p className="text-xs text-txt-muted mt-1">该技能可能未配置核心文档</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
