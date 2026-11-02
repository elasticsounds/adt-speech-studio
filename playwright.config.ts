import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:55023',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm exec tsx tests/browser/server.ts',
    url: 'http://127.0.0.1:55023/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
