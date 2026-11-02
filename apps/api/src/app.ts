import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import yaml from 'js-yaml'
import {
  AuthRequest,
  RecoveryRequest,
  EditEntry,
  RunRequest,
  VoiceSlot,
  Settings,
  type Credentials,
  type PublicUser,
} from '@speech/types'
import { Store } from './store.js'
import { Auth } from './auth.js'
import { Jobs } from './jobs.js'
import { extractArchive, MAX_UPLOAD, MAX_EXPANDED } from '../../../packages/bundle/src/archive.js'
import { readCatalog, entryKey } from '../../../packages/bundle/src/catalog.js'
import { exportBook } from '../../../packages/bundle/src/export.js'
import {
  atomicJson,
  directoryBytes,
  exists,
  filesUnder,
  hash,
  inside,
  jsonFile,
} from '../../../packages/bundle/src/files.js'
import { validWav } from '../../../packages/tts/src/provider.js'

export async function createApp(options: { root: string; transport?: typeof fetch }) {
  const store = new Store(options.root),
    auth = new Auth(options.root),
    jobs = new Jobs(store, options.transport)
  await fs.mkdir(options.root, { recursive: true })
  await jobs.recover()
  const profiles = z
    .record(z.string(), z.string())
    .parse(yaml.load(await fs.readFile('config/core_tts_profiles.yaml', 'utf8')))
  const instructions = z
    .record(z.string(), z.string())
    .parse(yaml.load(await fs.readFile('config/speech_instructions.yaml', 'utf8')))
  const app = new Hono<{ Variables: { user: PublicUser } }>()
  const secure = process.env.APP_ORIGIN?.startsWith('https://') ?? false
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              mediaSrc: ["'self'", 'blob:'],
              connectSrc: ["'self'"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
            }
          : undefined,
    }),
  )
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_UPLOAD,
      onError: (c) => c.json({ error: 'Upload exceeds the 1 GB limit.' }, 413),
    }),
  )
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin'),
        expected = process.env.APP_ORIGIN ?? new URL(c.req.url).origin
      if (origin && origin !== expected)
        throw new HTTPException(403, { message: 'Request origin is not allowed.' })
      if (c.req.header('X-Requested-With') !== 'ADTSpeech')
        throw new HTTPException(403, { message: 'Missing request validation header.' })
    }
    await next()
  })
  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: 'Some fields are invalid. Check the values and try again.',
          details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        400,
      )
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return c.json({ error: 'Workspace or file not found.' }, 404)
    if (code) {
      console.error(
        JSON.stringify({
          event: 'filesystem-operation-failed',
          code,
          syscall: (error as NodeJS.ErrnoException).syscall,
        }),
      )
      return c.json(
        { error: 'The server could not complete this operation. Your original ADT is safe.' },
        500,
      )
    }
    return c.json({ error: error.message || 'The request could not be completed.' }, 400)
  })
  const cookie = (c: Parameters<typeof setCookie>[0], token: string) =>
    setCookie(c, 'adt_session', token, {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: 7 * 24 * 3600,
    })
  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/auth/me', async (c) =>
    c.json({ user: await auth.user(getCookie(c, 'adt_session')) }),
  )
  for (const mode of ['register', 'login', 'recover'] as const)
    app.post(`/api/auth/${mode}`, bodyLimit({ maxSize: 8192 }), async (c) => {
      const body =
        mode === 'recover'
          ? RecoveryRequest.parse(await c.req.json())
          : AuthRequest.parse(await c.req.json())
      auth.throttle(`auth:${body.username}`)
      auth.throttle('auth:global', 100)
      if (mode === 'register') auth.throttle('registration:global', 20)
      const result =
        mode === 'register'
          ? await auth.register(body.username, body.password)
          : mode === 'login'
            ? await auth.login(body.username, body.password)
            : await auth.recover(
                body.username,
                body.password,
                (body as z.infer<typeof RecoveryRequest>).recoveryCode,
              )
      cookie(c, result.token)
      const { token: _token, ...safe } = result
      return c.json(safe)
    })
  app.post('/api/auth/logout', async (c) => {
    await auth.logout(getCookie(c, 'adt_session'))
    setCookie(c, 'adt_session', '', {
      httpOnly: true,
      secure,
      sameSite: 'Strict',
      path: '/',
      maxAge: 0,
    })
    return c.json({ ok: true })
  })
  app.use('/api/*', async (c, next) => {
    const user = await auth.user(getCookie(c, 'adt_session'))
    if (!user) throw new HTTPException(401, { message: 'Please sign in.' })
    c.set('user', user)
    await next()
  })
  const owner = (c: { get: (key: 'user') => PublicUser }) => c.get('user').id
  app.use('/api/books/*', async (c, next) => {
    if (['GET', 'HEAD'].includes(c.req.method)) return next()
    return store.exclusive(`request-${owner(c)}`, async () => {
      await next()
    })
  })
  const idle = (id: string) => {
    if (jobs.busy(id))
      throw new HTTPException(409, {
        message: 'A job is running for this ADT. Cancel it before editing or exporting.',
      })
  }
  const credentials = (
    c: { req: { header: (name: string) => string | undefined } },
    mode: 'personal' | 'service',
  ): Credentials => {
    if (mode === 'service') {
      if (Number(process.env.SERVICE_DAILY_CHARACTERS ?? 0) <= 0)
        throw new Error('Service generation is not enabled. Use your own API key.')
      return {
        gemini: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
        openai: process.env.OPENAI_API_KEY,
      }
    }
    const gemini = c.req.header('X-Gemini-API-Key'),
      openai = c.req.header('X-OpenAI-Key')
    if ((gemini?.length ?? 0) > 500 || (openai?.length ?? 0) > 500)
      throw new Error('Invalid API key.')
    return { gemini, openai }
  }
  const sendFile = async (file: string, download?: string, range?: string) => {
    const stat = await fs.stat(file),
      headers = new Headers({
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      })
    const ext = path.extname(file).toLowerCase(),
      mime =
        ext === '.zip'
          ? 'application/zip'
          : ext === '.wav'
            ? 'audio/wav'
            : ext === '.mp3'
              ? 'audio/mpeg'
              : ext === '.ogg'
                ? 'audio/ogg'
                : ext === '.flac'
                  ? 'audio/flac'
                  : ext === '.m4a'
                    ? 'audio/mp4'
                    : 'application/octet-stream'
    headers.set('Content-Type', mime)
    if (download) headers.set('Content-Disposition', `attachment; filename="${download}"`)
    let start = 0,
      end = stat.size - 1,
      status = 200
    if (range) {
      const parsed = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!parsed) return new Response(null, { status: 416 })
      start = Number(parsed[1])
      end = parsed[2] ? Number(parsed[2]) : end
      if (start > end || end >= stat.size) return new Response(null, { status: 416 })
      status = 206
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
    }
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Content-Length', String(end - start + 1))
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      headers,
      status,
    })
  }
  app.get('/api/info', async (c) => {
    const allowance = Number(process.env.SERVICE_DAILY_CHARACTERS ?? 0)
    return c.json({
      service: {
        gemini: allowance > 0 && !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
        openai: allowance > 0 && !!process.env.OPENAI_API_KEY,
      },
      dailyCharacters: allowance,
      remainingCharacters: Math.max(0, allowance - (await jobs.used(owner(c)))),
      maxUploadBytes: MAX_UPLOAD,
      profiles,
      instructions,
    })
  })
  app.get('/api/books', async (c) => c.json(await store.list(owner(c))))
  app.post('/api/books', async (c) =>
    store.exclusive('storage-admission', async () => {
      const user = owner(c),
        id = randomUUID(),
        dir = store.dir(user, id)
      if ((await store.list(user)).length >= 20)
        throw new Error('You can keep up to 20 ADTs. Delete an old workspace to upload another.')
      const ownerUsed = await directoryBytes(path.join(options.root, 'books', user)),
        totalUsed = await store.totalBytes()
      const remaining = Math.min(
        Number(process.env.MAX_OWNER_BYTES ?? 2 * 1024 ** 3) - ownerUsed,
        Number(process.env.MAX_STORAGE_BYTES ?? 7 * 1024 ** 3) - totalUsed,
      )
      if (remaining < 20 * 1024 ** 2)
        throw new Error('Storage quota reached. Delete unused workspaces.')
      await fs.mkdir(dir, { recursive: true })
      try {
        if (!c.req.raw.body) throw new Error('Upload a reader ZIP.')
        const target = path.join(dir, 'original.zip')
        let bytes = 0
        const guard = new Transform({
          transform(chunk: Buffer, _e, done) {
            bytes += chunk.length
            if (bytes > Math.min(MAX_UPLOAD, remaining / 2))
              done(new Error('Upload exceeds available storage or the upload limit.'))
            else done(null, chunk)
          },
        })
        await pipeline(
          Readable.fromWeb(c.req.raw.body as import('node:stream/web').ReadableStream),
          guard,
          createWriteStream(target, { flags: 'wx', mode: 0o600 }),
        )
        const extracted = await extractArchive(target, path.join(dir, 'original'), {
          bytes: Math.min(MAX_EXPANDED, remaining - bytes - 10 * 1024 ** 2),
          files: 25000,
        })
        const name = decodeURIComponent(c.req.header('X-File-Name') ?? 'book.zip').slice(0, 250)
        const { book, entries } = await readCatalog(dir, {
          id,
          ownerId: user,
          fileName: path.basename(name),
          createdAt: new Date().toISOString(),
          fileCount: extracted.files,
          bytes: extracted.bytes,
        })
        await store.initialize(book, entries)
        return c.json(await store.summary(user, id), 201)
      } catch (e) {
        await fs.rm(dir, { recursive: true, force: true })
        throw e
      }
    }),
  )
  app.get('/api/books/:book', async (c) => {
    const id = c.req.param('book'),
      user = owner(c),
      state = await store.load(user, id)
    return c.json({
      book: await store.summary(user, id),
      entries: [...state.entries.values()],
      settings: await store.settings(user, id),
      jobs: await store.jobs(user, id),
    })
  })
  app.delete('/api/books/:book', async (c) => {
    const id = c.req.param('book')
    idle(id)
    await store.delete(owner(c), id)
    return c.json({ ok: true })
  })
  app.put('/api/books/:book/entry', bodyLimit({ maxSize: 300000 }), async (c) => {
    const id = c.req.param('book')
    idle(id)
    const body = EditEntry.parse(await c.req.json()),
      { id: textId, language, version, ...patch } = body
    if (patch.speechText !== undefined) Object.assign(patch, { manualSpeech: true })
    return c.json(await store.revise(owner(c), id, language, textId, version, patch, 'Edited text'))
  })
  app.get('/api/books/:book/history', async (c) =>
    c.json(
      await store.history(
        owner(c),
        c.req.param('book'),
        c.req.query('language') ?? '',
        c.req.query('id') ?? '',
      ),
    ),
  )
  app.post('/api/books/:book/restore', bodyLimit({ maxSize: 4096 }), async (c) => {
    const id = c.req.param('book')
    idle(id)
    const body = z
      .object({
        language: z.string(),
        id: z.string(),
        version: z.number().int(),
        restoreVersion: z.number().int(),
      })
      .parse(await c.req.json())
    const previous = (await store.history(owner(c), id, body.language, body.id)).find(
      (e) => e.version === body.restoreVersion,
    )
    if (!previous) throw new Error('Version not found.')
    return c.json(
      await store.revise(
        owner(c),
        id,
        body.language,
        body.id,
        body.version,
        previous,
        `Restored version ${previous.version}`,
      ),
    )
  })
  app.get('/api/books/:book/audio', async (c) => {
    const version = c.req.query('version')
    const file = await store.audioPath(
      owner(c),
      c.req.param('book'),
      c.req.query('language') ?? '',
      c.req.query('id') ?? '',
      VoiceSlot.parse(c.req.query('slot') ?? 'primary'),
      version === undefined ? undefined : z.coerce.number().int().min(0).parse(version),
    )
    return sendFile(
      file,
      c.req.query('download') ? `recording${path.extname(file)}` : undefined,
      c.req.header('Range'),
    )
  })
  app.post('/api/books/:book/audio', bodyLimit({ maxSize: 30 * 1024 ** 2 }), async (c) => {
    const id = c.req.param('book'),
      user = owner(c)
    idle(id)
    const form = await c.req.formData(),
      body = EditEntry.parse({
        id: form.get('id'),
        language: form.get('language'),
        version: Number(form.get('version')),
      }),
      slot = VoiceSlot.parse(form.get('slot') ?? 'primary'),
      audio = form.get('audio')
    if (!(audio instanceof File) || audio.size > 25 * 1024 ** 2)
      throw new Error('Choose an audio file smaller than 25 MB.')
    const bytes = Buffer.from(await audio.arrayBuffer())
    let ext: string
    if (bytes.toString('ascii', 0, 4) === 'RIFF') {
      validWav(bytes)
      ext = 'wav'
    } else if (
      bytes.toString('ascii', 0, 3) === 'ID3' ||
      (bytes[0] === 255 && (bytes[1] & 224) === 224)
    )
      ext = 'mp3'
    else if (bytes.toString('ascii', 0, 4) === 'OggS') ext = 'ogg'
    else if (bytes.toString('ascii', 0, 4) === 'fLaC') ext = 'flac'
    else throw new Error('Use a valid WAV, MP3, OGG or FLAC recording.')
    const state = await store.load(user, id),
      entry = state.entries.get(entryKey(body.language, body.id))
    if (!entry) throw new Error('Text entry not found.')
    const dir = store.dir(user, id),
      name = `${hash(bytes)}.${ext}`
    await store.exclusive('storage-admission', async () => {
      await store.capacity(user, bytes.length + 65536)
      await fs.mkdir(path.join(dir, 'blobs'), { recursive: true })
      await fs
        .writeFile(path.join(dir, 'blobs', name), bytes, { flag: 'wx', mode: 0o600 })
        .catch((e) => {
          if (e.code !== 'EEXIST') throw e
        })
    })
    const record = {
      file: `blobs/${name}`,
      exportName: `manual-${name}`,
      source: 'manual' as const,
      exists: true,
      textHash: hash(entry.speechText.trim()),
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    }
    return c.json(
      await store.revise(
        user,
        id,
        body.language,
        body.id,
        body.version,
        { audios: { ...entry.audios, [slot]: record } },
        'Uploaded manual recording',
      ),
    )
  })
  app.post('/api/books/:book/plan', bodyLimit({ maxSize: 2000000 }), async (c) => {
    const body = RunRequest.parse(await c.req.json()),
      state = await store.load(owner(c), c.req.param('book'))
    return c.json(jobs.plan([...state.entries.values()], body))
  })
  app.post('/api/books/:book/jobs', bodyLimit({ maxSize: 2000000 }), async (c) => {
    const body = RunRequest.parse(await c.req.json())
    return c.json(
      await jobs.start(owner(c), c.req.param('book'), body, credentials(c, body.credentialMode)),
      202,
    )
  })
  app.get('/api/books/:book/jobs', async (c) =>
    c.json(await store.jobs(owner(c), c.req.param('book'))),
  )
  app.post('/api/books/:book/jobs/:job/cancel', async (c) => {
    await jobs.cancel(owner(c), c.req.param('book'), c.req.param('job'))
    return c.json({ ok: true })
  })
  app.get('/api/books/:book/jobs/:job/logs', async (c) => {
    const id = c.req.param('book'),
      job = c.req.param('job')
    await store.load(owner(c), id)
    z.string().uuid().parse(job)
    const file = path.join(store.dir(owner(c), id), 'calls', `${job}.jsonl`)
    if (c.req.query('download') === '1') return sendFile(file, 'generation-log.jsonl')
    const data = await fs.readFile(file, 'utf8').catch(() => '')
    return c.json(
      data.trim()
        ? data
            .trim()
            .split('\n')
            .slice(-500)
            .map((line) => JSON.parse(line))
        : [],
    )
  })
  app.get('/api/books/:book/files', async (c) => {
    const state = await store.load(owner(c), c.req.param('book'))
    const root = path.join(store.dir(owner(c), state.book.id), 'original', state.book.root)
    return c.json(await filesUnder(root))
  })
  app.get('/api/books/:book/catalog', async (c) => {
    const state = await store.load(owner(c), c.req.param('book')),
      language = c.req.query('language'),
      kind = c.req.query('kind')
    if (!state.book.languages.includes(language ?? '')) throw new Error('Language not found.')
    if (!['texts', 'speech_texts', 'audios'].includes(kind ?? ''))
      throw new Error('Catalog not found.')
    const entries = [...state.entries.values()].filter((e) => e.language === language)
    const data = Object.fromEntries(
      entries
        .filter(
          (e) =>
            kind !== 'audios' || (e.audios.primary?.exists && !e.audios.primary.stale && !e.muted),
        )
        .map((e) => [
          e.id,
          kind === 'texts'
            ? e.text
            : kind === 'speech_texts'
              ? e.speechText
              : e.audios.primary!.exportName,
        ]),
    )
    c.header('Content-Disposition', `attachment; filename="${kind}.json"`)
    return c.json(data)
  })
  app.get('/api/books/:book/original', async (c) => {
    const id = c.req.param('book')
    await store.load(owner(c), id)
    return sendFile(path.join(store.dir(owner(c), id), 'original.zip'), 'original-adt.zip')
  })
  app.post('/api/books/:book/export', async (c) => {
    const id = c.req.param('book')
    idle(id)
    const state = await store.load(owner(c), id)
    return store.exclusive('storage-admission', async () => {
      const dir = store.dir(owner(c), id),
        entries = [...state.entries.values()],
        signature = hash(JSON.stringify(entries.map((e) => [e.language, e.id, e.version])))
      const receipt = path.join(dir, '.cache', 'export', `${signature}.json`)
      if (await exists(receipt)) {
        const cached = await jsonFile<{ id: string }>(receipt)
        if (await exists(path.join(dir, 'exports', `${cached.id}.zip`))) return c.json(cached)
      }
      // ZIP output cannot exceed the uncompressed inputs plus modest archive overhead.
      const required =
        (await directoryBytes(path.join(dir, 'original'))) +
        (await directoryBytes(path.join(dir, 'blobs'))) +
        16 * 1024 ** 2
      await store.capacity(owner(c), required)
      const output = await exportBook(dir, state.book, entries),
        result = { id: path.basename(output, '.zip') }
      await atomicJson(receipt, result)
      return c.json(result)
    })
  })
  app.get('/api/books/:book/exports/:export', async (c) => {
    const id = c.req.param('book')
    await store.load(owner(c), id)
    const exportId = z.string().uuid().parse(c.req.param('export'))
    return sendFile(
      path.join(store.dir(owner(c), id), 'exports', `${exportId}.zip`),
      'updated-adt.zip',
    )
  })
  return { app, store, jobs, auth }
}
