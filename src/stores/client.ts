import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** 客户端音频偏好实体 */
export interface AudioPreferences {
  /** 当前选择的麦克风设备标识 */
  inputDeviceId: string
  /** 当前选择的音频输出设备标识 */
  outputDeviceId: string
  /** 麦克风输入增益百分比 */
  inputVolume: number
  /** 扬声器输出音量百分比 */
  outputVolume: number
  /** 是否启用浏览器原生降噪约束 */
  noiseSuppression: boolean
  /** 是否启用回声抵消 */
  echoCancellation: boolean
  /** 是否启用自动声音增强 */
  autoGainControl: boolean
}

/** 需要持久化到当前设备的客户端状态实体 */
interface PersistedClientState {
  /** 浏览器开发模式下生成的稳定设备标识 */
  browserDeviceIdentity: string
  /** 用户保存的展示昵称 */
  displayName: string
  /** 当前音频偏好 */
  audioPreferences: AudioPreferences
  /** 按参与者身份保存的独立音量 */
  participantVolumes: Record<string, number>
}

/** 客户端状态及操作实体 */
interface ClientStore extends PersistedClientState {
  /** 保存浏览器开发模式下的设备标识 */
  setBrowserDeviceIdentity: (identity: string) => void
  /** 保存用户展示昵称 */
  setDisplayName: (displayName: string) => void
  /** 合并并保存音频偏好 */
  updateAudioPreferences: (patch: Partial<AudioPreferences>) => void
  /** 保存指定参与者的独立音量 */
  setParticipantVolume: (identity: string, volume: number) => void
  /** 清除指定参与者的独立音量 */
  resetParticipantVolume: (identity: string) => void
}

/** 默认音频偏好 */
const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  inputDeviceId: 'default',
  outputDeviceId: 'default',
  inputVolume: 100,
  outputVolume: 85,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
}

/** 将音量限制在客户端支持的百分比范围内 */
function normalizeVolume(volume: number): number {
  return Math.max(0, Math.min(100, volume))
}

/** 客户端持久化状态仓库 */
export const useClientStore = create<ClientStore>()(persist(
  (set) => ({
    browserDeviceIdentity: '',
    displayName: '',
    audioPreferences: DEFAULT_AUDIO_PREFERENCES,
    participantVolumes: {},
    setBrowserDeviceIdentity: (identity) => set({ browserDeviceIdentity: identity }),
    setDisplayName: (displayName) => set({ displayName: displayName.trim() }),
    updateAudioPreferences: (patch) => set((state) => ({
      audioPreferences: {
        ...state.audioPreferences,
        ...patch,
        inputVolume: patch.inputVolume === undefined ? state.audioPreferences.inputVolume : normalizeVolume(patch.inputVolume),
        outputVolume: patch.outputVolume === undefined ? state.audioPreferences.outputVolume : normalizeVolume(patch.outputVolume),
      },
    })),
    setParticipantVolume: (identity, volume) => set((state) => ({
      participantVolumes: {
        ...state.participantVolumes,
        [identity]: normalizeVolume(volume),
      },
    })),
    resetParticipantVolume: (identity) => set((state) => {
      const participantVolumes = { ...state.participantVolumes }
      delete participantVolumes[identity]
      return { participantVolumes }
    }),
  }),
  {
    name: 'voice-room.client-state',
    storage: createJSONStorage(() => localStorage),
    partialize: (state) => ({
      browserDeviceIdentity: state.browserDeviceIdentity,
      displayName: state.displayName,
      audioPreferences: state.audioPreferences,
      participantVolumes: state.participantVolumes,
    }),
  },
))
