import { BrowserWindow, ipcMain } from 'electron'
import logger from '@main/utils/logger'
export default (win: BrowserWindow) => {
  ipcMain.handle('test', () => {
    logger.info('test')
    console.log('test')
    return 'test333'
  })
}
