/// 获取当前设备的系统机器码
#[tauri::command]
fn machine_code() -> Result<String, String> {
    machine_uid::get().map_err(|error| format!("读取机器码失败: {error}"))
}

/// 启动 Tauri 桌面应用并注册本地命令
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(room_engine::NativeAppState::default())
        .setup(|app| {
            // Windows 不使用原生菜单栏，桌面端仅保留应用内的自定义操作
            #[cfg(target_os = "windows")]
            app.remove_menu()?;
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            machine_code,
            room_engine::native_list_audio_devices,
            room_engine::native_audio_backend,
            room_engine::native_join_room,
            room_engine::native_leave_room,
            room_engine::native_set_microphone_muted,
            room_engine::native_set_output_muted,
            room_engine::native_update_audio_preferences,
            room_engine::native_set_participant_volume,
            room_engine::native_set_display_name,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败")
}
mod audio_engine;
mod audio_processor;
mod room_engine;
