// src/router/index.jsx
import Layout from '@renderer/layout'
import Home from '@renderer/views/Home'
import { createHashRouter } from 'react-router-dom'

// Electron 生产环境通过 file:// 加载页面，使用 Hash 路由避免本地文件路径被当作服务端路由
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Home />
      }
    ]
  }
])

export default router
