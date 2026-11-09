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
      '/camera-api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/camera-api/, ''),
      },
      '/api/data': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api\/data/, '/api'),
      },
      // Compatibility for backend asset URLs. New web mappings use /api/data/assets.
      '^/api/assets(?:[/?]|$)': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
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
      '/api/taxonomy': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
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
