import { useState } from "react";
import { useConfigStore, type McpEntry } from "@/stores/config";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ---- MCP 预设 ----

interface EnvFieldDef {
  key: string;
  label: string;
  hint: string;
  placeholder: string;
  required?: boolean;
}

interface McpPreset {
  id: string;
  nameZh: string;
  desc: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: EnvFieldDef[];
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: "github",
    nameZh: "GitHub",
    desc: "仓库管理、Issue/PR、文件读写、分支操作、搜索",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        label: "Personal Access Token",
        hint: "GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        required: true,
      },
    ],
  },
  {
    id: "word",
    nameZh: "Word 文档",
    desc: "读写 .docx 文档，支持段落、表格、样式操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-docx"],
    envFields: [],
  },
  {
    id: "excel",
    nameZh: "Excel 表格",
    desc: "读写 .xlsx 表格，支持公式、图表、数据操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-xlsx"],
    envFields: [],
  },
  {
    id: "powerpoint",
    nameZh: "PowerPoint 演示",
    desc: "读写 .pptx 演示文稿，支持幻灯片、布局、内容操作",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-pptx"],
    envFields: [],
  },
];

const EMPTY: McpEntry & { presetId?: string } = { name: "", transport: "stdio", command: "", args: [], url: "", presetId: "" };

