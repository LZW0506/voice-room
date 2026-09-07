export {}
// 窗口状态
interface Windows {
  close(): void // 关闭窗口
  maximize(): void // 最大化
  minimize(): void // 最小化
  unmaximize(): void // 还原
  onMaximized(callback: (isMax: boolean) => void): () => void // 窗口是否最大化
  getMax(): Promise<boolean>
}

interface System {
  platform(): Promise<string>
}
interface Voice {
  /** 请求房间访问令牌 */
  requestToken(request: { room: string; identity: string; name: string }): Promise<{ token: string; url: string }>
}
/** 应用更新接口 */
interface AppUpdate {
  /** 获取当前应用版本 */
  getVersion(): Promise<string>
  /** 检查可用更新 */
  check(): Promise<{ available: boolean; status: string; version?: string }>
  /** 下载更新 */
  download(): Promise<boolean>
  /** 退出并安装更新 */
  quitAndInstall(): Promise<void>
  /** 订阅下载进度 */
  onProgress(callback: (progress: number) => void): () => void
  /** 订阅下载完成 */
  onDownloaded(callback: (version: string) => void): () => void
  /** 订阅更新错误 */
  onError(callback: (message: string) => void): () => void
}
declare global {
  interface Window {
    windows: Windows
    system: System
    voice: Voice
    appUpdate: AppUpdate
  }
}
