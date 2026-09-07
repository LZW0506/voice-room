import { Outlet } from 'react-router-dom'
import Header from './header'

/** 应用主布局，负责窗口标题栏和页面内容承载 */
const Layout = () => (
  <div className="flex h-screen flex-col">
    <Header />
    <main className="min-h-0 flex-1 overflow-auto">
      <Outlet />
    </main>
  </div>
)

export default Layout
