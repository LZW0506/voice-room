import { Splitter } from 'antd'
import { useState } from 'react'
const Layout = () => {
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(false)

  return (
    <>
      <div className="bg-base drap-window h-9 w-full"></div>
      <Splitter className="h-content-full">
        {showLeft && <Splitter.Panel defaultSize="20%" min="15%" max="50%"></Splitter.Panel>}
        <Splitter.Panel></Splitter.Panel>
      </Splitter>
    </>
  )
}
export default Layout
