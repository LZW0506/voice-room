import { createSlice } from '@reduxjs/toolkit'
import i18n from '@renderer/locales'
import type { Locale } from 'antd/lib/locale'
import antdZhCn from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
export interface SystemState {
  lang: string
  antd: Locale
}
const initialState: SystemState = {
  lang: 'zh-CN',
  antd: antdZhCn
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
    }
  }
})
// 导出方法
export const { setLang } = systemSlice.actions

// 默认导出
export default systemSlice.reducer
