/** WebRTC 支持检查结果实体 */
export interface WebRtcSupport {
  /** 是否存在媒体设备 API */ mediaDevices: boolean
  /** 是否支持用户媒体采集 */ getUserMedia: boolean
  /** 失败原因 */ reason?: string
}

/** 检查当前 Electron renderer 是否具备 WebRTC 麦克风能力 */
export function checkWebRtcSupport(): WebRtcSupport {
  const mediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices)
  const getUserMedia = mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
  if (!mediaDevices)
    return {
      mediaDevices: false,
      getUserMedia: false,
      reason: '当前窗口没有可用的媒体设备接口，请确认应用使用 Electron 窗口启动'
    }
  if (!getUserMedia) return { mediaDevices: true, getUserMedia: false, reason: '当前 Electron 版本不支持麦克风采集' }
  return { mediaDevices, getUserMedia }
}

/** 将浏览器媒体权限错误转换为用户可读提示 */
export function formatWebRtcError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')
      return '麦克风权限被拒绝，请在 Windows 设置中允许声屿访问麦克风'
    if (error.name === 'NotFoundError') return '没有找到可用的麦克风设备'
    if (error.name === 'NotReadableError') return '麦克风已被其他应用占用'
    if (error.name === 'OverconstrainedError') return '当前麦克风不满足采集参数，请重新选择设备'
  }
  return error instanceof Error ? error.message : '打开 WebRTC 麦克风失败'
}

/** 生成稳定的本机用户身份 */
export function getLocalIdentity(): string {
  const key = 'voice-island-identity'
  const cached = localStorage.getItem(key)
  if (cached) return cached
  const identity = `device-${crypto.randomUUID()}`
  localStorage.setItem(key, identity)
  return identity
}

/** 根据稳定设备身份生成可读的默认昵称 */
export function createDefaultDisplayName(identity: string): string {
  const adjectives = ['安静', '晴朗', '轻盈', '温柔', '闪耀', '自在', '松弛', '清醒']
  const nouns = ['海盐', '月光', '云朵', '松果', '微风', '星河', '山雀', '灯塔']
  const seed = identity.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return `${adjectives[seed % adjectives.length]}${nouns[(seed >> 3) % nouns.length]}`
}
