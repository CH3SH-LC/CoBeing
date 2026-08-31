//! 模型配置模块：读写 `<dataRoot>/model-config.json`（多来源 + 当前使用来源）。
//!
//! 文件结构（v2）：
//! ```json
//! {
//!   "sources": [
//!     { "id": "...", "name": "DeepSeek 官方", "api_key": "...", "base_url": "...", "model": "deepseek-v4-flash" }
//!   ],
//!   "active_source": "<id>"
//! }
//! ```
//! 旧格式（v2.0.2 单来源 {api_key, base_url, model}）读取时自动迁移为单来源（id="default"）。
//! 优先级：内核启动时**优先读此文件**的 active 来源（cli.ts），回退环境变量 `DEEPSEEK_API_KEY` 等。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 单个模型来源（与前端 JSON 字段一一对应；snake_case 由 Tauri 自动映射 camelCase 参数）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelSource {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
    /// 思考模式（2.0.9）：true=开启（thinking enabled）；缺省 false（关闭，快且稳）
    #[serde(default)]
    pub thinking_enabled: bool,
    /// 思考强度（思考开启时生效）：low / high / max；缺省 high
    #[serde(default)]
    pub reasoning_effort: String,
}

impl ModelSource {
    /// 是否已配置 API Key（有非空 key）
    pub fn has_api_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

/// 全部模型来源 + 当前使用来源 id（空 = 未激活任何来源）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelConfigs {
    #[serde(default)]
    pub sources: Vec<ModelSource>,
    #[serde(default)]
    pub active_source: String,
}

impl ModelConfigs {
    /// 当前激活的来源（id 匹配；无 → None）
    pub fn active(&self) -> Option<&ModelSource> {
        if self.active_source.is_empty() {
            return None;
        }
        self.sources.iter().find(|s| s.id == self.active_source)
    }

    /// 是否有任何来源
    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

/// 配置文件路径：`<dataRoot>/model-config.json`
pub fn config_path(data_root: &Path) -> PathBuf {
    data_root.join("model-config.json")
}

/// 旧格式（单来源：{api_key, base_url, model}）→ 新格式迁移
fn migrate_legacy(raw: &str) -> Option<ModelConfigs> {
    #[derive(Deserialize)]
    struct Legacy {
        #[serde(default)]
        api_key: String,
        #[serde(default)]
        base_url: String,
        #[serde(default)]
        model: String,
    }
    let legacy: Legacy = serde_json::from_str(raw).ok()?;
    // 新格式必有 sources 字段；旧格式无 → 迁移
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    if v.get("sources").is_some() {
        return None;
    }
    Some(ModelConfigs {
        sources: vec![ModelSource {
            id: "default".into(),
            name: "DeepSeek 官方".into(),
            api_key: legacy.api_key,
            base_url: legacy.base_url,
            model: legacy.model,
            ..Default::default()
        }],
        active_source: "default".into(),
    })
}

/// 读取配置：文件不存在 / JSON 解析失败 → 默认（容错，不阻塞启动）；旧格式自动迁移
pub fn load_config(path: &Path) -> ModelConfigs {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return ModelConfigs::default(),
    };
    if let Some(migrated) = migrate_legacy(&raw) {
        return migrated;
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写入配置：创建父目录 + 原子落盘（先写临时文件再改名，避免半写）
pub fn save_config(path: &Path, config: &ModelConfigs) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "配置路径无父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入配置失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存配置失败: {e}"))?;
    Ok(())
}

/// Tauri 命令：读取全部模型来源与当前使用来源（前端设置界面初始化用）
#[tauri::command]
pub fn get_model_configs(app: tauri::AppHandle) -> ModelConfigs {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    load_config(&config_path(&data_root))
}

/// Tauri 命令：保存（新增或更新）一个模型来源；若这是第一个来源则自动设为当前使用
#[tauri::command]
pub fn save_model_source(app: tauri::AppHandle, source: ModelSource) -> Result<(), String> {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    let path = config_path(&data_root);
    let mut cfg = load_config(&path);
    let id = source.id.trim().to_string();
    if id.is_empty() {
        return Err("来源 id 不能为空".to_string());
    }
    let was_empty = cfg.sources.is_empty();
    if let Some(existing) = cfg.sources.iter_mut().find(|s| s.id == id) {
        *existing = source;
    } else {
        cfg.sources.push(source);
    }
    if was_empty || cfg.active_source.is_empty() {
        cfg.active_source = id;
    }
    save_config(&path, &cfg)
}

