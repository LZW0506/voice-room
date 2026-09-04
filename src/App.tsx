import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Button, Input, Modal, Popover, Progress, Select, Slider, Switch, Tabs, Tooltip } from 'antd'
import { Mic, MicOff, Pencil, Radio, RefreshCw, Settings, Sparkles, Users, Volume2, VolumeX, Wifi } from 'lucide-react'
import { createDefaultRoom, formatParticipantCount, getParticipantInitial } from './lib/ui'
import { getDeviceProfile, saveDisplayName, type DeviceProfile } from './lib/device'
import { checkForAppUpdate, getAppVersion, installAppUpdate, type AppUpdate, type AppUpdateDownloadEvent } from './lib/updater'
import { getNativeAudioBackend, joinNativeRoom, leaveNativeRoom, listenNativeRoomEvents, listNativeAudioDevices, setNativeDisplayName, setNativeMicrophoneMuted, setNativeOutputMuted, setNativeParticipantVolume, updateNativeAudioPreferences, type NativeAudioDevice, type NativeAudioDevices, type NativeAudioPreferences, type NativeParticipant } from './lib/nativeRoom'
import { MAX_AUDIO_VOLUME, MAX_NOISE_REDUCTION_LEVEL, useClientStore, type AudioPreferences } from './stores/client'

/** 成员音量右键菜单实体 */
interface ParticipantVolumeMenu {
  /** 参与者身份 */
  identity: string
  /** 参与者名称 */
  name: string
  /** 菜单横坐标 */
  x: number
  /** 菜单纵坐标 */
  y: number
}

/** 获取系统默认设备的展示名称 */
function getDefaultAudioDeviceName(devices: NativeAudioDevice[]): string {
  return devices.find((device) => device.isDefault)?.label || devices[0]?.label || '当前默认设备'
}

/** 将界面音频设置转换为 Rust 引擎参数 */
function toNativePreferences(preferences: AudioPreferences): NativeAudioPreferences {
  return {
    inputDeviceId: preferences.inputDeviceId,
    outputDeviceId: preferences.outputDeviceId,
    inputVolume: preferences.inputVolume,
    outputVolume: preferences.outputVolume,
    noiseSuppression: preferences.noiseSuppression,
    noiseReductionLevel: preferences.noiseReductionLevel,
    echoCancellation: preferences.echoCancellation,
  }
}

