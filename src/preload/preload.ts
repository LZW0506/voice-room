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
  isMax: (callback: (isMax: boolean) => void) =>
    ipcRenderer.on('windows:isMax', (_event, value: boolean) => callback(value)) // 最大化状态
})
contextBridge.exposeInMainWorld('system', {
  platform: () => ipcRenderer.invoke('system:platform') // 获取平台
})
