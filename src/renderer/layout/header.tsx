import SvgIcon from '@renderer/components/SvgIcon'
import useClientStore from '@renderer/store'
import { Button, Space } from 'antd'
import { useEffect } from 'react'

/** 应用无边框窗口标题栏 */
const Header = () => {
  const isMaximized = useClientStore((state) => state.isMaximized)
  const setMaximized = useClientStore((state) => state.setMaximized)
  const platform = useClientStore((state) => state.platform)
  const setPlatform = useClientStore((state) => state.setPlatform)

  useEffect(() => {
    void window.windows.getMax().then(setMaximized)
    void window.system.platform().then(setPlatform)
    return window.windows.onMaximized(setMaximized)
  }, [setMaximized, setPlatform])

  return (
    <header className="drap-window flex shrink-0 py-1 px-4 items-center justify-between bg-[#1b1a18] ">
      <div className="no-drap flex items-center gap-2 font-semibold text-[#f5f1e8]">
        <span className="rounded-lg bg-[#f2c94c] px-2 py-1 text-xs font-bold text-[#242019]">声屿</span>
        <span>语音空间</span>
      </div>
      {platform === 'win32' && (
        <Space size={2} className="no-drap">
          <Button
            className="window-action"
            type="text"
            onClick={() => window.windows.minimize()}
            aria-label="最小化"
            icon={<SvgIcon name="minimize" size="13px" />}
          />
          <Button
            className="window-action"
            type="text"
            onClick={() => (isMaximized ? window.windows.unmaximize() : window.windows.maximize())}
            aria-label={isMaximized ? '还原' : '最大化'}
            icon={<SvgIcon name={isMaximized ? 'unmaximize' : 'maximize'} size="13px" />}
          />
          <Button
            className="window-action window-close"
            type="text"
            onClick={() => window.windows.close()}
            aria-label="关闭"
            icon={<SvgIcon name="close" size="13px" />}
          />
        </Space>
      )}
    </header>
  )
}

export default Header
