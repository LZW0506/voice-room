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
/** 单个降噪方案的运行能力 */
interface NoiseReductionProviderCapability {
  /** 是否可以在当前应用中运行 */
  available: boolean
  /** 不可用时的原因 */
  reason?: string
}
/** 当前平台的降噪能力 */
/** 原生降噪能力接口 */
interface NoiseReduction {
  /** 查询当前平台可用的降噪方案 */
  getCapabilities(): Promise<NoiseReductionCapabilities>
  /** 启动原生降噪 helper */
  start(mode: import('@renderer/store').NoiseReductionMode, strength: number): Promise<{ native: boolean }>
  /** 停止原生降噪 helper */
  stop(): Promise<void>
  /** 接收主进程转发给渲染进程的 PCM 端口 */
  onPort(callback: (port: MessagePort) => void): () => void
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
  /** 当前平台的降噪能力 */
  interface NoiseReductionCapabilities {
    /** Electron 平台标识 */
    platform: string
    /** 各降噪方案的运行能力 */
    providers: Partial<Record<import('@renderer/store').NoiseReductionMode, NoiseReductionProviderCapability>>
  }
  interface Window {
    windows: Windows
    system: System
    voice: Voice
    noiseReduction: NoiseReduction
    appUpdate: AppUpdate
  }
}
