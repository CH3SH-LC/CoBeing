//! 更新模块：从 GitHub Releases 检查最新版本、下载安装包、启动安装程序。
//!
//! 数据源：https://api.github.com/repos/CH3SH-LC/CoBeing/releases
//! 电脑端资产命名：CoBeing.v2_<版本>_x64-setup.exe

use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

pub const GITHUB_REPO: &str = "CH3SH-LC/CoBeing";
pub const GITHUB_API_RELEASES: &str = "https://api.github.com/repos/CH3SH-LC/CoBeing/releases";

/// GitHub Release 资产（仅解析需要的字段）
#[derive(Debug, Deserialize, Clone)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

/// GitHub Release（仅解析需要的字段）
#[derive(Debug, Deserialize, Clone)]
pub struct GithubRelease {
    pub tag_name: String,
    pub prerelease: bool,
    #[serde(default)]
    pub published_at: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub assets: Vec<GithubAsset>,
}

/// 电脑端更新信息（返回给前端）
#[derive(Debug, serde::Serialize)]
pub struct DesktopUpdateInfo {
    pub latest_tag: String,
    pub published_at: String,
    pub body: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_size: u64,
    pub has_update: bool,
    pub current_version: String,
}

/// 从 releases 数组中挑选最新的正式版（跳过 prerelease），并匹配电脑端安装包资产。
/// 返回 None 表示没有可用更新源。
pub fn pick_desktop_release(releases: &[GithubRelease]) -> Option<(&GithubRelease, &GithubAsset)> {
    for rel in releases {
        if rel.prerelease {
            continue;
        }
        // 电脑端安装包：CoBeing.v2_<version>_x64-setup.exe（同时兼容 x64 通用名）
        let asset = rel
            .assets
            .iter()
            .find(|a| a.name.ends_with("-setup.exe") || a.name.ends_with("_x64-setup.exe"));
        if let Some(a) = asset {
            return Some((rel, a));
        }
    }
    None
}

/// 简单版本号比较（v2.0.0 / 2.0.0 / 2.0.0-alpha.0 等；主.次.补丁数字段比较，忽略预发布后缀）
/// 返回 true 当 latest > current。
pub fn is_newer_version(latest: &str, current: &str) -> bool {
    fn parse(s: &str) -> Vec<i64> {
        let cleaned = s.trim().trim_start_matches('v');
        // 取前 3 段数字（主.次.补丁），忽略预发布段
        cleaned
            .split(['.', '-', '+'])
            .filter_map(|seg| seg.parse::<i64>().ok())
            .take(3)
            .collect()
    }
    let l = parse(latest);
    let c = parse(current);
    for i in 0..3 {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

/// 构造带超时的 ureq Agent（ureq 3 API：Agent::config_builder → build → into Agent）
fn build_agent(read_timeout_secs: u64) -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(10)))
        .timeout_global(Some(std::time::Duration::from_secs(read_timeout_secs)))
        .build();
    config.into()
}

/// 从 GitHub API 拉取 releases 列表（按时间倒序）
pub fn fetch_releases() -> Result<Vec<GithubRelease>, String> {
    let agent = build_agent(15);
    let resp = agent
        .get(GITHUB_API_RELEASES)
        .query("per_page", "10")
        .header("User-Agent", "CoBeing-Desktop-Updater")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("GitHub API 请求失败: {e}"))?;
    let mut body = resp.into_body();
    body.read_json::<Vec<GithubRelease>>()
        .map_err(|e| format!("GitHub API 响应解析失败: {e}"))
}

/// Tauri 命令：检查电脑端是否有新版本
#[tauri::command]
pub fn check_update(app: AppHandle) -> Result<DesktopUpdateInfo, String> {
    let current = app
        .package_info()
        .version
        .to_string()
        .trim_start_matches('v')
        .to_string();
    let releases = fetch_releases()?;
    let Some((rel, asset)) = pick_desktop_release(&releases) else {
        return Err("未找到可用的正式版 Release".to_string());
    };
    let latest_tag = rel.tag_name.clone();
    let has_update = is_newer_version(&latest_tag, &current);
    Ok(DesktopUpdateInfo {
        latest_tag,
        published_at: rel.published_at.clone(),
        body: rel.body.clone().unwrap_or_default(),
        asset_name: asset.name.clone(),
        asset_url: asset.browser_download_url.clone(),
        asset_size: asset.size,
        has_update,
        current_version: current,
    })
}

