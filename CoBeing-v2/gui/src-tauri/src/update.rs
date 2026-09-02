//! 更新模块：从 GitHub Releases 检查最新版本、下载安装包、启动安装程序。
//!
//! 数据源：https://api.github.com/repos/CH3SH-LC/CoBeing/releases
//! 电脑端资产命名：CoBeing.v2_<版本>_x64-setup.exe
//!
//! ## 下载可靠性（v2.0.12 修复，2026-09-02）
//!
//! 根因：旧实现 60s 全局超时 + 无续传 / 无镜像 / 无完整性校验——GitHub CDN 从国内网络
//! 吞吐常 <550KB/s，32MB 安装包 60 秒内必然下不完，每次都在 ~31.5MB 处被超时掐断
//! （现场证据：用户 updates/ 目录遗留 31,488,795/32,175,831 字节的残缺安装包，反复下载反复失败）。
//!
//! 修复：
//! 1. 多源链：直连 GitHub → 国内镜像（按实测可达性排序：gh.ddlc.top / ghfast.top / gh-proxy.com）
//! 2. Range 断点续传：失败残留自动从断点继续（手动跟随重定向，保证 Range 头直达最终主机）
//! 3. 读超时 30s（30s 无数据才判死，慢而持续可下完）+ 全局兜底 30min
//! 4. 按 GitHub 资产 size 校验完整性；残缺自动换源重试（3 轮）；全败清理残留文件

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

pub const GITHUB_REPO: &str = "CH3SH-LC/CoBeing";
pub const GITHUB_API_RELEASES: &str = "https://api.github.com/repos/CH3SH-LC/CoBeing/releases";

/// Gitee 国内镜像仓库（下载源链首选；每次发版把安装包推到其 dist 分支：dist/<tag>/<资产名>）
pub const GITEE_REPO: &str = "CH3SH-LC/CoBeing";
pub const GITEE_DIST_BRANCH: &str = "dist";

/// 由 tag + 资产名构造 Gitee 下载 URL（raw/{dist}/{tag}/{asset}）
pub fn gitee_asset_url(tag: &str, asset_name: &str) -> String {
    format!("https://gitee.com/{GITEE_REPO}/raw/{GITEE_DIST_BRANCH}/{tag}/{asset_name}")
}

/// 下载重试轮数（每轮依次尝试全部来源）
pub const MAX_DOWNLOAD_ROUNDS: usize = 3;

/// 国内镜像前缀（顺序 = 实测可达性；2026-09-02 实测仅 gh.ddlc.top 可用，其余保留兜底）
const MIRROR_PREFIXES: [&str; 3] = [
    "https://gh.ddlc.top/",
    "https://ghfast.top/",
    "https://gh-proxy.com/",
];

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
    /// Gitee 国内下载源（直连固定 URL；资产未上传时 404 自动落到 GitHub/镜像）
    pub gitee_url: String,
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

/// API 请求 Agent（Releases 列表小响应；连接 10s + 响应 15s + 全局 20s）
fn api_agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(10)))
        .timeout_recv_response(Some(std::time::Duration::from_secs(15)))
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .build();
    config.into()
}

/// 下载专用 Agent：读超时 30s（持续低速可继续，30s 无数据才判死）+ 全局兜底 30min
/// + 手动跟随重定向（保留 Range 头）+ 自行处理状态码（416 续传起点无效等）
fn download_agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(10)))
        .timeout_recv_response(Some(std::time::Duration::from_secs(30)))
        .timeout_recv_body(Some(std::time::Duration::from_secs(30)))
        .timeout_global(Some(std::time::Duration::from_secs(30 * 60)))
        .max_redirects(0)
        .http_status_as_error(false)
        .build();
    config.into()
}

