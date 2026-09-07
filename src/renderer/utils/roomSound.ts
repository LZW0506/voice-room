let roomSoundContext: AudioContext | null = null

/** 获取用于播放房间提示音的共享音频上下文 */
function getRoomSoundContext(): AudioContext {
  if (!roomSoundContext) {
    roomSoundContext = new AudioContext({ latencyHint: 'interactive' })
  }
  return roomSoundContext
}

/** 在用户点击加入或离开房间时提前唤醒音频上下文 */
export async function prepareRoomSound(): Promise<void> {
  await getRoomSoundContext().resume()
}

/** 播放进入或离开房间的双音提示 */
export async function playRoomSound(joined: boolean, outputVolume: number): Promise<void> {
  const context = getRoomSoundContext()
  await context.resume()
  const now = context.currentTime + 0.01
  const master = context.createGain()
  const volume = Math.min(300, Math.max(0, outputVolume)) / 100
  master.gain.setValueAtTime(0.0001, now)
  master.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.08), now + 0.015)
  master.connect(context.destination)
  const frequencies = joined ? [523.25, 659.25] : [659.25, 523.25]
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    const start = now + index * 0.1
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(1, start + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.18)
    oscillator.connect(envelope).connect(master)
    oscillator.start(start)
    oscillator.stop(start + 0.2)
  })
  await new Promise<void>((resolve) => window.setTimeout(resolve, 280))
  master.disconnect()
}