/** 语音聊天室主页面，React 只负责界面和 Tauri 状态桥接 */
export default function App() {
  const [device, setDevice] = useState<DeviceProfile | null>(null)
  const [roomName, setRoomName] = useState(createDefaultRoom())
  const [connectedRoom, setConnectedRoom] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [participants, setParticipants] = useState<NativeParticipant[]>([])
  const [audioDevices, setAudioDevices] = useState<NativeAudioDevices>({ inputs: [], outputs: [] })
  const displayName = useClientStore((state) => state.displayName)
  const preferences = useClientStore((state) => state.audioPreferences)
  const participantVolumes = useClientStore((state) => state.participantVolumes)
  const updateAudioPreferences = useClientStore((state) => state.updateAudioPreferences)
  const setParticipantVolume = useClientStore((state) => state.setParticipantVolume)
  const clearParticipantVolume = useClientStore((state) => state.resetParticipantVolume)
  const [isMuted, setIsMuted] = useState(true)
  const [isOutputMuted, setIsOutputMuted] = useState(false)
  const [microphoneTestLevel, setMicrophoneTestLevel] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [isNameEditing, setIsNameEditing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [connectionState, setConnectionState] = useState('Disconnected')
  const [latency, setLatency] = useState<number | null>(null)
  const [inferenceBackend, setInferenceBackend] = useState('')
  const [appVersion, setAppVersion] = useState('读取中')
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdate | null>(null)
  const [updateStatus, setUpdateStatus] = useState('尚未检查更新')
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false)
  const [participantVolumeMenu, setParticipantVolumeMenu] = useState<ParticipantVolumeMenu | null>(null)
  const [temporarilyMutedParticipants, setTemporarilyMutedParticipants] = useState<Set<string>>(new Set())
  const availableUpdateRef = useRef<AppUpdate | null>(null)
  const updateCheckInProgressRef = useRef(false)
  const updateInstallInProgressRef = useRef(false)
  const downloadedUpdateBytesRef = useRef(0)
  const updateContentLengthRef = useRef<number | undefined>(undefined)

  /** 保存更新对象并释放上一份更新资源 */
  const saveAvailableUpdate = useCallback((update: AppUpdate | null) => {
    const previousUpdate = availableUpdateRef.current
    if (previousUpdate && previousUpdate !== update) void previousUpdate.close()
    availableUpdateRef.current = update
    setAvailableUpdate(update)
  }, [])

  /** 检查桌面应用更新 */
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

  /** 显示更新下载进度 */
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

  /** 安装当前发现的新版本 */
  const startAppUpdate = useCallback(async () => {
    const update = availableUpdateRef.current
    if (!update || updateInstallInProgressRef.current) return
    updateInstallInProgressRef.current = true
    setIsInstallingUpdate(true)
    setUpdateProgress(0)
    setUpdateStatus(`正在更新到 v${update.version}`)
    try {
      await installAppUpdate(update, handleUpdateDownload)
    } catch (updateError) {
      updateInstallInProgressRef.current = false
      setIsInstallingUpdate(false)
      setUpdateStatus('安装更新失败')
      setError(updateError instanceof Error ? updateError.message : '安装更新失败')
    }
  }, [handleUpdateDownload])

  /** 读取原生音频设备 */
  const refreshAudioDevices = useCallback(async () => {
    try {
      setAudioDevices(await listNativeAudioDevices())
    } catch (deviceError) {
      setError(deviceError instanceof Error ? deviceError.message : '读取音频设备失败')
    }
  }, [])

  useEffect(() => {
    getDeviceProfile().then((profile) => {
      setDevice(profile)
      setNameDraft(profile.displayName)
    }).catch(() => setError('无法读取设备身份'))
    void refreshAudioDevices()
    void getNativeAudioBackend().then((backend) => setInferenceBackend(backend || '')).catch(() => undefined)
    void performUpdateCheck(false)
    let dispose: (() => void) | undefined
    listenNativeRoomEvents(
      (state) => {
        if (state.roomName) setConnectedRoom(state.roomName)
        if (state.connectionState) setConnectionState(state.connectionState)
        if (state.participants) setParticipants(state.participants)
        if (typeof state.microphoneMuted === 'boolean') setIsMuted(state.microphoneMuted)
        if (typeof state.outputMuted === 'boolean') setIsOutputMuted(state.outputMuted)
        if (state.latency !== undefined) setLatency(state.latency)
        if (state.inferenceBackend) setInferenceBackend(state.inferenceBackend)
        if (state.connectionState === 'Disconnected') {
          setConnectedRoom('')
          setLatency(null)
        }
      },
      () => undefined,
      (level) => setMicrophoneTestLevel(Math.min(1, Math.max(0, level * 8))),
      setError,
    ).then((unlisten) => { dispose = unlisten }).catch(() => setError('无法建立原生音频事件通道'))
    return () => {
      dispose?.()
      void leaveNativeRoom().catch(() => undefined)
      void availableUpdateRef.current?.close()
    }
  }, [performUpdateCheck, refreshAudioDevices])

  /** 将音频偏好实时同步给 Rust 引擎并保存到 Zustand Persist */
  const changePreferences = (patch: Partial<AudioPreferences>) => {
    updateAudioPreferences(patch)
    if (!connectedRoom) return
    const next = { ...preferences, ...patch }
    void updateNativeAudioPreferences(toNativePreferences(next)).catch((audioError) => setError(audioError instanceof Error ? audioError.message : '更新音频设置失败'))
  }

  /** 进入指定房间，原生引擎会在 Rust 侧获取 Token、采集和发布音频 */
  const joinRoom = async () => {
    const normalizedRoom = roomName.trim()
    if (!normalizedRoom || !device || isConnecting || connectedRoom) return
    setError('')
    setIsConnecting(true)
    try {
      await joinNativeRoom({ roomName: normalizedRoom, identity: device.identity, displayName, preferences: toNativePreferences(preferences) })
      setConnectedRoom(normalizedRoom)
      setIsMuted(false)
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : '加入房间失败')
    } finally {
      setIsConnecting(false)
    }
  }

  /** 离开房间并释放 Rust 音频资源 */
  const leaveRoom = async () => {
    try {
      await leaveNativeRoom()
      setConnectedRoom('')
      setParticipants([])
      setConnectionState('Disconnected')
      setIsMuted(true)
      setIsOutputMuted(false)
      setTemporarilyMutedParticipants(new Set())
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : '离开房间失败')
    }
  }

  /** 切换当前麦克风发布状态 */
  const toggleMicrophone = async () => {
    const nextMuted = !isMuted
    try {
      await setNativeMicrophoneMuted(nextMuted)
      setIsMuted(nextMuted)
    } catch (microphoneError) {
      setError(microphoneError instanceof Error ? microphoneError.message : '切换麦克风失败')
    }
  }

  /** 切换当前远端声音输出状态 */
  const toggleAudioOutput = async () => {
    const nextMuted = !isOutputMuted
    try {
      await setNativeOutputMuted(nextMuted)
      setIsOutputMuted(nextMuted)
    } catch (outputError) {
      setError(outputError instanceof Error ? outputError.message : '切换声音输出失败')
    }
  }

  /** 保存昵称并同步给 LiveKit 房间 */
  const commitName = async () => {
    const nextName = nameDraft.trim().slice(0, 24)
    if (!nextName || !device) return
    saveDisplayName(nextName)
    setIsNameEditing(false)
    if (connectedRoom) {
      try {
        await setNativeDisplayName(nextName)
      } catch (nameError) {
        setError(nameError instanceof Error ? nameError.message : '同步昵称失败')
      }
    }
  }

  /** 打开成员独立音量菜单 */
  const openParticipantVolumeMenu = (event: ReactMouseEvent, participant: NativeParticipant) => {
    event.preventDefault()
    if (participant.identity === device?.identity) return
    setParticipantVolumeMenu({
      identity: participant.identity,
      name: participant.name || participant.identity,
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 232)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 148)),
    })
  }

  /** 修改成员独立音量，该状态只保存在本次应用会话 */
  const changeParticipantVolume = (identity: string, volume: number) => {
    setParticipantVolume(identity, volume)
    void setNativeParticipantVolume(identity, volume).catch((volumeError) => setError(volumeError instanceof Error ? volumeError.message : '调整成员音量失败'))
  }

  /** 恢复成员默认音量 */
  const resetParticipantVolume = (identity: string) => {
    clearParticipantVolume(identity)
    void setNativeParticipantVolume(identity, 100).catch(() => undefined)
    setParticipantVolumeMenu(null)
  }

  /** 临时静音或恢复某位成员 */
  const toggleParticipantMuted = (identity: string) => {
    const muted = temporarilyMutedParticipants.has(identity)
    setTemporarilyMutedParticipants((current) => {
      const next = new Set(current)
      if (muted) next.delete(identity)
      else next.add(identity)
      return next
    })
    void setNativeParticipantVolume(identity, muted ? (participantVolumes[identity] ?? 100) : 0).catch(() => undefined)
  }

  useEffect(() => {
    const closeMenu = () => setParticipantVolumeMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [])

  const orderedParticipants = useMemo(() => [...participants].sort((first, second) => first.order - second.order), [participants])
  const isConnected = connectionState === 'Connected' || connectionState === 'Connecting'
  const latencyLevel = latency === null ? 'pending' : latency <= 100 ? 'good' : latency <= 200 ? 'warning' : 'bad'

  return <main className="app-shell" onContextMenu={(event) => event.preventDefault()}>
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar"><div className="brand"><div className="brand-mark"><Radio size={18} /></div><span>声屿</span><small>VOICE ROOM</small></div><div className="top-actions"><div className="status-pill"><span className={`status-dot ${isConnected ? 'online' : ''}`} />{isConnected ? '服务在线' : '等待连接'}</div><Tooltip title="打开音频设置"><Button type="text" shape="circle" aria-label="打开音频设置" onClick={() => { setShowSettings(true); void refreshAudioDevices() }} icon={<Settings size={18} />} /></Tooltip></div></header>
    {!connectedRoom ? <section className="welcome-layout"><div className="welcome-copy"><div className="eyebrow"><Sparkles size={14} /> 轻松进入，随时开聊</div><h1>让声音，<em>自然发生</em></h1><p>一个简单、安静的语音空间。输入房间名，和朋友马上见面。</p><div className="join-card"><label htmlFor="room-name">房间名称</label><div className="room-input"><span>＃</span><Input variant="borderless" id="room-name" value={roomName} onChange={(event) => setRoomName(event.target.value)} onPressEnter={() => void joinRoom()} placeholder="例如：周末闲聊" /></div><Button type="primary" block size="large" onClick={() => void joinRoom()} disabled={!device || isConnecting} loading={isConnecting}>进入房间 <span>→</span></Button></div><div className="identity-line"><div className="avatar avatar-small">{getParticipantInitial(displayName)}</div><span>你将以 <strong>{displayName || '生成中…'}</strong> 的身份进入</span><Button type="link" onClick={() => { setNameDraft(displayName); setIsNameEditing(true) }} icon={<Pencil size={13} />}>修改</Button></div></div><div className="welcome-art"><div className="orb orb-main"><div className="orb-core"><Radio size={40} /></div></div><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="floating-note note-a">♪</div><div className="floating-note note-b">♫</div><div className="art-caption"><span className="pulse-line" /> 清晰的声音，舒服的距离</div></div></section> : <section className="room-layout"><div className="room-main"><div className="room-heading"><div><div className="eyebrow"><span className="live-dot" /> 正在进行</div><h2>＃{connectedRoom}</h2></div><Button type="default" onClick={() => void leaveRoom()}>离开房间</Button></div><div className="people-grid">{orderedParticipants.map((participant) => <ParticipantCard key={participant.identity} participant={participant} isSelf={participant.identity === device?.identity} onContextMenu={openParticipantVolumeMenu} />)}</div><div className="room-controls"><AudioControlButton kind="input" muted={isMuted} volume={preferences.inputVolume} onToggle={() => void toggleMicrophone()} onVolumeChange={(volume) => changePreferences({ inputVolume: volume })} /><AudioControlButton kind="output" muted={isOutputMuted} volume={preferences.outputVolume} onToggle={() => void toggleAudioOutput()} onVolumeChange={(volume) => changePreferences({ outputVolume: volume })} /><div className="control-hint"><Wifi size={15} /> 低延迟连接 · <span className={`latency-value latency-${latencyLevel}`}>{latency === null ? '检测中' : `${latency} ms`}</span> · {formatParticipantCount(participants.length)}</div><Tooltip title="打开音频设置"><Button type="text" shape="circle" size="large" onClick={() => setShowSettings(true)} icon={<Settings size={19} />} /></Tooltip></div></div><aside className="room-sidebar"><div className="sidebar-title"><span><Users size={16} /> 房间成员</span><b>{participants.length}</b></div><div className="member-list">{orderedParticipants.map((participant) => <MemberRow key={participant.identity} participant={participant} isSelf={participant.identity === device?.identity} onContextMenu={openParticipantVolumeMenu} />)}</div><div className="sidebar-tip"><Sparkles size={16} /><span>右键成员可单独调节其音量，设置只保存在本机</span></div></aside></section>}
    {participantVolumeMenu && <ParticipantVolumePopover menu={participantVolumeMenu} volume={participantVolumes[participantVolumeMenu.identity] ?? 100} muted={temporarilyMutedParticipants.has(participantVolumeMenu.identity)} onChange={(volume) => changeParticipantVolume(participantVolumeMenu.identity, volume)} onToggleMuted={() => toggleParticipantMuted(participantVolumeMenu.identity)} onReset={() => resetParticipantVolume(participantVolumeMenu.identity)} />}
    {error && <Alert className="toast-error" type="error" showIcon message={error} closable onClose={() => setError('')} />}
    {showUpdatePrompt && availableUpdate && <Alert className="toast-update" type="info" showIcon message={`发现新版本 v${availableUpdate.version}`} />}
    <Modal className="name-edit-modal" open={isNameEditing} onCancel={() => setIsNameEditing(false)} footer={null} centered title="修改昵称"><div className="name-edit-form"><Input value={nameDraft} maxLength={24} autoFocus onChange={(event) => setNameDraft(event.target.value)} onPressEnter={() => void commitName()} /><Button type="primary" block size="large" onClick={() => void commitName()}>保存昵称</Button></div></Modal>
    <AudioSettingsModal open={showSettings} onClose={() => setShowSettings(false)} devices={audioDevices} preferences={preferences} defaultInputLabel={getDefaultAudioDeviceName(audioDevices.inputs)} defaultOutputLabel={getDefaultAudioDeviceName(audioDevices.outputs)} isTestingMicrophone={false} microphoneTestLevel={microphoneTestLevel} appVersion={appVersion} availableUpdate={availableUpdate} updateStatus={updateStatus} isCheckingUpdate={isCheckingUpdate} isInstallingUpdate={isInstallingUpdate} updateProgress={updateProgress} inferenceBackend={inferenceBackend} onRefreshDevices={() => void refreshAudioDevices()} onTestMicrophone={() => setError('麦克风耳返由 Rust 原生音频链路提供，正在使用当前采集电平')} onChangePreferences={changePreferences} onCheckUpdate={() => void performUpdateCheck(true)} onInstallUpdate={() => void startAppUpdate()} />
  </main>
}

