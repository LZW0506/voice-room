import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { defineConfig } from 'vite'
// https://vitejs.dev/config
export default defineConfig(() => {
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': path.resolve(__dirname, 'src/renderer')
      }
    }
  }
})
