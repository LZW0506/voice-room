import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ConnectionState,
  LocalAudioTrack,
  Participant,
  Room,
  RoomEvent,
  Track,
  type RemoteAudioTrack,
} from 'livekit-client'
import { Headphones, Mic, MicOff, Pencil, Radio, RefreshCw, Settings, Sparkles, Users, Volume2, VolumeX, Wifi, X } from 'lucide-react'
import { createDefaultRoom, formatParticipantCount, getParticipantInitial } from './lib/ui'
import { canSelectAudioOutputDevice, connectRoom, createProcessedMicrophone, createRoom, disposeMicrophone, fetchToken, getAudioOutputErrorMessage, getMicrophoneErrorMessage, getMicrophonePermissionState, listAudioInputDevices, listAudioOutputDevices, requestMicrophonePermission, selectAudioOutputDevice, type AudioInputDevice, type AudioOutputDevice, type MicrophonePermissionState, type MicrophoneResources } from './lib/livekit'
import { getDeviceProfile, saveDisplayName, type DeviceProfile } from './lib/device'
import { checkForAppUpdate } from './lib/updater'
import { RemoteAudio } from './components/RemoteAudio'

/** 房间内展示的参与者实体 */
interface ParticipantView {
  /** LiveKit 参与者对象 */
  participant: Participant
  /** 当前是否正在发言 */
  speaking: boolean
  /** 当前是否已发布或订阅音频 */
  hasAudio: boolean
}

/** 客户端音频偏好实体 */
interface AudioPreferences {
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
}

const AUDIO_KEY = 'voice-room.audio-preferences'

/** 读取保存过的音频偏好 */
function readAudioPreferences(): AudioPreferences {
  const fallback: AudioPreferences = { inputDeviceId: 'default', outputDeviceId: 'default', inputVolume: 100, outputVolume: 85, noiseSuppression: true }
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}') }
  } catch {
    return fallback
  }
}

/** 保存音频偏好到本机设置 */
function writeAudioPreferences(preferences: AudioPreferences): void {
  localStorage.setItem(AUDIO_KEY, JSON.stringify(preferences))
}

/** 获取系统默认端点对应的实际设备名称 */
function getDefaultAudioDeviceName(devices: Array<AudioInputDevice | AudioOutputDevice>): string {
  const defaultDevice = devices.find((device) => device.deviceId === 'default')
  const relatedDevice = devices.find((device) => device.deviceId !== 'default' && device.hasLabel && device.groupId && device.groupId === defaultDevice?.groupId)
  const deviceName = relatedDevice?.label || (defaultDevice?.hasLabel ? defaultDevice.label : '')
  return deviceName.replace(/^(default|默认)\s*(?:-|—|：|:)\s*/i, '').trim() || '名称将在授权后显示'
}

