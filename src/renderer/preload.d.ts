export {}
// 窗口状态
interface Windows {
  closeWindow(): void // 关闭窗口
  maximize(): void // 最大化
  minimize(): void // 最小化
  restore(): void // 还原
  isMax(callback: (isMax: boolean) => void) // 窗口是否最大化
}
declare global {
  interface Window {
    windows: Windows
  }
}
