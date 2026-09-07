import { AudioOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Input, Modal, Progress, Select, Slider, Switch, Tabs } from 'antd'
import { useEffect, useState } from 'react'

/** 设置页音频偏好实体 */
export interface SettingsAudioPreferences {
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
}

/** 设置页音频设备实体 */
export interface SettingsAudioDevice {
  /** 设备唯一标识 */
  deviceId: string
  /** 设备显示名称 */
  label: string
  /** 是否为系统默认设备 */
  isDefault: boolean
}

/** 设置页音频设备列表实体 */
export interface SettingsAudioDevices {
  /** 音频输入设备列表 */
  inputs: SettingsAudioDevice[]
  /** 音频输出设备列表 */
  outputs: SettingsAudioDevice[]
}

/** 设置页更新状态实体 */
export interface SettingsUpdateState {
  /** 当前应用版本 */
  version: string
  /** 可用更新版本 */
  availableVersion: string
  /** 更新状态文案 */
  status: string
  /** 是否正在检查更新 */
  checking: boolean
  /** 是否正在安装更新 */
  installing: boolean
  /** 更新是否已下载完成 */
  ready: boolean
  /** 下载进度百分比 */
  progress: number | null
}

/** 设置弹窗属性实体 */
export interface SettingsModalProps {
  /** 是否打开弹窗 */
  open: boolean
  /** 关闭弹窗回调 */
  onClose: () => void
  /** 输入输出设备列表 */
  devices: SettingsAudioDevices
  /** 当前音频偏好 */
  preferences: SettingsAudioPreferences
  /** 修改音频偏好回调 */
  onChangePreferences: (patch: Partial<SettingsAudioPreferences>) => void
  /** 刷新设备回调 */
  onRefreshDevices: () => void
  /** 是否正在测试麦克风 */
  isTestingMicrophone: boolean
  /** 当前麦克风输入电平 */
  microphoneTestLevel: number
  /** 开始或停止麦克风测试回调 */
  onTestMicrophone: () => void
  /** 更新状态 */
  update: SettingsUpdateState
  /** 当前用户昵称 */
  displayName: string
  /** 用户昵称变化回调 */
  onChangeDisplayName: (value: string) => void
  /** 检查更新回调 */
  onCheckUpdate: () => void
  /** 安装已下载更新回调 */
  onInstallUpdate: () => void
}

/** 获取设备默认展示名称 */
function getDefaultDeviceName(devices: SettingsAudioDevice[]): string {
  return devices.find((device) => device.isDefault)?.label || devices[0]?.label || '当前默认设备'
}

/** 设置页音量滑块 */
function VolumeSetting({
  label,
  value,
  max = 300,
  disabled = false,
  onChange
}: {
  /** 设置项名称 */
  label: string
  /** 当前音量百分比 */
  value: number
  /** 可调节的最大百分比 */
  max?: number
  /** 是否禁用滑块 */
  disabled?: boolean
  /** 音量变化回调 */
  onChange: (value: number) => void
}) {
  return (
    <div className="volume-setting">
      <div className="volume-setting-heading">
        <span>{label}</span>
        <output>{value}%</output>
      </div>
      <Slider
        aria-label={label}
        min={0}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(nextValue: number | number[]) => onChange(typeof nextValue === 'number' ? nextValue : nextValue[0])}
      />
    </div>
  )
}

/** 设置页音频开关 */
function AudioToggle({
  label,
  description,
  value,
  onChange
}: {
  /** 设置项名称 */
  label: string
  /** 设置项说明 */
  description: string
  /** 当前开关状态 */
  value: boolean
  /** 开关变化回调 */
  onChange: (value: boolean) => void
}) {
  return (
    <div className="audio-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch checked={value} onChange={onChange} />
    </div>
  )
}

/** 将麦克风输入电平转换为测试条数量 */
function getMeterCount(level: number): number {
  return Math.min(36, Math.max(0, Math.round(level * 36)))
}