/** 语音聊天室主页面 */
export default function App() {
  const [device, setDevice] = useState<DeviceProfile | null>(null)
  const [roomName, setRoomName] = useState(createDefaultRoom())
  const [connectedRoom, setConnectedRoom] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [remoteAudioTracks, setRemoteAudioTracks] = useState<RemoteAudioTrack[]>([])
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDevice[]>([])
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioOutputDevice[]>([])
  const [preferences, setPreferences] = useState(readAudioPreferences)
  const [isLoadingDevices, setIsLoadingDevices] = useState(false)
  const [microphonePermission, setMicrophonePermission] = useState<MicrophonePermissionState>('prompt')
  const [isMuted, setIsMuted] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [isNameEditing, setIsNameEditing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const roomRef = useRef<Room | null>(null)
  const microphoneRef = useRef<MicrophoneResources | null>(null)
  const hasRequestedAudioAccessRef = useRef(false)

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

  /** 首次启动时请求麦克风权限并读取全部音频设备 */
  const requestAudioAccess = useCallback(async () => {
    setError('')
    setIsLoadingDevices(true)
    try {
      await requestMicrophonePermission()
      setMicrophonePermission('granted')
      const [inputs, outputs] = await Promise.all([listAudioInputDevices(), listAudioOutputDevices()])
      setAudioInputDevices(inputs)
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
      setDisplayName(profile.displayName)
      setNameDraft(profile.displayName)
    }).catch(() => setError('无法读取设备身份'))
  }, [])

  useEffect(() => {
    void checkForAppUpdate().catch((updateError: unknown) => {
      console.error('检查应用更新失败', updateError)
    })
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
    setParticipants(allParticipants.map((participant) => ({
      participant,
      speaking: participant.isSpeaking,
      hasAudio: Array.from(participant.audioTrackPublications.values()).some((publication) => Boolean(publication.track)),
    })))
    const tracks: RemoteAudioTrack[] = []
    room.remoteParticipants.forEach((participant) => participant.audioTrackPublications.forEach((publication) => {
      if (publication.track?.kind === Track.Kind.Audio) tracks.push(publication.track as RemoteAudioTrack)
    }))
    setRemoteAudioTracks(tracks)
  }, [])

  /** 绑定 LiveKit 事件，让界面随参与者和轨道变化更新 */
  const bindRoomEvents = useCallback((room: Room) => {
    const update = () => syncRoomState(room)
    room.on(RoomEvent.ParticipantConnected, update)
    room.on(RoomEvent.ParticipantDisconnected, update)
    room.on(RoomEvent.TrackSubscribed, update)
    room.on(RoomEvent.TrackUnsubscribed, update)
    room.on(RoomEvent.ActiveSpeakersChanged, update)
    room.on(RoomEvent.LocalTrackPublished, update)
    room.on(RoomEvent.LocalTrackUnpublished, update)
    room.on(RoomEvent.ConnectionStateChanged, (state) => setConnectionState(state))
    syncRoomState(room)
  }, [syncRoomState])

  /** 进入指定语音房间并连接 LiveKit */
  const joinRoom = async () => {
    const normalizedRoom = roomName.trim()
    if (!normalizedRoom || !device || isConnecting) return
    setError('')
    setIsConnecting(true)
    try {
      const token = await fetchToken({ room: normalizedRoom, identity: device.identity, name: displayName })
      const room = createRoom(() => {
        setConnectedRoom('')
        setConnectionState(ConnectionState.Disconnected)
      })
      await connectRoom(room, token)
      roomRef.current = room
      bindRoomEvents(room)
      setConnectedRoom(normalizedRoom)
      setConnectionState(ConnectionState.Connected)
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : '加入房间失败')
    } finally {
      setIsConnecting(false)
    }
  }

  /** 离开当前房间并释放麦克风和网络资源 */
  const leaveRoom = async () => {
    if (microphoneRef.current) {
      await disposeMicrophone(microphoneRef.current)
      microphoneRef.current = null
    }
    roomRef.current?.disconnect()
    roomRef.current = null
    setConnectedRoom('')
    setParticipants([])
    setRemoteAudioTracks([])
    setIsMuted(true)
    setConnectionState(ConnectionState.Disconnected)
  }

  /** 打开或关闭麦克风，开启时使用回声消除、降噪和自动增益 */
  const toggleMicrophone = async () => {
    const room = roomRef.current
    if (!room) return
    setError('')
    try {
      if (microphoneRef.current) {
        await room.localParticipant.unpublishTrack(microphoneRef.current.track)
        await disposeMicrophone(microphoneRef.current)
        microphoneRef.current = null
        setIsMuted(true)
        syncRoomState(room)
        return
      }
      const microphone = await createProcessedMicrophone(
        preferences.inputVolume,
        preferences.noiseSuppression,
        preferences.inputDeviceId,
      )
      await room.localParticipant.publishTrack(microphone.track, { name: 'microphone', source: Track.Source.Microphone })
      microphoneRef.current = microphone
      setIsMuted(false)
      syncRoomState(room)
      void refreshAudioDevices()
    } catch (microphoneError) {
      setError(getMicrophoneErrorMessage(microphoneError))
    }
  }

  /** 保存昵称并同步到当前 LiveKit 参与者 */
  const commitName = async () => {
    const nextName = nameDraft.trim().slice(0, 24)
    if (!nextName || !device) return
    saveDisplayName(nextName)
    setDisplayName(nextName)
    setIsNameEditing(false)
    await roomRef.current?.localParticipant.setName(nextName)
    if (roomRef.current) syncRoomState(roomRef.current)
  }

  /** 更新音频偏好并立即调整当前麦克风增益 */
  const changePreferences = (patch: Partial<AudioPreferences>) => {
    const next = { ...preferences, ...patch }
    setPreferences(next)
    writeAudioPreferences(next)
    if (patch.inputVolume !== undefined && microphoneRef.current) microphoneRef.current.gainNode.gain.value = next.inputVolume / 100
  }

  /** 打开音频设置并读取最新的设备列表 */
  const openAudioSettings = () => {
    setShowSettings(true)
    void refreshAudioDevices()
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
    }
  }, [])

  const sortedParticipants = useMemo(() => [...participants].sort((a, b) => Number(b.speaking) - Number(a.speaking)), [participants])
  const hasMicrophoneDeviceAccess = microphonePermission === 'granted' || audioInputDevices.some((device) => device.hasLabel)
  const defaultInputLabel = getDefaultAudioDeviceName(audioInputDevices)
  const defaultOutputLabel = getDefaultAudioDeviceName(audioOutputDevices)
  const isConnected = connectionState === ConnectionState.Connected || connectionState === ConnectionState.Connecting

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Radio size={18} /></div><span>声屿</span><small>VOICE ROOM</small></div>
        <div className="top-actions"><div className="status-pill"><span className={`status-dot ${isConnected ? 'online' : ''}`} />{isConnected ? '服务在线' : '等待连接'}</div><button className="icon-button" aria-label="打开音频设置" onClick={openAudioSettings}><Settings size={18} /></button></div>
      </header>

      {!connectedRoom ? (
        <section className="welcome-layout">
          <div className="welcome-copy">
            <div className="eyebrow"><Sparkles size={14} /> 轻松进入，随时开聊</div>
            <h1>让声音，<em>自然发生</em></h1>
            <p>一个简单、安静的语音空间。输入房间名，和朋友马上见面。</p>
            <div className="join-card"><label htmlFor="room-name">房间名称</label><div className="room-input"><span>＃</span><input id="room-name" value={roomName} onChange={(event) => setRoomName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void joinRoom()} placeholder="例如：周末闲聊" /></div><button className="primary-button" onClick={() => void joinRoom()} disabled={!device || isConnecting}>{isConnecting ? '正在连接…' : '进入房间'}<span>→</span></button></div>
            <div className="identity-line"><div className="avatar avatar-small">{getParticipantInitial(displayName)}</div><span>你将以 <strong>{displayName || '生成中…'}</strong> 的身份进入</span><button onClick={() => { setNameDraft(displayName); setIsNameEditing(true) }}><Pencil size={13} /> 修改</button></div>
          </div>
          <div className="welcome-art"><div className="orb orb-main"><div className="orb-core"><Radio size={40} /></div></div><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="floating-note note-a">♪</div><div className="floating-note note-b">♫</div><div className="art-caption"><span className="pulse-line" /> 清晰的声音，舒服的距离</div></div>
        </section>
      ) : (
        <section className="room-layout">
          <div className="room-main"><div className="room-heading"><div><div className="eyebrow"><span className="live-dot" /> 正在进行</div><h2>＃{connectedRoom}</h2></div><button className="leave-button" onClick={() => void leaveRoom()}>离开房间</button></div><div className="people-grid">{sortedParticipants.map(({ participant, speaking, hasAudio }) => <ParticipantCard key={participant.identity} participant={participant} speaking={speaking} hasAudio={hasAudio} isSelf={participant.identity === device?.identity} />)}</div><div className="room-controls"><button className={`mic-button ${!isMuted ? 'active' : ''}`} onClick={() => void toggleMicrophone()}>{isMuted ? <MicOff size={22} /> : <Mic size={22} />}<span>{isMuted ? '打开麦克风' : '静音'}</span></button><div className="control-hint"><Wifi size={15} /> 低延迟连接 · {formatParticipantCount(participants.length)}</div><button className="round-control" onClick={openAudioSettings}><Settings size={19} /></button></div></div>
          <aside className="room-sidebar"><div className="sidebar-title"><span><Users size={16} /> 房间成员</span><b>{participants.length}</b></div><div className="member-list">{sortedParticipants.map(({ participant, speaking, hasAudio }) => <MemberRow key={participant.identity} participant={participant} speaking={speaking} hasAudio={hasAudio} isSelf={participant.identity === device?.identity} />)}</div><div className="sidebar-tip"><Sparkles size={16} /><span>打开麦克风后，系统会自动进行回声消除与降噪</span></div></aside>
        </section>
      )}

      {remoteAudioTracks.map((track) => <RemoteAudio key={track.sid} track={track} volume={preferences.outputVolume} outputDeviceId={preferences.outputDeviceId} onOutputError={handleOutputError} />)}
      {error && <div className="toast-error">{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
      {isNameEditing && <div className="modal-backdrop" onClick={() => setIsNameEditing(false)}><div className="modal small-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><h3>修改昵称</h3><button className="close-button" onClick={() => setIsNameEditing(false)}><X size={18} /></button></div><input className="text-input" value={nameDraft} maxLength={24} autoFocus onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void commitName()} /><button className="primary-button full-button" onClick={() => void commitName()}>保存昵称</button></div></div>}
      {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">AUDIO SETTINGS</div><h3>音频设置</h3></div><button className="close-button" onClick={() => setShowSettings(false)}><X size={18} /></button></div><div className="device-field"><div className="device-field-heading"><label htmlFor="audio-input-device"><Mic size={17} /> 麦克风设备</label><button type="button" onClick={() => void refreshAudioDevices()} disabled={isLoadingDevices}><RefreshCw size={14} className={isLoadingDevices ? 'spinning' : ''} />刷新</button></div><select id="audio-input-device" value={preferences.inputDeviceId} onChange={(event) => changePreferences({ inputDeviceId: event.target.value })}><option value="default">系统默认麦克风（{defaultInputLabel}）</option>{audioInputDevices.filter((input) => input.deviceId !== 'default').map((input) => <option key={input.deviceId} value={input.deviceId}>{input.label}</option>)}</select><small>{microphonePermission === 'denied' ? '麦克风权限未开启，请在 macOS 隐私设置或浏览器网站设置中允许后刷新' : hasMicrophoneDeviceAccess ? '可直接选择电脑上的输入设备' : '正在等待系统或浏览器确认麦克风权限'}</small></div><div className="device-field"><div className="device-field-heading"><label htmlFor="audio-output-device"><Headphones size={17} /> 音频输出设备</label>{canSelectAudioOutputDevice() && <button type="button" onClick={() => void chooseAudioOutput()}>选择设备</button>}</div><select id="audio-output-device" value={preferences.outputDeviceId} onChange={(event) => changePreferences({ outputDeviceId: event.target.value })}><option value="default">系统默认输出（{defaultOutputLabel}）</option>{audioOutputDevices.filter((output) => output.deviceId !== 'default').map((output) => <option key={output.deviceId} value={output.deviceId}>{output.label}</option>)}</select><small>{canSelectAudioOutputDevice() ? '点击“选择设备”可打开系统输出设备选择窗口' : audioOutputDevices.length <= 1 ? '当前运行环境只开放了系统默认输出设备' : '输出设备无需麦克风权限，选择后会立即切换远端语音'}</small></div><SettingSlider icon={<Mic size={17} />} label="麦克风输入" value={preferences.inputVolume} onChange={(value) => changePreferences({ inputVolume: value })} /><SettingSlider icon={<Headphones size={17} />} label="扬声器输出" value={preferences.outputVolume} onChange={(value) => changePreferences({ outputVolume: value })} /><label className="toggle-row"><span><Sparkles size={17} /><span><strong>语音降噪</strong><small>自动减少环境噪音</small></span></span><input type="checkbox" checked={preferences.noiseSuppression} onChange={(event) => changePreferences({ noiseSuppression: event.target.checked })} /><i /></label><p className="settings-note">输出设备会立即切换，麦克风设备和降噪会在下一次打开麦克风时生效</p></div></div>}
    </main>
  )
}

/** 参与者卡片组件参数 */
interface ParticipantCardProps {
  /** LiveKit 参与者 */
  participant: Participant
  /** 是否正在说话 */
  speaking: boolean
  /** 是否有音频 */
  hasAudio: boolean
  /** 是否是当前用户 */
  isSelf: boolean
}

/** 展示房间中的大尺寸参与者卡片 */
function ParticipantCard({ participant, speaking, hasAudio, isSelf }: ParticipantCardProps) {
  return <div className={`participant-card ${speaking ? 'speaking' : ''}`}><div className="card-top"><span className="participant-label">{isSelf ? '你' : '成员'}</span>{hasAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}</div><div className="avatar avatar-large">{getParticipantInitial(participant.name)}</div><h3>{participant.name || participant.identity}</h3><div className="speaking-state">{speaking ? <><span className="sound-bars"><i /><i /><i /></span>正在说话</> : hasAudio ? '已连接' : '已静音'}</div></div>
}

/** 成员列表行组件参数 */
interface MemberRowProps {
  /** LiveKit 参与者 */
  participant: Participant
  /** 是否正在说话 */
  speaking: boolean
  /** 是否有音频 */
  hasAudio: boolean
  /** 是否是当前用户 */
  isSelf: boolean
}

/** 展示侧边栏中的成员简要状态 */
function MemberRow({ participant, speaking, hasAudio, isSelf }: MemberRowProps) {
  return <div className="member-row"><div className={`avatar avatar-medium ${speaking ? 'avatar-speaking' : ''}`}>{getParticipantInitial(participant.name)}</div><div className="member-info"><strong>{participant.name || participant.identity}{isSelf && <small>（你）</small>}</strong><span>{speaking ? '正在说话' : '在线'}</span></div>{hasAudio ? <Mic size={15} className={speaking ? 'icon-speaking' : ''} /> : <MicOff size={15} />}</div>
}

/** 音量滑块组件参数 */
interface SettingSliderProps {
  /** 左侧图标 */
  icon: ReactNode
  /** 设置名称 */
  label: string
  /** 当前数值 */
  value: number
  /** 数值变化回调 */
  onChange: (value: number) => void
}

/** 渲染带百分比的音量设置滑块 */
function SettingSlider({ icon, label, value, onChange }: SettingSliderProps) {
  return <label className="slider-row"><span className="slider-label">{icon}{label}</span><input type="range" min="0" max="150" value={value} onChange={(event) => onChange(Number(event.target.value))} /><output>{value}%</output></label>
}
