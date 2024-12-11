import React, { useEffect, useState } from 'react'

import Settings from '@renderer/components/Settings'
import { Button } from 'antd'
const Home: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  // 进行初始化操作
  const init = async () => {}
  useEffect(() => {
    init()
  }, [])

  return (
    <>
      <Button onClick={() => setIsModalOpen(true)} type="primary">
        设置
      </Button>
      <Settings isModalOpen={isModalOpen} onCancel={() => setIsModalOpen(false)}></Settings>
    </>
  )
}
export default Home
