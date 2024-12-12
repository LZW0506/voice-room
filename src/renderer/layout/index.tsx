import { Splitter } from 'antd'
import { useState } from 'react'
import DataSource from './dataSource'
import Header from './header'
const Layout = () => {
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(false)

  return (
    <>
      <Header></Header>
      <Splitter className="h-content-full">
        {showLeft && (
          <Splitter.Panel defaultSize="20%" min="15%" max="50%">
            <DataSource></DataSource>
          </Splitter.Panel>
        )}
        <Splitter.Panel></Splitter.Panel>
      </Splitter>
    </>
  )
}
export default Layout
