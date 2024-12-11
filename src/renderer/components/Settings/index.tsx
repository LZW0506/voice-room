import { Modal, Tabs } from 'antd'
import { useTranslation } from 'react-i18next'
import General from './general'
export default ({
  isModalOpen,
  onCancel
}: {
  isModalOpen: boolean // modal是否打开
  onCancel: () => void
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      maskClosable={false}
      title={t('setting.title')}
      open={isModalOpen}
      onCancel={onCancel}
      width="700px"
      footer={null}
    >
      <Tabs
        defaultActiveKey="general"
        tabPosition="left"
        items={[
          {
            label: t('setting.tabs.general'),
            key: 'general',
            children: <General />
          },
          {
            label: t('setting.tabs.plugInMarket'),
            key: 'plugInMarket'
          }
        ]}
      />
    </Modal>
  )
}
