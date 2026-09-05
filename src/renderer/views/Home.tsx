import {
  AudioMutedOutlined,
  AudioOutlined,
  EditOutlined,
  LoginOutlined,
  LogoutOutlined,
  MutedOutlined,
  SettingOutlined,
  SoundOutlined,
  WifiOutlined
} from '@ant-design/icons'
import SettingsModal, { type SettingsAudioDevice, type SettingsUpdateState } from '@renderer/components/Settings'
import useClientStore from '@renderer/store'
import { playRoomSound, prepareRoomSound } from '@renderer/utils/roomSound'
import {
  checkWebRtcSupport,
  createDefaultDisplayName,
  formatWebRtcError,
  getLocalIdentity
} from '@renderer/utils/webrtc'
import { Alert, Button, Card, Input, List, Modal, Popover, Slider, Tooltip, Typography } from 'antd'
import {
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack
} from 'livekit-client'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

/** 房间成员展示实体 */
interface ParticipantItem {
  /** LiveKit 身份 */
  identity: string
  /** 成员昵称 */
  name: string
  /** 是否正在发言 */
  speaking: boolean
  /** 是否静音 */
  muted: boolean
  /** 是否关闭声音输出 */
  outputMuted: boolean
}

/** 本机发言状态检测资源实体 */
interface LocalSpeakingMonitor {
  /** 音频处理上下文 */
  context: AudioContext
  /** 麦克风媒体流输入节点 */
  source: MediaStreamAudioSourceNode
  /** 麦克风电平分析节点 */
  analyser: AnalyserNode
  /** 防止检测音频被播放的静音节点 */
  silentGain: GainNode
  /** 电平检测定时器 */
  timer: number
  /** 连续静音帧数量 */
  silentFrames: number
}

/** 本机麦克风输入增益处理链实体 */
interface LocalInputPipeline {
  /** 原始麦克风媒体流 */
  stream: MediaStream
  /** 输入增益音频上下文 */
  context: AudioContext
  /** 原始麦克风输入节点 */
  source: MediaStreamAudioSourceNode
  /** 输入音量增益节点 */
  gain: GainNode
  /** 处理后媒体流输出节点 */
  destination: MediaStreamAudioDestinationNode
  /** 发布到 LiveKit 的音频轨道 */
  track: LocalAudioTrack
}

/** 远端声音全局输出处理链实体 */
interface RemoteOutputGraph {
  /** 远端声音输出上下文 */
  context: AudioContext
  /** 全局输出音量节点 */
  gain: GainNode
}

/** 成员独立音量菜单实体 */
interface ParticipantVolumeMenu {
  /** 参与者身份 */
  identity: string
  /** 参与者昵称 */
  name: string
  /** 菜单横坐标 */
  x: number
  /** 菜单纵坐标 */
  y: number
}

/** 远端成员音轨输出节点实体 */
interface RemoteTrackOutput {
  /** 远端成员身份 */
  identity: string
  /** 媒体元素输入节点 */
  source: MediaElementAudioSourceNode
  /** 成员独立音量节点 */
  gain: GainNode
  /** LiveKit 挂载的媒体元素 */
  element: HTMLMediaElement
}

/** 房间输入输出控制属性实体 */
interface AudioControlButtonProps {
  /** 控制的音频通道 */
  kind: 'input' | 'output'
  /** 当前是否关闭 */
  muted: boolean
  /** 当前音量百分比 */
  volume: number
  /** 切换关闭状态回调 */
  onToggle: () => void
  /** 音量变化回调 */
  onVolumeChange: (volume: number) => void
}

/** 房间底部输入输出控制按钮 */
function AudioControlButton({ kind, muted, volume, onToggle, onVolumeChange }: AudioControlButtonProps) {
  const isInput = kind === 'input'
  const channelName = isInput ? '麦克风输入' : '声音输出'
  const enabledIcon = isInput ? <AudioOutlined /> : <SoundOutlined />
  const disabledIcon = isInput ? <AudioMutedOutlined /> : <MutedOutlined />
  return (
    <Popover
      placement="top"
      trigger="hover"
      title={`${channelName} · ${muted ? '已关闭' : '已开启'}`}
      content={
        <div className="room-volume-popover">
          <div className="room-volume-heading">
            <span>音量</span>
            <strong>{volume}%</strong>
          </div>
          <Slider
            aria-label={`${channelName}音量`}
            min={0}
            max={300}
            value={volume}
            onChange={(nextValue: number | number[]) =>
              onVolumeChange(typeof nextValue === 'number' ? nextValue : nextValue[0])
            }
          />
        </div>
      }
    >
      <Button
        className="room-audio-control"
        type={muted ? 'primary' : 'default'}
        danger={muted}
        shape="circle"
        size="large"
        aria-label={muted ? `开启${channelName}` : `关闭${channelName}`}
        onClick={onToggle}
        icon={muted ? disabledIcon : enabledIcon}
      />
    </Popover>
  )
}

/** 成员独立音量菜单属性实体 */
interface ParticipantVolumePopoverProps {
  /** 当前菜单定位及成员信息 */
  menu: ParticipantVolumeMenu
  /** 当前成员音量百分比 */
  volume: number
  /** 当前成员是否临时静音 */
  muted: boolean
  /** 音量变化回调 */
  onChange: (volume: number) => void
  /** 临时静音切换回调 */
  onToggleMuted: () => void
  /** 恢复默认音量回调 */
  onReset: () => void
}

