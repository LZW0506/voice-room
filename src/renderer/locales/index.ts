import type { Locale } from 'antd/lib/locale'
import antdEn from 'antd/locale/en_US'
import antdZhCn from 'antd/locale/zh_CN'
import 'dayjs/locale/en'
import 'dayjs/locale/zh-cn'
import i18n, { ResourceKey } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './lang/en.json'
import zhCn from './lang/zh-CN.json'
export interface Language {
  name: string
  key: string
  locale: ResourceKey
  date: string
  antd: Locale
}
export const Languages: Language[] = [
  {
    name: '简体中文',
    key: 'zh-CN',
    locale: zhCn,
    date: 'zh-cn',
    antd: antdZhCn
  },
  {
    name: 'English',
    key: 'en',
    locale: en,
    date: 'en',
    antd: antdEn
  }
]
i18n
  // 检测用户当前使用的语言
  // 文档: https://github.com/i18next/i18next-browser-languageDetector
  .use(LanguageDetector)
  // 注入 react-i18next 实例
  .use(initReactI18next)
  // 初始化 i18next
  // 配置参数的文档: https://www.i18next.com/overview/configuration-options
  .init({
    debug: true,
    fallbackLng: 'zh-CN',
    lng: navigator.language,
    interpolation: {
      escapeValue: false
    },
    resources: Languages.reduce((acc, cur) => {
      return {
        ...acc,
        [cur.key]: {
          translation: cur.locale
        }
      }
    }, {})
  })

export default i18n
