
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
      '/api/species': {
        target: 'https://smart-ground-truthing-and-digital.onrender.com',
        changeOrigin: true,
        secure: true,
      },
      '/api/tables': {
        target: 'https://smart-ground-truthing-and-digital.onrender.com',
        changeOrigin: true,
        secure: true,
      },
      '/api/plants': {
        target: 'https://smart-ground-truthing-and-digital.onrender.com',
        changeOrigin: true,
        secure: true,
      },
      '/api/db-test': {
        target: 'https://smart-ground-truthing-and-digital.onrender.com',
        changeOrigin: true,
        secure: true,
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
