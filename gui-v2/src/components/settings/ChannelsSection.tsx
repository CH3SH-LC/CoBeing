import { useState } from "react";
import { useConfigStore, type ChannelEntry } from "@/stores/config";
import * as Dialog from "@radix-ui/react-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";

const CHANNEL_TYPES = ["onebot", "wecom", "feishu", "discord"] as const;

const TYPE_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  onebot: [
    { key: "wsUrl", label: "WebSocket URL", placeholder: "ws://localhost:6700" },
    { key: "botQQ", label: "Bot QQ", placeholder: "123456789" },
    { key: "accessToken", label: "Access Token", placeholder: "" },
  ],
  wecom: [
    { key: "wecomCorpId", label: "Corp ID", placeholder: "" },
    { key: "wecomAgentId", label: "Agent ID", placeholder: "" },
    { key: "wecomSecret", label: "Secret", placeholder: "" },
  ],
  feishu: [
    { key: "feishuAppId", label: "App ID", placeholder: "" },
    { key: "feishuAppSecret", label: "App Secret", placeholder: "" },
  ],
  discord: [
    { key: "discordBotToken", label: "Bot Token", placeholder: "" },
    { key: "discordGuildId", label: "Guild ID", placeholder: "" },
  ],
};

const EMPTY: ChannelEntry = { name: "", enabled: false, type: "onebot" };

export function ChannelsSection() {
  const channels = useConfigStore((s) => s.channels);
  const updateChannel = useConfigStore((s) => s.updateChannel);
  const deleteChannel = useConfigStore((s) => s.deleteChannel);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ChannelEntry }>({ key: "", entry: EMPTY });

  const entries = Object.entries(channels);
  const fields = TYPE_FIELDS[editing.entry.type] || [];

  const openAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY } });
    setEditOpen(true);
  };

  const handleEdit = (key: string) => {
    const ch = channels[key];
    setEditing({ key, entry: { ...ch } });
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateChannel(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    if (confirm(`确定删除 Channel "${key}"？`)) deleteChannel(key);
  };

  const updateField = (fieldKey: string, value: string) => {
    setEditing({ ...editing, entry: { ...editing.entry, [fieldKey]: value } });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-txt">Channels</h2>
          <p className="text-sm text-txt-muted">消息渠道配置</p>
        </div>
        <button onClick={openAdd} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="p-6 rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted">暂无 Channel</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, ch]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-txt">{key}</div>
                <div className="text-[11px] text-txt-muted">{ch.type} · {ch.enabled ? "已启用" : "已禁用"}</div>
              </div>
              <button onClick={() => updateChannel(key, { ...ch, enabled: !ch.enabled })} className={`text-xs px-2 py-1 rounded ${ch.enabled ? "bg-success/10 text-success" : "bg-bg-base text-txt-muted"}`}>
                {ch.enabled ? "启用" : "禁用"}
              </button>
              <button onClick={() => handleEdit(key)} className="text-xs text-txt-sub hover:text-accent">编辑</button>
              <button onClick={() => handleDelete(key)} className="text-xs text-txt-sub hover:text-danger">删除</button>
            </div>
          ))}
        </div>
      )}

      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <DialogPrimitive.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-bg-surface rounded-xl shadow-xl p-6 z-50 border border-bdr max-h-[80vh] overflow-y-auto">
            <Dialog.Title className="text-base font-semibold text-txt mb-4">
              {editing.key ? `编辑 ${editing.key}` : "添加 Channel"}
            </Dialog.Title>
            <div className="space-y-3">
              {!editing.key && (
                <label className="block">
                  <span className="text-xs text-txt-sub">名称</span>
                  <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" />
                </label>
              )}
              <label className="block">
                <span className="text-xs text-txt-sub">类型</span>
                <select value={editing.entry.type} onChange={(e) => {
                  const newType = e.target.value;
                  const newEntry: ChannelEntry = { ...editing.entry, type: newType, name: editing.entry.name, enabled: editing.entry.enabled };
                  setEditing({ ...editing, entry: newEntry });
                }} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                  {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              {fields.map(f => (
                <label key={f.key} className="block">
                  <span className="text-xs text-txt-sub">{f.label}</span>
                  <input value={(editing.entry[f.key] as string) || ""} onChange={(e) => updateField(f.key, e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder={f.placeholder} />
                </label>
              ))}
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
