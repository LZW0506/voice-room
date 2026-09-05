import { ipcMain } from 'electron'

const tokenUrl = process.env.VITE_TOKEN_URL || 'http://82.157.174.249:8787/api/token'
const livekitUrl = process.env.VITE_LIVEKIT_URL || 'ws://82.157.174.249:7880'

/** 房间 Token 请求实体 */
interface RoomTokenRequest {
  /** 房间名称 */ room: string
  /** 用户身份 */ identity: string
  /** 用户昵称 */ name: string
}
/** 房间 Token 响应实体 */
interface RoomTokenResponse {
  /** LiveKit 令牌 */ token: string
  /** LiveKit 地址 */ url: string
}

/** 注册房间网络相关 IPC 方法 */
export default () => {
  ipcMain.handle('voice:token', async (_event, request: RoomTokenRequest): Promise<RoomTokenResponse> => {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request)
    })
    if (!response.ok) throw new Error(`Token 服务返回错误: ${response.status}`)
    const result = (await response.json()) as Partial<RoomTokenResponse>
    if (!result.token) throw new Error('Token 服务响应缺少 token')
    return { token: result.token, url: result.url || livekitUrl }
  })
}