/** 大尺寸房间成员卡片 */
function ParticipantCard({ participant, isSelf, onContextMenu }: { participant: NativeParticipant; isSelf: boolean; onContextMenu: (event: ReactMouseEvent, participant: NativeParticipant) => void }) {
  return <div className={`participant-card ${participant.speaking ? 'speaking' : ''} ${isSelf ? '' : 'volume-adjustable'}`} onContextMenu={(event) => onContextMenu(event, participant)}><div className="card-top"><span className="participant-label">{isSelf ? '你' : '成员'}</span><span className="member-status-icons">{participant.microphoneMuted && <MicOff size={16} aria-label="麦克风已关闭" />}{participant.outputMuted && <VolumeX size={16} aria-label="声音输出已关闭" />}</span></div><div className="avatar avatar-large">{getParticipantInitial(participant.name)}</div><h3>{participant.name || participant.identity}</h3><div className="speaking-state">{participant.speaking && <span className="sound-bars"><i /><i /><i /></span>}</div></div>
}

/** 侧边栏成员行 */
function MemberRow({ participant, isSelf, onContextMenu }: { participant: NativeParticipant; isSelf: boolean; onContextMenu: (event: ReactMouseEvent, participant: NativeParticipant) => void }) {
  return <div className={`member-row ${isSelf ? '' : 'volume-adjustable'}`} onContextMenu={(event) => onContextMenu(event, participant)}><div className={`avatar avatar-medium ${participant.speaking ? 'avatar-speaking' : ''}`}>{getParticipantInitial(participant.name)}</div><div className="member-info"><strong>{participant.name || participant.identity}{isSelf && <small>（你）</small>}</strong></div><span className="member-status-icons">{participant.microphoneMuted && <MicOff size={15} aria-label="麦克风已关闭" />}{participant.outputMuted && <VolumeX size={15} aria-label="声音输出已关闭" />}</span></div>
}

