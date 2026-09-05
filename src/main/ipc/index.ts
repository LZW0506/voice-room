import { BrowserWindow } from 'electron'
import system from './system'
import update from './update'
import voice from './voice'
export default (win: BrowserWindow) => {
  system(win)
  voice()
  update(() => win)
}
