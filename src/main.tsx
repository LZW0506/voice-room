import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import 'antd/dist/reset.css'
import './styles.css'
import App from './App'

const DARK_THEME_BACKGROUND = '#18191c'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#e6c968',
          colorInfo: '#e6c968',
          colorBgBase: DARK_THEME_BACKGROUND,
          colorBgContainer: DARK_THEME_BACKGROUND,
          colorBgElevated: DARK_THEME_BACKGROUND,
          colorBgLayout: DARK_THEME_BACKGROUND,
          colorFill: DARK_THEME_BACKGROUND,
          colorFillAlter: DARK_THEME_BACKGROUND,
          colorFillSecondary: DARK_THEME_BACKGROUND,
          colorFillTertiary: DARK_THEME_BACKGROUND,
          colorFillQuaternary: DARK_THEME_BACKGROUND,
          colorBorder: '#41444b',
          colorTextBase: '#f5f2ee',
          colorTextLightSolid: '#1b202b',
          borderRadius: 10,
          fontFamily: 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