export function McpSection() {
  const mcpServers = useConfigStore((s) => s.mcpServers);
  const updateMcp = useConfigStore((s) => s.updateMcp);
  const deleteMcp = useConfigStore((s) => s.deleteMcp);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: McpEntry & { presetId?: string } }>({ key: "", entry: EMPTY });

  const entries = Object.entries(mcpServers);

  const openAdd = () => { setEditing({ key: "", entry: { ...EMPTY } }); setEditOpen(true); };
  const handleEdit = (key: string) => { setEditing({ key, entry: { ...mcpServers[key] } }); setEditOpen(true); };

  const handlePresetSelect = (presetId: string) => {
    if (!presetId) {
      setEditing({ ...editing, entry: { ...EMPTY, presetId: "" } });
      return;
    }
    const preset = MCP_PRESETS.find(p => p.id === presetId);
    if (!preset) return;

    const env: Record<string, string> = {};
    for (const f of preset.envFields) {
      env[f.key] = "";
    }

    setEditing({
      ...editing,
      entry: {
        ...editing.entry,
        presetId,
        transport: preset.transport,
        command: preset.command,
        args: [...preset.args],
        env: Object.keys(env).length > 0 ? env : undefined,
      },
    });
  };

  const handleSave = () => {
    let name = editing.key || editing.entry.name.trim();
    if (!name && editing.entry.presetId) {
      name = editing.entry.presetId;
    }
    if (!name) return;

    const { presetId: _, ...entryData } = editing.entry;
    updateMcp(name, { ...entryData, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 MCP 服务器 "${key}"？`)) deleteMcp(key);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">MCP 服务器</h2>
          <p className="text-sm text-txt-muted">MCP 工具服务器连接</p>
        </div>
        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted" style={{ padding: 24 }}>暂无 MCP 服务器</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map(([key, m]) => {
            const matchedPreset = MCP_PRESETS.find(
              p => p.command === m.command &&
                   JSON.stringify(p.args) === JSON.stringify(m.args)
            );
            return (
              <div key={key} className="flex items-center gap-3 rounded-lg bg-elevated" style={{ padding: "14px 20px" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-txt">{key}</div>
                  <div className="text-sm text-txt-muted">
                    {matchedPreset?.nameZh || m.transport} · {m.transport === "stdio" ? m.command : m.url}
                  </div>
                </div>
                <button onClick={() => handleEdit(key)} className="text-sm text-txt-sub hover:text-accent">编辑</button>
                <button onClick={() => handleDelete(key)} className="text-sm text-txt-sub hover:text-danger">删除</button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{editing.key ? `编辑 ${editing.key}` : "添加 MCP 服务器"}</DialogTitle>
          </DialogHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* 预设选择（仅新增时） */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">选择预设</span>
                <select
                  value={editing.entry.presetId || ""}
                  onChange={(e) => handlePresetSelect(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                >
                  <option value="">-- 自定义 --</option>
                  {MCP_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.nameZh} — {p.desc}</option>
                  ))}
                </select>
              </label>
            )}

            {/* 名称（仅新增时） */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">名称（留空则使用预设 ID）</span>
                <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. my-github" />
              </label>
            )}

            {/* 预设信息（选择预设后） */}
            {!editing.key && editing.entry.presetId && (() => {
              const preset = MCP_PRESETS.find(p => p.id === editing.entry.presetId)!;
              return (
                <div className="rounded-lg bg-elevated" style={{ padding: "12px 16px" }}>
                  <div className="text-sm text-txt">
                    {preset.nameZh} <span className="text-txt-muted">· {preset.transport}</span>
                  </div>
                  <div className="text-sm text-txt-muted mt-1">
                    {preset.command} {(preset.args || []).join(" ")}
                  </div>
                  {preset.envFields.map(f => (
                    <label key={f.key} className="block mt-3">
                      <span className="text-sm text-txt-sub">
                        {f.label}
                        {f.required && <span className="text-danger ml-1">*</span>}
                      </span>
                      {f.hint && <div className="text-xs text-txt-muted mt-0.5 mb-1">{f.hint}</div>}
                      <input
                        type="password"
                        value={editing.entry.env?.[f.key] || ""}
                        onChange={(e) => setEditing({
                          ...editing,
                          entry: {
                            ...editing.entry,
                            env: { ...editing.entry.env, [f.key]: e.target.value },
                          },
                        })}
                        className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                        placeholder={f.placeholder}
                      />
                    </label>
                  ))}
                </div>
              );
            })()}

            {/* 自定义模式：完整配置表单 */}
            {!editing.key && !editing.entry.presetId && (
              <>
                <label className="block">
                  <span className="text-sm text-txt-sub">传输方式</span>
                  <select value={editing.entry.transport} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, transport: e.target.value as "stdio" | "http" } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                  </select>
                </label>
                {editing.entry.transport === "stdio" ? (
                  <>
                    <label className="block">
                      <span className="text-sm text-txt-sub">命令</span>
                      <input value={editing.entry.command || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, command: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="npx" />
                    </label>
                    <label className="block">
                      <span className="text-sm text-txt-sub">参数（逗号分隔）</span>
                      <input value={(editing.entry.args || []).join(", ")} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, args: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="-y, @modelcontextprotocol/server-filesystem" />
                    </label>
                  </>
                ) : (
                  <label className="block">
                    <span className="text-sm text-txt-sub">URL</span>
                    <input value={editing.entry.url || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, url: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="http://localhost:3000/mcp" />
                  </label>
                )}
              </>
            )}

            {/* 编辑模式：显示当前配置 */}
            {editing.key && (
              <>
                <div className="text-sm text-txt-muted">
                  传输: <span className="text-txt">{editing.entry.transport}</span>
                </div>
                {editing.entry.transport === "stdio" ? (
                  <>
                    <label className="block">
                      <span className="text-sm text-txt-sub">命令</span>
                      <input value={editing.entry.command || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, command: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                    </label>
                    <label className="block">
                      <span className="text-sm text-txt-sub">参数（逗号分隔）</span>
                      <input value={(editing.entry.args || []).join(", ")} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, args: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                    </label>
                    <label className="block">
                      <span className="text-sm text-txt-sub">环境变量（JSON）</span>
                      <input value={JSON.stringify(editing.entry.env || {})} onChange={(e) => { try { setEditing({ ...editing, entry: { ...editing.entry, env: JSON.parse(e.target.value) } }); } catch {} }} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder='{"KEY": "value"}' />
                    </label>
                  </>
                ) : (
                  <label className="block">
                    <span className="text-sm text-txt-sub">URL</span>
                    <input value={editing.entry.url || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, url: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                  </label>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setEditOpen(false)} className="h-9 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">取消</button>
            <button onClick={handleSave} className="h-9 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors">保存</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
