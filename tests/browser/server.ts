import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from '../../apps/api/src/app.js'
import { tone } from '../fixture.js'

// This transport exists only in the test server; production bundles never import it.
process.env.PROVIDER_INTERVAL_MS = '0'
process.env.SERVICE_DAILY_CHARACTERS = '0'
process.env.PUBLIC_WEB_URL = 'http://localhost:55024/adt-speech-studio/'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-browser-'))
const { app, jobs } = await createApp({
  root,
  transport: async (_url, init) => {
    const request = JSON.parse(init?.body as string)
    if (request.generationConfig?.responseMimeType === 'application/json')
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    speechText: 'A garden has twelve flowers.',
                    failureReason: null,
                  }),
                },
              ],
            },
          },
        ],
      })
    if (String(_url).endsWith('/interactions'))
      return Response.json({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'audio', mime_type: 'audio/wav', data: tone.toString('base64') }],
          },
        ],
      })
    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: 'audio/wav', data: tone.toString('base64') } }],
          },
        },
      ],
    })
  },
})
app.get('*', serveStatic({ root: 'dist/web' }))
app.get('*', serveStatic({ path: 'dist/web/index.html' }))
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 55023 })
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.close()
    void jobs
      .stop()
      .then(() => fs.rm(root, { recursive: true, force: true }))
      .finally(() => process.exit(0))
  })
