import Icon from '@ant-design/icons'
import SvgIcon from '@renderer/components/SvgIcon'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { setMax, setPlatform } from '@renderer/store/modules/systemSlice'
import { Space } from 'antd'
import { useEffect } from 'react'
const Header = () => {
  // 通过useDispatch 派发事件
  const dispatch = useAppDispatch()
  const isMax = useAppSelector((state) => state.isMax)
  const platform = useAppSelector((state) => state.platform)
  window.windows.isMax((isMax: boolean) => {
    dispatch(setMax(isMax))
  })
  useEffect(() => {
    window.windows.getMax().then((isMax: boolean) => {
      dispatch(setMax(isMax))
    })
    window.system.platform().then((platform: string) => {
      dispatch(setPlatform(platform))
    })
  }, [])
  return (
    <div className="bg-base drap-window h-header-full flex w-full items-center justify-between pl-2 pr-2">
      <div className="h-full w-16"></div>
      <div>
        {platform == 'win32' && (
          <Space>
            <Icon
              component={() => <SvgIcon name="minimize" size="14px" />}
              className="no-drap hover:bg-border text-icon cursor-pointer p-1 hover:rounded"
              onClick={() => window.windows.minimize()}
            ></Icon>
            {isMax && (
              <Icon
                component={() => <SvgIcon name="unmaximize" size="14px" />}
                className="no-drap hover:bg-border text-icon cursor-pointer p-1 hover:rounded"
                onClick={() => window.windows.unmaximize()}
              ></Icon>
            )}
            {!isMax && (
              <Icon
                component={() => <SvgIcon name="maximize" size="14px" />}
                className="no-drap hover:bg-border text-icon cursor-pointer p-1 hover:rounded"
                onClick={() => window.windows.maximize()}
              ></Icon>
            )}
            <Icon
              component={() => <SvgIcon name="close" size="14px" />}
              className="no-drap hover:bg-border text-icon cursor-pointer p-1 hover:rounded"
              onClick={() => window.windows.close()}
            ></Icon>
          </Space>
        )}
      </div>
    </div>
  )
}
export default Header
