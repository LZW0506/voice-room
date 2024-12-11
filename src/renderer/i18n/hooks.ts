import dayjs from 'dayjs'
import i18n, { Language } from './index'
import { useAppDispatch } from '@renderer/store/hooks'

import { changeLang } from '@renderer/store/modules/systemSlice'
export const changeLanguage = (languageConfig: Language) => {
  // 更新 i18n 语言
  i18n.changeLanguage(languageConfig.key)
  import(`dayjs/locale/${languageConfig.date}`).then(() => {
    // 更新 dayjs 语言
    dayjs.locale(languageConfig.date)
  })
  import(`antd/locale/${languageConfig.locale}`).then(() => {
    // 更新 antd 语言
    const dispatch = useAppDispatch()
    dispatch(changeLang(languageConfig))
  })
}
