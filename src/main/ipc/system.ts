import { app, BrowserWindow, ipcMain } from 'electron'
export default (win: BrowserWindow) => {
  // 最小化窗口
  ipcMain.on('windows:minimize', function () {
    win.minimize()
  })
  // 最大化窗口
  ipcMain.on('windows:maximize', function () {
    win.maximize()
  })
  // 还原窗口
  ipcMain.on('windows:unmaximize', function () {
    win.unmaximize()
  })
  // 还原窗口
  ipcMain.handle('windows:getMax', function () {
    return win.isMaximized()
  })
  // 关闭窗口
  ipcMain.on('windows:close', () => {
    app.quit()
  })
  // 获取当前系统
  ipcMain.handle('system:platform', () => {
    return process.platform
  })
  // 监听窗口最大化
  win.on('maximize', () => {
    win.webContents.send('windows:isMax', true)
  })
  // 监听窗口还原
  win.on('unmaximize', () => {
    win.webContents.send('windows:isMax', false)
  })
}