/// 从 GitHub API 拉取 releases 列表（按时间倒序）
pub fn fetch_releases() -> Result<Vec<GithubRelease>, String> {
    let resp = api_agent()
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
        gitee_url: gitee_asset_url(&rel.tag_name, &asset.name),
        asset_size: asset.size,
        has_update,
        current_version: current,
    })
}

/// 构建下载源链：直连 GitHub 优先，镜像按实测可达性排序（前缀 + 原始资产 URL）
pub fn build_download_sources(asset_url: &str) -> Vec<String> {
    let mut sources = vec![asset_url.to_string()];
    for prefix in MIRROR_PREFIXES {
        sources.push(format!("{prefix}{asset_url}"));
    }
    sources
}

/// 拼接重定向 Location（兼容相对路径；GitHub/镜像场景 Location 均为绝对 URL）
pub fn join_url(base: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    if let Some(scheme_end) = base.find("://") {
        let rest = &base[scheme_end + 3..];
        if let Some(slash) = rest.find('/') {
            let host = &rest[..slash];
            let path = location.trim_start_matches('/');
            return format!("{}://{}/{}", &base[..scheme_end], host, path);
        }
    }
    location.to_string()
}

/// 源显示名（错误信息用）
pub fn source_label(url: &str) -> String {
    let host = url
        .split("://")
        .nth(1)
        .and_then(|s| s.split('/').next())
        .unwrap_or(url);
    if host == "github.com" {
        "GitHub 直连".to_string()
    } else {
        format!("镜像 {host}")
    }
}

/// 多轮多源下载编排（纯逻辑；attempt 可注入以便单测）。
///
/// - `attempt(source, resume_from)` 返回 `Ok(文件当前总长度)` 表示该源"流正常结束"；
///   长度与期望一致才视为成功，否则记为残缺并继续下一源/下一轮（断点续传）。
/// - 文件已与期望一致时直接成功（幂等重试，不重复下载）。
/// - 全部失败后清理残缺文件并返回聚合错误（含各源原因）。
pub fn run_download_rounds<F>(
    sources: &[String],
    expected_size: u64,
    dest: &Path,
    attempt: &mut F,
) -> Result<(), String>
where
    F: FnMut(&str, u64) -> Result<u64, String>,
{
    let current_len = || std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);

    // 已有完整文件（上次已下完但未安装/重复点击）→ 直接成功
    if expected_size > 0 && current_len() == expected_size {
        return Ok(());
    }
    let mut reasons: Vec<String> = Vec::new();
    for _round in 1..=MAX_DOWNLOAD_ROUNDS {
        for src in sources {
            let resume = current_len();
            if expected_size > 0 && resume == expected_size {
                return Ok(());
            }
            match attempt(src, resume) {
                Ok(len) if expected_size == 0 || len == expected_size => return Ok(()),
                Ok(len) => reasons.push(format!(
                    "{}：流提前结束（{} / {} 字节）",
                    source_label(src),
                    len,
                    expected_size
                )),
                Err(e) => reasons.push(format!("{}：{e}", source_label(src))),
            }
        }
    }
    // 全败：清理残缺文件，避免下次误用
    let _ = std::fs::remove_file(dest);
    Err(format!(
        "下载失败：已依次尝试 {} 个来源共 {} 轮。{}",
        sources.len(),
        MAX_DOWNLOAD_ROUNDS,
        reasons.join("；")
    ))
}

