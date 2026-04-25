import { useState } from "react";
import { useConfigStore, type ChannelEntry, type ChannelBindTo } from "@/stores/config";
import { useAgentsStore } from "@/stores/agents";
import { useGroupsStore } from "@/stores/groups";
import { getWsClient } from "@/hooks/useWebSocket";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

// ---- 预设 ----

const CHANNEL_PRESETS = [
  {
    id: "qqbot",
    nameZh: "QQ 机器人",
    desc: "通过 QQ 官方 Bot API v2 网关接入，无需第三方框架",
    fields: ["qqbotAppId", "qqbotAppSecret"],
    required: ["qqbotAppId", "qqbotAppSecret"],
  },
  {
    id: "discord",
    nameZh: "Discord 机器人",
    desc: "通过 Bot Token 接入 Discord 服务器",
    fields: ["discordBotToken", "discordGuildId"],
    required: ["discordBotToken"],
  },
  {
    id: "feishu",
    nameZh: "飞书机器人",
    desc: "通过自建应用接入飞书，接收事件回调并回复消息",
    fields: ["feishuAppId", "feishuAppSecret", "feishuVerificationToken", "feishuEncryptKey", "feishuPort"],
    required: ["feishuAppId", "feishuAppSecret", "feishuVerificationToken"],
  },
] as const;

const FIELD_DEFS: Record<string, { label: string; hint: string; placeholder: string; required?: boolean }> = {
  // QQ Bot Official API v2
  qqbotAppId: {
    label: "App ID",
    hint: "QQ 开放平台 → 应用管理 → 基本信息 → AppID",
    placeholder: "1234567890",
    required: true,
  },
  qqbotAppSecret: {
    label: "App Secret",
    hint: "QQ 开放平台 → 应用管理 → 基本信息 → AppSecret",
    placeholder: "",
    required: true,
  },
  // Discord
  discordBotToken: {
    label: "Bot Token",
    hint: "在 Discord Developer Portal → Bot 页面获取",
    placeholder: "MTIzNDU2Nzg5...",
    required: true,
  },
  discordGuildId: {
    label: "服务器 ID（可选）",
    hint: "限定只监听某个服务器，留空则监听所有",
    placeholder: "1234567890123456789",
  },
  // 飞书
  feishuAppId: {
    label: "App ID",
    hint: "飞书开放平台 → 应用凭证",
    placeholder: "cli_a5xxxxxxxxxxxxx",
    required: true,
  },
  feishuAppSecret: {
    label: "App Secret",
    hint: "飞书开放平台 → 应用凭证",
    placeholder: "",
    required: true,
  },
  feishuVerificationToken: {
    label: "Verification Token",
    hint: "事件订阅 → 请求网址验证，用于验证回调来源",
    placeholder: "",
    required: true,
  },
  feishuEncryptKey: {
    label: "Encrypt Key（可选）",
    hint: "事件订阅加密密钥，未开启加密则留空",
    placeholder: "",
  },
  feishuPort: {
    label: "回调监听端口（可选）",
    hint: "本地 HTTP 回调服务端口，默认 8081",
    placeholder: "8081",
  },
};

const EMPTY: ChannelEntry = { name: "", enabled: true, type: "qqbot" };

function BindingLabel({ bindTo, agents, groups }: { bindTo?: ChannelBindTo; agents: { id: string; name: string }[]; groups: { id: string; name: string }[] }) {
  if (!bindTo) return <span className="text-txt-muted">未绑定</span>;
  if (bindTo.type === "agent") {
    const a = agents.find(x => x.id === bindTo.agentId);
    return <span className="text-accent">→ {a ? a.name : bindTo.agentId}</span>;
  }
  const g = groups.find(x => x.id === bindTo.groupId);
  return <span className="text-accent">→ {g ? g.name : bindTo.groupId}</span>;
}

