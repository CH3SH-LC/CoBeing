import { useState } from "react";
import { useConfigStore, type ProviderEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const EMPTY_ENTRY: ProviderEntry = { name: "", apiKeyEnv: "", type: "openai-compat", baseURL: "" };

export function ProvidersSection() {
  const providers = useConfigStore((s) => s.providers);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ProviderEntry }>({ key: "", entry: EMPTY_ENTRY });

  const entries = Object.entries(providers);

  const handleAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY_ENTRY } });
    setEditOpen(true);
  };

  const handleEdit = (key: string) => {
    setEditing({ key, entry: { ...providers[key] } });
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateProvider(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 Provider "${key}"？`)) deleteProvider(key);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">Providers</h2>
          <p className="text-sm text-txt-muted">LLM 服务商配置</p>
        </div>
        <button onClick={handleAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 Provider</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, p]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted truncate">
                  {p.type || "openai-compat"} · {p.baseURL || "default"} · <span className="text-accent">{p.apiKeyEnv}</span>
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
              {editing.key ? `编辑 ${editing.key}` : "添加 Provider"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称（英文标识符）</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. openai" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">API Key 环境变量</span>
                <input value={editing.entry.apiKeyEnv} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, apiKeyEnv: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. OPENAI_API_KEY" />
              </label>
              <label className="block">
                <span className="text-xs text-txt-sub">类型</span>
                <select value={editing.entry.type} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, type: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  <option value="openai-compat">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-txt-sub">Base URL（可选）</span>
                <input value={editing.entry.baseURL || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, baseURL: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="https://api.openai.com/v1" />
              </label>
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
