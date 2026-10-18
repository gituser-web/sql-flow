import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 前后端不分离：构建产物直接进 Spring Boot 的静态目录。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../src/main/resources/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 开发时把 /api 代理到后端，避免跨域
    proxy: {
      '/api': 'http://localhost:7000',
    },
  },
})
