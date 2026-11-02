import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import path from 'node:path'
export default defineConfig({
  root: 'apps/web',
  plugins: [react(), tailwind()],
  resolve: { alias: { '@speech/types': path.resolve('packages/types/src/index.ts') } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 55020),
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 55021}` },
  },
})
