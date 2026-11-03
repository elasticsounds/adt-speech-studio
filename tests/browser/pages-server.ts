import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
const app = new Hono()
app.get(
  '/adt-speech-studio/*',
  serveStatic({
    root: 'dist/pages',
    rewriteRequestPath: (path) => path.replace(/^\/adt-speech-studio/, ''),
  }),
)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 55024 })