export function ChannelsSection() {
  const channels = useConfigStore((s) => s.channels);
  const updateChannel = useConfigStore((s) => s.updateChannel);
  const deleteChannel = useConfigStore((s) => s.deleteChannel);
  const agents = useAgentsStore((s) => s.agents);
  const groups = useGroupsStore((s) => s.groups);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ChannelEntry }>({ key: "", entry: EMPTY });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const entries = Object.entries(channels).filter(([_key, ch]) => ch != null);

  const preset = CHANNEL_PRESETS.find(p => p.id === editing.entry.type);
  const fields = preset ? preset.fields.map(f => ({ key: f, ...FIELD_DEFS[f] })) : [];

  const openAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY } });
    setEditOpen(true);
  };

  const handleEdit = (key: string) => {
    setEditing({ key, entry: { ...channels[key] } });
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateChannel(name, { ...editing.entry, name });
    if (editing.entry.bindTo) {
      getWsClient()?.send({
        type: "bind_channel",
        payload: {
          channelName: name,
          targetType: editing.entry.bindTo.type,
          targetId: editing.entry.bindTo.agentId || editing.entry.bindTo.groupId,
        },
      });
    } else {
      getWsClient()?.send({
        type: "unbind_channel",
        payload: { channelName: name },
      });
    }
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    setDeleteTarget(key);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteChannel(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const updateField = (fieldKey: string, value: string) => {
    setEditing({ ...editing, entry: { ...editing.entry, [fieldKey]: value } });
  };

  const handlePresetSelect = (presetId: string) => {
    setEditing({ ...editing, entry: { ...EMPTY, name: editing.entry.name, type: presetId, bindTo: editing.entry.bindTo } });
  };

  // 绑定
  const bindType = editing.entry.bindTo?.type ?? "";
  const bindTargetId = editing.entry.bindTo?.agentId || editing.entry.bindTo?.groupId || "";

  const setBindType = (type: string) => {
    if (!type) {
      setEditing({ ...editing, entry: { ...editing.entry, bindTo: undefined } });
    } else {
      setEditing({
        ...editing,
        entry: {
          ...editing.entry,
          bindTo: type === "agent" ? { type: "agent" } : { type: "group" },
        },
      });
    }
  };

  const setBindTarget = (targetId: string) => {
    if (!targetId) return;
    setEditing({
      ...editing,
      entry: {
        ...editing.entry,
        bindTo: bindType === "agent"
          ? { type: "agent", agentId: targetId }
          : { type: "group", groupId: targetId },
      },
    });
  };

  const agentList = agents.map(a => ({ id: a.id, name: a.name }));
  const groupList = groups.map(g => ({ id: g.id, name: g.name }));

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="text-lg font-semibold text-txt">Channels</h2>
          <p className="text-sm text-txt-muted">消息渠道配置。每个渠道可绑定一个 Agent 或群组。</p>
        </div>
        <button onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted" style={{ padding: 24 }}>暂无 Channel</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {entries.map(([key, ch]) => {
            const chPreset = CHANNEL_PRESETS.find(p => p.id === ch.type);
            const connFields = chPreset ? chPreset.fields.filter(f => ch[f]) : [];
            return (
              <div key={key} className="flex items-center gap-3 rounded-lg bg-elevated" style={{ padding: "14px 20px" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-txt">{key}</div>
                  <div className="text-sm text-txt-muted truncate">
                    {chPreset?.nameZh || ch.type}
                    <span className="mx-1.5">·</span>
                    {ch.enabled
                      ? <span className="text-success">已启用</span>
                      : <span>已禁用</span>
                    }
                    <span className="mx-1.5">·</span>
                    <BindingLabel bindTo={ch.bindTo} agents={agentList} groups={groupList} />
                    {connFields.length > 0 && (
                      <span className="text-txt-muted ml-1.5 text-sm">
                        （{connFields.map(f => FIELD_DEFS[f]?.label || f).join("、")}已配置）
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => updateChannel(key, { ...ch, enabled: !ch.enabled })} className={`text-sm px-2.5 py-1 rounded-lg ${ch.enabled ? "bg-success/10 text-success" : "bg-input text-txt-muted"}`}>
                  {ch.enabled ? "启用" : "禁用"}
                </button>
                <button onClick={() => handleEdit(key)} className="text-sm text-txt-sub hover:text-accent">编辑</button>
                <button onClick={() => handleDelete(key)} className="text-sm text-txt-sub hover:text-danger">删除</button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent style={{ maxWidth: 600, padding: "28px 32px" }}>
          <DialogHeader>
            <DialogTitle>{editing.key ? `编辑 ${editing.key}` : "添加 Channel"}</DialogTitle>
          </DialogHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* 预设选择（仅新增时） */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">选择渠道类型</span>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) handlePresetSelect(e.target.value); }}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                >
                  <option value="">-- 选择渠道类型 --</option>
                  {CHANNEL_PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.nameZh} — {p.desc}</option>
                  ))}
                </select>
              </label>
            )}

            {/* 名称 */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">名称（英文标识符）</span>
                <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. my-qq-bot" />
              </label>
            )}

            {/* 当前类型 */}
            {editing.key && (
              <div>
                <div className="text-sm text-txt-muted">
                  类型: <span className="text-txt">{CHANNEL_PRESETS.find(p => p.id === editing.entry.type)?.nameZh || editing.entry.type}</span>
                </div>
                <div className="text-sm text-txt-muted mt-1">
                  {CHANNEL_PRESETS.find(p => p.id === editing.entry.type)?.desc}
                </div>
              </div>
            )}

            {/* 连接参数 */}
            {fields.map(f => (
              <label key={f.key} className="block">
                <span className="text-sm text-txt-sub">
                  {f.label}
                  {f.required && <span className="text-danger ml-1">*</span>}
                </span>
                {f.hint && <div className="text-sm text-txt-muted mt-0.5 mb-1">{f.hint}</div>}
                <input
                  value={(editing.entry[f.key] as string) || ""}
                  onChange={(e) => updateField(f.key, e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                  placeholder={f.placeholder}
                />
              </label>
            ))}

            {/* 绑定目标 */}
            <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 20, marginTop: 4 }}>
              <h3 className="text-sm font-medium text-txt mb-2">绑定目标</h3>
              <p className="text-sm text-txt-muted mb-4">每个 Channel 仅可绑定一个会话。收到的消息将路由到绑定的 Agent 或群组。</p>

              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setBindType("")}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${!bindType ? "bg-accent/10 text-accent border border-accent/30" : "bg-input border border-bdr text-txt-sub"}`}
                >
                  不绑定
                </button>
                <button
                  onClick={() => setBindType("agent")}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${bindType === "agent" ? "bg-accent/10 text-accent border border-accent/30" : "bg-input border border-bdr text-txt-sub"}`}
                >
                  Agent
                </button>
                <button
                  onClick={() => setBindType("group")}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${bindType === "group" ? "bg-accent/10 text-accent border border-accent/30" : "bg-input border border-bdr text-txt-sub"}`}
                >
                  群组
                </button>
              </div>

              {bindType === "agent" && (
                <label className="block">
                  <span className="text-sm text-txt-sub">选择 Agent</span>
                  <select value={bindTargetId} onChange={(e) => setBindTarget(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                    <option value="">-- 选择 Agent --</option>
                    {agentList.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
                  </select>
                </label>
              )}

              {bindType === "group" && (
                <label className="block">
                  <span className="text-sm text-txt-sub">选择群组</span>
                  <select value={bindTargetId} onChange={(e) => setBindTarget(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                    <option value="">-- 选择群组 --</option>
                    {groupList.map(g => <option key={g.id} value={g.id}>{g.name} ({g.id})</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-2">
            <button onClick={() => setEditOpen(false)} className="h-8 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">取消</button>
            <button onClick={handleSave} className="h-8 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors">保存</button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="删除 Channel"
        description={`确定要删除 Channel "${deleteTarget}" 吗？此操作不可撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
