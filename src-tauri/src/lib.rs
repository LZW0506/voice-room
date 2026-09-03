/// 获取当前设备的系统机器码
#[tauri::command]
fn machine_code() -> Result<String, String> {
    machine_uid::get().map_err(|error| format!("读取机器码失败: {error}"))
}

/// 启动 Tauri 桌面应用并注册本地命令
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![machine_code])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败")
}
