import React, { useEffect, useState } from 'react'

import { Button } from 'antd'
import Settings from '@renderer/components/Settings'
const Home: React.FC = () => {
  const [test, setTest] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  // 进行初始化操作
  const init = async () => {
    const result = await window.test.test()
    setTest(result)
  }
  useEffect(() => {
    init()
  }, [])

  return (
    <>
      {test}
      <Button onClick={() => setIsModalOpen(true)}>设置</Button>
      <Settings isModalOpen={isModalOpen} onCancel={() => setIsModalOpen(false)}></Settings>
    </>
  )
}
export default Home
