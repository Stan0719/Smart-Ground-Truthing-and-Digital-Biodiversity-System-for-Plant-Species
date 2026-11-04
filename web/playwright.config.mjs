import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
