import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from '../../apps/api/src/app.js'
import { tone, normalizationPayload } from '../fixture.js'

// This transport exists only in the test server; production bundles never import it.
process.env.PROVIDER_INTERVAL_MS = '0'
process.env.SERVICE_DAILY_CHARACTERS = '0'
process.env.PUBLIC_WEB_URL = 'http://localhost:55024/adt-speech-studio/'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-browser-'))
const { app, jobs } = await createApp({
  root,
  transport: async (_url, init) => {
    if (String(_url) === 'https://api.openai.com/v1/audio/transcriptions') {
      if ((init?.headers as Record<string, string>).Authorization !== 'Bearer pages-openai-key')
        return new Response(null, { status: 401 })
      const audio = (init!.body as FormData).get('file') as Blob
      const bytes = Buffer.from(await audio.arrayBuffer())
      const duration = bytes.readUInt32LE(40) / 48000
      return Response.json({
        text: 'Every plant',
        duration,
        words: [
          { word: 'Every', start: 0, end: duration / 2 },
          { word: 'plant', start: duration / 2, end: duration },
        ],
      })
    }
    if (String(_url) === 'https://api.openai.com/v1/responses') {
      if ((init?.headers as Record<string, string>).Authorization !== 'Bearer pages-openai-key')
        return new Response(null, { status: 401 })
      return Response.json(normalizationPayload('A garden has twelve flowers.'))
    }
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
