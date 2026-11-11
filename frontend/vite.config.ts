import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 将来 Python バックエンド（backend/）に接続するときのためのプロキシ設定。
    // 現在のデモでは使用していない（すべてダミーデータで動作）。
    proxy: { '/api': 'http://localhost:8000' },
  },
})
