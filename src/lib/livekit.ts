import { isTauri } from '@tauri-apps/api/core'
import { LocalAudioTrack, Room, RoomEvent } from 'livekit-client'

const TOKEN_URL = import.meta.env.VITE_TOKEN_URL || 'http://localhost:8787/api/token'
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || 'ws://localhost:7880'

/** Token 服务请求参数 */
export interface TokenRequest {
  /** 房间名称 */
  room: string
  /** LiveKit 用户身份 */
  identity: string
  /** 用户显示名称 */
  name: string
}

/** Token 服务响应实体 */
export interface TokenResponse {
  /** LiveKit 访问令牌 */
  token: string
  /** LiveKit 服务地址 */
  url: string
}

/** 麦克风音频处理资源实体 */
export interface MicrophoneResources {
  /** 发布到 LiveKit 的音频轨道 */
  track: LocalAudioTrack
  /** 系统原始麦克风媒体流 */
  rawStream: MediaStream
  /** Web Audio 处理上下文 */
  audioContext: AudioContext
  /** 控制麦克风输入音量的增益节点 */
  gainNode: GainNode
}

/** 麦克风输入设备实体 */
export interface AudioInputDevice {
  /** 浏览器分配的设备标识 */
  deviceId: string
  /** 展示给用户的设备名称 */
  label: string
  /** 同一物理设备输入输出端点共用的分组标识 */
  groupId: string
  /** 系统是否已开放真实设备名称 */
  hasLabel: boolean
}

/** 音频输出设备实体 */
export interface AudioOutputDevice {
  /** 浏览器分配的设备标识 */
  deviceId: string
  /** 展示给用户的设备名称 */
  label: string
  /** 同一物理设备输入输出端点共用的分组标识 */
  groupId: string
  /** 系统是否已开放真实设备名称 */
  hasLabel: boolean
}

/** 麦克风权限状态 */
export type MicrophonePermissionState = PermissionState | 'unsupported'

/** 扩展浏览器音频输出选择能力 */
interface AudioOutputMediaDevices extends MediaDevices {
  /** 打开浏览器原生音频输出设备选择器 */
  selectAudioOutput?: () => Promise<MediaDeviceInfo>
}

/** 获取进入指定房间所需的 LiveKit 令牌 */
export async function fetchToken(request: TokenRequest): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message || '无法获取房间通行证')
  }
  return response.json() as Promise<TokenResponse>
}

/** 创建带有回声消除、自动增益与可选降噪的麦克风轨道 */
export async function createProcessedMicrophone(
  inputVolume: number,
  noiseSuppression: boolean,
  inputDeviceId: string,
): Promise<MicrophoneResources> {
  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: inputDeviceId === 'default' ? undefined : { exact: inputDeviceId },
      echoCancellation: true,
      noiseSuppression,
      autoGainControl: true,
      channelCount: 1,
    },
  })
  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(rawStream)
  const gainNode = audioContext.createGain()
  const destination = audioContext.createMediaStreamDestination()
  gainNode.gain.value = inputVolume / 100
  source.connect(gainNode).connect(destination)
  const outputTrack = destination.stream.getAudioTracks()[0]
  if (!outputTrack) throw new Error('未能创建麦克风轨道')
  return { track: new LocalAudioTrack(outputTrack), rawStream, audioContext, gainNode }
}

/** 读取当前浏览器能够识别的全部麦克风设备 */
export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter((device) => device.kind === 'audioinput' && device.deviceId)
  return inputs.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `麦克风 ${index + 1}`,
    groupId: device.groupId,
    hasLabel: Boolean(device.label),
  }))
}

/** 读取当前浏览器能够识别的全部音频输出设备 */
export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  const outputs = devices.filter((device) => device.kind === 'audiooutput' && device.deviceId)
  return outputs.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `音频输出 ${index + 1}`,
    groupId: device.groupId,
    hasLabel: Boolean(device.label),
  }))
}

