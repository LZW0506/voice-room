// src/router/index.jsx
import Layout from '@renderer/layout'
import Home from '@renderer/views/Home'
import { createBrowserRouter } from 'react-router-dom'

const router = createBrowserRouter([
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
