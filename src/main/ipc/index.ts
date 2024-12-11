import { BrowserWindow } from 'electron'
import system from './system'
export default (win: BrowserWindow) => {
  system(win)
}
