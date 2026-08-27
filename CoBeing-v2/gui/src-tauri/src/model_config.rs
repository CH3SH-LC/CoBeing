//! 模型配置模块：读写 `<dataRoot>/model-config.json`（API Key / Base URL / 模型名）。
//!
//! 优先级：内核启动时**优先读此文件**（cli.ts），回退环境变量 `DEEPSEEK_API_KEY` 等。
//! 空字段语义：api_key 空 = 未配置（内核回退 env）；base_url 空 = 默认 DeepSeek；model 空 = 默认 deepseek-chat。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 模型配置（与前端 JSON 字段一一对应；snake_case 由 Tauri 自动映射 camelCase 参数）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

impl ModelConfig {
    /// 是否已配置 API Key（有非空 key）
    pub fn has_api_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

/// 配置文件路径：`<dataRoot>/model-config.json`
pub fn config_path(data_root: &Path) -> PathBuf {
    data_root.join("model-config.json")
}

/// 读取配置：文件不存在 / JSON 解析失败 → 返回默认（容错，不阻塞启动）
pub fn load_config(path: &Path) -> ModelConfig {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return ModelConfig::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 写入配置：创建父目录 + 原子落盘（先写临时文件再改名，避免半写）
pub fn save_config(path: &Path, config: &ModelConfig) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "配置路径无父目录".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let json = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("写入配置失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("保存配置失败: {e}"))?;
    Ok(())
}

/// Tauri 命令：读取当前模型配置（前端设置界面初始化用）
#[tauri::command]
pub fn get_model_config(app: tauri::AppHandle) -> ModelConfig {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    load_config(&config_path(&data_root))
}

/// Tauri 命令：保存模型配置（前端设置界面保存按钮）
#[tauri::command]
pub fn save_model_config(
    app: tauri::AppHandle,
    api_key: String,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let root = crate::resolve_root();
    let data_root = crate::resolve_data_root(&root, Some(&app));
    let config = ModelConfig {
        api_key: api_key.trim().to_string(),
        base_url: base_url.trim().to_string(),
        model: model.trim().to_string(),
    };
    save_config(&config_path(&data_root), &config)
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

    #[test]
    fn save_then_load_roundtrip() {
        let dir = temp_dir();
        let path = config_path(&dir);
        let cfg = ModelConfig {
            api_key: "sk-test-123".into(),
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
        };
        save_config(&path, &cfg).expect("save ok");
        let loaded = load_config(&path);
        assert_eq!(loaded.api_key, "sk-test-123");
        assert_eq!(loaded.base_url, "https://api.deepseek.com");
        assert_eq!(loaded.model, "deepseek-chat");
        assert!(loaded.has_api_key());
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = temp_dir();
        let path = config_path(&dir.join("nonexistent-dir"));
        let cfg = load_config(&path);
        assert_eq!(cfg.api_key, "");
        assert!(!cfg.has_api_key());
    }

    #[test]
    fn load_corrupt_json_returns_default() {
        let dir = temp_dir();
        let path = config_path(&dir);
        std::fs::write(&path, "{ not valid json !!").expect("write");
        let cfg = load_config(&path);
        assert_eq!(cfg.api_key, "");
        assert_eq!(cfg.model, "");
    }

    #[test]
    fn save_empty_config_clears_api_key() {
        let dir = temp_dir();
        let path = config_path(&dir);
        save_config(&path, &ModelConfig::default()).expect("save ok");
        let loaded = load_config(&path);
        assert!(!loaded.has_api_key());
        assert_eq!(loaded.model, "");
    }

    #[test]
    fn save_overwrites_previous() {
        let dir = temp_dir();
        let path = config_path(&dir);
        save_config(&path, &ModelConfig { api_key: "old".into(), ..Default::default() }).expect("save");
        save_config(&path, &ModelConfig { api_key: "new".into(), model: "m2".into(), ..Default::default() }).expect("save");
        let loaded = load_config(&path);
        assert_eq!(loaded.api_key, "new");
        assert_eq!(loaded.model, "m2");
    }
}
