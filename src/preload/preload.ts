// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'

// 窗口相关
contextBridge.exposeInMainWorld('windows', {
  closeWindow: () => ipcRenderer.send('windows:close'), // 关闭窗口
  maximize: () => ipcRenderer.send('windows:maximize'), // 最大化
  minimize: () => ipcRenderer.send('windows:minimize'), // 最小化
  restore: () => ipcRenderer.send('windows:restore'), // 还原
  isMax: (callback: (isMax: boolean) => void) =>
    ipcRenderer.on('windows:isMax', (_event, value: boolean) => callback(value)) // 最大化状态
})
