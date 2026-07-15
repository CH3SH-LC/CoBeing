import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getWsClient } from "@/hooks/useWebSocket";
import { useConfigStore } from "@/stores/config";
import { usePluginsStore } from "@/stores/plugins";

const PERMISSIONS = ["full-access", "basic-access", "workspace-access", "workspace-readwrite", "read-only"] as const;

const TAG_LABELS: Record<string, string> = {
  coding: "代码",
  reasoning: "推理",
  fast: "快速",
  flagship: "旗舰",
  "long-context": "长文本",
  vision: "视觉",
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const configProviders = useConfigStore((s) => s.providers);
  const pluginProviders = usePluginsStore((s) => s.providers);
  const getModels = usePluginsStore((s) => s.getModels);
  const pluginsLoaded = usePluginsStore((s) => s.loaded);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [permission, setPermission] = useState<string>("full-access");
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [networkMode, setNetworkMode] = useState<"all" | "whitelist" | "none">("all");
  const [allowDomains, setAllowDomains] = useState<string[]>([]);
  const [memoryLimit, setMemoryLimit] = useState("512m");
  const [cpuLimit, setCpuLimit] = useState(1);
  const [commandTimeout, setCommandTimeout] = useState(30);
  const [diskLimit, setDiskLimit] = useState("1g");
  const [securityEnabled, setSecurityEnabled] = useState(true);
  const [selectedImage, setSelectedImage] = useState("cobeing-sandbox:python");
  const [newDomain, setNewDomain] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const allProviders = useMemo(() => {
    const pluginIds = pluginProviders.map(p => p.id);
    const configIds = Object.keys(configProviders);
    const merged = new Set([...pluginIds, ...configIds]);
    return [...merged].sort();
  }, [pluginProviders, configProviders]);

  const models = useMemo(() => getModels(provider), [provider, getModels]);
  const canCreate = name.trim() && role.trim();

  const handleCreate = () => {
    if (!canCreate) return;

    getWsClient()?.send({
      type: "create_agent",
      payload: {
        name: name.trim(),
        role: role.trim(),
        provider,
        model,
        systemPrompt: systemPrompt.trim() || undefined,
        sandbox: {
          enabled: sandboxEnabled,
          filesystem: "isolated",
          network: {
            enabled: networkMode !== "none",
            mode: networkMode,
            allowDomains: allowDomains,
          },
          resources: {
            memory: memoryLimit,
            cpus: cpuLimit,
            timeout: commandTimeout,
            disk: diskLimit,
          },
          security: {
            enabled: securityEnabled,
            noNewPrivileges: securityEnabled,
            readOnlyRootfs: securityEnabled,
            dropAllCapabilities: securityEnabled,
          },
          image: selectedImage,
        },
      },
    });

    setName("");
    setRole("");
    setSystemPrompt("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>创建 Agent</DialogTitle>
          <DialogDescription>配置新 Agent 的基本信息和能力</DialogDescription>
        </DialogHeader>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 8 }}>
          <div>
            <label className="text-sm text-txt-sub mb-1 block">名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：React专家" className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50" />
          </div>

          <div>
            <label className="text-sm text-txt-sub mb-1 block">角色 *</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="例如：前端开发专家" className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-txt-sub mb-1 block">Provider</label>
              <Select value={provider} onValueChange={(v) => {
                setProvider(v);
                const m = getModels(v);
                if (m?.[0]) setModel(m[0].id);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allProviders.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!pluginsLoaded && (
                <div className="text-xs text-txt-muted mt-1">加载中...</div>
              )}
            </div>
            <div>
              <label className="text-sm text-txt-sub mb-1 block">Model</label>
              {models.length > 0 ? (
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                        {m.tags?.length ? ` (${m.tags.map(t => TAG_LABELS[t] || t).join("/")})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <input value={model} onChange={(e) => setModel(e.target.value)} className="w-full h-9 px-3 rounded-lg bg-input border border-bdr text-sm text-txt focus:outline-none focus:border-accent/50" placeholder="模型 ID" />
              )}
            </div>
          </div>

          <div>
            <label className="text-sm text-txt-sub mb-1 block">System Prompt (可选)</label>
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="自定义系统提示词..." rows={3} className="w-full px-3 py-2 rounded-lg bg-input border border-bdr text-sm text-txt placeholder:text-txt-muted focus:outline-none focus:border-accent/50 resize-none" />
          </div>

          <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-xs text-accent hover:text-accent/80 transition-colors">
            {showAdvanced ? "\u25BC" : "\u25B6"} 高级配置
          </button>

          {showAdvanced && (
            <div className="rounded-xl bg-elevated" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label className="text-sm text-txt-sub mb-1 block">权限模式</label>
                <Select value={permission} onValueChange={setPermission}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERMISSIONS.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-txt">Docker 沙箱</span>
                <Switch checked={sandboxEnabled} onCheckedChange={setSandboxEnabled} />
              </div>

              {sandboxEnabled && (
                <>
                  {/* 网络模式选择 */}
                  <div>
                    <label className="text-xs text-txt-sub mb-1 block">网络模式</label>
                    <select value={networkMode} onChange={(e) => setNetworkMode(e.target.value as any)}
                      className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                      <option value="all">全开</option>
                      <option value="whitelist">白名单</option>
                      <option value="none">全关</option>
                    </select>
                  </div>

                  {/* 域名白名单管理 */}
                  {networkMode === "whitelist" && (
                    <div className="rounded-lg bg-surface-solid p-3 space-y-2">
                      <label className="text-xs text-txt-sub block">域名白名单</label>
                      {allowDomains.map((domain, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-sm text-txt flex-1">{domain}</span>
                          <button onClick={() => setAllowDomains(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-xs text-danger hover:text-danger/80">删除</button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                          placeholder="输入域名" className="flex-1 h-7 px-2 rounded bg-input border border-bdr text-sm text-txt" />
                        <button onClick={() => { if (newDomain) { setAllowDomains(prev => [...prev, newDomain]); setNewDomain(""); } }}
                          className="h-7 px-3 rounded bg-accent text-white text-xs">添加</button>
                      </div>
                    </div>
                  )}

                  {/* 资源限制 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-txt-sub mb-1 block">内存限制</label>
                      <select value={memoryLimit} onChange={(e) => setMemoryLimit(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                        <option value="256m">256MB</option>
                        <option value="512m">512MB</option>
                        <option value="1g">1GB</option>
                        <option value="2g">2GB</option>
                        <option value="4g">4GB</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-txt-sub mb-1 block">CPU 核数</label>
                      <select value={cpuLimit} onChange={(e) => setCpuLimit(Number(e.target.value))}
                        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={4}>4</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-txt-sub mb-1 block">超时(秒)</label>
                      <input type="number" value={commandTimeout} min={5} max={300}
                        onChange={(e) => setCommandTimeout(Number(e.target.value))}
                        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt" />
                    </div>
                  </div>

                  {/* 磁盘限制和镜像选择 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-txt-sub mb-1 block">磁盘限制</label>
                      <select value={diskLimit} onChange={(e) => setDiskLimit(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                        <option value="128m">128MB</option>
                        <option value="256m">256MB</option>
                        <option value="512m">512MB</option>
                        <option value="1g">1GB</option>
                        <option value="2g">2GB</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-txt-sub mb-1 block">镜像</label>
                      <select value={selectedImage} onChange={(e) => setSelectedImage(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg bg-input border border-bdr text-sm text-txt">
                        <option value="cobeing-sandbox:base">base (Node.js)</option>
                        <option value="cobeing-sandbox:python">python (Node.js + Python)</option>
                        <option value="cobeing-sandbox:full">full (Node.js + Python + Go)</option>
                      </select>
                    </div>
                  </div>

                  {/* 安全加固开关 */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-txt">安全加固</span>
                    <Switch checked={securityEnabled} onCheckedChange={setSecurityEnabled} />
                  </div>
                </>
              )}

              {!sandboxEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-txt">网络访问</span>
                  <Switch checked={networkMode !== "none"} onCheckedChange={(v) => setNetworkMode(v ? "all" : "none")} />
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => onOpenChange(false)} className="h-10 px-4 rounded-lg text-sm text-txt-sub bg-hover hover:bg-elevated transition-colors">取消</button>
            <button onClick={handleCreate} disabled={!canCreate} className="h-10 px-4 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">创建</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