/** 按旧版样式展示完整音频设置弹窗 */
export default function SettingsModal({
  open,
  onClose,
  devices,
  preferences,
  onChangePreferences,
  onRefreshDevices,
  isTestingMicrophone,
  microphoneTestLevel,
  onTestMicrophone,
  update,
  displayName,
  onChangeDisplayName,
  onCheckUpdate,
  onInstallUpdate
}: SettingsModalProps) {
  const [displayNameDraft, setDisplayNameDraft] = useState(displayName)

  /** 弹窗打开时同步当前昵称到编辑草稿 */
  useEffect(() => {
    if (open) setDisplayNameDraft(displayName)
  }, [displayName, open])

  /** 保存非空昵称并交由房间逻辑实时同步 */
  const saveDisplayName = () => {
    const normalized = displayNameDraft.trim().slice(0, 24)
    if (!normalized) return
    onChangeDisplayName(normalized)
    setDisplayNameDraft(normalized)
  }

  const deviceSettings = (
    <section className="settings-section">
      <h4>设备与测试</h4>
      <div className="settings-panel">
        <div className="device-setting-row">
          <label htmlFor="audio-input-device">输入设备</label>
          <div className="device-select-wrap">
            <Select
              id="audio-input-device"
              value={preferences.inputDeviceId}
              onChange={(value) => onChangePreferences({ inputDeviceId: value })}
              options={[
                { value: 'default', label: `默认 - ${getDefaultDeviceName(devices.inputs)}` },
                ...devices.inputs
                  .filter((device) => !device.isDefault)
                  .map((device) => ({ value: device.deviceId, label: device.label }))
              ]}
            />
            <Button type="text" icon={<ReloadOutlined />} onClick={onRefreshDevices} aria-label="刷新输入设备" />
          </div>
        </div>
        <div className="device-setting-row">
          <label htmlFor="audio-output-device">输出设备</label>
          <div className="device-select-wrap">
            <Select
              id="audio-output-device"
              value={preferences.outputDeviceId}
              onChange={(value) => onChangePreferences({ outputDeviceId: value })}
              options={[
                { value: 'default', label: `默认 - ${getDefaultDeviceName(devices.outputs)}` },
                ...devices.outputs
                  .filter((device) => !device.isDefault)
                  .map((device) => ({ value: device.deviceId, label: device.label }))
              ]}
            />
            <Button type="text" icon={<ReloadOutlined />} onClick={onRefreshDevices} aria-label="刷新输出设备" />
          </div>
        </div>
        <div className="mic-test-row">
          <span className="settings-row-label">
            <AudioOutlined />
            麦克风测试
          </span>
          <div className="mic-test-controls">
            <Button type="primary" onClick={onTestMicrophone}>
              {isTestingMicrophone ? '停止测试' : '检查一下'}
            </Button>
            <div className="level-meter" aria-label="麦克风输入电平">
              {Array.from({ length: 36 }, (_, index) => (
                <i key={index} className={index < getMeterCount(microphoneTestLevel) ? 'active' : ''} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
  const audioSettings = (
    <section className="settings-section">
      <h4>音频处理</h4>
      <div className="settings-panel processing-panel">
        <VolumeSetting
          label="麦克风输入"
          value={preferences.inputVolume}
          onChange={(value) => onChangePreferences({ inputVolume: value })}
        />
        <VolumeSetting
          label="扬声器输出"
          value={preferences.outputVolume}
          onChange={(value) => onChangePreferences({ outputVolume: value })}
        />
        <AudioToggle
          label="语音降噪"
          description="DeepFilterNet3 WebAssembly 本地处理"
          value={preferences.noiseSuppression}
          onChange={(value) => onChangePreferences({ noiseSuppression: value })}
        />
        <VolumeSetting
          label="降噪强度"
          value={preferences.noiseReductionLevel}
          max={100}
          disabled={!preferences.noiseSuppression}
          onChange={(value) => onChangePreferences({ noiseReductionLevel: value })}
        />
        <AudioToggle
          label="回音抵消"
          description="使用 WebRTC 音频处理减少扬声器声音回到麦克风"
          value={preferences.echoCancellation}
          onChange={(value) => onChangePreferences({ echoCancellation: value })}
        />
      </div>
    </section>
  )
  const profileSettings = (
    <section className="settings-section">
      <h4>个人信息</h4>
      <div className="settings-panel profile-panel">
        <div className="profile-setting-row">
          <label htmlFor="settings-display-name">显示昵称</label>
          <Input
            id="settings-display-name"
            value={displayNameDraft}
            maxLength={24}
            onChange={(event) => setDisplayNameDraft(event.target.value)}
            onPressEnter={saveDisplayName}
          />
          <Button type="primary" onClick={saveDisplayName} disabled={!displayNameDraft.trim()}>
            保存昵称
          </Button>
        </div>
        <small className="profile-setting-note">昵称会保存在本机，并实时同步到当前房间</small>
      </div>
    </section>
  )
  const updateSettings = (
    <section className="settings-section">
      <h4>应用更新</h4>
      <div className="settings-panel update-panel">
        <div className="version-setting-row">
          <div>
            <span>当前版本</span>
            <strong>{update.version === '开发版' ? update.version : `v${update.version}`}</strong>
          </div>
          <Button type="default" onClick={onCheckUpdate} loading={update.checking}>
            检查更新
          </Button>
        </div>
        <div className="update-status-row">
          <span>{update.availableVersion ? `发现新版本 v${update.availableVersion}` : update.status}</span>
          {update.ready && (
            <Button type="primary" onClick={onInstallUpdate} loading={update.installing}>
              立即更新
            </Button>
          )}
        </div>
        {update.installing && <Progress percent={update.progress ?? 0} status="active" showInfo />}
      </div>
    </section>
  )
  return (
    <Modal
      className="settings-ant-modal"
      styles={{ body: { maxHeight: 'calc(100vh - 150px)', overflowY: 'auto', paddingRight: 2 } }}
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={720}
      title="设置"
    >
      <Tabs
        className="settings-tabs"
        tabPosition="left"
        items={[
          { key: 'devices', label: '设备与测试', children: deviceSettings },
          { key: 'audio', label: '音频处理', children: audioSettings },
          { key: 'profile', label: '个人信息', children: profileSettings },
          { key: 'updates', label: '应用更新', children: updateSettings }
        ]}
      />
      <p className="settings-note">音频设置会自动保存在本机，输入、输出和成员独立音量最高支持 300%</p>
    </Modal>
  )
}
