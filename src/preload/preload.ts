// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'

// 窗口相关
contextBridge.exposeInMainWorld('windows', {
  close: () => ipcRenderer.send('windows:close'), // 关闭窗口
  maximize: () => ipcRenderer.send('windows:maximize'), // 最大化
  minimize: () => ipcRenderer.send('windows:minimize'), // 最小化
  unmaximize: () => ipcRenderer.send('windows:unmaximize'), // 还原
  platform: () => ipcRenderer.invoke('windows:platform'), // 获取平台
  getMax: () => ipcRenderer.invoke('windows:getMax'), // 查看当前是否最大化
  onMaximized: (callback: (isMax: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value)
    ipcRenderer.on('windows:isMax', handler)
    return () => ipcRenderer.removeListener('windows:isMax', handler)
  }
})
contextBridge.exposeInMainWorld('system', {
  platform: () => ipcRenderer.invoke('system:platform') // 获取平台
})
contextBridge.exposeInMainWorld('voice', {
  /** 请求房间访问令牌 */
  requestToken: (request: { room: string; identity: string; name: string }) =>
    ipcRenderer.invoke('voice:token', request)
})
// 应用更新相关
contextBridge.exposeInMainWorld('appUpdate', {
  /** 获取当前应用版本 */
  getVersion: () => ipcRenderer.invoke('app:version'),
  /** 检查是否有可用更新 */
  check: () => ipcRenderer.invoke('app:check-update'),
  /** 下载可用更新 */
  download: () => ipcRenderer.invoke('app:download-update'),
  /** 退出应用并安装更新 */
  quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
  /** 订阅更新下载进度 */
  onProgress: (callback: (progress: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: number) => callback(progress)
    ipcRenderer.on('app:update-progress', handler)
    return () => ipcRenderer.removeListener('app:update-progress', handler)
  },
  /** 订阅更新下载完成事件 */
  onDownloaded: (callback: (version: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, version: string) => callback(version)
    ipcRenderer.on('app:update-downloaded', handler)
    return () => ipcRenderer.removeListener('app:update-downloaded', handler)
  },
  /** 订阅更新错误事件 */
  onError: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('app:update-error', handler)
    return () => ipcRenderer.removeListener('app:update-error', handler)
  }
})
