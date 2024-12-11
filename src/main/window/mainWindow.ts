import { app, BrowserWindow } from 'electron'
import path from 'path'
import ipc from '@main/ipc'
const createMainWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: true,
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
