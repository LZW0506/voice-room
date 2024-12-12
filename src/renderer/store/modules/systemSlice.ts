import { createSlice } from '@reduxjs/toolkit'
import i18n from '@renderer/locales'
import type { Locale } from 'antd/lib/locale'
import antdZhCn from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
export interface SystemState {
  lang: string
  antd: Locale
  isMax: boolean
  platform: string
}
const initialState: SystemState = {
  lang: 'zh-CN',
  antd: antdZhCn,
  isMax: false,
  platform: ''
}

// 创建一个 Slice
export const systemSlice = createSlice({
  name: 'system',
  initialState,
  // 定义 reducers 并生成关联的操作
  reducers: {
    setLang(state, action) {
      i18n.changeLanguage(action.payload.key)
      dayjs.locale(action.payload.date)
      state.lang = action.payload.key
      state.antd = action.payload.antd
    },
    setMax(state, action) {
      state.isMax = action.payload
    },
    setPlatform(state, action) {
      state.platform = action.payload
    }
  }
})

// 导出方法
export const { setLang, setMax, setPlatform } = systemSlice.actions

// 默认导出
export default systemSlice.reducer
