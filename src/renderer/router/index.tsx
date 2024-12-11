// src/router/index.jsx
import { createBrowserRouter } from 'react-router-dom'
import Home from '@renderer/views/Home'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />
  }
])

export default router
