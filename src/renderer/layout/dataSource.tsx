import { Input, MenuProps, Tree, TreeDataNode } from 'antd'
import React from 'react'
const dig = (path = '0', level = 3) => {
  const list = []
  for (let i = 0; i < 10; i += 1) {
    const key = `${path}-${i}`
    const treeNode: TreeDataNode = {
      title: key,
      key
    }

    if (level > 0) {
      treeNode.children = dig(key, level - 1)
    }

    list.push(treeNode)
  }
  return list
}

const treeData = dig()

const DataSource: React.FC = () => {
  const items: MenuProps['items'] = [
    {
      key: '1',
      label: 'My Account',
      disabled: true
    },
    {
      type: 'divider'
    },
    {
      key: '2',
      label: 'Profile',
      extra: '⌘P'
    },
    {
      key: '3',
      label: 'Billing',
      extra: '⌘B'
    },
    {
      key: '4',
      label: 'Settings',
      extra: '⌘S'
    }
  ]
  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto pb-16">
        <Tree treeData={treeData}></Tree>
      </div>
      <div className="bg-base absolute bottom-0 flex h-16 w-full items-center pl-2 pr-2">
        <Input placeholder="Search" />
      </div>
    </div>
  )
}

export default DataSource
