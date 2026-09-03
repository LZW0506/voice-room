import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 创建 Vite 开发与构建配置 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
})
