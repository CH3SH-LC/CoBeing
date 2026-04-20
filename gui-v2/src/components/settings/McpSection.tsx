import { useState } from "react";
import { useConfigStore, type McpEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const EMPTY: McpEntry = { name: "", transport: "stdio", command: "", args: [], url: "" };

export function McpSection() {
  const mcpServers = useConfigStore((s) => s.mcpServers);
  const updateMcp = useConfigStore((s) => s.updateMcp);
  const deleteMcp = useConfigStore((s) => s.deleteMcp);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: McpEntry }>({ key: "", entry: EMPTY });

  const entries = Object.entries(mcpServers);

  const openAdd = () => { setEditing({ key: "", entry: { ...EMPTY } }); setEditOpen(true); };
  const handleEdit = (key: string) => { setEditing({ key, entry: { ...mcpServers[key] } }); setEditOpen(true); };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateMcp(name, { ...editing.entry, name });
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
        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 MCP 服务器</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, m]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted">
                  {m.transport} · {m.transport === "stdio" ? m.command : m.url}
                </div>
              </div>
              <button onClick={() => handleEdit(key)} className="text-xs text-txt-sub hover:text-accent">编辑</button>
              <button onClick={() => handleDelete(key)} className="text-xs text-txt-sub hover:text-danger">删除</button>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-bg-surface rounded-xl shadow-xl p-6 z-50 border border-bdr">
            <Dialog.Title className="text-base font-semibold text-txt mb-4">
              {editing.key ? `编辑 ${editing.key}` : "添加 MCP 服务器"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">传输方式</span>
                <select value={editing.entry.transport} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, transport: e.target.value as "stdio" | "http" } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                </select>
              </label>
              {editing.entry.transport === "stdio" ? (
                <>
                  <label className="block">
                    <span className="text-xs text-txt-sub">命令</span>
                    <input value={editing.entry.command || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, command: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="npx" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-txt-sub">参数（逗号分隔）</span>
                    <input value={(editing.entry.args || []).join(", ")} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, args: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="-y, @modelcontextprotocol/server-filesystem" />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="text-xs text-txt-sub">URL</span>
                  <input value={editing.entry.url || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, url: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="http://localhost:3000/mcp" />
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditOpen(false)} className="px-4 py-2 rounded-lg text-xs text-txt-sub hover:bg-bg-hover">取消</button>
              <button onClick={handleSave} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">保存</button>
            </div>
          </DialogPrimitive.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
