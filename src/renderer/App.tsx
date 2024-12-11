import router from '@renderer/router'
import { ConfigProvider } from 'antd'
import { RouterProvider } from 'react-router-dom'
import { useAppSelector } from './store/hooks'
const App: React.FC = () => {
  const antdLang = useAppSelector((state) => state.antd)
  return (
    <>
      <ConfigProvider theme={{ cssVar: true }} locale={antdLang}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </>
  )
}

export default App
