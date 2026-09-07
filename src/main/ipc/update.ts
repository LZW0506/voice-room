import { app, autoUpdater, ipcMain, type BrowserWindow } from 'electron'

/** GitHub Release 中 Squirrel.Windows 更新清单的默认地址 */
// 代理地址沿用旧项目，避免国内网络直连 GitHub 时被中途断开
const DEFAULT_UPDATE_URL = 'https://githubdog.com/https://github.com/LZW0506/voice-room/releases/latest/download'

/** 注册 Squirrel.Windows 自动更新相关 IPC 方法 */
export default (getWindow: () => BrowserWindow | null) => {
  const updateUrl = process.env.VITE_UPDATE_URL || DEFAULT_UPDATE_URL
  let configured = false
  if (updateUrl && process.platform === 'win32') {
    autoUpdater.setFeedURL({ url: updateUrl })
    configured = true
  }

  autoUpdater.on('update-available', () => {
    getWindow()?.webContents.send('app:update-progress', 0)
  })
  autoUpdater.on('update-downloaded', (_event, _releaseNotes, releaseName) => {
    getWindow()?.webContents.send('app:update-progress', 100)
    getWindow()?.webContents.send('app:update-downloaded', releaseName)
  })
  autoUpdater.on('error', (error) => {
    getWindow()?.webContents.send('app:update-error', error.message)
  })

  ipcMain.handle('app:version', () => (app.isPackaged ? app.getVersion() : '开发版'))
  ipcMain.handle('app:check-update', async () => {
    if (!configured) return { available: false, status: '当前未配置更新服务' }
    return new Promise<{ available: boolean; status: string; version?: string }>((resolve, reject) => {
      /** 清理本次更新检查使用的一次性事件 */
      const cleanup = () => {
        autoUpdater.removeListener('update-available', handleAvailable)
        autoUpdater.removeListener('update-not-available', handleNotAvailable)
        autoUpdater.removeListener('error', handleError)
      }
      /** 处理发现可用更新 */
      const handleAvailable = () => {
        cleanup()
        resolve({ available: true, status: '发现新版本，正在下载' })
      }
      /** 处理当前版本已经最新 */
      const handleNotAvailable = () => {
        cleanup()
        resolve({ available: false, status: '当前已是最新版本' })
      }
      /** 处理更新检查失败 */
      const handleError = (error: Error) => {
        cleanup()
        reject(new Error(error.message || '检查更新失败'))
      }
      autoUpdater.once('update-available', handleAvailable)
      autoUpdater.once('update-not-available', handleNotAvailable)
      autoUpdater.once('error', handleError)
      try {
        autoUpdater.checkForUpdates()
      } catch (error) {
        handleError(error instanceof Error ? error : new Error('检查更新失败'))
      }
    })
  })
  ipcMain.handle('app:download-update', async () => {
    if (!configured) throw new Error('当前未配置更新服务')
    // Squirrel.Windows 在检查到更新后会自动下载，此方法用于兼容设置页的显式下载操作
    autoUpdater.checkForUpdates()
    return true
  })
  ipcMain.handle('app:quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })
}
