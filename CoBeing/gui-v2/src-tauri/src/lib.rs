use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent,
};

#[tauri::command]
fn run_dev_server() -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        Err("run_dev_server is only available in debug builds".to_string())
    }

    #[cfg(debug_assertions)]
    {
        let bat_path = std::path::Path::new("D:\\agent-codes\\CoBeing\\start.bat");
        if !bat_path.exists() {
            return Err(format!("start script not found: {}", bat_path.display()));
        }
        std::process::Command::new("cmd")
            .args(["/C", "start", "", bat_path.to_str().unwrap_or_default()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok("development server started".to_string())
    }
}

#[tauri::command]
fn open_project_dir() -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    {
        Err("open_project_dir is only available in debug builds".to_string())
    }

    #[cfg(debug_assertions)]
    {
        let dir = "D:\\agent-codes\\CoBeing";
        std::process::Command::new("explorer")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok("project directory opened".to_string())
    }
}

fn kill_core() {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/FI", "WINDOWTITLE eq CoBeing Core"])
        .output();
}

fn cleanup_and_exit() {
    kill_core();
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![run_dev_server, open_project_dir])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Show/Hide Window", true, None::<&str>)?;
            let status = MenuItem::with_id(app, "status", "Ready", false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

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
                    "quit" => cleanup_and_exit(),
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

            if let Some(w) = app.get_webview_window("main") {
                let window = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.emit("window-close-requested", ());
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::Exit = event {
                kill_core();
            }
        });
}
