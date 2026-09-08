import { BrowserWindow } from 'electron'
import system from './system'
import update from './update'
import voice from './voice'
import noise from './noise'
export default (win: BrowserWindow) => {
  system(win)
  voice()
  noise()
  update(() => win)
}
