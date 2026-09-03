/** 房间事件提示音类型 */
export type RoomSoundType = 'join' | 'leave'

/** 音频上下文输出设备能力 */
interface AudioContextWithSinkId extends AudioContext {
  /** 切换音频上下文的输出设备 */
  setSinkId?: (sinkId: string) => Promise<void>
}

let roomSoundContext: AudioContextWithSinkId | null = null

/** 获取房间提示音共用的音频上下文 */
function getRoomSoundContext(): AudioContextWithSinkId {
  if (!roomSoundContext) roomSoundContext = new AudioContext() as AudioContextWithSinkId
  return roomSoundContext
}

/** 在用户操作期间提前解锁房间提示音播放能力 */
export async function prepareRoomSound(outputDeviceId: string): Promise<void> {
  const context = getRoomSoundContext()
  if (context.state === 'suspended') await context.resume()
  if (outputDeviceId !== 'default' && context.setSinkId) await context.setSinkId(outputDeviceId)
}

/** 播放进入或离开房间的短提示音 */
export async function playRoomSound(type: RoomSoundType, volume: number, muted: boolean, outputDeviceId: string): Promise<void> {
  if (muted || volume <= 0) return
  const context = getRoomSoundContext()
  await prepareRoomSound(outputDeviceId)

  const now = context.currentTime
  const gain = context.createGain()
  const oscillator = context.createOscillator()
  const peak = Math.min(1, volume / 100) * 0.08
  const frequencies = type === 'join' ? [523.25, 659.25] : [659.25, 523.25]
  const noteLength = 0.12

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequencies[0], now)
  oscillator.frequency.setValueAtTime(frequencies[1], now + noteLength)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.015)
  gain.gain.setValueAtTime(peak, now + noteLength)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + noteLength * 2)
  oscillator.connect(gain).connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + noteLength * 2)
}