/// 单源真实下载：从 offset 断点续传，流式写入 dest，返回最终文件长度。
/// 手动跟随重定向（最多 6 跳），每跳携带 Range 头，保证续传直达最终主机。
fn stream_from(
    agent: &ureq::Agent,
    source_url: &str,
    dest: &Path,
    offset: u64,
    on_progress: &mut dyn FnMut(u64),
) -> Result<u64, String> {
    let mut current = source_url.to_string();
    let mut response = None;
    for _hop in 0..6 {
        let mut req = agent
            .get(&current)
            .header("User-Agent", "CoBeing-Desktop-Updater")
            .header("Accept", "application/octet-stream");
        if offset > 0 {
            req = req.header("Range", &format!("bytes={offset}-"));
        }
        let resp = req.call().map_err(|e| format!("请求失败：{e}"))?;
        let status = resp.status().as_u16();
        match status {
            301 | 302 | 303 | 307 | 308 => {
                let loc = resp
                    .headers()
                    .get("location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or("重定向缺少 Location 头")?
                    .to_string();
                current = join_url(&current, &loc);
            }
            200 | 206 => {
                response = Some(resp);
                break;
            }
            416 => return Err("RANGE_UNSATISFIABLE".to_string()),
            other => return Err(format!("HTTP {other}")),
        }
    }
    let resp = response.ok_or("重定向次数过多")?;

    // 200 = 服务器忽略 Range（从头覆盖）；206 = 续传（追加）
    let mut file = if resp.status().as_u16() == 206 && offset > 0 {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(dest)
            .map_err(|e| format!("打开文件失败：{e}"))?
    } else {
        File::create(dest).map_err(|e| format!("创建文件失败：{e}"))?
    };

    let mut reader = resp.into_body().into_reader();
    let mut buf = [0u8; 64 * 1024];
    let mut received = offset;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("下载中断：{e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入文件失败：{e}"))?;
        received += n as u64;
        on_progress(received);
    }
    file.flush().map_err(|e| format!("刷盘失败：{e}"))?;
    std::fs::metadata(dest)
        .map(|m| m.len())
        .map_err(|e| format!("读取文件大小失败：{e}"))
}

/// 真实网络单源尝试：优先从残留断点续传；续传起点无效（416）则清空重头再试一次。
fn real_download_attempt(
    agent: &ureq::Agent,
    source_url: &str,
    dest: &Path,
    on_progress: &mut dyn FnMut(u64),
) -> Result<u64, String> {
    let existing = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    match stream_from(agent, source_url, dest, existing, on_progress) {
        Err(e) if e == "RANGE_UNSATISFIABLE" => {
            // 残留文件与远端不一致（如镜像曾返回错误内容）→ 清空重头
            let _ = std::fs::remove_file(dest);
            stream_from(agent, source_url, dest, 0, on_progress)
        }
        other => other,
    }
}

