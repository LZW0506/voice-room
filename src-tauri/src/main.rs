// Windows 发布版使用图形界面子系统，避免启动时显示命令行窗口
#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

/// 启动桌面端主进程
fn main() {
    voice_room_lib::run()
}