/** 查询浏览器当前的麦克风授权状态 */
export async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (!navigator.permissions?.query) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  } catch {
    return 'unsupported'
  }
}

/** 通过浏览器或系统权限提示申请麦克风访问并返回当前默认设备信息 */
export async function requestMicrophonePermission(): Promise<AudioInputDevice | null> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前环境不支持访问麦克风')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const track = stream.getAudioTracks()[0]
  const settings = track?.getSettings()
  const device = track?.label ? {
    deviceId: settings?.deviceId || 'default',
    label: track.label,
    groupId: settings?.groupId || '',
    hasLabel: true,
  } : null
  stream.getTracks().forEach((track) => track.stop())
  return device
}

/** 判断当前浏览器是否支持原生音频输出设备选择器 */
export function canSelectAudioOutputDevice(): boolean {
  const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices | undefined
  return typeof mediaDevices?.selectAudioOutput === 'function'
}

/** 打开浏览器原生选择器并返回用户授权的音频输出设备 */
export async function selectAudioOutputDevice(): Promise<AudioOutputDevice> {
  const mediaDevices = navigator.mediaDevices as AudioOutputMediaDevices | undefined
  if (!mediaDevices?.selectAudioOutput) throw new Error('当前浏览器不支持主动选择音频输出设备')
  const device = await mediaDevices.selectAudioOutput()
  return {
    deviceId: device.deviceId,
    label: device.label || '已选择的音频输出',
    groupId: device.groupId,
    hasLabel: Boolean(device.label),
  }
}

/** 根据桌面系统或浏览器环境返回麦克风授权指引 */
export function getMicrophonePermissionGuide(): string {
  if (!isTauri()) return '麦克风权限未开启，请在浏览器的网站设置中允许后刷新'

  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('windows')) {
    return '麦克风权限未开启，请在 Windows 设置的“隐私和安全性 → 麦克风”中允许桌面应用访问麦克风'
  }
  if (userAgent.includes('macintosh') || userAgent.includes('mac os')) {
    return '麦克风权限未开启，请在 macOS 系统设置的“隐私与安全性 → 麦克风”中允许声屿访问'
  }
  return '麦克风权限未开启，请在系统隐私设置中允许声屿访问麦克风'
}

/** 将浏览器麦克风异常转换为明确的中文提示 */
export function getMicrophoneErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : '无法打开麦克风'
  if (error.name === 'NotAllowedError') return getMicrophonePermissionGuide()
  if (error.name === 'NotFoundError') return '未检测到可用的麦克风，请在音频设置中选择输入设备'
  if (error.name === 'NotReadableError' || error.name === 'AbortError') return '所选麦克风当前不可用，可能正被其他应用占用'
  if (error.name === 'OverconstrainedError') return '所选麦克风已断开，请在音频设置中重新选择'
  return error.message || '无法打开麦克风'
}

/** 将音频输出设备选择异常转换为明确的中文提示 */
export function getAudioOutputErrorMessage(error: unknown): string {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : '无法选择音频输出设备'
  if (error.name === 'NotAllowedError') return '未获得音频输出设备权限，请在浏览器弹窗中选择并允许使用该设备'
  if (error.name === 'NotFoundError') return '未检测到可用的音频输出设备'
  return error.message || '无法选择音频输出设备'
}

/** 释放麦克风处理链路与浏览器音频资源 */
export async function disposeMicrophone(resources: MicrophoneResources): Promise<void> {
  resources.track.stop()
  resources.rawStream.getTracks().forEach((track) => track.stop())
  await resources.audioContext.close()
}

/** 创建客户端房间实例并配置断开事件 */
export function createRoom(onDisconnected: () => void): Room {
  const room = new Room({ adaptiveStream: true, dynacast: true })
  room.on(RoomEvent.Disconnected, onDisconnected)
  return room
}

/** 连接到 LiveKit 房间 */
export async function connectRoom(room: Room, credentials: TokenResponse): Promise<void> {
  await room.connect(credentials.url || LIVEKIT_URL, credentials.token)
}
