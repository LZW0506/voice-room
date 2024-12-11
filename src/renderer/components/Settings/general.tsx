import { Languages } from '@renderer/locales'
import { useAppDispatch } from '@renderer/store/hooks'
import { setLang } from '@renderer/store/modules/systemSlice'
import { Form, Select } from 'antd'
import { useTranslation } from 'react-i18next'
const General = () => {
  const { t } = useTranslation()
  type FieldType = {
    language?: string
  }
  // 通过useDispatch 派发事件
  const dispatch = useAppDispatch()
  const langChange = (value: string) => {
    const lang = Languages.find((item) => item.key === value)
    dispatch(setLang(lang))
  }
  return (
    <>
      <div className="text-sm font-bold">{t('setting.general.label')}</div>
      <div className="mt-5">
        <Form initialValues={{ language: 'zh-CN' }}>
          <Form.Item<FieldType> label={t('setting.general.language')} name="language">
            <Select onChange={langChange} options={Languages.map((item) => ({ label: item.name, value: item.key }))} />
          </Form.Item>
        </Form>
      </div>
    </>
  )
}
export default General
