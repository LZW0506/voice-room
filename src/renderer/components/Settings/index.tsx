import { useState } from 'react'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
export default ({
  isModalOpen,
  onOk,
  onCancel
}: {
  isModalOpen: boolean // modal是否打开
  onOk?: () => void
  onCancel?: () => void
}) => {
  const { t } = useTranslation()
  const [confirmLoading, setConfirmLoading] = useState(false)
  const handleOk = () => {
    setConfirmLoading(true)
    if (onOk) {
      onOk()
    }
  }
  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    }
  }
  return (
    <Modal
      maskClosable={false}
      title={t('setting.title')}
      okText={t('setting.save')}
      open={isModalOpen}
      onOk={handleOk}
      onCancel={handleCancel}
      confirmLoading={confirmLoading}
    ></Modal>
  )
}
