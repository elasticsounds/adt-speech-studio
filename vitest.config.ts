import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  resolve: { alias: { '@speech/types': path.resolve('packages/types/src/index.ts') } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30000, fileParallelism: false },
})
