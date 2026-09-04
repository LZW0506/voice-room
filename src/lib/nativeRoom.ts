import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** 原生音频设备实体 */
export interface NativeAudioDevice {
  /** 原生设备标识 */
  deviceId: string
  /** 设备名称 */
  label: string
  /** 是否是系统默认设备 */
  isDefault: boolean
}

/** 原生输入输出设备列表 */
export interface NativeAudioDevices {
  /** 麦克风设备 */
  inputs: NativeAudioDevice[]
  /** 输出设备 */
  outputs: NativeAudioDevice[]
}

/** 原生房间参与者状态 */
export interface NativeParticipant {
  /** LiveKit 身份 */
  identity: string
  /** 参与者昵称 */
  name: string
  /** 是否正在发言 */
  speaking: boolean
  /** 是否关闭麦克风 */
  microphoneMuted: boolean
  /** 是否关闭输出 */
  outputMuted: boolean
  /** 加入顺序 */
  order: number
}

/** 原生房间状态 */
export interface NativeRoomState {
  /** 房间名称 */
  roomName: string
  /** 连接状态 */
  connectionState: string
  /** 房间参与者 */
  participants: NativeParticipant[]
  /** 当前用户麦克风状态 */
  microphoneMuted: boolean
  /** 当前用户输出状态 */
  outputMuted: boolean
  /** 网络往返延迟 */
  latency: number | null
  /** 当前推理后端 */
  inferenceBackend?: 'windowsOnnxRuntimeCpu' | 'macosCoreMl'
}

/** 发送给原生引擎的音频偏好 */
export interface NativeAudioPreferences {
  /** 输入设备标识 */
  inputDeviceId: string
  /** 输出设备标识 */
  outputDeviceId: string
  /** 输入音量 */
  inputVolume: number
  /** 输出音量 */
  outputVolume: number
  /** 是否启用降噪 */
  noiseSuppression: boolean
  /** 降噪强度 */
  noiseReductionLevel: number
  /** 是否启用回声抵消 */
  echoCancellation: boolean
}

/** 加入原生房间的参数 */
export interface NativeJoinRequest {
  /** 房间名称 */
  roomName: string
  /** LiveKit 身份 */
  identity: string
  /** 展示昵称 */
  displayName: string
  /** 音频偏好 */
  preferences: NativeAudioPreferences
}

/** 监听原生房间事件 */
export async function listenNativeRoomEvents(onState: (state: NativeRoomState) => void, onSound: (type: 'join' | 'leave') => void, onLevel: (level: number) => void, onError: (message: string) => void): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<NativeRoomState>('voice://room-state', (event) => onState(event.payload)),
    listen<'join' | 'leave'>('voice://room-sound', (event) => onSound(event.payload)),
    listen<number>('voice://microphone-level', (event) => onLevel(event.payload)),
    listen<string>('voice://error', (event) => onError(event.payload)),
  ])
  return () => unlisteners.forEach((unlisten) => unlisten())
}

/** 读取原生输入输出设备 */
export function listNativeAudioDevices(): Promise<NativeAudioDevices> {
  return invoke<NativeAudioDevices>('native_list_audio_devices')
}

/** 获取当前平台原生推理后端 */
export function getNativeAudioBackend(): Promise<NativeRoomState['inferenceBackend']> {
  return invoke<NativeRoomState['inferenceBackend']>('native_audio_backend')
}

/** 连接原生 LiveKit 房间 */
export function joinNativeRoom(request: NativeJoinRequest): Promise<void> {
  return invoke('native_join_room', { request })
}

/** 离开原生 LiveKit 房间 */
export function leaveNativeRoom(): Promise<void> {
  return invoke('native_leave_room')
}

/** 修改当前用户麦克风状态 */
export function setNativeMicrophoneMuted(muted: boolean): Promise<void> {
  return invoke('native_set_microphone_muted', { muted })
}

/** 修改当前用户输出状态 */
export function setNativeOutputMuted(muted: boolean): Promise<void> {
  return invoke('native_set_output_muted', { muted })
}

/** 修改原生全局音频偏好 */
export function updateNativeAudioPreferences(preferences: NativeAudioPreferences): Promise<void> {
  return invoke('native_update_audio_preferences', { preferences })
}

/** 修改本机听到的某位成员音量 */
export function setNativeParticipantVolume(identity: string, volume: number): Promise<void> {
  return invoke('native_set_participant_volume', { identity, volume })
}

/** 修改当前用户昵称并同步到原生房间 */
export function setNativeDisplayName(displayName: string): Promise<void> {
  return invoke('native_set_display_name', { displayName })
}
