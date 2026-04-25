import { useState } from "react";
import { useConfigStore, type ProviderEntry } from "@/stores/config";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

const EMPTY_ENTRY: ProviderEntry = { name: "", apiKeyEnv: "", type: "openai-compat", baseURL: "" };

// 厂商预设（与后端 PROVIDER_PRESETS 同步）
const PRESETS = [
  { id: "deepseek", nameZh: "DeepSeek", type: "openai-compat", apiKeyEnv: "DEEPSEEK_API_KEY", generalURL: "https://api.deepseek.com", codingURL: "https://api.deepseek.com" },
  { id: "zhipu", nameZh: "智谱 / GLM", type: "openai-compat", apiKeyEnv: "ZHIPU_API_KEY", generalURL: "https://open.bigmodel.cn/api/paas/v4", codingURL: "https://open.bigmodel.cn/api/coding/paas/v4" },
  { id: "qwen", nameZh: "通义千问", type: "openai-compat", apiKeyEnv: "QWEN_API_KEY", generalURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", codingURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "minimax", nameZh: "MiniMax", type: "openai-compat", apiKeyEnv: "MINIMAX_API_KEY", generalURL: "https://api.minimax.chat/v1", codingURL: "https://api.minimax.chat/v1" },
  { id: "volcengine", nameZh: "火山引擎 / 豆包", type: "openai-compat", apiKeyEnv: "VOLCENGINE_API_KEY", generalURL: "https://ark.cn-beijing.volces.com/api/v3", codingURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "moonshot", nameZh: "月之暗面 / Kimi", type: "openai-compat", apiKeyEnv: "MOONSHOT_API_KEY", generalURL: "https://api.moonshot.ai/v1", codingURL: "https://api.moonshot.ai/v1" },
  { id: "siliconflow", nameZh: "硅基流动", type: "openai-compat", apiKeyEnv: "SILICONFLOW_API_KEY", generalURL: "https://api.siliconflow.cn/v1", codingURL: "https://api.siliconflow.cn/v1" },
  { id: "openai", nameZh: "OpenAI", type: "openai-compat", apiKeyEnv: "OPENAI_API_KEY", generalURL: "https://api.openai.com/v1", codingURL: "https://api.openai.com/v1" },
  { id: "anthropic", nameZh: "Anthropic", type: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", generalURL: "", codingURL: "" },
  { id: "gemini", nameZh: "Google Gemini", type: "gemini", apiKeyEnv: "GEMINI_API_KEY", generalURL: "", codingURL: "" },
  { id: "grok", nameZh: "Grok / xAI", type: "openai-compat", apiKeyEnv: "XAI_API_KEY", generalURL: "https://api.x.ai/v1", codingURL: "https://api.x.ai/v1" },
];

export function ProvidersSection() {
  const providers = useConfigStore((s) => s.providers);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<{ key: string; entry: ProviderEntry }>({ key: "", entry: EMPTY_ENTRY });
  const [showKey, setShowKey] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const entries = Object.entries(providers);

  const handleAdd = () => {
    setEditing({ key: "", entry: { ...EMPTY_ENTRY } });
    setShowKey(false);
    setEditOpen(true);
  };

  const handleEdit = (key: string) => {
    setEditing({ key, entry: { ...providers[key] } });
    setShowKey(false);
    setEditOpen(true);
  };

  const handleSave = () => {
    const name = editing.key || editing.entry.name.trim();
    if (!name) return;
    updateProvider(name, { ...editing.entry, name });
    setEditOpen(false);
  };

  const handleDelete = (key: string) => {
    setDeleteTarget(key);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteProvider(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handlePresetSelect = (presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const plan = editing.entry.plan || "general";
    setEditing({
      key: "",
      entry: {
        ...editing.entry,
        name: preset.id,
        type: preset.type as ProviderEntry["type"],
        apiKeyEnv: preset.apiKeyEnv,
        baseURL: plan === "coding" ? preset.codingURL : preset.generalURL,
        plan,
      },
    });
  };

  const handlePlanChange = (plan: "general" | "coding") => {
    const preset = PRESETS.find(p => p.id === (editing.key || editing.entry.name));
    const newURL = preset
      ? (plan === "coding" ? preset.codingURL : preset.generalURL)
      : editing.entry.baseURL;
    setEditing({ ...editing, entry: { ...editing.entry, plan, baseURL: newURL || editing.entry.baseURL } });
  };

  const currentPreset = PRESETS.find(p => p.id === (editing.key || editing.entry.name));
  const hasPlanToggle = currentPreset && currentPreset.generalURL !== currentPreset.codingURL;

  const maskKey = (key: string) => {
    if (!key) return "";
    if (key.length <= 8) return "****";
    return key.slice(0, 4) + "****" + key.slice(-4);
  };

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div>
          <h2 className="text-lg font-semibold text-txt">Providers</h2>
          <p className="text-sm text-txt-muted">LLM 服务商配置</p>
        </div>
        <button onClick={handleAdd} className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90">+ 添加</button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-bdr text-center text-sm text-txt-muted" style={{ padding: 24 }}>暂无 Provider</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {entries.map(([key, p]) => {
            const preset = PRESETS.find(pr => pr.id === key);
            const keyStatus = p.apiKey
              ? `Key: ${maskKey(p.apiKey)}`
              : p._apiKeyResolved
                ? `${p.apiKeyEnv}: ${p._apiKeyResolved}`
                : p.apiKeyEnv
                  ? `${p.apiKeyEnv} (未设置)`
                  : "未配置 Key";
            return (
              <div key={key} className="flex items-center gap-3 rounded-lg bg-elevated" style={{ padding: "14px 20px" }}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-txt">{preset?.nameZh || key}</div>
                  <div className="text-sm text-txt-muted truncate">
                    {p.type || "openai-compat"} · {p.baseURL || "default"}
                    <span className="text-accent ml-2">{keyStatus}</span>
                    {p.plan === "coding" && <span className="ml-2 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">Coding</span>}
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
        <DialogContent style={{ maxWidth: 600, padding: "28px 32px" }}>
          <DialogHeader>
            <DialogTitle>{editing.key ? `编辑 ${editing.key}` : "添加 Provider"}</DialogTitle>
          </DialogHeader>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* 预设选择（仅新增时） */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">选择厂商</span>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) handlePresetSelect(e.target.value); }}
                  className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                >
                  <option value="">-- 选择预设 --</option>
                  {PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.nameZh}</option>
                  ))}
                </select>
              </label>
            )}

            {/* 名称 */}
            {!editing.key && (
              <label className="block">
                <span className="text-sm text-txt-sub">名称（英文标识符）</span>
                <input value={editing.entry.name} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, name: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. deepseek" />
              </label>
            )}

            {/* API Key */}
            <label className="block">
              <div className="flex items-center justify-between">
                <span className="text-sm text-txt-sub">API Key</span>
                {editing.entry.apiKey && (
                  <button onClick={() => setShowKey(!showKey)} className="text-xs text-accent hover:text-accent/80">
                    {showKey ? "隐藏" : "显示"}
                  </button>
                )}
              </div>
              <input
                type={showKey ? "text" : "password"}
                value={editing.entry.apiKey || ""}
                onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, apiKey: e.target.value } })}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50"
                placeholder="输入 API Key（留空则通过下方环境变量名读取）"
              />
              {!editing.entry.apiKey && editing.entry._apiKeyResolved && (
                <span className="text-xs text-txt-muted mt-1 block">
                  当前通过环境变量 {editing.entry.apiKeyEnv} 读取：{editing.entry._apiKeyResolved}
                </span>
              )}
            </label>

            {/* 环境变量名（备选） */}
            <label className="block">
              <span className="text-sm text-txt-sub">环境变量名（备选，优先使用上方直接输入的 Key）</span>
              <input value={editing.entry.apiKeyEnv} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, apiKeyEnv: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="e.g. DEEPSEEK_API_KEY" />
            </label>

            {/* 类型 */}
            <label className="block">
              <span className="text-sm text-txt-sub">类型</span>
              <select value={editing.entry.type} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, type: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50">
                <option value="openai-compat">OpenAI Compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>

            {/* Plan 选择 */}
            {hasPlanToggle && (
              <div className="block">
                <span className="text-sm text-txt-sub mb-2 block">计费方式</span>
                <div className="flex gap-3">
                  <button
                    onClick={() => handlePlanChange("general")}
                    className={`flex-1 py-2 rounded-lg text-sm transition-colors ${editing.entry.plan !== "coding" ? "bg-accent/10 text-accent border border-accent/30" : "bg-input border border-bdr text-txt-sub"}`}
                  >
                    按量计费
                  </button>
                  <button
                    onClick={() => handlePlanChange("coding")}
                    className={`flex-1 py-2 rounded-lg text-sm transition-colors ${editing.entry.plan === "coding" ? "bg-accent/10 text-accent border border-accent/30" : "bg-input border border-bdr text-txt-sub"}`}
                  >
                    Coding 计划
                  </button>
                </div>
              </div>
            )}

            {/* Base URL */}
            <label className="block">
              <span className="text-sm text-txt-sub">Base URL</span>
              <input value={editing.entry.baseURL || ""} onChange={(e) => setEditing({ ...editing, entry: { ...editing.entry, baseURL: e.target.value } })} className="mt-1 w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="https://api.openai.com/v1" />
            </label>
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
        title="删除 Provider"
        description={`确定要删除 Provider "${deleteTarget}" 吗？此操作不可撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