/** 成员音量右键菜单 */
function ParticipantVolumePopover({ menu, volume, muted, onChange, onToggleMuted, onReset }: { menu: ParticipantVolumeMenu; volume: number; muted: boolean; onChange: (volume: number) => void; onToggleMuted: () => void; onReset: () => void }) {
  return <div className="participant-volume-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}><div className="participant-volume-heading"><span className="participant-volume-person"><Tooltip title={muted ? '恢复声音' : '静音'}><Button type={muted ? 'primary' : 'text'} danger={muted} shape="circle" size="small" aria-label={muted ? '恢复声音' : '静音'} onClick={onToggleMuted} icon={muted ? <VolumeX size={15} /> : <Volume2 size={15} />} /></Tooltip><span className="participant-volume-name">{menu.name}</span></span><output>{muted ? '已静音' : `${volume}%`}</output></div><Slider aria-label={`${menu.name}的音量`} min={0} max={MAX_AUDIO_VOLUME} value={volume} onChange={(nextValue) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /><div className="participant-volume-footer"><span>仅影响你听到的声音</span><Button type="link" onClick={onReset}>恢复默认</Button></div></div>
}

/** 房间底部输入输出控制按钮 */
function AudioControlButton({ kind, muted, volume, onToggle, onVolumeChange }: { kind: 'input' | 'output'; muted: boolean; volume: number; onToggle: () => void; onVolumeChange: (volume: number) => void }) {
  const isInput = kind === 'input'
  const channelName = isInput ? '麦克风输入' : '声音输出'
  const icon = isInput ? muted ? <MicOff size={22} /> : <Mic size={22} /> : muted ? <VolumeX size={22} /> : <Volume2 size={22} />
  return <Popover placement="top" trigger="hover" title={`${channelName} · ${muted ? '已关闭' : '已开启'}`} content={<div className="room-volume-popover"><div className="room-volume-heading"><span>音量</span><strong>{volume}%</strong></div><Slider aria-label={`${channelName}音量`} min={0} max={MAX_AUDIO_VOLUME} value={volume} onChange={(nextValue) => onVolumeChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /></div>}><Button type={muted ? 'primary' : 'default'} danger={muted} shape="circle" size="large" aria-label={muted ? `开启${channelName}` : `关闭${channelName}`} onClick={onToggle} icon={icon} /></Popover>
}

/** 音频处理开关 */
function AudioToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <div className="audio-toggle"><span><strong>{label}</strong><small>{description}</small></span><Switch checked={value} onChange={onChange} /></div>
}

