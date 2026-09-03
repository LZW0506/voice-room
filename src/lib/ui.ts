/** 生成进入页面时使用的默认房间名称 */
export function createDefaultRoom(): string {
  return '夜航电台'
}

/** 取昵称首字符作为头像标识 */
export function getParticipantInitial(name?: string): string {
  return (name?.trim().slice(0, 1) || '?').toUpperCase()
}

/** 将人数格式化为界面文案 */
export function formatParticipantCount(count: number): string {
  return `${count} 人在线`
}
