import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** 客户端支持的最大音频增益百分比 */
export const MAX_AUDIO_VOLUME = 300

/** DeepFilterNet 支持的最大降噪强度 */
export const MAX_NOISE_REDUCTION_LEVEL = 100

/** 将音量限制在客户端支持范围内 */
function normalizeVolume(volume: number): number {
  return Math.max(0, Math.min(MAX_AUDIO_VOLUME, volume))
}

/** 将降噪强度限制在 DeepFilterNet 支持范围内 */
function normalizeNoiseReductionLevel(level: number): number {
  return Math.max(0, Math.min(MAX_NOISE_REDUCTION_LEVEL, level))
}

/** 客户端全局状态实体 */
export interface ClientState {
  /** 当前窗口是否最大化 */
  isMaximized: boolean
  /** 当前系统平台 */
  platform: string
  /** 当前用户显示名称 */
  displayName: string
  /** 上次使用的房间名称 */
  roomName: string
  /** 输入设备标识 */
  inputDeviceId: string
  /** 输出设备标识 */
  outputDeviceId: string
  /** 输入音量百分比 */
  inputVolume: number
  /** 输出音量百分比 */
  outputVolume: number
  /** 是否启用降噪 */
  noiseSuppression: boolean
  /** 降噪强度百分比 */
  noiseReductionLevel: number
  /** 是否启用回声抵消 */
  echoCancellation: boolean
  /** 本次会话中的成员独立音量 */
  participantVolumes: Record<string, number>
  /** 更新窗口最大化状态 */
  setMaximized: (value: boolean) => void
  /** 更新系统平台 */
  setPlatform: (value: string) => void
  /** 更新用户显示名称 */
  setDisplayName: (value: string) => void
  /** 更新房间名称 */
  setRoomName: (value: string) => void
  /** 更新音频设置 */
  setAudioPreferences: (
    patch: Partial<
      Pick<
        ClientState,
        | 'inputDeviceId'
        | 'outputDeviceId'
        | 'inputVolume'
        | 'outputVolume'
        | 'noiseSuppression'
        | 'noiseReductionLevel'
        | 'echoCancellation'
      >
    >
  ) => void
  /** 保存指定成员的独立音量 */
  setParticipantVolume: (identity: string, volume: number) => void
  /** 清除指定成员的独立音量 */
  resetParticipantVolume: (identity: string) => void
}

/** Zustand 持久化客户端状态 */
const useClientStore = create<ClientState>()(
  persist(
    (set) => ({
      isMaximized: false,
      platform: '',
      displayName: '',
      roomName: '周末闲聊',
      inputDeviceId: 'default',
      outputDeviceId: 'default',
      inputVolume: 100,
      outputVolume: 85,
      noiseSuppression: true,
      noiseReductionLevel: 80,
      echoCancellation: true,
      participantVolumes: {},
      setMaximized: (value) => set({ isMaximized: value }),
      setPlatform: (value) => set({ platform: value }),
      setDisplayName: (value) => set({ displayName: value }),
      setRoomName: (value) => set({ roomName: value }),
      setAudioPreferences: (patch) =>
        set((state) => ({
          ...patch,
          inputVolume: patch.inputVolume === undefined ? state.inputVolume : normalizeVolume(patch.inputVolume),
          outputVolume: patch.outputVolume === undefined ? state.outputVolume : normalizeVolume(patch.outputVolume),
          noiseReductionLevel:
            patch.noiseReductionLevel === undefined
              ? state.noiseReductionLevel
              : normalizeNoiseReductionLevel(patch.noiseReductionLevel)
        })),
      setParticipantVolume: (identity, volume) =>
        set((state) => ({
          participantVolumes: { ...state.participantVolumes, [identity]: normalizeVolume(volume) }
        })),
      resetParticipantVolume: (identity) =>
        set((state) => {
          const participantVolumes = { ...state.participantVolumes }
          delete participantVolumes[identity]
          return { participantVolumes }
        })
    }),
    {
      name: 'voice-island-client',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        displayName: state.displayName,
        roomName: state.roomName,
        inputDeviceId: state.inputDeviceId,
        outputDeviceId: state.outputDeviceId,
        inputVolume: state.inputVolume,
        outputVolume: state.outputVolume,
        noiseSuppression: state.noiseSuppression,
        noiseReductionLevel: state.noiseReductionLevel,
        echoCancellation: state.echoCancellation
      })
    }
  )
)

export default useClientStore
