import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'

if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN)
  throw new Error('Set APP_ORIGIN to the public HTTPS URL before starting production.')
const { app, jobs } = await createApp({ root: path.resolve(process.env.DATA_DIR ?? '.data') })
if (process.env.NODE_ENV === 'production') {
  app.get('*', serveStatic({ root: 'dist/web' }))
  app.get('*', serveStatic({ path: 'dist/web/index.html' }))
}
const server = serve(
  {
    fetch: app.fetch,
    hostname: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 55021),
  },
  (info) => {
    console.log(`ADT Speech Studio listening on ${info.port}`)
  },
)
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close()
    void jobs.stop().finally(() => process.exit(0))
  })
