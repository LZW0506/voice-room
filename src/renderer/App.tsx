import { RouterProvider } from 'react-router-dom'
import router from '@renderer/router'
import { ConfigProvider } from 'antd'

const App: React.FC = () => {
  return (
    <>
      <ConfigProvider theme={{ cssVar: true }}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </>
  )
}

export default App
