//! CoBeing v2 — Tauri native desktop GUI (Rust side: kernel bridge).
//!
//! This crate is responsible for hosting the `cobeing-kernel` Node subprocess and
//! forwarding JSON-RPC between the React front-end and the kernel over stdio.

/// KernelBridge: pure, testable JSON-RPC 2.0-over-stdio bridge to the kernel subprocess.
pub mod kernel_bridge;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};

use kernel_bridge::{KernelBridge, KernelBridgeError, KernelBridgeOptions};

/// Managed state: the kernel bridge (None until `setup` has spawned it).
struct KernelState(Mutex<Option<Arc<KernelBridge>>>);

/// Resolve the CoBeing-v2 project root.
///
/// `COBEING_V2_ROOT` wins when set (for packaging overrides); otherwise derive from
/// `CARGO_MANIFEST_DIR` (this crate = `<root>/gui/src-tauri`), i.e. up two levels.
fn resolve_root() -> PathBuf {
    if let Ok(root) = std::env::var("COBEING_V2_ROOT") {
        if !root.trim().is_empty() {
            return PathBuf::from(root);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| manifest.join("../../"))
}

/// Resolve the data root: `COBEING_DATA_ROOT` wins; dev mode → `<root>/data`; release → app data dir.
fn resolve_data_root(root: &Path, app: Option<&tauri::AppHandle>) -> PathBuf {
    if let Ok(data) = std::env::var("COBEING_DATA_ROOT") {
        if !data.trim().is_empty() {
            return PathBuf::from(data);
        }
    }
    if let Some(app) = app {
        if let Ok(dir) = app.path().app_data_dir() {
            return dir;
        }
    }
    root.join("data")
}

/// Windows verbatim 路径（`\\?\` 前缀）Node.js 无法作为脚本参数解析（lstat 崩），
/// 剥离前缀为普通路径（本地盘场景；UNC 形式 `\\?\UNC\` 同样剥离为 `\\server\share`）。
fn portable_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

/// Build the kernel launch command.
///
/// Dev mode: `node <root>/node_modules/tsx/dist/cli.mjs <root>/packages/bridge/src/cli.ts --data <dataRoot>`
/// Release mode: `<resources>/kernel/node.exe <resources>/kernel/kernel.mjs --data <dataRoot>`
/// (packaged by `scripts/build-kernel-dist.mjs`: node.exe = portable runtime, no Node install needed)
///
/// Note: on Windows, `resource_dir()` is the install dir itself (NSIS places bundled
/// resources under `<install>/resources/`), so the kernel lives at
/// `<resource_dir>/resources/kernel/`. We probe both layouts defensively, and strip
/// the verbatim `\\?\` prefix (Node cannot execute a `\\?\`-prefixed script path).
fn build_kernel_command(resources: Option<&Path>, data_root: PathBuf) -> Command {
    if let Some(res) = resources {
        for candidate in [res.join("resources").join("kernel"), res.join("kernel")] {
            let node = candidate.join("node.exe");
            let cli = candidate.join("kernel.mjs");
            if node.exists() && cli.exists() {
                let mut cmd = Command::new(portable_path(&node));
                cmd.arg(portable_path(&cli)).arg("--data").arg(&data_root);
                return cmd;
            }
        }
    }
    let root = resolve_root();
    let tsx = root.join("node_modules/tsx/dist/cli.mjs");
    let cli = root.join("packages/bridge/src/cli.ts");

    let mut cmd = Command::new("node");
    cmd.arg(&tsx).arg(&cli).arg("--data").arg(&data_root);
    cmd
}

#[tauri::command]
fn rpc_call(
    state: tauri::State<'_, KernelState>,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let bridge = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .cloned()
        .ok_or_else(|| "rpc error: kernel not started".to_string())?;

    bridge
        .request(&method, params)
        .map_err(|e: KernelBridgeError| match e {
            KernelBridgeError::Rpc { code, message } => format!("[{code}] {message}"),
            other => format!("rpc error: {other}"),
        })
}

#[tauri::command]
fn get_kernel_status(state: tauri::State<'_, KernelState>) -> bool {
    state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|b| b.is_alive())
        .unwrap_or(false)
}

/// E2E 测试设施：把前端自检报告写入数据目录（e2e-report.json），供外部验证读取。
/// 仅 #e2e/VITE_E2E 自检模式使用，不影响产品路径。
#[tauri::command]
fn e2e_report(content: String) -> Result<String, String> {
    let root = resolve_root();
    let data_root = resolve_data_root(&root, None);
    std::fs::create_dir_all(&data_root).map_err(|e| format!("rpc error: {e}"))?;
    let path = data_root.join("e2e-report.json");
    std::fs::write(&path, content).map_err(|e| format!("rpc error: {e}"))?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            // 发布模式：内核随包（resources/kernel/，build-kernel-dist.mjs 生成）；
            // 开发模式：node + tsx 源码直跑
            let resources = if cfg!(debug_assertions) {
                None
            } else {
                app.path().resource_dir().ok()
            };
            let data_root = resolve_data_root(&resolve_root(), Some(app.handle()));
            let command = build_kernel_command(resources.as_deref(), data_root.clone());
            // 启动诊断落盘（发布版故障排查）：命令 + spawn 结果
            let _ = std::fs::create_dir_all(&data_root);
            let diag = format!(
                "ts={} resources={:?}\ncommand={}\n",
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0),
                resources,
                {
                    let mut s = format!("{:?}", command.get_program());
                    for a in command.get_args() {
                        s.push_str(&format!(" {:?}", a));
                    }
                    s
                },
            );
            std::fs::write(data_root.join("kernel-launch.log"), diag).ok();
            let options = KernelBridgeOptions {
                command,
                request_timeout: std::time::Duration::from_secs(60),
                on_notify: {
                    let handle = app.handle().clone();
                    Box::new(move |params| {
                        let _ = handle.emit("jsonrpc-notify", &params);
                    })
                },
                on_exited: {
                    let handle = app.handle().clone();
                    Box::new(move |code| {
                        let _ = handle.emit("kernel-exited", serde_json::json!({ "code": code }));
                    })
                },
            };

            let state = match KernelBridge::spawn(options) {
                Ok(bridge) => {
                    eprintln!("[kernel-bridge] spawned cobeing-kernel"); // diagnostic only
                    Some(bridge)
                }
                Err(e) => {
                    eprintln!("[kernel-bridge] failed to spawn cobeing-kernel: {e}");
                    None
                }
            };

            app.manage(KernelState(Mutex::new(state)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc_call, get_kernel_status, e2e_report])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            // Gracefully stop the kernel subprocess before the host exits.
            if let Some(bridge) = app_handle
                .try_state::<KernelState>()
                .and_then(|s| s.0.lock().unwrap().clone())
            {
                if bridge.is_alive() {
                    bridge.stop();
                }
            }
        }
    });
}
