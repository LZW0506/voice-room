import { app, ipcMain, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

/** GitHub Release 中 electron-updater 清单的默认代理地址 */
const DEFAULT_UPDATE_URL = 'https://githubdog.com/https://github.com/LZW0506/voice-room/releases/latest/download'

/** 注册 NSIS 与 electron-updater 自动更新相关 IPC 方法 */
export default (getWindow: () => BrowserWindow | null) => {
  const configured = process.platform === 'win32' && app.isPackaged
  const updateUrl = process.env.VITE_UPDATE_URL || DEFAULT_UPDATE_URL
  if (configured && process.env.VITE_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl })
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    getWindow()?.webContents.send('app:update-progress', 0)
    getWindow()?.webContents.send('app:update-available', info.version)
  })
  autoUpdater.on('download-progress', (progress) => {
    getWindow()?.webContents.send('app:update-progress', progress.percent)
  })
  autoUpdater.on('update-downloaded', (info) => {
    getWindow()?.webContents.send('app:update-progress', 100)
    getWindow()?.webContents.send('app:update-downloaded', info.version)
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
    // electron-updater 检查到更新后会自动下载，页面只需等待下载完成事件
    await autoUpdater.downloadUpdate()
    return true
  })
  ipcMain.handle('app:quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })
}
