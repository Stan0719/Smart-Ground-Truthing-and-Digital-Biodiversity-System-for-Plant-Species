import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/iot': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/species-requests': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/species': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/tables': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/plants': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/db-test': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api/observations': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api': 'http://127.0.0.1:3001',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
