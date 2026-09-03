import { invoke } from '@tauri-apps/api/core'

const NAME_KEY = 'voice-room.display-name'
const DEVICE_KEY = 'voice-room.device-identity'

/** 设备信息实体 */
export interface DeviceProfile {
  /** 用于 LiveKit identity 的设备标识 */
  identity: string
  /** 当前设备的显示名称 */
  displayName: string
}

/** 读取设备机器码，浏览器开发模式下使用稳定的本地随机标识 */
async function readMachineCode(): Promise<string> {
  try {
    return await invoke<string>('machine_code')
  } catch {
    const cached = localStorage.getItem(DEVICE_KEY)
    if (cached) return cached
    const generated = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, generated)
    return generated
  }
}

/** 将机器码转换为不直接暴露硬件信息的 LiveKit identity */
async function createIdentity(machineCode: string): Promise<string> {
  const bytes = new TextEncoder().encode(machineCode)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `device-${hash.slice(0, 16)}`
}

/** 根据设备 identity 生成稳定且可读的默认昵称 */
function createDefaultName(identity: string): string {
  const adjectives = ['安静', '晴朗', '轻盈', '温柔', '闪耀', '自在', '松弛', '清醒']
  const nouns = ['海盐', '月光', '云朵', '松果', '微风', '星河', '山雀', '灯塔']
  const seed = identity.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return `${adjectives[seed % adjectives.length]}${nouns[(seed >> 3) % nouns.length]}`
}

/** 获取本机在聊天室中的身份与昵称 */
export async function getDeviceProfile(): Promise<DeviceProfile> {
  const identity = await createIdentity(await readMachineCode())
  const savedName = localStorage.getItem(NAME_KEY)?.trim()
  return { identity, displayName: savedName || createDefaultName(identity) }
}

/** 保存用户修改后的昵称 */
export function saveDisplayName(displayName: string): void {
  localStorage.setItem(NAME_KEY, displayName.trim())
}