/// Tauri 命令：下载安装包到应用数据目录 `updates/`，返回本地路径。
/// 下载过程中通过 `update-progress` 事件向前端推送 {received, total}。
#[tauri::command]
pub async fn download_installer(
    app: AppHandle,
    url: String,
    asset_name: String,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    let updates_dir = data_dir.join("updates");
    std::fs::create_dir_all(&updates_dir).map_err(|e| format!("创建更新目录失败: {e}"))?;
    let dest: PathBuf = updates_dir.join(sanitize_filename(&asset_name));

    let agent = build_agent(60);
    let resp = agent
        .get(&url)
        .header("User-Agent", "CoBeing-Desktop-Updater")
        .header("Accept", "application/octet-stream")
        .call()
        .map_err(|e| format!("下载请求失败: {e}"))?;

    let total: u64 = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut reader = resp.into_body().into_reader();
    let mut file = File::create(&dest).map_err(|e| format!("创建文件失败: {e}"))?;
    let mut buf = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let handle = app.clone();
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("下载中断: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入文件失败: {e}"))?;
        received += n as u64;
        let _ = handle.emit("update-progress", serde_json::json!({ "received": received, "total": total }));
    }
    file.flush().map_err(|e| format!("刷盘失败: {e}"))?;
    Ok(dest.display().to_string())
}

/// Tauri 命令：启动已下载的 NSIS 安装程序（用户按安装向导完成升级）
#[tauri::command]
pub fn launch_installer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("安装包不存在: {path}"));
    }
    let mut cmd = Command::new(&p);
    #[cfg(target_os = "windows")]
    cmd.arg("/S"); // 静默安装（NSIS 支持 /S）；如需向导移除该参数
    #[cfg(not(target_os = "windows"))]
    let _ = &mut cmd;
    cmd.spawn().map_err(|e| format!("启动安装程序失败: {e}"))?;
    Ok(())
}

/// 资产名安全化（仅保留文件名，防路径穿越）
fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    base.chars()
        .filter(|c| c.is_alphanumeric() || ". _-".contains(*c))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> GithubAsset {
        GithubAsset {
            name: name.to_string(),
            browser_download_url: format!("https://example.com/{name}"),
            size: 100,
        }
    }

    fn release(tag: &str, prerelease: bool, assets: Vec<GithubAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: tag.to_string(),
            prerelease,
            published_at: "2026-01-01T00:00:00Z".to_string(),
            body: Some("notes".to_string()),
            assets,
        }
    }

    #[test]
    fn pick_desktop_release_skips_prerelease_and_picks_setup_exe() {
        let releases = vec![
            release("v2.0.0-alpha.0", true, vec![asset("CoBeing-mobile-v2.0.0-alpha-debug.apk")]),
            release("v1.4.0", false, vec![asset("CoBeing-v1.4.0.zip")]),
            release("v2.0.0", false, vec![
                asset("CoBeing-mobile-v2.0.0-debug.apk"),
                asset("CoBeing.v2_2.0.0_x64-setup.exe"),
            ]),
        ];
        let (rel, a) = pick_desktop_release(&releases).expect("should pick");
        assert_eq!(rel.tag_name, "v2.0.0");
        assert_eq!(a.name, "CoBeing.v2_2.0.0_x64-setup.exe");
    }

    #[test]
    fn pick_desktop_release_none_when_all_prerelease() {
        let releases = vec![release("v2.0.0-alpha.0", true, vec![asset("x-setup.exe")])];
        assert!(pick_desktop_release(&releases).is_none());
    }

    #[test]
    fn is_newer_version_compares_major_minor_patch() {
        assert!(is_newer_version("v2.1.0", "2.0.0"));
        assert!(is_newer_version("v2.0.1", "2.0.0"));
        assert!(is_newer_version("v10.0.0", "v9.9.9"));
        assert!(!is_newer_version("v2.0.0", "2.0.0"));
        assert!(!is_newer_version("v1.9.0", "2.0.0"));
        assert!(!is_newer_version("v2.0.0-alpha.0", "2.0.0"));
        assert!(is_newer_version("v2.0.1", "2.0.0-alpha.1"));
    }

    #[test]
    fn sanitize_filename_strips_paths() {
        assert_eq!(sanitize_filename("CoBeing.v2_2.0.0_x64-setup.exe"), "CoBeing.v2_2.0.0_x64-setup.exe");
        assert_eq!(sanitize_filename("../../evil.exe"), "evil.exe");
        assert_eq!(sanitize_filename("a\\b\\c.exe"), "c.exe");
    }
}
