import { app, ipcMain, MessageChannelMain, type MessagePortMain } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** 客户端支持的降噪方案标识 */
type NoiseReductionMode = 'off' | 'webrtc' | 'onnx-cpu'

/** 单个降噪方案的运行能力 */
interface NoiseReductionProviderCapability {
  /** 是否可以在当前应用中运行 */
  available: boolean
  /** 不可用时的原因 */
  reason?: string
}

/** 当前平台的降噪能力 */
export interface NoiseReductionCapabilities {
  /** Electron 平台标识 */
  platform: NodeJS.Platform
  /** 各降噪方案的运行能力 */
  providers: Partial<Record<NoiseReductionMode, NoiseReductionProviderCapability>>
}

/** 原生降噪会话实体 */
interface NoiseReductionSession {
  /** 当前页面标识 */
  webContentsId: number
  /** 原生 helper 子进程 */
  child: ChildProcessWithoutNullStreams
  /** 与渲染进程连接的消息端口 */
  port: MessagePortMain
  /** 尚未发送给渲染进程的输出字节 */
  outputBuffer: Buffer
  /** 单帧音频字节数 */
  frameBytes: number
}

const sessions = new Map<number, NoiseReductionSession>()

/** 获取当前安装包携带的原生降噪资源目录 */
function getNativeResourceDir(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform
  const arch = process.arch
  return app.isPackaged
    ? join(process.resourcesPath, arch)
    : resolve(app.getAppPath(), 'native', 'resources', platform, arch)
}

/** 获取原生 helper 的文件路径 */
function getHelperPath(): string {
  return join(getNativeResourceDir(), process.platform === 'win32' ? 'voice-noise-helper.exe' : 'voice-noise-helper')
}

/** 将原生 provider 转换为 helper 启动参数 */
function isNativeProvider(mode: NoiseReductionMode): boolean {
  return mode === 'onnx-cpu'
}

/** 结束指定页面的原生降噪会话 */
function stopSession(webContentsId: number): void {
  const session = sessions.get(webContentsId)
  if (!session) return
  sessions.delete(webContentsId)
  session.port.close()
  session.child.kill()
}

/** 向仍然有效的渲染进程端口发送降噪状态消息 */
function postSessionMessage(session: NoiseReductionSession, message: unknown): void {
  if (sessions.get(session.webContentsId) !== session) return
  try {
    session.port.postMessage(message)
  } catch {
    // 页面关闭时端口可能已经失效，此时无需继续上报状态
  }
}

/** 等待 helper 完成模型加载并报告就绪状态 */
function waitForHelperReady(child: ChildProcessWithoutNullStreams, provider: NoiseReductionMode): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false
    let stderrBuffer = ''
    const timeout = setTimeout(() => settle(() => rejectReady(new Error('降噪 helper 初始化超时'))), 30_000)
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback()
    }
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
      if (stderrBuffer.includes(`READY provider=${provider}`)) settle(resolveReady)
    })
    child.once('error', (error) => settle(() => rejectReady(new Error(`启动降噪 helper 失败: ${error.message}`))))
    child.once('close', (code) =>
      settle(() => rejectReady(new Error(`降噪 helper 初始化失败，退出码 ${code ?? 'unknown'}`)))
    )
  })
}

/** 为原生 helper 转发实时 PCM 帧 */
function attachSessionPort(session: NoiseReductionSession): void {
  session.port.on('message', ({ data }) => {
    if (!(data instanceof ArrayBuffer)) return
    const bytes = Buffer.from(data)
    if (bytes.byteLength !== session.frameBytes) return
    if (!session.child.stdin.destroyed) session.child.stdin.write(bytes)
  })
  session.port.start()
  session.child.stdout.on('data', (chunk: Buffer) => {
    session.outputBuffer = Buffer.concat([session.outputBuffer, chunk])
    while (session.outputBuffer.byteLength >= session.frameBytes) {
      const frame = session.outputBuffer.subarray(0, session.frameBytes)
      session.outputBuffer = session.outputBuffer.subarray(session.frameBytes)
      const copy = new Uint8Array(frame).slice()
      postSessionMessage(session, copy.buffer)
    }
  })
  session.child.on('error', (error) => {
    postSessionMessage(session, { type: 'error', message: error.message })
  })
  session.child.on('close', (code) => {
    if (code !== 0) postSessionMessage(session, { type: 'error', message: `降噪 helper 已退出，退出码 ${code ?? 'unknown'}` })
  })
}

/** 注册降噪能力查询 IPC */
export default () => {
  ipcMain.handle('noise:start', async (event, request: { mode: NoiseReductionMode; strength: number }) => {
    stopSession(event.sender.id)
    if (!isNativeProvider(request.mode)) return { native: false }
    const helperPath = getHelperPath()
    const modelPath = join(getNativeResourceDir(), 'models', 'DeepFilterNet3_onnx.tar.gz')
    if (!existsSync(helperPath) || !existsSync(modelPath)) {
      throw new Error('原生降噪 helper 或模型资源不存在，请先执行 yarn native:prepare')
    }
    const child = spawn(
      helperPath,
      ['--provider', request.mode, '--model', modelPath, '--strength', String(request.strength)],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    try {
      await waitForHelperReady(child, request.mode)
    } catch (error) {
      child.kill()
      throw error
    }
    const channel = new MessageChannelMain()
    const session: NoiseReductionSession = {
      webContentsId: event.sender.id,
      child,
      port: channel.port1,
      outputBuffer: Buffer.alloc(0),
      frameBytes: 480 * 4
    }
    sessions.set(event.sender.id, session)
    attachSessionPort(session)
    event.sender.postMessage('noise:port', null, [channel.port2])
    return { native: true }
  })
  ipcMain.handle('noise:stop', (event) => {
    stopSession(event.sender.id)
  })
  ipcMain.handle('noise:capabilities', (): NoiseReductionCapabilities => {
    const platform = process.platform
    if (platform === 'win32') {
      return {
        platform,
        providers: {
          off: { available: true },
          webrtc: { available: true },
          'onnx-cpu': { available: existsSync(getHelperPath()) && existsSync(join(getNativeResourceDir(), 'models', 'DeepFilterNet3_onnx.tar.gz')) }
        }
      }
    }
    if (platform === 'darwin') {
      return {
        platform,
        providers: {
          off: { available: true },
          webrtc: { available: true },
          'onnx-cpu': {
            available:
              existsSync(getHelperPath()) &&
              existsSync(join(getNativeResourceDir(), 'models', 'DeepFilterNet3_onnx.tar.gz'))
          }
        }
      }
    }
    return {
      platform,
      providers: {
        off: { available: true },
        webrtc: { available: true }
      }
    }
  })
}
