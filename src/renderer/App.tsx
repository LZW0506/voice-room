import router from '@renderer/router'
import { ConfigProvider, theme } from 'antd'
import { RouterProvider } from 'react-router-dom'
const App: React.FC = () => {
  return (
    <>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          cssVar: {},
          token: {
            colorPrimary: '#f2c94c',
            colorInfo: '#f2c94c',
            colorSuccess: '#7bc47f',
            colorTextBase: '#f5f1e8',
            colorBgBase: '#151515',
            colorBgContainer: '#1e1e1e',
            colorBorder: '#3b3b3b',
            borderRadius: 8
          }
        }}
      >
        <RouterProvider router={router} />
      </ConfigProvider>
    </>
  )
}

export default App