/// Tauri 命令：设置当前使用的模型来源（须已存在）
#[tauri::command]
pub fn set_active_model_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    let path = config_path(&data_root);
    let mut cfg = load_config(&path);
    if !cfg.sources.iter().any(|s| s.id == id) {
        return Err(format!("模型来源不存在: {id}"));
    }
    cfg.active_source = id;
    save_config(&path, &cfg)
}

/// Tauri 命令：删除模型来源；若删除的是当前使用来源，则当前使用置空（内核回退环境变量）
#[tauri::command]
pub fn delete_model_source(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    let path = config_path(&data_root);
    let mut cfg = load_config(&path);
    let before = cfg.sources.len();
    cfg.sources.retain(|s| s.id != id);
    if cfg.sources.len() == before {
        return Err(format!("模型来源不存在: {id}"));
    }
    if cfg.active_source == id {
        cfg.active_source = String::new();
    }
    save_config(&path, &cfg)
}

/// 测试连接结果（前端「测试连接」按钮展示）
#[derive(Debug, Clone, serde::Serialize)]
pub struct TestConnectionResult {
    /// true = 真实调用成功；false = 失败（message 说明原因）
    pub ok: bool,
    pub message: String,
    pub status: Option<u16>,
}

/// Tauri 命令：真实调用模型 API 验证来源配置（2.0.7「测试连接」）。
/// 用来源的 base_url/api_key/model 发一个最小 chat/completions 请求：
/// 网络/DNS/鉴权/余额/模型名任何一环不通都会给出明确中文结果。
#[tauri::command]
pub fn test_model_source(app: tauri::AppHandle, source_id: String) -> Result<TestConnectionResult, String> {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    let path = config_path(&data_root);
    let cfg = load_config(&path);
    let source = cfg
        .sources
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("模型来源不存在: {source_id}"))?;
    if source.api_key.trim().is_empty() {
        return Ok(TestConnectionResult {
            ok: false,
            message: "未填写 API Key，无法测试".to_string(),
            status: None,
        });
    }
    let base = if source.base_url.trim().is_empty() {
        "https://api.deepseek.com".to_string()
    } else {
        source.base_url.trim().trim_end_matches('/').to_string()
    };
    let model = if source.model.trim().is_empty() {
        "deepseek-chat"
    } else {
        source.model.trim()
    };
    let url = format!("{base}/chat/completions");
    // 2.0.9：思考模式显式控制（来源配置；默认关闭）
    let body = if source.thinking_enabled {
        serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 32,
            "thinking": { "type": "enabled" },
            "reasoning_effort": if source.reasoning_effort.trim().is_empty() { "high" } else { source.reasoning_effort.trim() },
        })
    } else {
        serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 16,
            "thinking": { "type": "disabled" },
        })
    };
    // ureq 3.4：Agent::config_builder 配超时；4xx/5xx 默认返回 Ok(Response)（http_status_as_error=false）
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(10)))
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .build()
        .into();
    let response = agent
        .post(&url)
        .header("Authorization", &format!("Bearer {}", source.api_key.trim()))
        .header("Content-Type", "application/json")
        .send_json(&body);
    match response {
        Ok(mut resp) => {
            let status = resp.status().as_u16();
            let text = resp.body_mut().read_to_string().unwrap_or_default();
            if status >= 200 && status < 300 {
                // 2xx：内容是否可用（推理模型可能 content 为空 → 提示）
                let has_content = text.contains("\"content\"");
                let note = if has_content {
                    "连接成功：模型可正常调用".to_string()
                } else {
                    format!("连接成功（HTTP {status}），但响应未含正文——推理模型（deepseek-v4-flash）可能返回空 content，工具调用建议 deepseek-chat")
                };
                return Ok(TestConnectionResult {
                    ok: true,
                    message: note,
                    status: Some(status),
                });
            }
            // 4xx/5xx：按状态分类（detail 取响应体）
            let detail = if text.is_empty() { format!("HTTP {status}") } else { text.chars().take(200).collect() };
            let message = match status {
                401 => "鉴权失败（HTTP 401）：API Key 无效或已过期".to_string(),
                402 => "余额不足（HTTP 402）：请前往模型服务商充值".to_string(),
                404 => "地址/模型不存在（HTTP 404）：请检查 Base URL 与模型名".to_string(),
                429 => "请求过于频繁（HTTP 429）：请稍后重试".to_string(),
                _ if status >= 500 => format!("模型服务端错误（HTTP {status}）：请稍后重试"),
                _ if text.contains("model") && (text.contains("not found") || text.contains("does not exist")) => {
                    format!("模型不存在：{model}（HTTP {status}），请检查模型名")
                }
                _ => format!("模型请求被拒绝（HTTP {status}）：{detail}"),
            };
            Ok(TestConnectionResult {
                ok: false,
                message,
                status: Some(status),
            })
        }
        Err(e) => {
            // 传输层错误（DNS/超时/拒绝/TLS）：按文本分类
            let msg = e.to_string();
            let message = if msg.contains("dns") || msg.contains("resolve") {
                "无法解析域名：请检查 Base URL 与网络".to_string()
            } else if msg.contains("timed out") || msg.contains("timeout") {
                "连接超时：请检查网络/代理（模型服务可达性）".to_string()
            } else if msg.contains("refused") {
                "连接被拒绝：请检查 Base URL".to_string()
            } else {
                format!("网络错误：{msg}")
            };
            Ok(TestConnectionResult {
                ok: false,
                message,
                status: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// 每个测试独立子目录（Rust 测试默认并行，共享目录会互相覆盖）
    fn temp_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "cobeing-model-config-test-{}-{n}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn source(id: &str, key: &str, model: &str) -> ModelSource {
        ModelSource {
            id: id.into(),
            name: format!("来源 {id}"),
            api_key: key.into(),
            base_url: String::new(),
            model: model.into(),
            ..Default::default()
        }
    }

    #[test]
    fn save_then_load_roundtrip_multiple_sources() {
        let dir = temp_dir();
        let path = config_path(&dir);
        let cfg = ModelConfigs {
            sources: vec![
                source("a", "sk-a", "deepseek-v4-flash"),
                source("b", "sk-b", "deepseek-v4-pro"),
            ],
            active_source: "b".into(),
        };
        save_config(&path, &cfg).expect("save ok");
        let loaded = load_config(&path);
        assert_eq!(loaded.sources.len(), 2);
        assert_eq!(loaded.active_source, "b");
        let active = loaded.active().expect("active");
        assert_eq!(active.api_key, "sk-b");
        assert_eq!(active.model, "deepseek-v4-pro");
    }

    #[test]
    fn load_missing_file_returns_empty() {
        let dir = temp_dir();
        let path = config_path(&dir.join("nonexistent-dir"));
        let cfg = load_config(&path);
        assert!(cfg.is_empty());
        assert!(cfg.active().is_none());
    }

    #[test]
    fn load_corrupt_json_returns_empty() {
        let dir = temp_dir();
        let path = config_path(&dir);
        std::fs::write(&path, "{ not valid json !!").expect("write");
        let cfg = load_config(&path);
        assert!(cfg.is_empty());
    }

    #[test]
    fn legacy_format_migrates_to_single_source() {
        let dir = temp_dir();
        let path = config_path(&dir);
        std::fs::write(
            &path,
            r#"{"api_key":"sk-legacy","base_url":"https://api.deepseek.com","model":"deepseek-v4-flash"}"#,
        )
        .expect("write");
        let cfg = load_config(&path);
        assert_eq!(cfg.sources.len(), 1);
        assert_eq!(cfg.sources[0].id, "default");
        assert_eq!(cfg.sources[0].name, "DeepSeek 官方");
        assert_eq!(cfg.sources[0].api_key, "sk-legacy");
        assert_eq!(cfg.active_source, "default");
        assert_eq!(cfg.active().expect("active").model, "deepseek-v4-flash");
    }

    #[test]
    fn legacy_empty_fields_migrate_but_no_key() {
        let dir = temp_dir();
        let path = config_path(&dir);
        std::fs::write(&path, r#"{"api_key":"","base_url":"","model":""}"#).expect("write");
        let cfg = load_config(&path);
        assert_eq!(cfg.sources.len(), 1);
        assert!(!cfg.sources[0].has_api_key());
    }

    #[test]
    fn save_source_creates_and_activates_first() {
        let dir = temp_dir();
        let path = config_path(&dir);
        let mut cfg = load_config(&path);
        assert!(cfg.is_empty());
        // 模拟 save_model_source 逻辑：第一个来源自动激活
        cfg.sources.push(source("a", "sk-a", "m1"));
        cfg.active_source = "a".into();
        save_config(&path, &cfg).expect("save");
        let loaded = load_config(&path);
        assert_eq!(loaded.active_source, "a");
        assert!(loaded.active().is_some());
    }

    #[test]
    fn active_returns_none_when_id_unknown() {
        let cfg = ModelConfigs {
            sources: vec![source("a", "sk-a", "m1")],
            active_source: "zzz".into(),
        };
        assert!(cfg.active().is_none());
    }

    #[test]
    fn active_returns_none_when_empty_id() {
        let cfg = ModelConfigs {
            sources: vec![source("a", "sk-a", "m1")],
            active_source: String::new(),
        };
        assert!(cfg.active().is_none());
    }
}
