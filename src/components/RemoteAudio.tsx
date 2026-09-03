import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'

/** 远端音频播放组件参数 */
interface RemoteAudioProps {
  /** LiveKit 远端音频轨道 */
  track: RemoteAudioTrack
  /** 播放音量，范围为 0 到 100 */
  volume: number
  /** 播放远端声音的输出设备标识 */
  outputDeviceId: string
  /** 输出设备切换失败时的回调 */
  onOutputError: (message: string) => void
}

/** 将远端音频轨道挂载到隐藏 audio 元素并控制输出音量 */
export function RemoteAudio({ track, volume, outputDeviceId, onOutputError }: RemoteAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    track.attach(element)
    element.volume = volume / 100
    return () => {
      track.detach(element)
    }
  }, [track])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100
  }, [volume])

  useEffect(() => {
    const element = audioRef.current
    if (!element) return
    if (!element.setSinkId) {
      if (outputDeviceId !== 'default') onOutputError('当前运行环境不支持选择音频输出设备')
      return
    }
    void element.setSinkId(outputDeviceId).catch((error: unknown) => {
      onOutputError(error instanceof Error ? `切换音频输出设备失败：${error.message}` : '切换音频输出设备失败')
    })
  }, [onOutputError, outputDeviceId])

  return <audio ref={audioRef} autoPlay />
}