/// Tauri 命令：下载安装包到应用数据目录 `updates/`，返回本地路径。
/// 源链：Gitee 国内源（可选）→ GitHub 直连 → 国内镜像；断点续传 + 完整性校验
/// （expected_size 来自 GitHub 资产 size）。下载过程中通过 `update-progress`
/// 事件向前端推送 {received, total}。
#[tauri::command]
pub async fn download_installer(
    app: AppHandle,
    url: String,
    gitee_url: String,
    asset_name: String,
    expected_size: u64,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    let updates_dir = data_dir.join("updates");
    std::fs::create_dir_all(&updates_dir).map_err(|e| format!("创建更新目录失败: {e}"))?;
    let dest: PathBuf = updates_dir.join(sanitize_filename(&asset_name));

    // 源链：Gitee（国内首选）→ GitHub 直连 → 第三方镜像（均支持失败自动换源）
    let mut sources: Vec<String> = Vec::new();
    if !gitee_url.is_empty() {
        sources.push(gitee_url);
    }
    sources.extend(build_download_sources(&url));

    let agent = download_agent();
    let handle = app.clone();
    let mut progress = |received: u64| {
        let _ = handle.emit(
            "update-progress",
            serde_json::json!({ "received": received, "total": expected_size }),
        );
    };
    let mut attempt = |src: &str, _resume: u64| {
        real_download_attempt(&agent, src, &dest, &mut progress)
    };
    run_download_rounds(&sources, expected_size, &dest, &mut attempt)?;
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

    fn temp_dest(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("cobeing-update-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
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

    // ---------- v2.0.12 下载可靠性新增 ----------

    #[test]
    fn build_download_sources_direct_first_then_mirrors() {
        let url = "https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.12/CoBeing.v2_2.0.12_x64-setup.exe";
        let sources = build_download_sources(url);
        assert_eq!(sources.len(), 1 + MIRROR_PREFIXES.len());
        assert_eq!(sources[0], url);
        assert!(sources[1].starts_with("https://gh.ddlc.top/") && sources[1].ends_with(url));
        assert!(sources[2].starts_with("https://ghfast.top/") && sources[2].ends_with(url));
        assert!(sources[3].starts_with("https://gh-proxy.com/") && sources[3].ends_with(url));
    }

    #[test]
    fn join_url_handles_absolute_and_relative() {
        assert_eq!(
            join_url("https://a.com/x", "https://cdn.b.com/y?z=1"),
            "https://cdn.b.com/y?z=1"
        );
        assert_eq!(join_url("https://a.com/x", "/y"), "https://a.com/y");
    }

    #[test]
    fn source_label_distinguishes_direct_and_mirror() {
        assert_eq!(
            source_label("https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.12/x.exe"),
            "GitHub 直连"
        );
        assert!(source_label("https://gh.ddlc.top/https://github.com/x/y.exe").contains("gh.ddlc.top"));
    }

    #[test]
    fn gitee_asset_url_builds_dist_raw_url() {
        assert_eq!(
            gitee_asset_url("v2.0.12", "CoBeing.v2_2.0.12_x64-setup.exe"),
            "https://gitee.com/CH3SH-LC/CoBeing/raw/dist/v2.0.12/CoBeing.v2_2.0.12_x64-setup.exe"
        );
    }

    #[test]
    fn rounds_succeed_on_first_source() {
        let dest = temp_dest("ok1");
        let sources = vec!["s1".to_string(), "s2".to_string()];
        let mut attempt = |src: &str, resume: u64| {
            assert_eq!(src, "s1");
            assert_eq!(resume, 0);
            Ok(100)
        };
        assert!(run_download_rounds(&sources, 100, &dest, &mut attempt).is_ok());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn rounds_fail_over_to_next_source() {
        let dest = temp_dest("failover");
        let sources = vec!["s1".to_string(), "s2".to_string()];
        let mut calls: Vec<(String, u64)> = Vec::new();
        let mut attempt = |src: &str, resume: u64| {
            calls.push((src.to_string(), resume));
            if src == "s1" {
                Err("网络错误".to_string())
            } else {
                Ok(200)
            }
        };
        assert!(run_download_rounds(&sources, 200, &dest, &mut attempt).is_ok());
        assert_eq!(calls, vec![("s1".to_string(), 0), ("s2".to_string(), 0)]);
    }

    #[test]
    fn rounds_resume_partial_until_complete() {
        let dest = temp_dest("resume");
        std::fs::write(&dest, vec![0u8; 100]).unwrap();
        let sources = vec!["s1".to_string(), "s2".to_string()];
        let mut calls: Vec<(String, u64)> = Vec::new();
        let mut attempt = |src: &str, resume: u64| {
            calls.push((src.to_string(), resume));
            if src == "s1" {
                Err("timeout".to_string()) // 源 1 挂了
            } else {
                std::fs::write(&dest, vec![0u8; 300]).unwrap(); // 源 2 续传至完成
                Ok(300)
            }
        };
        assert!(run_download_rounds(&sources, 300, &dest, &mut attempt).is_ok());
        // 编排器必须以文件当前长度作为续传起点传给下一源
        assert_eq!(calls[0], ("s1".to_string(), 100));
        assert_eq!(calls[1], ("s2".to_string(), 100));
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn rounds_treat_early_eof_as_incomplete_and_retry() {
        let dest = temp_dest("earlyeof");
        let sources = vec!["s1".to_string()];
        let mut attempt = |_src: &str, resume: u64| {
            if resume == 0 {
                std::fs::write(&dest, vec![0u8; 100]).unwrap(); // 流"正常结束"但只有 100/200
                Ok(100)
            } else {
                std::fs::write(&dest, vec![0u8; 200]).unwrap();
                Ok(200)
            }
        };
        assert!(run_download_rounds(&sources, 200, &dest, &mut attempt).is_ok());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn rounds_cleanup_and_report_on_total_failure() {
        let dest = temp_dest("allfail");
        std::fs::write(&dest, vec![0u8; 5]).unwrap();
        let sources = vec!["s1".to_string()];
        let mut attempt = |_src: &str, _resume: u64| Err("连接失败".to_string());
        let err = run_download_rounds(&sources, 10, &dest, &mut attempt).unwrap_err();
        assert!(err.contains("s1") && err.contains("连接失败"));
        assert!(!dest.exists(), "全部失败后应清理残缺文件");
    }

    #[test]
    fn rounds_skip_when_file_already_complete() {
        let dest = temp_dest("done");
        std::fs::write(&dest, vec![0u8; 100]).unwrap();
        let sources = vec!["s1".to_string()];
        let mut attempt = |_src: &str, _resume: u64| -> Result<u64, String> {
            panic!("不应再调用 attempt")
        };
        assert!(run_download_rounds(&sources, 100, &dest, &mut attempt).is_ok());
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn rounds_accept_unknown_size_on_first_eof() {
        let dest = temp_dest("nosize");
        let sources = vec!["s1".to_string()];
        let mut attempt = |_src: &str, _resume: u64| Ok(12345);
        assert!(run_download_rounds(&sources, 0, &dest, &mut attempt).is_ok());
        let _ = std::fs::remove_file(&dest);
    }

    // ---------- 真实网络（cargo test -- --ignored 运行；本机直连 GitHub 可达） ----------

    #[test]
    #[ignore = "真实网络下载 32MB 安装包"]
    fn real_download_completes_full_installer_with_size_check() {
        let dest = temp_dest("real-full");
        let url = "https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.11/CoBeing.v2_2.0.11_x64-setup.exe";
        let expected: u64 = 32_175_831;
        let sources = build_download_sources(url);
        let agent = download_agent();
        let mut progress = |_r: u64| {};
        let mut attempt = |src: &str, _resume: u64| real_download_attempt(&agent, src, &dest, &mut progress);
        run_download_rounds(&sources, expected, &dest, &mut attempt).expect("完整下载应成功");
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), expected);
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    #[ignore = "真实网络断点续传下载 32MB 安装包"]
    fn real_download_resumes_from_partial_prefix() {
        let dest = temp_dest("real-resume");
        let url = "https://github.com/CH3SH-LC/CoBeing/releases/download/v2.0.11/CoBeing.v2_2.0.11_x64-setup.exe";
        let expected: u64 = 32_175_831;
        let agent = download_agent();
        let mut progress = |_r: u64| {};

        // 1) 真实完整下载一次（拿到与服务器一致的内容）
        let mut attempt = |src: &str, _resume: u64| real_download_attempt(&agent, src, &dest, &mut progress);
        run_download_rounds(&[url.to_string()], expected, &dest, &mut attempt).expect("首次完整下载应成功");
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), expected);

        // 2) 截断成 300KB，模拟"上次失败残留的真实内容前缀"
        let f = OpenOptions::new().write(true).open(&dest).unwrap();
        f.set_len(307_200).unwrap();
        drop(f);
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), 307_200);

        // 3) 从 300KB 断点真实续传至完整（Range 直达最终主机）
        let mut attempt2 = |src: &str, _resume: u64| real_download_attempt(&agent, src, &dest, &mut progress);
        run_download_rounds(&[url.to_string()], expected, &dest, &mut attempt2).expect("断点续传应成功");
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), expected);
        let _ = std::fs::remove_file(&dest);
    }
}