/** 全局音量设置 */
function VolumeSetting({ label, value, onChange, max = MAX_AUDIO_VOLUME }: { label: string; value: number; onChange: (value: number) => void; max?: number }) {
  return <div className="volume-setting"><div className="volume-setting-heading"><span>{label}</span><output>{value}%</output></div><Slider aria-label={label} min={0} max={max} value={value} onChange={(nextValue) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])} /></div>
}

/** 音频设置弹窗 */
function AudioSettingsModal({ open, onClose, devices, preferences, defaultInputLabel, defaultOutputLabel, isTestingMicrophone, microphoneTestLevel, appVersion, availableUpdate, updateStatus, isCheckingUpdate, isInstallingUpdate, updateProgress, inferenceBackend, onRefreshDevices, onTestMicrophone, onChangePreferences, onCheckUpdate, onInstallUpdate }: { open: boolean; onClose: () => void; devices: NativeAudioDevices; preferences: AudioPreferences; defaultInputLabel: string; defaultOutputLabel: string; isTestingMicrophone: boolean; microphoneTestLevel: number; appVersion: string; availableUpdate: AppUpdate | null; updateStatus: string; isCheckingUpdate: boolean; isInstallingUpdate: boolean; updateProgress: number | null; inferenceBackend: string; onRefreshDevices: () => void; onTestMicrophone: () => void; onChangePreferences: (patch: Partial<AudioPreferences>) => void; onCheckUpdate: () => void; onInstallUpdate: () => void }) {
  const deviceSettings = <section className="settings-section"><h4>设备与测试</h4><div className="settings-panel"><div className="device-setting-row"><label htmlFor="audio-input-device">输入设备</label><div className="device-select-wrap"><Select id="audio-input-device" value={preferences.inputDeviceId} onChange={(value) => onChangePreferences({ inputDeviceId: value })} options={[{ value: 'default', label: `默认 - ${defaultInputLabel}` }, ...devices.inputs.filter((device) => !device.isDefault).map((device) => ({ value: device.deviceId, label: device.label }))]} /><Button type="text" icon={<RefreshCw size={14} />} onClick={onRefreshDevices} aria-label="刷新输入设备" /></div></div><div className="device-setting-row"><label htmlFor="audio-output-device">输出设备</label><div className="device-select-wrap"><Select id="audio-output-device" value={preferences.outputDeviceId} onChange={(value) => onChangePreferences({ outputDeviceId: value })} options={[{ value: 'default', label: `默认 - ${defaultOutputLabel}` }, ...devices.outputs.filter((device) => !device.isDefault).map((device) => ({ value: device.deviceId, label: device.label }))]} /><Button type="text" icon={<RefreshCw size={14} />} onClick={onRefreshDevices} aria-label="刷新输出设备" /></div></div><small className="device-permission-note">设备由 Rust 原生音频层读取，不经过浏览器权限</small><div className="mic-test-row"><span className="settings-row-label"><Mic size={17} />麦克风测试</span><div className="mic-test-controls"><Button type="primary" onClick={onTestMicrophone}>{isTestingMicrophone ? '停止测试' : '检查一下'}</Button><div className="level-meter" aria-label="麦克风输入电平">{Array.from({ length: 36 }, (_, index) => <i key={index} className={index < Math.round(microphoneTestLevel * 36) ? 'active' : ''} />)}</div></div></div></div></section>
  const audioSettings = <section className="settings-section"><h4>音频处理</h4><div className="settings-panel processing-panel"><VolumeSetting label="麦克风输入" value={preferences.inputVolume} onChange={(value) => onChangePreferences({ inputVolume: value })} /><VolumeSetting label="扬声器输出" value={preferences.outputVolume} onChange={(value) => onChangePreferences({ outputVolume: value })} /><AudioToggle label="语音降噪" description={`DeepFilterNet3 原生处理 · ${inferenceBackend || '平台后端读取中'}`} value={preferences.noiseSuppression} onChange={(value) => onChangePreferences({ noiseSuppression: value })} /><VolumeSetting label="降噪强度" value={preferences.noiseReductionLevel} max={MAX_NOISE_REDUCTION_LEVEL} onChange={(value) => onChangePreferences({ noiseReductionLevel: value })} /><AudioToggle label="回音抵消" description="使用原生音频处理减少扬声器声音回到麦克风" value={preferences.echoCancellation} onChange={(value) => onChangePreferences({ echoCancellation: value })} /></div></section>
  const updateSettings = <section className="settings-section"><h4>应用更新</h4><div className="settings-panel update-panel"><div className="version-setting-row"><div><span>当前版本</span><strong>{appVersion === '开发版' ? appVersion : `v${appVersion}`}</strong></div><Button type="default" onClick={onCheckUpdate} loading={isCheckingUpdate}>检查更新</Button></div><div className="update-status-row"><span>{availableUpdate ? `发现新版本 v${availableUpdate.version}` : updateStatus}</span>{availableUpdate && <Button type="primary" onClick={onInstallUpdate} loading={isInstallingUpdate}>立即更新</Button>}</div>{isInstallingUpdate && <Progress percent={updateProgress ?? 0} status="active" showInfo />}</div></section>
  return <Modal className="settings-ant-modal" styles={{ body: { maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', paddingRight: 2 } }} open={open} onCancel={onClose} footer={null} centered width={720} title="设置"><Tabs className="settings-tabs" tabPosition="left" items={[{ key: 'devices', label: '设备与测试', children: deviceSettings }, { key: 'audio', label: '音频处理', children: audioSettings }, { key: 'updates', label: '应用更新', children: updateSettings }]} /><p className="settings-note">音频设置会自动保存在本机，输入、输出和成员独立音量最高支持 300%</p></Modal>
}
