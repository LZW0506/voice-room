import ipc from '@main/ipc'
import { app, BrowserWindow, screen } from 'electron'
import path from 'path'
const createMainWindow = () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: Math.ceil(width * 0.75), // 向上取整,不支持小数
    height: Math.ceil(height * 0.85),
    minWidth: Math.ceil(width * 0.5),
    minHeight: Math.ceil(height * 0.5),
    frame: false,
    title: 'DBin',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    trafficLightPosition: { x: 10, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }
  if (!app.isPackaged) {
    // Open the DevTools.
    mainWindow.webContents.openDevTools()
  }
  ipc(mainWindow)

  return mainWindow
}
export default createMainWindow
