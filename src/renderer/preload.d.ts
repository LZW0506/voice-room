export {}
// 窗口状态
interface Windows {
  close(): void // 关闭窗口
  maximize(): void // 最大化
  minimize(): void // 最小化
  unmaximize(): void // 还原
  isMax(callback: (isMax: boolean) => void) // 窗口是否最大化
  getMax(): Promise<boolean>
}

interface System {
  platform(): Promise<string>
}
declare global {
  interface Window {
    windows: Windows
    system: System
  }
}
