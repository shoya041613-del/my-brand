import { defineConfig } from 'vite';

// Vite 開発サーバーの設定
// /api/* へのリクエストを Express バックエンド（ポート3001）にプロキシする
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
