import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

let updateCheckStarted = false

/** 启动桌面应用后检查 GitHub Release 中的新版本并由用户确认安装 */
export async function checkForAppUpdate(): Promise<void> {
  if (!isTauri() || updateCheckStarted) return
  updateCheckStarted = true

  const update = await check()
  if (!update) return

  const shouldInstall = window.confirm(`发现声屿新版本 ${update.version}\n\n是否立即下载并安装？`)
  if (!shouldInstall) {
    await update.close()
    return
  }

  await update.downloadAndInstall()
  await relaunch()
}
