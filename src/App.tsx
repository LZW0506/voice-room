import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Button, Input, Modal, Popover, Progress, Select, Slider, Switch, Tooltip } from 'antd'
import {
  ConnectionState,
  LocalAudioTrack,
  Participant,
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
} from 'livekit-client'
import { Mic, MicOff, Pencil, Radio, RefreshCw, Settings, Sparkles, Users, Volume2, VolumeX, Wifi } from 'lucide-react'
import { createDefaultRoom, formatParticipantCount, getParticipantInitial } from './lib/ui'
import { canSelectAudioOutputDevice, connectRoom, createProcessedMicrophone, createRoom, disposeMicrophone, fetchToken, getAudioOutputErrorMessage, getMicrophoneErrorMessage, getMicrophonePermissionGuide, getMicrophonePermissionState, getRoomLatency, listAudioInputDevices, listAudioOutputDevices, requestMicrophonePermission, selectAudioOutputDevice, type AudioInputDevice, type AudioOutputDevice, type MicrophonePermissionState, type MicrophoneResources } from './lib/livekit'
import { getDeviceProfile, saveDisplayName, type DeviceProfile } from './lib/device'
import { checkForAppUpdate, getAppVersion, installAppUpdate, type AppUpdate, type AppUpdateDownloadEvent } from './lib/updater'
import { RemoteAudio } from './components/RemoteAudio'
import { MAX_AUDIO_VOLUME, useClientStore, type AudioPreferences } from './stores/client'
import { playRoomSound, prepareRoomSound } from './lib/roomSound'

/** 房间内展示的参与者实体 */
interface ParticipantView {
  /** LiveKit 参与者对象 */
  participant: Participant
  /** 当前是否正在发言 */
  speaking: boolean
  /** 当前参与者是否关闭麦克风 */
  microphoneMuted: boolean
  /** 当前参与者是否关闭声音输出 */
  outputMuted: boolean
  /** 当前参与者在本次房间中的加入顺序 */
  order: number
}

/** 远端音频轨道展示实体 */
interface RemoteAudioTrackView {
  /** LiveKit 远端音频轨道 */
  track: RemoteAudioTrack
  /** 轨道所属参与者身份标识 */
  participantIdentity: string
}

/** 成员音量右键菜单实体 */
interface ParticipantVolumeMenu {
  /** 参与者身份标识 */
  identity: string
  /** 参与者展示名称 */
  name: string
  /** 右键菜单横坐标 */
  x: number
  /** 右键菜单纵坐标 */
  y: number
}

/** 麦克风测试资源实体 */
interface MicrophoneTestResources {
  /** 用于测试的媒体流 */
  stream: MediaStream
  /** 测试专用音频上下文 */
  audioContext: AudioContext
  /** 读取麦克风波形的分析器 */
  analyser: AnalyserNode
  /** 当前测试动画帧标识 */
  animationFrame: number
  /** 是否由测试流程创建媒体流 */
  ownsStream: boolean
}

/** LiveKit 参与者属性中的声音输出关闭状态键 */
const OUTPUT_MUTED_ATTRIBUTE = 'voice.outputMuted'

/** 判断指定参与者是否已经关闭麦克风 */
function isParticipantMicrophoneMuted(participant: Participant): boolean {
  const microphonePublication = Array.from(participant.audioTrackPublications.values())
    .find((publication) => publication.source === Track.Source.Microphone)
  return !microphonePublication || microphonePublication.isMuted
}

/** 判断指定参与者是否已经关闭声音输出 */
function isParticipantOutputMuted(participant: Participant): boolean {
  return participant.attributes[OUTPUT_MUTED_ATTRIBUTE] === 'true'
}

/** 获取系统默认端点对应的实际设备名称 */
function getDefaultAudioDeviceName(devices: Array<AudioInputDevice | AudioOutputDevice>): string {
  const defaultDevice = devices.find((device) => device.deviceId === 'default')
  const relatedDevice = devices.find((device) => device.deviceId !== 'default' && device.hasLabel && device.groupId && device.groupId === defaultDevice?.groupId)
  const deviceName = relatedDevice?.label || (defaultDevice?.hasLabel ? defaultDevice.label : '')
  return deviceName.replace(/^(default|默认)\s*(?:-|—|：|:)\s*/i, '').trim() || '当前默认设备'
}

/** 将权限请求返回的真实麦克风名称回填到系统默认设备 */
function mergeDefaultInputDevice(devices: AudioInputDevice[], permissionDevice: AudioInputDevice | null): AudioInputDevice[] {
  if (!permissionDevice?.label) return devices
  const hasDefaultDevice = devices.some((device) => device.deviceId === 'default')
  const updatedDevices = devices.map((device) => device.deviceId === permissionDevice.deviceId || device.deviceId === 'default'
    ? { ...device, label: permissionDevice.label, groupId: device.groupId || permissionDevice.groupId, hasLabel: true }
    : device)
  if (hasDefaultDevice) return updatedDevices
  return [{ ...permissionDevice, deviceId: 'default' }, ...updatedDevices]
}

