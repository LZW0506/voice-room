import router from '@renderer/router'
import { ConfigProvider } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { useAppSelector } from './store/hooks'
const App: React.FC = () => {
  const antdLang = useAppSelector((state) => state.antd)
  return (
    <>
      <ConfigProvider
        theme={{
          cssVar: true,
          token: {
            colorPrimary: '#3f72af',
            colorInfo: '#5b7fa3',
            colorSuccess: '#83cc5e',
            colorTextBase: '#212121',
            borderRadius: 5
          }
        }}
        locale={antdLang}
      >
        <RouterProvider router={router} />
      </ConfigProvider>
    </>
  )
}

export default App
