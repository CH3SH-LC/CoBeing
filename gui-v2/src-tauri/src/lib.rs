use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Listener, Manager, RunEvent, Emitter,
};

#[tauri::command]
fn run_dev_server() -> Result<String, String> {
    let bat_path = std::path::Path::new("D:\\agent-codes\\CoBeing\\start.bat");
    if !bat_path.exists() {
        return Err(format!("找不到 {}", bat_path.display()));
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", "", bat_path.to_str().unwrap()])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok("已启动开发者服务器".to_string())
}

#[tauri::command]
fn open_project_dir() -> Result<String, String> {
    let dir = "D:\\agent-codes\\CoBeing";
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok("已打开项目目录".to_string())
}

/// 杀掉 Core 后端进程（按窗口标题杀）
fn kill_core() {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/FI", "WINDOWTITLE eq CoBeing Core"])
        .output();
}

/// 清理并退出
fn cleanup_and_exit() {
    let _ = kill_core();
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![run_dev_server, open_project_dir])
        .setup(|app| {
            // 托盘菜单
            let toggle = MenuItem::with_id(app, "toggle", "显示/隐藏窗口", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "就绪", false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle, &status, &sep, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("CoBeing")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        cleanup_and_exit();
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 拦截窗口关闭 — 在窗口级别监听前端响应
            if let Some(w) = app.get_webview_window("main") {
                let window = w.clone();
                let window2 = w.clone();

                // 监听关闭请求
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        // 通知前端决定行为
                        let _ = window.emit("window-close-requested", ());
                    }
                });

                // 在窗口级别监听前端的退出确认
                let _ = window2.listen("app-exit", move |_event| {
                    cleanup_and_exit();
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // 不阻止退出
        });
    }
