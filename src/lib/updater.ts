import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater'

/** Tauri 检测到的桌面应用更新实体 */
export type AppUpdate = Update

/** 桌面应用更新下载事件实体 */
export type AppUpdateDownloadEvent = DownloadEvent

/** 获取当前桌面应用版本号 */
export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return '开发版'
  return getVersion()
}

/** 检查 GitHub Release 中是否存在新版本 */
export async function checkForAppUpdate(): Promise<Update | null> {
  if (!isTauri()) return null
  return check()
}

/** 下载并安装指定版本的桌面应用更新 */
export async function installAppUpdate(update: Update, onEvent?: (event: DownloadEvent) => void): Promise<void> {
  await update.downloadAndInstall(onEvent)
  if (!navigator.userAgent.toLowerCase().includes('windows')) await relaunch()
}
