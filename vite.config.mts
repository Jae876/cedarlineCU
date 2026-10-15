import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@pages': path.resolve(process.cwd(), 'src/pages'),
      '@components': path.resolve(process.cwd(), 'src/components'),
      '@services': path.resolve(process.cwd(), 'src/services'),
    },
  },
  server: {
    strictPort: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
