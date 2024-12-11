import { defineConfig } from 'vite'
import path from 'path'
import react from '@vitejs/plugin-react-swc'
// https://vitejs.dev/config
export default defineConfig(() => {
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/renderer')
      }
    },
    css: {
      preprocessorOptions: {
        less: {
          javascriptEnabled: true, // 支持内联 JavaScript
          modifyVars: {
            // 更改主题
          }
        }
      }
    }
  }
})
