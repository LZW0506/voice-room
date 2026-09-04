import { useEffect, useRef } from 'react'
import type { RemoteAudioTrack } from 'livekit-client'
import { MAX_AUDIO_VOLUME } from '../stores/client'

/** 远端音频播放组件参数 */
interface RemoteAudioProps {
  /** LiveKit 远端音频轨道 */
  track: RemoteAudioTrack
  /** 播放增益百分比，范围为 0 到 300 */
  volume: number
  /** 播放远端声音的输出设备标识 */
  outputDeviceId: string
  /** 输出设备切换失败时的回调 */
  onOutputError: (message: string) => void
}

/** 将远端音频轨道接入 Web Audio 增益链路并从指定设备播放 */
export function RemoteAudio({ track, volume, outputDeviceId, onOutputError }: RemoteAudioProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const normalizedGain = Math.max(0, Math.min(MAX_AUDIO_VOLUME, volume)) / 100

  useEffect(() => {
    const element = audioRef.current
    if (!element) return

    const audioContext = new AudioContext()
    const sourceStream = new MediaStream([track.mediaStreamTrack])
    const sourceNode = audioContext.createMediaStreamSource(sourceStream)
    const gainNode = audioContext.createGain()
    const destinationNode = audioContext.createMediaStreamDestination()

    gainNode.gain.value = normalizedGain
    sourceNode.connect(gainNode).connect(destinationNode)
    element.srcObject = destinationNode.stream
    element.volume = 1
    audioContextRef.current = audioContext
    gainNodeRef.current = gainNode
    void audioContext.resume().then(() => element.play()).catch((error: unknown) => {
      onOutputError(error instanceof Error ? `播放远端声音失败：${error.message}` : '播放远端声音失败')
    })

    return () => {
      element.pause()
      element.srcObject = null
      sourceNode.disconnect()
      gainNode.disconnect()
      destinationNode.disconnect()
      gainNodeRef.current = null
      audioContextRef.current = null
      void audioContext.close()
    }
  }, [onOutputError, track])

  useEffect(() => {
    const audioContext = audioContextRef.current
    const gainNode = gainNodeRef.current
    if (!audioContext || !gainNode) return
    gainNode.gain.setTargetAtTime(normalizedGain, audioContext.currentTime, 0.01)
  }, [normalizedGain])

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