/** 语音聊天室主页面 */
export default function App() {
  const [device, setDevice] = useState<DeviceProfile | null>(null)
  const [roomName, setRoomName] = useState(createDefaultRoom())
  const [connectedRoom, setConnectedRoom] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<RemoteAudioTrackView[]>([])
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([])
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDevice[]>([])
  const displayName = useClientStore((state) => state.displayName)
  const preferences = useClientStore((state) => state.audioPreferences)
  const participantVolumes = useClientStore((state) => state.participantVolumes)
  const updateAudioPreferences = useClientStore((state) => state.updateAudioPreferences)
  const setParticipantVolume = useClientStore((state) => state.setParticipantVolume)
  const clearParticipantVolume = useClientStore((state) => state.resetParticipantVolume)
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermissionState>('prompt')
  const [isMuted, setIsMuted] = useState(true)
  const [isOutputMuted, setIsOutputMuted] = useState(false)
  const [isTestingMicrophone, setIsTestingMicrophone] = useState(false)
  const [microphoneTestLevel, setMicrophoneTestLevel] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [isNameEditing, setIsNameEditing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [latency, setLatency] = useState<number | null>(null)
  const [appVersion, setAppVersion] = useState('读取中')
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null)
  const [updateStatus, setUpdateStatus] = useState('尚未检查更新')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false)
  const [participantVolumeMenu, setParticipantVolumeMenu] = useState<ParticipantVolumeMenu | null>(null)
  const [temporarilyMutedParticipants, setTemporarilyMutedParticipants] = useState<Set<string>>(new Set())
  const roomRef = useRef<Room | null>(null)
  const microphoneRef = useRef<MicrophoneResources | null>(null)
  const microphoneTestRef = useRef<MicrophoneTestResources | null>(null)
  const hasRequestedAudioAccessRef = useRef(false)
  const availableUpdateRef = useRef<AppUpdate | null>(null)
  const updateCheckInProgressRef = useRef(false)
  const updateInstallInProgressRef = useRef(false)
  const downloadedUpdateBytesRef = useRef(0)
  const updateContentLengthRef = useRef<number | undefined>(undefined)
  const participantOrderRef = useRef(new Map<string, number>())
  const nextParticipantOrderRef = useRef(0)
  const soundPreferencesRef = useRef({ outputVolume: preferences.outputVolume, outputDeviceId: preferences.outputDeviceId, muted: isOutputMuted })

  useEffect(() => {
    soundPreferencesRef.current = { outputVolume: preferences.outputVolume, outputDeviceId: preferences.outputDeviceId, muted: isOutputMuted }
  }, [isOutputMuted, preferences.outputDeviceId, preferences.outputVolume])

  /** 播放遵循当前输出设置的房间事件提示音 */
  const playCurrentRoomSound = useCallback((type: 'join' | 'leave') => {
    const soundPreferences = soundPreferencesRef.current
    void playRoomSound(type, soundPreferences.outputVolume, soundPreferences.muted, soundPreferences.outputDeviceId).catch(() => undefined)
  }, [])

  /** 保存本次检测到的更新并释放已失效的更新资源 */
  const saveAvailableUpdate = useCallback((update: AppUpdate | null) => {
    const previousUpdate = availableUpdateRef.current
    if (previousUpdate && previousUpdate !== update) void previousUpdate.close()
    availableUpdateRef.current = update
    setAvailableUpdate(update)
  }, [])

  /** 检查桌面应用更新并同步设置页中的更新状态 */
  const performUpdateCheck = useCallback(async (showLatestResult: boolean) => {
    if (updateCheckInProgressRef.current || updateInstallInProgressRef.current) return
    updateCheckInProgressRef.current = true
    setIsCheckingUpdate(true)
    setUpdateStatus('正在检查更新')
    try {
      const currentVersion = await getAppVersion()
      setAppVersion(currentVersion)
      if (currentVersion === '开发版') {
        setUpdateStatus('开发模式不检查更新')
        return
      }
      const update = await checkForAppUpdate()
      saveAvailableUpdate(update)
      if (update) {
        setUpdateStatus(`发现新版本 v${update.version}`)
        setShowUpdatePrompt(true)
      } else {
        setUpdateStatus('当前已是最新版本')
        if (showLatestResult) setShowUpdatePrompt(false)
      }
    } catch (updateError) {
      setUpdateStatus('检查更新失败')
      if (showLatestResult) setError(updateError instanceof Error ? updateError.message : '检查更新失败')
    } finally {
      updateCheckInProgressRef.current = false
      setIsCheckingUpdate(false)
    }
  }, [saveAvailableUpdate])

  /** 根据下载事件计算并展示应用更新进度 */
  const handleUpdateDownload = useCallback((event: AppUpdateDownloadEvent) => {
    if (event.event === 'Started') {
      downloadedUpdateBytesRef.current = 0
      updateContentLengthRef.current = event.data.contentLength
      setUpdateProgress(event.data.contentLength ? 0 : null)
      return
    }
    if (event.event === 'Progress') {
      downloadedUpdateBytesRef.current += event.data.chunkLength
      const contentLength = updateContentLengthRef.current
      if (contentLength) setUpdateProgress(Math.min(100, Math.round(downloadedUpdateBytesRef.current / contentLength * 100)))
      return
    }
    setUpdateProgress(100)
  }, [])

  /** 下载并安装当前检测到的新版本 */
  const startAppUpdate = useCallback(async () => {
    const update = availableUpdateRef.current
    if (!update || updateInstallInProgressRef.current) return
    updateInstallInProgressRef.current = true
    setError('')
    setIsInstallingUpdate(true)
    setUpdateStatus(`正在更新到 v${update.version}`)
    setUpdateProgress(0)
    try {
      await installAppUpdate(update, handleUpdateDownload)
    } catch (updateError) {
      setUpdateStatus('安装更新失败')
      setError(updateError instanceof Error ? updateError.message : '安装更新失败')
      updateInstallInProgressRef.current = false
      setIsInstallingUpdate(false)
    }
  }, [handleUpdateDownload])

  /** 关闭更新提示但保留设置页中的更新信息 */
  const dismissUpdatePrompt = () => {
    setShowUpdatePrompt(false)
  }

  /** 刷新系统中可供浏览器使用的输入与输出设备 */
  const refreshAudioDevices = useCallback(async () => {
    setIsLoadingDevices(true)
    try {
      const [inputs, outputs] = await Promise.all([listAudioInputDevices(), listAudioOutputDevices()])
      setAudioInputDevices(inputs)
      setAudioOutputDevices(outputs)
    } catch (deviceError) {
      setError(deviceError instanceof Error ? deviceError.message : '读取音频设备失败')
    } finally {
      setIsLoadingDevices(false)
    }
  }, [])

  /** 启动时检查麦克风授权并读取全部音频设备，仅在未授权时触发系统申请 */
  const requestAudioAccess = useCallback(async () => {
    setError('')
    setIsLoadingDevices(true)
    try {
      const permissionState = await getMicrophonePermissionState()
      if (permissionState === 'granted') {
        setMicrophonePermission('granted')
        const [inputs, outputs] = await Promise.all([listAudioInputDevices(), listAudioOutputDevices()])
        setAudioInputDevices(inputs)
        setAudioOutputDevices(outputs)
        return
      }
      const permissionDevice = await requestMicrophonePermission()
      setMicrophonePermission('granted')
      const [inputs, outputs] = await Promise.all([listAudioInputDevices(), listAudioOutputDevices()])
      setAudioInputDevices(mergeDefaultInputDevice(inputs, permissionDevice))
      setAudioOutputDevices(outputs)
    } catch (permissionError) {
      setMicrophonePermission(await getMicrophonePermissionState())
      setError(getMicrophoneErrorMessage(permissionError))
      await refreshAudioDevices()
    } finally {
      setIsLoadingDevices(false)
    }
  }, [refreshAudioDevices])

  useEffect(() => {
    getDeviceProfile().then((profile) => {
      setDevice(profile)
      setNameDraft(profile.displayName)
    }).catch(() => setError('无法读取设备身份'))
  }, [])

  useEffect(() => {
    void performUpdateCheck(false)
  }, [])

  useEffect(() => {
    if (!hasRequestedAudioAccessRef.current) {
      hasRequestedAudioAccessRef.current = true
      void requestAudioAccess()
    }
    navigator.mediaDevices?.addEventListener('devicechange', refreshAudioDevices)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshAudioDevices)
  }, [refreshAudioDevices, requestAudioAccess])

  /** 同步房间内参与者与远端音频轨道到 React 状态 */
  const syncRoomState = useCallback((room: Room) => {
    const allParticipants: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
      .sort((first, second) => {
        const joinedAtDifference = (first.joinedAt?.getTime() ?? 0) - (second.joinedAt?.getTime() ?? 0)
        if (joinedAtDifference !== 0) return joinedAtDifference
        return first.identity.localeCompare(second.identity)
      })
    const activeIdentities = new Set(allParticipants.map((participant) => participant.identity))
    participantOrderRef.current.forEach((_, identity) => {
      if (!activeIdentities.has(identity)) participantOrderRef.current.delete(identity)
    })
    allParticipants.forEach((participant) => {
      if (!participantOrderRef.current.has(participant.identity)) {
        participantOrderRef.current.set(participant.identity, nextParticipantOrderRef.current)
        nextParticipantOrderRef.current += 1
      }
    })
    setParticipants(allParticipants.map((participant) => ({
      participant,
      speaking: participant.isSpeaking,
      microphoneMuted: isParticipantMicrophoneMuted(participant),
      outputMuted: isParticipantOutputMuted(participant),
      order: participantOrderRef.current.get(participant.identity) ?? Number.MAX_SAFE_INTEGER,
    })))
    const tracks: RemoteAudioTrackView[] = []
    room.remoteParticipants.forEach((participant) => participant.audioTrackPublications.forEach((publication) => {
      if (publication.track?.kind === Track.Kind.Audio) tracks.push({
        track: publication.track as RemoteAudioTrack,
        participantIdentity: participant.identity,
      })
    }))
    setRemoteAudioTracks(tracks)
  }, [])

  /** 绑定 LiveKit 事件，让界面随参与者和轨道变化更新 */
  const bindRoomEvents = useCallback((room: Room) => {
    const update = () => syncRoomState(room)
    const handleParticipantConnected = () => {
      playCurrentRoomSound('join')
      update()
    }
    const removeTemporaryMute = (participant: Participant) => {
      setTemporarilyMutedParticipants((current) => {
        if (!current.has(participant.identity)) return current
        const next = new Set(current)
        next.delete(participant.identity)
        return next
      })
      playCurrentRoomSound('leave')
      update()
    }
    const updateSpeaking = (speakers: Participant[]) => {
      const speakingIdentities = new Set(speakers.map((participant) => participant.identity))
      setParticipants((current) => current.map((view) => ({
        ...view,
        speaking: speakingIdentities.has(view.participant.identity),
      })))
    }
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, removeTemporaryMute)
    room.on(RoomEvent.TrackPublished, update)
    room.on(RoomEvent.TrackUnpublished, update)
    room.on(RoomEvent.TrackSubscribed, update)
    room.on(RoomEvent.TrackUnsubscribed, update)
    room.on(RoomEvent.TrackMuted, update)
    room.on(RoomEvent.TrackUnmuted, update)
    room.on(RoomEvent.ParticipantAttributesChanged, update)
    room.on(RoomEvent.ParticipantNameChanged, update)
    room.on(RoomEvent.ActiveSpeakersChanged, updateSpeaking)
    room.on(RoomEvent.LocalTrackPublished, update)
    room.on(RoomEvent.LocalTrackUnpublished, update)
    room.on(RoomEvent.ConnectionStateChanged, (state) => setConnectionState(state))
    syncRoomState(room)
  }, [playCurrentRoomSound, syncRoomState])

  /** 创建并发布当前设置对应的麦克风轨道 */
  const publishMicrophone = async (room: Room) => {
    if (microphoneRef.current) return
    const microphone = await createProcessedMicrophone(
      preferences.inputVolume,
      preferences.noiseSuppression,
      preferences.echoCancellation,
      preferences.autoGainControl,
      preferences.inputDeviceId,
    )
    try {
      await room.localParticipant.publishTrack(microphone.track, { name: 'microphone', source: Track.Source.Microphone })
      microphoneRef.current = microphone
      setIsMuted(false)
      syncRoomState(room)
      void refreshAudioDevices()
    } catch (publishError) {
      await disposeMicrophone(microphone)
      throw publishError
    }
  }

  /** 进入指定语音房间并连接 LiveKit */
  const joinRoom = async () => {
    const normalizedRoom = roomName.trim()
    if (!normalizedRoom || !device || isConnecting) return
    void prepareRoomSound(preferences.outputDeviceId).catch(() => undefined)
    setError('')
    setIsConnecting(true)
    try {
      const token = await fetchToken({ room: normalizedRoom, identity: device.identity, name: displayName })
      const room = createRoom(() => {
        setConnectedRoom('')
        setConnectionState(ConnectionState.Disconnected)
        setTemporarilyMutedParticipants(new Set())
      })
      await connectRoom(room, token)
      roomRef.current = room
      participantOrderRef.current.clear()
      nextParticipantOrderRef.current = 0
      setTemporarilyMutedParticipants(new Set())
      bindRoomEvents(room)
      setConnectionState(ConnectionState.Connected)
      setIsOutputMuted(false)
      await room.localParticipant.setAttributes({ [OUTPUT_MUTED_ATTRIBUTE]: 'false' })
      try {
        await publishMicrophone(room)
      } catch (microphoneError) {
        setIsMuted(true)
        setError(getMicrophoneErrorMessage(microphoneError))
      }
      setConnectedRoom(normalizedRoom)
      playCurrentRoomSound('join')
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : '加入房间失败')
    } finally {
      setIsConnecting(false)
    }
  }

  /** 离开当前房间并释放麦克风和网络资源 */
  const leaveRoom = async () => {
    playCurrentRoomSound('leave')
    if (microphoneRef.current) {
      await disposeMicrophone(microphoneRef.current)
      microphoneRef.current = null
    }
    roomRef.current?.disconnect()
    roomRef.current = null
    setConnectedRoom('')
    setParticipants([])
    setRemoteAudioTracks([])
    setParticipantVolumeMenu(null)
    setTemporarilyMutedParticipants(new Set())
    participantOrderRef.current.clear()
    nextParticipantOrderRef.current = 0
    setIsMuted(true)
    setIsOutputMuted(false)
    setConnectionState(ConnectionState.Disconnected)
  }

  /** 停止发布当前麦克风并释放本机音频资源 */
  const unpublishMicrophone = async (room: Room) => {
    const microphone = microphoneRef.current
    if (!microphone) return
    await room.localParticipant.unpublishTrack(microphone.track)
    await disposeMicrophone(microphone)
    microphoneRef.current = null
    setIsMuted(true)
    syncRoomState(room)
  }

  /** 打开或关闭麦克风，开启时使用回声消除、降噪和自动增益 */
  const toggleMicrophone = async () => {
    const room = roomRef.current
    if (!room) return
    setError('')
    try {
      if (microphoneRef.current) {
        await unpublishMicrophone(room)
        return
      }
      await publishMicrophone(room)
    } catch (microphoneError) {
      setError(getMicrophoneErrorMessage(microphoneError))
    }
  }

  /** 切换当前用户的声音输出状态并同步给房间成员 */
  const toggleAudioOutput = async () => {
    const room = roomRef.current
    if (!room) return
    const nextMuted = !isOutputMuted
    setError('')
    setIsOutputMuted(nextMuted)
    try {
      await room.localParticipant.setAttributes({ [OUTPUT_MUTED_ATTRIBUTE]: String(nextMuted) })
      syncRoomState(room)
    } catch (outputError) {
      setIsOutputMuted(!nextMuted)
      setError(outputError instanceof Error ? outputError.message : '同步声音输出状态失败')
    }
  }

  /** 保存昵称并同步到当前 LiveKit 参与者 */
  const commitName = async () => {
    const nextName = nameDraft.trim().slice(0, 24)
    if (!nextName || !device) return
    saveDisplayName(nextName)
    setIsNameEditing(false)
    await roomRef.current?.localParticipant.setName(nextName)
    if (roomRef.current) syncRoomState(roomRef.current)
  }

  /** 更新音频偏好并立即调整当前麦克风增益 */
  const changePreferences = (patch: Partial<AudioPreferences>) => {
    updateAudioPreferences(patch)
    if (patch.inputVolume !== undefined && microphoneRef.current) microphoneRef.current.gainNode.gain.value = patch.inputVolume / 100
  }

  /** 打开指定成员的本机独立音量菜单 */
  const openParticipantVolumeMenu = (event: ReactMouseEvent, participant: Participant) => {
    event.preventDefault()
    if (participant.identity === device?.identity) return
    const menuWidth = 224
    const menuHeight = 148
    setParticipantVolumeMenu({
      identity: participant.identity,
      name: participant.name || participant.identity,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - menuWidth - 8)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - menuHeight - 8)),
    })
  }

  /** 更新指定成员的本机独立音量 */
  const changeParticipantVolume = (identity: string, volume: number) => {
    setParticipantVolume(identity, volume)
  }

  /** 恢复指定成员的默认音量 */
  const resetParticipantVolume = (identity: string) => {
    clearParticipantVolume(identity)
    setParticipantVolumeMenu(null)
  }

  /** 临时静音或恢复指定成员的声音 */
  const toggleParticipantMuted = (identity: string) => {
    setTemporarilyMutedParticipants((current) => {
      const next = new Set(current)
      if (next.has(identity)) next.delete(identity)
      else next.add(identity)
      return next
    })
  }

  /** 打开音频设置并读取最新的设备列表 */
  const openAudioSettings = () => {
    setShowSettings(true)
    void refreshAudioDevices()
  }

  /** 停止麦克风测试并释放测试资源 */
  const stopMicrophoneTest = () => {
    const resources = microphoneTestRef.current
    if (!resources) return
    window.cancelAnimationFrame(resources.animationFrame)
    resources.audioContext.close().catch(() => undefined)
    if (resources.ownsStream) resources.stream.getTracks().forEach((track) => track.stop())
    microphoneTestRef.current = null
    setIsTestingMicrophone(false)
    setMicrophoneTestLevel(0)
  }

  /** 开始读取麦克风实时波形并展示测试电平 */
  const testMicrophone = async () => {
    if (microphoneTestRef.current) {
      stopMicrophoneTest()
      return
    }
    setError('')
    let stream: MediaStream | null = microphoneRef.current?.rawStream || null
    let ownsStream = false
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: preferences.inputDeviceId === 'default' ? undefined : { exact: preferences.inputDeviceId },
            channelCount: 1,
          },
        })
        ownsStream = true
      }
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const updateLevel = () => {
        analyser.getByteTimeDomainData(data)
        const average = data.reduce((total, value) => total + Math.abs(value - 128), 0) / data.length
        setMicrophoneTestLevel(Math.min(1, average / 32))
        const resources = microphoneTestRef.current
        if (resources) resources.animationFrame = window.requestAnimationFrame(updateLevel)
      }
      microphoneTestRef.current = { stream, audioContext, analyser, animationFrame: window.requestAnimationFrame(updateLevel), ownsStream }
      setIsTestingMicrophone(true)
    } catch (testError) {
      if (ownsStream) stream?.getTracks().forEach((track) => track.stop())
      setError(getMicrophoneErrorMessage(testError))
    }
  }

  /** 打开浏览器输出设备选择器并保存用户授权的设备 */
  const chooseAudioOutput = async () => {
    setError('')
    try {
      const selectedDevice = await selectAudioOutputDevice()
      setAudioOutputDevices((current) => current.some((device) => device.deviceId === selectedDevice.deviceId) ? current : [...current, selectedDevice])
      changePreferences({ outputDeviceId: selectedDevice.deviceId })
    } catch (outputError) {
      setError(getAudioOutputErrorMessage(outputError))
    }
  }

  /** 展示音频输出设备切换异常 */
  const handleOutputError = useCallback((message: string) => {
    setError(message)
  }, [])

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect()
      microphoneRef.current?.rawStream.getTracks().forEach((track) => track.stop())
      void microphoneRef.current?.audioContext.close()
      void availableUpdateRef.current?.close()
      stopMicrophoneTest()
    }
  }, [])

  useEffect(() => {
    /** 点击菜单外部时关闭成员音量菜单 */
    const closeMenu = () => setParticipantVolumeMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [])

  useEffect(() => {
    if (!showSettings) stopMicrophoneTest()
  }, [showSettings])

  useEffect(() => {
    const room = roomRef.current
    if (!connectedRoom || !room) {
      setLatency(null)
      return
    }
    let disposed = false
    const refreshLatency = async () => {
      const nextLatency = await getRoomLatency(room).catch(() => null)
      if (!disposed && roomRef.current === room) setLatency(nextLatency)
    }
    void refreshLatency()
    const timer = window.setInterval(() => void refreshLatency(), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [connectedRoom])

  const orderedParticipants = useMemo(() => [...participants].sort((first, second) => first.order - second.order), [participants])
  const hasMicrophoneDeviceAccess = microphonePermission === 'granted' || audioInputDevices.some((device) => device.hasLabel)
  const defaultInputLabel = getDefaultAudioDeviceName(audioInputDevices)
  const defaultOutputLabel = getDefaultAudioDeviceName(audioOutputDevices)
  const isConnected = connectionState === ConnectionState.Connected || connectionState === ConnectionState.Connecting

  /** 根据往返延迟返回对应的主题颜色级别 */
  const latencyLevel = latency === null ? 'pending' : latency <= 100 ? 'good' : latency <= 200 ? 'warning' : 'bad'

  return (
    <main className="app-shell" onContextMenu={(event) => event.preventDefault()}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Radio size={18} /></div><span>声屿</span><small>VOICE ROOM</small></div>
        <div className="top-actions"><div className="status-pill"><span className={`status-dot ${isConnected ? 'online' : ''}`} />{isConnected ? '服务在线' : '等待连接'}</div><Tooltip title="打开音频设置"><Button type="text" shape="circle" aria-label="打开音频设置" onClick={openAudioSettings} icon={<Settings size={18} />} /></Tooltip></div>
      </header>

      {!connectedRoom ? (
        <section className="welcome-layout">
          <div className="welcome-copy">
            <div className="eyebrow"><Sparkles size={14} /> 轻松进入，随时开聊</div>
            <h1>让声音，<em>自然发生</em></h1>
            <p>一个简单、安静的语音空间。输入房间名，和朋友马上见面。</p>
            <div className="join-card"><label htmlFor="room-name">房间名称</label><div className="room-input"><span>＃</span><Input variant="borderless" id="room-name" value={roomName} onChange={(event) => setRoomName(event.target.value)} onPressEnter={() => void joinRoom()} placeholder="例如：周末闲聊" /></div><Button type="primary" block size="large" onClick={() => void joinRoom()} disabled={!device || isConnecting} loading={isConnecting}>进入房间 <span>→</span></Button></div>
            <div className="identity-line"><div className="avatar avatar-small">{getParticipantInitial(displayName)}</div><span>你将以 <strong>{displayName || '生成中…'}</strong> 的身份进入</span><Button type="link" onClick={() => { setNameDraft(displayName); setIsNameEditing(true) }} icon={<Pencil size={13} />}>修改</Button></div>
          </div>
          <div className="welcome-art"><div className="orb orb-main"><div className="orb-core"><Radio size={40} /></div></div><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="floating-note note-a">♪</div><div className="floating-note note-b">♫</div><div className="art-caption"><span className="pulse-line" /> 清晰的声音，舒服的距离</div></div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-main"><div className="room-heading"><div><div className="eyebrow"><span className="live-dot" /> 正在进行</div><h2>＃{connectedRoom}</h2></div><Button type="default" onClick={() => void leaveRoom()}>离开房间</Button></div><div className="people-grid">{orderedParticipants.map(({ participant, speaking, microphoneMuted, outputMuted }) => <ParticipantCard key={participant.identity} participant={participant} speaking={speaking} microphoneMuted={microphoneMuted} isSelf={participant.identity === device?.identity} outputMuted={participant.identity === device?.identity ? isOutputMuted : outputMuted} onContextMenu={openParticipantVolumeMenu} />)}</div><div className="room-controls"><AudioControlButton kind="input" muted={isMuted} volume={preferences.inputVolume} onToggle={() => void toggleMicrophone()} onVolumeChange={(volume) => changePreferences({ inputVolume: volume })} /><AudioControlButton kind="output" muted={isOutputMuted} volume={preferences.outputVolume} onToggle={() => void toggleAudioOutput()} onVolumeChange={(volume) => changePreferences({ outputVolume: volume })} /><div className="control-hint"><Wifi size={15} /> 低延迟连接 · <span className={`latency-value latency-${latencyLevel}`}>{latency === null ? '检测中' : `${latency} ms`}</span> · {formatParticipantCount(participants.length)}</div><Tooltip title="打开音频设置"><Button type="text" shape="circle" size="large" aria-label="打开音频设置" onClick={openAudioSettings} icon={<Settings size={19} />} /></Tooltip></div></div>
          <aside className="room-sidebar"><div className="sidebar-title"><span><Users size={16} /> 房间成员</span><b>{participants.length}</b></div><div className="member-list">{orderedParticipants.map(({ participant, speaking, microphoneMuted, outputMuted }) => <MemberRow key={participant.identity} participant={participant} speaking={speaking} microphoneMuted={microphoneMuted} isSelf={participant.identity === device?.identity} outputMuted={participant.identity === device?.identity ? isOutputMuted : outputMuted} onContextMenu={openParticipantVolumeMenu} />)}</div><div className="sidebar-tip"><Sparkles size={16} /><span>右键成员可单独调节其音量，设置只保存在本机</span></div></aside>
        </section>
      )}

      {remoteAudioTracks.map(({ track, participantIdentity }) => <RemoteAudio key={track.sid} track={track} volume={isOutputMuted || temporarilyMutedParticipants.has(participantIdentity) ? 0 : preferences.outputVolume * (participantVolumes[participantIdentity] ?? 100) / 100} outputDeviceId={preferences.outputDeviceId} onOutputError={handleOutputError} />)}
      {participantVolumeMenu && <ParticipantVolumePopover menu={participantVolumeMenu} volume={participantVolumes[participantVolumeMenu.identity] ?? 100} muted={temporarilyMutedParticipants.has(participantVolumeMenu.identity)} onChange={(volume) => changeParticipantVolume(participantVolumeMenu.identity, volume)} onToggleMuted={() => toggleParticipantMuted(participantVolumeMenu.identity)} onReset={() => resetParticipantVolume(participantVolumeMenu.identity)} />}
      {error && <Alert className="toast-error" type="error" showIcon message={error} closable onClose={() => setError('')} />}
      {showUpdatePrompt && availableUpdate && <Alert className="toast-update" type="info" showIcon message={`发现声屿新版本 v${availableUpdate.version}`} description="可以在设置中查看更新说明并手动安装" action={<Button type="primary" size="small" loading={isInstallingUpdate} onClick={() => void startAppUpdate()}>立即更新</Button>} closable onClose={dismissUpdatePrompt} />}
      <Modal className="name-edit-modal" open={isNameEditing} onCancel={() => setIsNameEditing(false)} footer={null} centered title="修改昵称"><div className="name-edit-form"><Input value={nameDraft} maxLength={24} autoFocus onChange={(event) => setNameDraft(event.target.value)} onPressEnter={() => void commitName()} /><Button type="primary" block size="large" onClick={() => void commitName()}>保存昵称</Button></div></Modal>
      <AudioSettingsModal open={showSettings} onClose={() => setShowSettings(false)} audioInputDevices={audioInputDevices} audioOutputDevices={audioOutputDevices} preferences={preferences} defaultInputLabel={defaultInputLabel} defaultOutputLabel={defaultOutputLabel} microphonePermission={microphonePermission} hasMicrophoneDeviceAccess={hasMicrophoneDeviceAccess} isLoadingDevices={isLoadingDevices} isTestingMicrophone={isTestingMicrophone} microphoneTestLevel={microphoneTestLevel} canSelectOutput={canSelectAudioOutputDevice()} appVersion={appVersion} availableUpdate={availableUpdate} updateStatus={updateStatus} isCheckingUpdate={isCheckingUpdate} isInstallingUpdate={isInstallingUpdate} updateProgress={updateProgress} onRefreshDevices={() => void refreshAudioDevices()} onChooseOutput={() => void chooseAudioOutput()} onTestMicrophone={() => void testMicrophone()} onChangePreferences={changePreferences} onCheckUpdate={() => void performUpdateCheck(true)} onInstallUpdate={() => void startAppUpdate()} />
    </main>
  )
}

/** 参与者卡片组件参数 */
interface ParticipantCardProps {
  /** LiveKit 参与者 */
  participant: Participant
  /** 是否正在说话 */
  speaking: boolean
  /** 当前参与者是否关闭麦克风 */
  microphoneMuted: boolean
  /** 是否是当前用户 */
  isSelf: boolean
  /** 当前参与者是否关闭声音输出 */
  outputMuted: boolean
  /** 右键打开成员音量菜单的回调 */
  onContextMenu: (event: ReactMouseEvent, participant: Participant) => void
}

/** 展示房间中的大尺寸参与者卡片 */
function ParticipantCard({ participant, speaking, microphoneMuted, isSelf, outputMuted, onContextMenu }: ParticipantCardProps) {
  return <div className={`participant-card ${speaking ? 'speaking' : ''} ${isSelf ? '' : 'volume-adjustable'}`} onContextMenu={(event) => onContextMenu(event, participant)}><div className="card-top"><span className="participant-label">{isSelf ? '你' : '成员'}</span><span className="member-status-icons">{microphoneMuted && <MicOff size={16} aria-label="麦克风已关闭" />}{outputMuted && <VolumeX size={16} aria-label="声音输出已关闭" />}</span></div><div className="avatar avatar-large">{getParticipantInitial(participant.name)}</div><h3>{participant.name || participant.identity}</h3><div className="speaking-state" aria-label={speaking ? '正在说话' : undefined}>{speaking && <span className="sound-bars"><i /><i /><i /></span>}</div></div>
}

/** 成员列表行组件参数 */
interface MemberRowProps {
  /** LiveKit 参与者 */
  participant: Participant
  /** 是否正在说话 */
  speaking: boolean
  /** 当前参与者是否关闭麦克风 */
  microphoneMuted: boolean
  /** 是否是当前用户 */
  isSelf: boolean
  /** 当前参与者是否关闭声音输出 */
  outputMuted: boolean
  /** 右键打开成员音量菜单的回调 */
  onContextMenu: (event: ReactMouseEvent, participant: Participant) => void
}

/** 展示侧边栏中的成员简要状态 */
function MemberRow({ participant, speaking, microphoneMuted, isSelf, outputMuted, onContextMenu }: MemberRowProps) {
  return <div className={`member-row ${isSelf ? '' : 'volume-adjustable'}`} onContextMenu={(event) => onContextMenu(event, participant)}><div className={`avatar avatar-medium ${speaking ? 'avatar-speaking' : ''}`}>{getParticipantInitial(participant.name)}</div><div className="member-info"><strong>{participant.name || participant.identity}{isSelf && <small>（你）</small>}</strong></div><span className="member-status-icons">{microphoneMuted && <MicOff size={15} aria-label="麦克风已关闭" />}{outputMuted && <VolumeX size={15} aria-label="声音输出已关闭" />}</span></div>
}

/** 成员独立音量浮层组件参数 */
interface ParticipantVolumePopoverProps {
  /** 当前菜单定位及成员信息 */
  menu: ParticipantVolumeMenu
  /** 当前成员独立音量 */
  volume: number
  /** 当前成员是否被临时静音 */
  muted: boolean
  /** 音量变化回调 */
  onChange: (volume: number) => void
  /** 切换临时静音状态回调 */
  onToggleMuted: () => void
  /** 恢复默认音量回调 */
  onReset: () => void
}

/** 展示成员独立音量右键菜单 */
function ParticipantVolumePopover({ menu, volume, muted, onChange, onToggleMuted, onReset }: ParticipantVolumePopoverProps) {
  const muteAction = muted ? '恢复声音' : '静音'
  return <div className="participant-volume-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><div className="participant-volume-heading"><span className="participant-volume-person"><Tooltip title={muteAction}><Button type={muted ? 'primary' : 'text'} danger={muted} shape="circle" size="small" aria-label={`${muteAction}${menu.name}`} onClick={onToggleMuted} icon={muted ? <VolumeX size={15} /> : <Volume2 size={15} />} /></Tooltip><span className="participant-volume-name">{menu.name}</span></span><output>{muted ? '已静音' : `${volume}%`}</output></div><Slider aria-label={`${menu.name}的音量`} min={0} max={MAX_AUDIO_VOLUME} value={volume} onChange={(nextValue) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /><div className="participant-volume-footer"><span>仅影响你听到的声音</span><Button type="link" onClick={onReset}>恢复默认</Button></div></div>
}

/** 房间音频控制按钮参数 */
interface AudioControlButtonProps {
  /** 当前控制的音频通道 */
  kind: 'input' | 'output'
  /** 当前音频通道是否关闭 */
  muted: boolean
  /** 当前音频通道音量 */
  volume: number
  /** 切换音频通道状态回调 */
  onToggle: () => void
  /** 音量变化回调 */
  onVolumeChange: (volume: number) => void
}

/** 渲染带悬浮音量调节的房间音频控制按钮 */
function AudioControlButton({ kind, muted, volume, onToggle, onVolumeChange }: AudioControlButtonProps) {
  const isInput = kind === 'input'
  const channelName = isInput ? '麦克风输入' : '声音输出'
  const actionName = muted ? `开启${channelName}` : `关闭${channelName}`
  const icon = isInput
    ? muted ? <MicOff size={22} /> : <Mic size={22} />
    : muted ? <VolumeX size={22} /> : <Volume2 size={22} />

  return <Popover placement="top" trigger="hover" title={`${channelName} · ${muted ? '已关闭' : '已开启'}`} content={<div className="room-volume-popover"><div className="room-volume-heading"><span>音量</span><strong>{volume}%</strong></div><Slider aria-label={`${channelName}音量`} min={0} max={MAX_AUDIO_VOLUME} value={volume} onChange={(nextValue) => onVolumeChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /></div>}><Button type={muted ? 'primary' : 'default'} danger={muted} shape="circle" size="large" aria-label={actionName} onClick={onToggle} icon={icon} /></Popover>
}

/** 音频处理开关组件参数 */
interface AudioToggleProps {
  /** 开关名称 */
  label: string
  /** 开关说明 */
  description: string
  /** 当前开关状态 */
  value: boolean
  /** 开关状态变化回调 */
  onChange: (value: boolean) => void
}

/** 渲染音频处理开关 */
function AudioToggle({ label, description, value, onChange }: AudioToggleProps) {
  return <div className="audio-toggle"><span><strong>{label}</strong><small>{description}</small></span><Switch checked={value} onChange={onChange} /></div>
}

/** 全局音量设置组件参数 */
interface VolumeSettingProps {
  /** 音量设置名称 */
  label: string
  /** 当前音量百分比 */
  value: number
  /** 音量变化回调 */
  onChange: (value: number) => void
}

/** 渲染使用 Ant Design 滑块的全局音量设置 */
function VolumeSetting({ label, value, onChange }: VolumeSettingProps) {
  return <div className="volume-setting"><div className="volume-setting-heading"><span>{label}</span><output>{value}%</output></div><Slider aria-label={label} min={0} max={MAX_AUDIO_VOLUME} value={value} onChange={(nextValue) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /></div>
}

/** 语音设置弹窗组件参数 */
interface AudioSettingsModalProps {
  /** 是否显示弹窗 */
  open: boolean
  /** 关闭弹窗回调 */
  onClose: () => void
  /** 可用麦克风设备列表 */
  audioInputDevices: AudioInputDevice[]
  /** 可用音频输出设备列表 */
  audioOutputDevices: AudioOutputDevice[]
  /** 当前音频偏好 */
  preferences: AudioPreferences
  /** 系统默认麦克风名称 */
  defaultInputLabel: string
  /** 系统默认输出设备名称 */
  defaultOutputLabel: string
  /** 麦克风权限状态 */
  microphonePermission: MicrophonePermissionState
  /** 当前是否已经开放麦克风设备信息 */
  hasMicrophoneDeviceAccess: boolean
  /** 是否正在刷新设备 */
  isLoadingDevices: boolean
  /** 是否正在测试麦克风 */
  isTestingMicrophone: boolean
  /** 当前麦克风测试电平 */
  microphoneTestLevel: number
  /** 当前环境是否支持主动选择输出设备 */
  canSelectOutput: boolean
  /** 当前桌面应用版本 */
  appVersion: string
  /** 当前检测到的新版本 */
  availableUpdate: AppUpdate | null
  /** 更新检测状态文本 */
  updateStatus: string
  /** 是否正在检查更新 */
  isCheckingUpdate: boolean
  /** 是否正在安装更新 */
  isInstallingUpdate: boolean
  /** 更新下载进度 */
  updateProgress: number | null
  /** 刷新音频设备回调 */
  onRefreshDevices: () => void
  /** 选择音频输出设备回调 */
  onChooseOutput: () => void
  /** 测试麦克风回调 */
  onTestMicrophone: () => void
  /** 更新音频偏好回调 */
  onChangePreferences: (patch: Partial<AudioPreferences>) => void
  /** 检查应用更新回调 */
  onCheckUpdate: () => void
  /** 安装检测到的更新回调 */
  onInstallUpdate: () => void
}

/** 使用 Ant Design 展示语音设备、音量与音频处理设置 */
function AudioSettingsModal({ open, onClose, audioInputDevices, audioOutputDevices, preferences, defaultInputLabel, defaultOutputLabel, microphonePermission, hasMicrophoneDeviceAccess, isLoadingDevices, isTestingMicrophone, microphoneTestLevel, canSelectOutput, appVersion, availableUpdate, updateStatus, isCheckingUpdate, isInstallingUpdate, updateProgress, onRefreshDevices, onChooseOutput, onTestMicrophone, onChangePreferences, onCheckUpdate, onInstallUpdate }: AudioSettingsModalProps) {
  return <Modal className="settings-ant-modal" open={open} onCancel={onClose} footer={null} centered width={620} title="设置"><section className="settings-section"><h4>设备与测试</h4><div className="settings-panel"><div className="device-setting-row"><label htmlFor="audio-input-device">输入设备</label><div className="device-select-wrap"><Select id="audio-input-device" value={preferences.inputDeviceId} onChange={(value) => onChangePreferences({ inputDeviceId: value })} options={[{ value: 'default', label: `默认 - ${defaultInputLabel}` }, ...audioInputDevices.filter((input) => input.deviceId !== 'default').map((input) => ({ value: input.deviceId, label: input.label }))]} /><Button type="text" icon={<RefreshCw size={14} className={isLoadingDevices ? 'spinning' : ''} />} onClick={onRefreshDevices} loading={isLoadingDevices} aria-label="刷新输入设备" /></div></div><div className="device-setting-row"><label htmlFor="audio-output-device">输出设备</label><div className="device-select-wrap"><Select id="audio-output-device" value={preferences.outputDeviceId} onChange={(value) => onChangePreferences({ outputDeviceId: value })} options={[{ value: 'default', label: `默认 - ${defaultOutputLabel}` }, ...audioOutputDevices.filter((output) => output.deviceId !== 'default').map((output) => ({ value: output.deviceId, label: output.label }))]} />{canSelectOutput && <Button type="text" onClick={onChooseOutput}>选择</Button>}</div></div><small className="device-permission-note">{microphonePermission === 'denied' ? getMicrophonePermissionGuide() : hasMicrophoneDeviceAccess ? '可直接选择电脑上的输入设备' : '正在等待系统或浏览器确认麦克风权限'}</small><div className="mic-test-row"><span className="settings-row-label"><Mic size={17} />麦克风测试</span><div className="mic-test-controls"><Button type="primary" onClick={onTestMicrophone}>{isTestingMicrophone ? '停止测试' : '检查一下'}</Button><div className="level-meter" aria-label="麦克风输入电平">{Array.from({ length: 36 }, (_, index) => <i key={index} className={index < Math.round(microphoneTestLevel * 36) ? 'active' : ''} />)}</div></div></div></div></section><section className="settings-section"><h4>音频设置</h4><div className="settings-panel processing-panel"><VolumeSetting label="麦克风输入" value={preferences.inputVolume} onChange={(value) => onChangePreferences({ inputVolume: value })} /><VolumeSetting label="扬声器输出" value={preferences.outputVolume} onChange={(value) => onChangePreferences({ outputVolume: value })} /><AudioToggle label="语音降噪" description="使用系统音频处理减少环境噪音" value={preferences.noiseSuppression} onChange={(value) => onChangePreferences({ noiseSuppression: value })} /><AudioToggle label="回音抵消" description="减少扬声器声音回到麦克风" value={preferences.echoCancellation} onChange={(value) => onChangePreferences({ echoCancellation: value })} /><AudioToggle label="声音增强" description="使用系统自动增益稳定麦克风音量" value={preferences.autoGainControl} onChange={(value) => onChangePreferences({ autoGainControl: value })} /></div></section><section className="settings-section"><h4>应用更新</h4><div className="settings-panel update-panel"><div className="version-setting-row"><div><span>当前版本</span><strong>{appVersion === '开发版' ? appVersion : `v${appVersion}`}</strong></div><Button type="default" onClick={onCheckUpdate} loading={isCheckingUpdate}>检查更新</Button></div><div className="update-status-row"><span>{availableUpdate ? `发现新版本 v${availableUpdate.version}` : updateStatus}</span>{availableUpdate && <Button type="primary" onClick={onInstallUpdate} loading={isInstallingUpdate}>立即更新</Button>}</div>{isInstallingUpdate && <Progress percent={updateProgress ?? undefined} status="active" showInfo={updateProgress !== null} />}{availableUpdate?.body && <div className="update-notes">{availableUpdate.body}</div>}</div></section><p className="settings-note">音频设置会自动保存在本机，输入、输出和成员独立音量最高支持 300%</p></Modal>
}