/** 展示成员独立音量右键菜单 */
function ParticipantVolumePopover({
  menu,
  volume,
  muted,
  onChange,
  onToggleMuted,
  onReset
}: ParticipantVolumePopoverProps) {
  return (
    <div
      className="participant-volume-menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="participant-volume-heading">
        <span>{menu.name}</span>
        <Button type={muted ? 'primary' : 'text'} danger={muted} size="small" onClick={onToggleMuted}>
          {muted ? '恢复声音' : '静音'}
        </Button>
      </div>
      <Slider
        aria-label={`${menu.name}的音量`}
        min={0}
        max={300}
        value={volume}
        disabled={muted}
        onChange={(nextValue: number | number[]) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])}
      />
      <div className="participant-volume-footer">
        <span>仅影响你听到的声音</span>
        <Button type="link" onClick={onReset}>
          恢复默认
        </Button>
      </div>
    </div>
  )
}

/** 将 LiveKit 参与者转换为页面实体 */
function toParticipantItem(
  participant: Pick<Participant, 'identity' | 'name' | 'isSpeaking' | 'trackPublications' | 'attributes'>
): ParticipantItem {
  return {
    identity: participant.identity,
    name: participant.name || participant.identity,
    speaking: participant.isSpeaking,
    muted: [...participant.trackPublications.values()].some(
      (publication) => publication.source === Track.Source.Microphone && publication.isMuted
    ),
    outputMuted: participant.attributes['voice.outputMuted'] === 'true'
  }
}

