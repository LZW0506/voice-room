import { Outlet } from 'react-router-dom'

const Layout = () => {
  return (
    <div className="h-full">
      <div className="drap-window h-9 w-full bg-slate-200"></div>
      <Outlet />
    </div>
  )
}
export default Layout