/** 语音房间主页 */
const Home: React.FC = () => {
  const room = useRef<Room | null>(null)
  const audioContainer = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [outputMuted, setOutputMuted] = useState(false)
  const [latency, setLatency] = useState<number | null>(null)
  const [participantVolumeMenu, setParticipantVolumeMenu] = useState<ParticipantVolumeMenu | null>(null)
  const [temporarilyMutedParticipants, setTemporarilyMutedParticipants] = useState<Set<string>>(new Set())
  const [participants, setParticipants] = useState<ParticipantItem[]>([])
  const [error, setError] = useState('')
  const [supportError, setSupportError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [nicknameOpen, setNicknameOpen] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [audioDevices, setAudioDevices] = useState<{ inputs: SettingsAudioDevice[]; outputs: SettingsAudioDevice[] }>({
    inputs: [],
    outputs: []
  })
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false)
  const [microphoneTestLevel, setMicrophoneTestLevel] = useState(0)
  const microphoneTestStream = useRef<MediaStream | null>(null)
  const microphoneTestContext = useRef<AudioContext | null>(null)
  const microphoneTestAnalyser = useRef<AnalyserNode | null>(null)
  const microphoneTestDelay = useRef<DelayNode | null>(null)
  const microphoneTestGain = useRef<GainNode | null>(null)
  const microphoneTestTimer = useRef<number | null>(null)
  const localSpeakingMonitor = useRef<LocalSpeakingMonitor | null>(null)
  const localInputPipeline = useRef<LocalInputPipeline | null>(null)
  const localSpeaking = useRef(false)
  const latencyTimer = useRef<number | null>(null)
  const remoteOutputGraph = useRef<RemoteOutputGraph | null>(null)
  const remoteTrackOutputs = useRef<Map<RemoteTrack, RemoteTrackOutput>>(new Map())
  const temporarilyMutedParticipantsRef = useRef<Set<string>>(new Set())
  const [update, setUpdate] = useState<SettingsUpdateState>({
    version: '开发版',
    availableVersion: '',
    status: '尚未检查更新',
    checking: false,
    installing: false,
    ready: false,
    progress: null
  })
  const displayName = useClientStore((state) => state.displayName)
  const roomName = useClientStore((state) => state.roomName)
  const setDisplayName = useClientStore((state) => state.setDisplayName)
  const setRoomName = useClientStore((state) => state.setRoomName)
  const outputVolume = useClientStore((state) => state.outputVolume)
  const inputVolume = useClientStore((state) => state.inputVolume)
  const noiseSuppression = useClientStore((state) => state.noiseSuppression)
  const echoCancellation = useClientStore((state) => state.echoCancellation)
  const noiseReductionLevel = useClientStore((state) => state.noiseReductionLevel)
  const inputDeviceId = useClientStore((state) => state.inputDeviceId)
  const outputDeviceId = useClientStore((state) => state.outputDeviceId)
  const setAudioPreferences = useClientStore((state) => state.setAudioPreferences)
  const participantVolumes = useClientStore((state) => state.participantVolumes)
  const setParticipantVolume = useClientStore((state) => state.setParticipantVolume)
  const resetParticipantVolume = useClientStore((state) => state.resetParticipantVolume)
  const participantList = useMemo(
    () => [...participants].sort((first, second) => first.identity.localeCompare(second.identity)),
    [participants]
  )

  /** 刷新当前房间成员列表 */
  const refreshParticipants = () => {
    const current = room.current
    if (!current) return
    const all = [current.localParticipant, ...current.remoteParticipants.values()]
    setParticipants(
      all.map((participant) => {
        const item = toParticipantItem(participant)
        if (participant === current.localParticipant) item.speaking = localSpeaking.current
        return item
      })
    )
  }

  /** 更新本机发言状态并立即刷新对应成员卡片 */
  const setLocalSpeaking = useCallback((speaking: boolean) => {
    if (localSpeaking.current === speaking) return
    localSpeaking.current = speaking
    const localIdentity = room.current?.localParticipant.identity
    if (!localIdentity) return
    setParticipants((current) =>
      current.map((participant) =>
        participant.identity === localIdentity ? { ...participant, speaking } : participant
      )
    )
  }, [])

  /** 停止本机发言状态检测并释放音频节点 */
  const stopLocalSpeakingMonitor = useCallback(() => {
    const monitor = localSpeakingMonitor.current
    if (monitor) {
      window.clearInterval(monitor.timer)
      monitor.source.disconnect()
      monitor.analyser.disconnect()
      monitor.silentGain.disconnect()
      void monitor.context.close()
      localSpeakingMonitor.current = null
    }
    setLocalSpeaking(false)
  }, [setLocalSpeaking])

  /** 使用本地麦克风电平即时检测本人是否正在说话 */
  const startLocalSpeakingMonitor = useCallback(async () => {
    stopLocalSpeakingMonitor()
    const microphoneTrack = room.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
      ?.mediaStreamTrack
    if (!microphoneTrack) throw new Error('未找到本机麦克风轨道，无法检测发言状态')
    const context = new AudioContext({ latencyHint: 'interactive' })
    await context.resume()
    const source = context.createMediaStreamSource(new MediaStream([microphoneTrack]))
    const analyser = context.createAnalyser()
    const silentGain = context.createGain()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.15
    silentGain.gain.value = 0
    source.connect(analyser)
    analyser.connect(silentGain)
    silentGain.connect(context.destination)
    const samples = new Uint8Array(analyser.fftSize)
    const monitor: LocalSpeakingMonitor = {
      context,
      source,
      analyser,
      silentGain,
      timer: 0,
      silentFrames: 0
    }
    // 每 40 毫秒读取一次本地电平，亮起立即响应，熄灭保留短暂迟滞以避免闪烁
    monitor.timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let energy = 0
      for (const sample of samples) {
        const normalized = (sample - 128) / 128
        energy += normalized * normalized
      }
      const speaking = Math.sqrt(energy / samples.length) >= 0.018
      if (speaking) {
        monitor.silentFrames = 0
        setLocalSpeaking(true)
        return
      }
      monitor.silentFrames += 1
      if (monitor.silentFrames >= 6) setLocalSpeaking(false)
    }, 40)
    localSpeakingMonitor.current = monitor
  }, [setLocalSpeaking, stopLocalSpeakingMonitor])

  /** 枚举系统音频输入输出设备并更新设置页列表 */
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioDevices({
        inputs: devices
          .filter((device) => device.kind === 'audioinput')
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label || '未命名麦克风',
            isDefault: device.deviceId === 'default'
          })),
        outputs: devices
          .filter((device) => device.kind === 'audiooutput')
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label || '未命名扬声器',
            isDefault: device.deviceId === 'default'
          }))
      })
    } catch (deviceError) {
      setError(formatWebRtcError(deviceError))
    }
  }, [])

  /** 停止麦克风测试并释放临时音频资源 */
  const stopMicrophoneTest = useCallback(() => {
    if (microphoneTestTimer.current !== null) {
      window.clearInterval(microphoneTestTimer.current)
      microphoneTestTimer.current = null
    }
    microphoneTestStream.current?.getTracks().forEach((track) => track.stop())
    microphoneTestStream.current = null
    void microphoneTestContext.current?.close()
    microphoneTestContext.current = null
    microphoneTestAnalyser.current = null
    microphoneTestDelay.current = null
    microphoneTestGain.current = null
    setMicrophoneTestLevel(0)
    setIsTestingMicrophone(false)
  }, [])

  /** 开始或停止麦克风输入电平测试 */
  const toggleMicrophoneTest = useCallback(async () => {
    if (isTestingMicrophone) {
      stopMicrophoneTest()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: inputDeviceId === 'default' ? undefined : { exact: inputDeviceId },
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation,
          noiseSuppression
        }
      })
      const context = new AudioContext({ latencyHint: 'interactive' })
      await context.resume()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      const monitorDelay = context.createDelay(1)
      const monitorGain = context.createGain()
      analyser.fftSize = 512
      monitorDelay.delayTime.value = 0.5
      source.connect(analyser)
      // 仅让麦克风测试耳返延迟 0.5 秒，房间内发布的语音仍保持实时
      analyser.connect(monitorDelay)
      monitorDelay.connect(monitorGain)
      monitorGain.gain.value = outputVolume / 100
      monitorGain.connect(context.destination)
      const data = new Uint8Array(analyser.fftSize)
      microphoneTestStream.current = stream
      microphoneTestContext.current = context
      microphoneTestAnalyser.current = analyser
      microphoneTestDelay.current = monitorDelay
      microphoneTestGain.current = monitorGain
      setIsTestingMicrophone(true)
      microphoneTestTimer.current = window.setInterval(() => {
        const currentAnalyser = microphoneTestAnalyser.current
        if (!currentAnalyser) return
        currentAnalyser.getByteTimeDomainData(data)
        let sum = 0
        for (const sample of data) {
          const normalized = (sample - 128) / 128
          sum += normalized * normalized
        }
        setMicrophoneTestLevel(Math.min(1, Math.sqrt(sum / data.length) * 3))
      }, 80)
    } catch (testError) {
      stopMicrophoneTest()
      setError(formatWebRtcError(testError))
    }
  }, [echoCancellation, inputDeviceId, isTestingMicrophone, noiseSuppression, outputVolume, stopMicrophoneTest])

  /** 停止本机麦克风输入处理链并释放媒体资源 */
  const stopLocalInputPipeline = useCallback(async () => {
    const pipeline = localInputPipeline.current
    if (!pipeline) return
    localInputPipeline.current = null
    stopLocalSpeakingMonitor()
    const currentRoom = room.current
    if (currentRoom) await currentRoom.localParticipant.unpublishTrack(pipeline.track, true)
    pipeline.stream.getTracks().forEach((track) => track.stop())
    pipeline.source.disconnect()
    pipeline.gain.disconnect()
    await pipeline.context.close()
  }, [stopLocalSpeakingMonitor])

  /** 创建带输入增益的麦克风轨道并发布到当前房间 */
  const startLocalInputPipeline = useCallback(
    async (deviceId: string) => {
      const currentRoom = room.current
      if (!currentRoom) throw new Error('当前未连接到房间')
      await stopLocalInputPipeline()
      const currentPreferences = useClientStore.getState()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: currentPreferences.echoCancellation,
          noiseSuppression: currentPreferences.noiseSuppression
        }
      })
      const context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
      await context.resume()
      const source = context.createMediaStreamSource(stream)
      const gain = context.createGain()
      const destination = context.createMediaStreamDestination()
      gain.gain.value = currentPreferences.inputVolume / 100
      source.connect(gain)
      gain.connect(destination)
      const processedTrack = destination.stream.getAudioTracks()[0]
      const track = new LocalAudioTrack(processedTrack, undefined, true, context)
      await currentRoom.localParticipant.publishTrack(track, { source: Track.Source.Microphone })
      localInputPipeline.current = { stream, context, source, gain, destination, track }
      await startLocalSpeakingMonitor()
    },
    [startLocalSpeakingMonitor, stopLocalInputPipeline]
  )

  /** 获取或创建远端声音全局输出处理链 */
  const getRemoteOutputGraph = useCallback(async (): Promise<RemoteOutputGraph> => {
    if (remoteOutputGraph.current) return remoteOutputGraph.current
    const context = new AudioContext({ latencyHint: 'interactive' })
    const gain = context.createGain()
    const currentPreferences = useClientStore.getState()
    gain.gain.value = outputMuted ? 0 : currentPreferences.outputVolume / 100
    gain.connect(context.destination)
    const sinkContext = context as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }
    if (sinkContext.setSinkId) {
      await sinkContext.setSinkId(
        currentPreferences.outputDeviceId === 'default' ? '' : currentPreferences.outputDeviceId
      )
    }
    await context.resume()
    remoteOutputGraph.current = { context, gain }
    return remoteOutputGraph.current
  }, [outputMuted])

  /** 关闭远端声音全局输出处理链 */
  const stopRemoteOutputGraph = useCallback(async () => {
    const graph = remoteOutputGraph.current
    if (!graph) return
    remoteOutputGraph.current = null
    remoteTrackOutputs.current.forEach((output) => {
      output.source.disconnect()
      output.gain.disconnect()
      output.element.remove()
    })
    remoteTrackOutputs.current.clear()
    await graph.context.close()
  }, [])

  /** 修改音频偏好并在已连接时立即应用设备和输出音量变化 */
  const changeAudioPreferences = useCallback(
    async (patch: Parameters<typeof setAudioPreferences>[0]) => {
      setAudioPreferences(patch)
      const currentRoom = room.current
      const shouldRestartInput =
        patch.inputDeviceId !== undefined ||
        patch.echoCancellation !== undefined ||
        patch.noiseSuppression !== undefined
      if (shouldRestartInput) stopMicrophoneTest()
      if (shouldRestartInput && currentRoom) {
        try {
          await startLocalInputPipeline(patch.inputDeviceId ?? useClientStore.getState().inputDeviceId)
          if (muted) {
            await localInputPipeline.current?.track.mute()
            stopLocalSpeakingMonitor()
          }
          refreshParticipants()
        } catch (deviceError) {
          setError(formatWebRtcError(deviceError))
        }
      }
      if (patch.inputVolume !== undefined && localInputPipeline.current) {
        localInputPipeline.current.gain.gain.setTargetAtTime(
          patch.inputVolume / 100,
          localInputPipeline.current.context.currentTime,
          0.015
        )
      }
      if (patch.outputVolume !== undefined) {
        const volume = Math.max(0, Math.min(300, patch.outputVolume)) / 100
        if (microphoneTestGain.current) microphoneTestGain.current.gain.value = volume
        const graph = remoteOutputGraph.current
        if (graph) graph.gain.gain.setTargetAtTime(outputMuted ? 0 : volume, graph.context.currentTime, 0.015)
      }
      if (patch.outputDeviceId !== undefined) {
        const sinkId = patch.outputDeviceId === 'default' ? '' : patch.outputDeviceId
        const sinkContext = remoteOutputGraph.current?.context as
          (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | undefined
        if (sinkContext?.setSinkId) {
          try {
            await sinkContext.setSinkId(sinkId)
          } catch (sinkError) {
            setError(formatWebRtcError(sinkError))
          }
        }
      }
    },
    [
      muted,
      outputMuted,
      refreshParticipants,
      setAudioPreferences,
      startLocalInputPipeline,
      stopLocalSpeakingMonitor,
      stopMicrophoneTest
    ]
  )

  /** 挂载远端音频轨道到隐藏音频容器 */
  const attachTrack = async (track: RemoteTrack, participant: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio || !audioContainer.current) return
    const element = track.attach()
    element.autoplay = true
    element.controls = false
    element.volume = 1
    const graph = await getRemoteOutputGraph()
    const source = graph.context.createMediaElementSource(element)
    const participantGain = graph.context.createGain()
    participantGain.gain.value = temporarilyMutedParticipantsRef.current.has(participant.identity)
      ? 0
      : (useClientStore.getState().participantVolumes[participant.identity] ?? 100) / 100
    source.connect(participantGain)
    participantGain.connect(graph.gain)
    remoteTrackOutputs.current.set(track, {
      identity: participant.identity,
      source,
      gain: participantGain,
      element
    })
    audioContainer.current.appendChild(element)
    await element.play()
  }

  /** 移除远端音轨对应的成员音量节点 */
  const detachTrack = useCallback((track: RemoteTrack) => {
    const output = remoteTrackOutputs.current.get(track)
    if (output) {
      output.source.disconnect()
      output.gain.disconnect()
      output.element.remove()
      remoteTrackOutputs.current.delete(track)
    }
    track.detach().forEach((element) => element.remove())
  }, [])

  /** 打开远端成员独立音量菜单 */
  const openParticipantVolumeMenu = (event: ReactMouseEvent, participant: ParticipantItem) => {
    event.preventDefault()
    if (participant.identity === room.current?.localParticipant.identity) return
    setParticipantVolumeMenu({
      identity: participant.identity,
      name: participant.name,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 240)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 170))
    })
  }

  /** 修改指定远端成员的独立音量 */
  const changeParticipantVolume = (identity: string, volume: number) => {
    setParticipantVolume(identity, volume)
    remoteTrackOutputs.current.forEach((output) => {
      if (output.identity === identity && !temporarilyMutedParticipantsRef.current.has(identity)) {
        output.gain.gain.setTargetAtTime(volume / 100, output.gain.context.currentTime, 0.015)
      }
    })
  }

  /** 临时静音或恢复指定远端成员 */
  const toggleParticipantMuted = (identity: string) => {
    const next = new Set(temporarilyMutedParticipantsRef.current)
    const shouldMute = !next.has(identity)
    if (shouldMute) next.add(identity)
    else next.delete(identity)
    temporarilyMutedParticipantsRef.current = next
    setTemporarilyMutedParticipants(next)
    const volume = participantVolumes[identity] ?? 100
    remoteTrackOutputs.current.forEach((output) => {
      if (output.identity === identity) {
        output.gain.gain.setTargetAtTime(shouldMute ? 0 : volume / 100, output.gain.context.currentTime, 0.015)
      }
    })
  }

  /** 恢复指定远端成员的默认音量 */
  const restoreParticipantVolume = (identity: string) => {
    resetParticipantVolume(identity)
    const next = new Set(temporarilyMutedParticipantsRef.current)
    next.delete(identity)
    temporarilyMutedParticipantsRef.current = next
    setTemporarilyMutedParticipants(next)
    remoteTrackOutputs.current.forEach((output) => {
      if (output.identity === identity) {
        output.gain.gain.setTargetAtTime(1, output.gain.context.currentTime, 0.015)
      }
    })
    setParticipantVolumeMenu(null)
  }

  /** 保存昵称并实时同步到当前 LiveKit 房间 */
  const changeDisplayName = useCallback(
    async (value: string) => {
      const normalized = value.slice(0, 24)
      setDisplayName(normalized)
      if (!normalized.trim() || !room.current) return
      try {
        await room.current.localParticipant.setName(normalized.trim())
        refreshParticipants()
      } catch (nameError) {
        setError(nameError instanceof Error ? nameError.message : '同步昵称失败')
      }
    },
    [setDisplayName]
  )

  /** 关闭或恢复当前用户听到的远端声音 */
  const toggleOutput = useCallback(async () => {
    const nextMuted = !outputMuted
    setOutputMuted(nextMuted)
    const graph = remoteOutputGraph.current
    if (graph) graph.gain.gain.setTargetAtTime(nextMuted ? 0 : outputVolume / 100, graph.context.currentTime, 0.015)
    try {
      await room.current?.localParticipant.setAttributes({ 'voice.outputMuted': String(nextMuted) })
      refreshParticipants()
    } catch (outputError) {
      setError(outputError instanceof Error ? outputError.message : '同步声音输出状态失败')
    }
  }, [outputMuted, outputVolume])

  /** 读取 LiveKit 信令往返延迟 */
  const refreshLatency = useCallback(() => {
    const signalRtt = room.current?.engine.client.rtt
    setLatency(typeof signalRtt === 'number' && signalRtt >= 0 ? Math.round(signalRtt) : null)
  }, [])

  /** 停止房间延迟定时读取 */
  const stopLatencyMonitor = useCallback(() => {
    if (latencyTimer.current !== null) {
      window.clearInterval(latencyTimer.current)
      latencyTimer.current = null
    }
    setLatency(null)
  }, [])

  /** 每两秒读取一次 LiveKit RTT 延迟 */
  const startLatencyMonitor = useCallback(() => {
    stopLatencyMonitor()
    refreshLatency()
    latencyTimer.current = window.setInterval(refreshLatency, 2000)
  }, [refreshLatency, stopLatencyMonitor])

  /** 检查应用更新并将结果展示在设置页 */
  const checkForUpdate = async () => {
    setUpdate((current) => ({ ...current, checking: true, status: '正在检查更新' }))
    try {
      const result = await window.appUpdate.check()
      setUpdate((current) => ({
        ...current,
        availableVersion: result.version || '',
        checking: false,
        installing: result.available,
        progress: result.available ? 0 : null,
        status: result.status
      }))
    } catch (updateError) {
      setUpdate((current) => ({ ...current, checking: false, status: formatWebRtcError(updateError) }))
    }
  }

  /** 退出应用并安装已经下载完成的更新 */
  const installUpdate = () => {
    setUpdate((current) => ({ ...current, installing: true, status: '正在退出并安装更新' }))
    void window.appUpdate.quitAndInstall()
  }

  /** 保存昵称并关闭弹窗 */
  const saveNickname = () => {
    const normalized = nicknameDraft.trim().slice(0, 24)
    if (!normalized) return
    void changeDisplayName(normalized)
    setNicknameOpen(false)
  }

  /** 加入 LiveKit 房间并打开 WebRTC 麦克风 */
  const joinRoom = async () => {
    setError('')
    const support = checkWebRtcSupport()
    if (!support.getUserMedia) {
      setSupportError(support.reason || '当前环境不支持 WebRTC')
      return
    }
    if (!roomName.trim() || connecting || connected || !displayName.trim()) return
    setConnecting(true)
    // 在网络连接开始前唤醒音频上下文，避免连接耗时过长后提示音被浏览器拦截
    await prepareRoomSound().catch(() => {})
    try {
      const token = await window.voice.requestToken({
        room: roomName.trim(),
        identity: getLocalIdentity(),
        name: displayName.trim()
      })
      const nextRoom = new Room({ adaptiveStream: true, dynacast: true })
      nextRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        void attachTrack(track, participant).catch((trackError) => setError(formatWebRtcError(trackError)))
      })
      nextRoom.on(RoomEvent.TrackUnsubscribed, (track) => {
        detachTrack(track)
      })
      nextRoom.on(RoomEvent.ParticipantConnected, refreshParticipants)
      nextRoom.on(RoomEvent.ParticipantDisconnected, refreshParticipants)
      nextRoom.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
      nextRoom.on(RoomEvent.ParticipantNameChanged, refreshParticipants)
      nextRoom.on(RoomEvent.ParticipantAttributesChanged, refreshParticipants)
      nextRoom.on(RoomEvent.TrackMuted, refreshParticipants)
      nextRoom.on(RoomEvent.TrackUnmuted, refreshParticipants)
      await nextRoom.connect(token.url, token.token)
      room.current = nextRoom
      await startLocalInputPipeline(useClientStore.getState().inputDeviceId)
      setConnected(true)
      setMuted(false)
      setOutputMuted(false)
      await nextRoom.localParticipant.setAttributes({ 'voice.outputMuted': 'false' })
      startLatencyMonitor()
      refreshParticipants()
      // 连接和麦克风初始化完成后播放提示音，确保用户一定能听到进入声音
      void playRoomSound(true, outputVolume).catch(() => {})
    } catch (joinError) {
      setError(formatWebRtcError(joinError))
      await stopLocalInputPipeline()
      await stopRemoteOutputGraph()
      await room.current?.disconnect()
      room.current = null
    } finally {
      setConnecting(false)
    }
  }

  /** 离开房间并停止所有本地媒体轨道 */
  const leaveRoom = async () => {
    // 先播放离开提示音，再断开房间和释放媒体轨道
    void playRoomSound(false, outputVolume).catch(() => {})
    stopLocalSpeakingMonitor()
    stopLatencyMonitor()
    await stopLocalInputPipeline()
    await stopRemoteOutputGraph()
    await room.current?.disconnect()
    room.current = null
    audioContainer.current?.replaceChildren()
    setConnected(false)
    setMuted(false)
    setOutputMuted(false)
    temporarilyMutedParticipantsRef.current = new Set()
    setTemporarilyMutedParticipants(new Set())
    setParticipantVolumeMenu(null)
    setParticipants([])
  }

  /** 切换当前用户麦克风静音状态 */
  const toggleMute = async () => {
    const next = !muted
    const microphoneTrack = localInputPipeline.current?.track
    if (!microphoneTrack) throw new Error('未找到本机麦克风轨道')
    if (next) await microphoneTrack.mute()
    else await microphoneTrack.unmute()
    setMuted(next)
    if (next) {
      stopLocalSpeakingMonitor()
    } else {
      await startLocalSpeakingMonitor()
    }
    refreshParticipants()
  }

  /** 初始化 WebRTC 支持状态和首次昵称弹窗 */
  useEffect(() => {
    const support = checkWebRtcSupport()
    if (!support.getUserMedia) setSupportError(support.reason || '当前环境不支持 WebRTC')
    if (!displayName.trim()) {
      const defaultName = createDefaultDisplayName(getLocalIdentity())
      setDisplayName(defaultName)
      setNicknameDraft(defaultName)
    }
    return () => {
      stopLocalSpeakingMonitor()
      stopLatencyMonitor()
      void stopLocalInputPipeline()
      void stopRemoteOutputGraph()
      void room.current?.disconnect()
    }
  }, [])

  /** 组件卸载时停止麦克风测试 */
  useEffect(() => () => stopMicrophoneTest(), [stopMicrophoneTest])

  /** 点击页面其他位置或窗口失焦时关闭成员音量菜单 */
  useEffect(() => {
    const closeMenu = () => setParticipantVolumeMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [])

  /** 设置弹窗打开时读取设备列表并订阅更新事件 */
  useEffect(() => {
    if (settingsOpen) void refreshDevices()
  }, [refreshDevices, settingsOpen])

  /** 初始化版本号并监听自动更新进度 */
  useEffect(() => {
    void window.appUpdate
      .getVersion()
      .then((version) => setUpdate((current) => ({ ...current, version })))
      .catch(() => {})
    const removeProgress = window.appUpdate.onProgress((progress) =>
      setUpdate((current) => ({
        ...current,
        installing: true,
        progress,
        status: `正在下载更新 ${Math.round(progress)}%`
      }))
    )
    const removeDownloaded = window.appUpdate.onDownloaded((version) =>
      setUpdate((current) => ({
        ...current,
        availableVersion: version.replace(/^v/, ''),
        installing: false,
        ready: true,
        progress: 100,
        status: '更新已下载，可以立即安装'
      }))
    )
    const removeError = window.appUpdate.onError((message) =>
      setUpdate((current) => ({ ...current, checking: false, installing: false, status: message }))
    )
    return () => {
      removeProgress()
      removeDownloaded()
      removeError()
    }
  }, [])

  return (
    <div className="home-page">
      <div className="home-glow home-glow-one" />
      <div className="home-glow home-glow-two" />
      <div className={`home-content ${connected ? 'room-mode' : ''}`}>
        {!connected && (
          <section className="hero-section">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-dot" /> 私人语音空间
              </div>
              <Typography.Title className="hero-title">
                让声音，<em>自然发生</em>
              </Typography.Title>
              <Typography.Paragraph className="hero-subtitle">
                一个简单、安静的语音空间。输入房间名，和朋友马上见面。
              </Typography.Paragraph>
            </div>
            <Button
              className="hero-settings"
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              设置
            </Button>
          </section>
        )}
        {supportError && (
          <Alert
            className="page-alert"
            type="warning"
            showIcon
            message="WebRTC 不可用"
            description={supportError}
            closable
            onClose={() => setSupportError('')}
          />
        )}
        {error && (
          <Alert className="page-alert" type="error" showIcon message={error} closable onClose={() => setError('')} />
        )}
        {!connected ? (
          <section className="welcome-grid">
            <div className="welcome-copy-column">
              <Card className="join-panel">
                <h2>进入你的房间</h2>
                <p>选择一个名字，马上开始聊天</p>
                <div className="join-form">
                  <label htmlFor="room-name">房间名称</label>
                  <Input
                    id="room-name"
                    size="large"
                    prefix={<span className="input-hash">#</span>}
                    value={roomName}
                    onChange={(event) => setRoomName(event.target.value)}
                    onPressEnter={() => void joinRoom()}
                    placeholder="例如：周末闲聊"
                  />
                  <Button
                    className="join-button"
                    type="primary"
                    size="large"
                    block
                    icon={<LoginOutlined />}
                    loading={connecting}
                    onClick={() => void joinRoom()}
                  >
                    进入房间
                  </Button>
                </div>
                <div className="join-footnote">
                  <span className="status-ring" /> 麦克风仅在进入房间后启用
                </div>
              </Card>
              <div className="identity-line">
                <div className="mini-avatar">{displayName.slice(0, 1)}</div>
                <span>
                  你将以 <strong>{displayName}</strong> 的身份进入
                </span>
                <Button
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setNicknameDraft(displayName)
                    setNicknameOpen(true)
                  }}
                >
                  修改
                </Button>
              </div>
            </div>
            <div className="welcome-visual">
              <div className="visual-orb">
                <div className="visual-orb-inner">
                  <SoundOutlined />
                </div>
              </div>
              <div className="visual-ring visual-ring-one" />
              <div className="visual-ring visual-ring-two" />
              <div className="visual-note visual-note-one">♪</div>
              <div className="visual-note visual-note-two">♫</div>
              <div className="visual-caption">
                <WifiOutlined /> 清晰的声音，舒服的距离
              </div>
            </div>
          </section>
        ) : (
          <section className="room-section">
            <div className="room-main-card">
              <div className="room-card-header">
                <div>
                  <div className="eyebrow">
                    <span className="live-indicator" /> 正在进行
                  </div>
                  <h2>#{roomName}</h2>
                </div>
                <Button danger icon={<LogoutOutlined />} onClick={() => void leaveRoom()}>
                  离开房间
                </Button>
              </div>
              <div className="participant-grid">
                {participantList.map((participant) => (
                  <div
                    className={`participant-tile ${participant.speaking ? 'is-speaking' : ''} ${
                      participant.identity === room.current?.localParticipant.identity ? '' : 'is-remote'
                    }`}
                    key={participant.identity}
                    onContextMenu={(event) => openParticipantVolumeMenu(event, participant)}
                  >
                    <div className="participant-avatar">{participant.name.slice(0, 1)}</div>
                    <strong>{participant.name}</strong>
                    <div className="speaking-state">
                      {participant.speaking && (
                        <span className="sound-bars" aria-label="正在讲话">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </div>
                    {(participant.muted || participant.outputMuted) && (
                      <div className="participant-icons">
                        {participant.muted && <AudioMutedOutlined aria-label="麦克风已关闭" />}
                        {participant.outputMuted && <MutedOutlined aria-label="声音输出已关闭" />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="room-toolbar">
                <AudioControlButton
                  kind="input"
                  muted={muted}
                  volume={inputVolume}
                  onToggle={() => void toggleMute()}
                  onVolumeChange={(volume) => void changeAudioPreferences({ inputVolume: volume })}
                />
                <AudioControlButton
                  kind="output"
                  muted={outputMuted}
                  volume={outputVolume}
                  onToggle={() => void toggleOutput()}
                  onVolumeChange={(volume) => void changeAudioPreferences({ outputVolume: volume })}
                />
                <span className="toolbar-status">
                  <WifiOutlined /> 低延迟连接 · {latency === null ? '检测中' : `${latency} ms`}
                </span>
                <Tooltip title="打开音频设置">
                  <Button
                    type="text"
                    shape="circle"
                    size="large"
                    icon={<SettingOutlined />}
                    onClick={() => setSettingsOpen(true)}
                  />
                </Tooltip>
              </div>
            </div>
            <aside className="room-side-card">
              <div className="side-card-title">
                <span>房间成员</span>
                <b>{participantList.length}</b>
              </div>
              <List
                dataSource={participantList}
                split={false}
                renderItem={(participant) => (
                  <List.Item
                    className={participant.identity === room.current?.localParticipant.identity ? '' : 'is-remote'}
                    onContextMenu={(event) => openParticipantVolumeMenu(event, participant)}
                  >
                    <List.Item.Meta
                      avatar={<div className="mini-avatar">{participant.name.slice(0, 1)}</div>}
                      title={
                        <div className="member-list-name">
                          <span>{participant.name}</span>
                          {(participant.muted || participant.outputMuted) && (
                            <span className="member-list-icons">
                              {participant.muted && <AudioMutedOutlined aria-label="麦克风已关闭" />}
                              {participant.outputMuted && <MutedOutlined aria-label="声音输出已关闭" />}
                            </span>
                          )}
                        </div>
                      }
                      description={
                        participant.speaking ? (
                          <span className="sound-bars" aria-label="正在讲话">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : undefined
                      }
                    />
                  </List.Item>
                )}
              />
              <div className="side-tip">右键成员可调节独立音量</div>
            </aside>
          </section>
        )}
        <div ref={audioContainer} className="hidden" />
      </div>
      {participantVolumeMenu && (
        <ParticipantVolumePopover
          menu={participantVolumeMenu}
          volume={participantVolumes[participantVolumeMenu.identity] ?? 100}
          muted={temporarilyMutedParticipants.has(participantVolumeMenu.identity)}
          onChange={(volume) => changeParticipantVolume(participantVolumeMenu.identity, volume)}
          onToggleMuted={() => toggleParticipantMuted(participantVolumeMenu.identity)}
          onReset={() => restoreParticipantVolume(participantVolumeMenu.identity)}
        />
      )}
      <Modal
        className="nickname-modal"
        title="修改昵称"
        open={nicknameOpen}
        maskClosable
        closable
        onCancel={() => setNicknameOpen(false)}
        footer={null}
        centered
      >
        <Input
          size="large"
          autoFocus
          maxLength={24}
          value={nicknameDraft}
          onChange={(event) => setNicknameDraft(event.target.value)}
          onPressEnter={saveNickname}
          placeholder="请输入昵称"
        />
        <Button type="primary" size="large" block onClick={saveNickname} disabled={!nicknameDraft.trim()}>
          保存昵称
        </Button>
      </Modal>
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          stopMicrophoneTest()
          setSettingsOpen(false)
        }}
        devices={audioDevices}
        preferences={{
          inputDeviceId,
          outputDeviceId,
          inputVolume,
          outputVolume,
          noiseSuppression,
          noiseReductionLevel,
          echoCancellation
        }}
        onChangePreferences={(patch) => void changeAudioPreferences(patch)}
        onRefreshDevices={() => void refreshDevices()}
        isTestingMicrophone={isTestingMicrophone}
        microphoneTestLevel={microphoneTestLevel}
        onTestMicrophone={() => void toggleMicrophoneTest()}
        displayName={displayName}
        onChangeDisplayName={(value) => void changeDisplayName(value)}
        update={update}
        onCheckUpdate={() => void checkForUpdate()}
        onInstallUpdate={installUpdate}
      />
    </div>
  )
}

export default Home
