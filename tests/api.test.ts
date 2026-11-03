import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  RunRequest,
  RunPlan,
  type Job,
  type Entry,
  type BookDetail,
} from '@speech/types'
import { createApp } from '../apps/api/src/app.js'
import { makeFixture, tone, normalizationPayload } from './fixture.js'
import { filesUnder, jsonFile, hash } from '../packages/bundle/src/files.js'
import { extractArchive } from '../packages/bundle/src/archive.js'

let root: string, system: Awaited<ReturnType<typeof createApp>>, cookie: string, bookId: string
let transport: ReturnType<typeof vi.fn<typeof fetch>>
const key = 'test-personal-secret'
const payload = () =>
  Response.json({
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'audio', mime_type: 'audio/wav', data: tone.toString('base64') }],
      },
    ],
  })
async function call(
  url: string,
  method = 'GET',
  body?: unknown,
  session = cookie,
  extra: Record<string, string> = {},
) {
  return system.app.request(`http://localhost/api${url}`, {
    method,
    headers: {
      Cookie: session,
      'X-Requested-With': 'ADTSpeech',
      ...(body instanceof Uint8Array || body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...extra,
    },
    ...(body === undefined
      ? {}
      : {
          body:
            body instanceof Uint8Array || body instanceof FormData
              ? (body as BodyInit)
              : JSON.stringify(body),
        }),
  })
}
async function register(username = 'tester') {
  const response = await call(
    '/auth/register',
    'POST',
    { username, password: 'test-password-long-enough' },
    '',
  )
  expect(response.status).toBe(200)
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    data: (await response.json()) as { user: { id: string }; recoveryCode: string },
  }
}
const request = (patch: Partial<RunRequest> = {}) =>
  RunRequest.parse({ language: 'en', scope: 'missing', settings: DEFAULT_SETTINGS, ...patch })
async function start(patch: Partial<RunRequest> = {}) {
  const res = await call(`/books/${bookId}/jobs`, 'POST', request(patch), cookie, {
    'X-Gemini-API-Key': key,
    'X-OpenAI-Key': 'test-openai-secret',
  })
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(202)
  return (await res.json()) as Job
}
async function finish(id: string) {
  for (let i = 0; i < 500; i++) {
    const jobs = (await (await call(`/books/${bookId}/jobs`)).json()) as Job[]
    const job = jobs.find((j) => j.id === id)!
    if (job.status !== 'running') return job
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('Job did not finish')
}
async function entries() {
  return ((await (await call(`/books/${bookId}`)).json()) as BookDetail).entries
}
beforeEach(async () => {
  process.env.PUBLIC_WEB_URL = 'https://pages.example/adt-speech-studio/'
  process.env.PROVIDER_INTERVAL_MS = '0'
  process.env.SERVICE_DAILY_CHARACTERS = '0'
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-api-'))
  transport = vi.fn<typeof fetch>(async () => payload())
  system = await createApp({ root, transport })
  cookie = (await register()).cookie
  const fixture = await makeFixture(path.join(root, 'fixture.zip'))
  const response = await call('/books', 'POST', await fs.readFile(fixture), cookie, {
    'X-File-Name': 'plants.zip',
  })
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(201)
  bookId = ((await response.json()) as { id: string }).id
})
afterEach(async () => {
  await system.jobs.stop()
  await fs.rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  delete process.env.PUBLIC_WEB_URL
  delete process.env.SERVICE_DAILY_CHARACTERS
  delete process.env.MAX_OWNER_BYTES
  delete process.env.MAX_STORAGE_BYTES
  delete process.env.SERVICE_GLOBAL_DAILY_CHARACTERS
})

it('lets a new account sign up, import a reader and recover without an invitation', async () => {
  expect((await (await call('/books')).json()) as unknown[]).toHaveLength(1)
  const other = await register('another')
  const recovery = await call(
    '/auth/recover',
    'POST',
    {
      username: 'another',
      password: 'a-new-password-long-enough',
      recoveryCode: other.data.recoveryCode,
    },
    '',
  )
  expect(recovery.status).toBe(200)
  expect(
    ((await (await call('/auth/me', 'GET', undefined, other.cookie)).json()) as { user: null })
      .user,
  ).toBeNull()
})
it('rejects anonymous and cross-account access across workspace routes', async () => {
  const other = (await register('other')).cookie
  const routes = [
    `/books/${bookId}`,
    `/books/${bookId}/jobs`,
    `/books/${bookId}/files`,
    `/books/${bookId}/history?language=en&id=pg001_h`,
    `/books/${bookId}/audio?language=en&id=pg001_h`,
    `/books/${bookId}/original`,
    `/books/${bookId}/catalog?language=en&kind=texts`,
  ]
  for (const route of routes) {
    expect((await call(route, 'GET', undefined, '')).status).toBe(401)
    expect((await call(route, 'GET', undefined, other)).status).toBeGreaterThanOrEqual(400)
  }
  expect((await call(`/books/${bookId}`, 'DELETE', undefined, other)).status).toBe(404)
})
it('rejects cross-origin mutations and missing validation headers', async () => {
  expect(
    (
      await call(`/books/${bookId}/export`, 'POST', {}, cookie, {
        Origin: 'https://attacker.invalid',
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await system.app.request(`http://localhost/api/books/${bookId}/export`, {
        method: 'POST',
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(403)
})
it('generates only missing audio, keeps the original and reuses complete cache inputs', async () => {
  const job = await finish((await start()).id)
  expect(job.completed).toBe(5)
  expect(job.failed).toBe(0)
  expect(transport).toHaveBeenCalledTimes(5)
  const first = (await entries()).find((e) => e.id === 'pg001_h' && e.language === 'en')!
  expect(first.version).toBe(0)
  expect(first.audios.primary?.source).toBe('imported')
  const again = await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  expect(again.cached).toBe(1)
  expect(transport).toHaveBeenCalledTimes(5)
  const changed = await finish(
    (
      await start({
        scope: 'selected',
        ids: ['pg001_p'],
        settings: { ...DEFAULT_SETTINGS, voice: 'Puck' },
      })
    ).id,
  )
  expect(changed.completed).toBe(1)
  expect(changed.cached).toBe(0)
  expect(transport).toHaveBeenCalledTimes(6)
})
it('regenerates all languages without confusing identical IDs in different locales', async () => {
  const job = await finish((await start({ scope: 'all', language: '*' })).id)
  expect(job.completed).toBe(12)
  expect(job.failed).toBe(0)
  const versions = (await entries()).filter((e) => e.id === 'pg001_h')
  expect(versions.every((e) => e.version === 1 && e.audios.primary?.source === 'generated')).toBe(
    true,
  )
})
it('retains the prior recording and useful failure information when Gemini returns no audio', async () => {
  transport.mockImplementation(async () =>
    Response.json({ candidates: [{ finishReason: 'OTHER' }] }),
  )
  const job = await finish((await start({ scope: 'selected', ids: ['pg001_h'] })).id)
  expect(job.failed).toBe(1)
  expect(job.results[0].error).toContain('no audio')
  const entry = (await entries()).find((e) => e.id === 'pg001_h' && e.language === 'en')!
  expect(entry.version).toBe(0)
  expect(entry.audios.primary?.source).toBe('imported')
})
it('guards stale edits and appends restorations to history', async () => {
  const change = { language: 'en', id: 'pg001_h', version: 0, speechText: 'A new spoken sentence' }
  expect((await call(`/books/${bookId}/entry`, 'PUT', change)).status).toBe(200)
  const stale = await call(`/books/${bookId}/entry`, 'PUT', change)
  expect(stale.status).toBe(400)
  expect(((await stale.json()) as { error: string }).error).toContain('changed')
  const restored = await call(`/books/${bookId}/restore`, 'POST', {
    language: 'en',
    id: 'pg001_h',
    version: 1,
    restoreVersion: 0,
  })
  expect(((await restored.json()) as Entry).version).toBe(2)
  const history = (await (
    await call(`/books/${bookId}/history?language=en&id=pg001_h`)
  ).json()) as Entry[]
  expect(history.map((e) => e.version)).toEqual([2, 1, 0])
})
it('protects manual recordings unless replacement is explicitly selected', async () => {
  const form = new FormData()
  form.set('language', 'en')
  form.set('id', 'pg001_p')
  form.set('version', '0')
  form.set('audio', new File([new Uint8Array(tone)], 'voice.wav', { type: 'audio/wav' }))
  expect((await call(`/books/${bookId}/audio`, 'POST', form)).status).toBe(200)
  const plan = (await (
    await call(`/books/${bookId}/plan`, 'POST', request({ scope: 'all' }))
  ).json()) as { protected: number; count: number }
  expect(plan.protected).toBe(1)
  expect(plan.count).toBe(5)
  const run = await finish(
    (await start({ scope: 'selected', ids: ['pg001_p'], replaceManual: true })).id,
  )
  expect(run.completed).toBe(1)
})
it('does not persist personal credentials in job receipts, logs, history or exports', async () => {
  await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  for (const file of await filesUnder(path.join(root, 'books'))) {
    if (file.endsWith('.json') || file.endsWith('.jsonl'))
      expect(await fs.readFile(path.join(root, 'books', file), 'utf8')).not.toContain(key)
  }
  const callHeaders = transport.mock.calls[0][1]!.headers as Record<string, string>
  expect(callHeaders['x-goog-api-key']).toBe(key)
})
it('does not silently use service credentials when personal credentials are missing', async () => {
  const response = await call(`/books/${bookId}/jobs`, 'POST', request())
  expect(response.status).toBe(400)
  expect(transport).not.toHaveBeenCalled()
})
it('cancels in-flight work without late publication and blocks concurrent edits', async () => {
  transport.mockImplementation(
    async (_url, init) =>
      new Promise((resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        setTimeout(() => resolve(payload()), 500)
      }),
  )
  const job = await start({ scope: 'selected', ids: ['pg001_p'] })
  expect(
    (
      await call(`/books/${bookId}/entry`, 'PUT', {
        language: 'en',
        id: 'pg001_p',
        version: 0,
        speechText: 'Changed',
      })
    ).status,
  ).toBe(409)
  expect((await call(`/books/${bookId}/jobs/${job.id}/cancel`, 'POST', {})).status).toBe(200)
  expect((await finish(job.id)).status).toBe('cancelled')
  expect((await entries()).find((e) => e.id === 'pg001_p' && e.language === 'en')!.version).toBe(0)
})
it('exports generated mappings and serves downloadable audio including byte ranges', async () => {
  // A completed durable receipt must already release the editing/export guard.
  const save = system.store.saveJob.bind(system.store)
  vi.spyOn(system.store, 'saveJob').mockImplementation(async (job) => {
    await save(job)
    if (job.status === 'completed') await new Promise((r) => setTimeout(r, 40))
  })
  await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  const response = await call(
    `/books/${bookId}/audio?language=en&id=pg001_p`,
    'GET',
    undefined,
    cookie,
    { Range: 'bytes=0-43' },
  )
  expect(response.status).toBe(206)
  expect((await response.arrayBuffer()).byteLength).toBe(44)
  const exportedResponse = await call(`/books/${bookId}/export`, 'POST', {})
  expect(exportedResponse.status, await exportedResponse.clone().text()).toBe(200)
  const exported = (await exportedResponse.json()) as { id: string }
  const file = await call(`/books/${bookId}/exports/${exported.id}`)
  expect(file.status).toBe(200)
  const target = path.join(root, 'output.zip')
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()))
  const out = path.join(root, 'output')
  await extractArchive(target, out)
  const map = await jsonFile<Record<string, string>>(path.join(out, 'content/i18n/en/audios.json'))
  expect(map.pg001_p).toMatch(/^tts-/)
  expect(await fs.readFile(path.join(out, 'content/i18n/en/audio', map.pg001_p))).toEqual(tone)
})
it('removes the whole private workspace on explicit deletion', async () => {
  await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  const owner = ((await (await call('/auth/me')).json()) as { user: { id: string } }).user.id
  expect((await call(`/books/${bookId}`, 'DELETE')).status).toBe(200)
  await expect(fs.stat(system.store.dir(owner, bookId))).rejects.toThrow()
  expect(await (await call('/books')).json()).toEqual([])
})

it('reuses an unchanged export and charges storage before creating another', async () => {
  const one = (await (await call(`/books/${bookId}/export`, 'POST', {})).json()) as { id: string }
  const two = (await (await call(`/books/${bookId}/export`, 'POST', {})).json()) as { id: string }
  expect(two.id).toBe(one.id)
  await call(`/books/${bookId}/entry`, 'PUT', {
    language: 'en',
    id: 'pg001_p',
    version: 0,
    speechText: 'An updated line',
  })
  process.env.MAX_OWNER_BYTES = '1'
  const response = await call(`/books/${bookId}/export`, 'POST', {})
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('Storage quota')
})
it('enforces shared storage limits on manual uploads, edits and generation', async () => {
  process.env.MAX_STORAGE_BYTES = '1'
  const form = new FormData()
  form.set('language', 'en')
  form.set('id', 'pg001_p')
  form.set('version', '0')
  form.set('audio', new File([new Uint8Array(tone)], 'voice.wav'))
  expect((await call(`/books/${bookId}/audio`, 'POST', form)).status).toBe(400)
  expect(
    (
      await call(`/books/${bookId}/entry`, 'PUT', {
        language: 'en',
        id: 'pg001_p',
        version: 0,
        speechText: 'Updated',
      })
    ).status,
  ).toBe(400)
  const job = await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  expect(job.failed).toBe(1)
  expect(transport).not.toHaveBeenCalled()
})
it('normalizes independently, protects manual speech, and honors explicit replacement', async () => {
  transport.mockImplementation(async () => Response.json(normalizationPayload()))
  await call(`/books/${bookId}/entry`, 'PUT', {
    language: 'en',
    id: 'pg002_n',
    version: 0,
    speechText: 'My own reading',
  })
  const plan = (await (
    await call(
      `/books/${bookId}/plan`,
      'POST',
      request({ scope: 'selected', ids: ['pg002_n'], operation: 'normalize' }),
    )
  ).json()) as { protected: number }
  expect(plan.protected).toBe(1)
  const done = await finish(
    (
      await start({
        scope: 'selected',
        ids: ['pg002_n'],
        operation: 'normalize',
        replaceManual: true,
      })
    ).id,
  )
  expect(done.completed).toBe(1)
  const entry = (await entries()).find((e) => e.language === 'en' && e.id === 'pg002_n')!
  expect(entry.text).toBe('A garden has 12 flowers.')
  expect(entry.speechText).toBe('Twelve flowers')
  expect(entry.manualSpeech).toBe(false)
})
it('persists books and marks abandoned running jobs interrupted on restart', async () => {
  const job = await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
  job.status = 'running'
  await system.store.saveJob(job)
  system = await createApp({ root, transport })
  const recovered = await finish(job.id)
  expect(recovered.status).toBe('interrupted')
  expect(
    (await entries()).find((e) => e.language === 'en' && e.id === 'pg001_p')!.audios.primary
      ?.exists,
  ).toBe(true)
})
it('generates the secondary narrator without replacing the primary recording', async () => {
  const done = await finish(
    (await start({ scope: 'selected', ids: ['pg001_h'], slot: 'secondary' })).id,
  )
  expect(done.completed).toBe(1)
  const entry = (await entries()).find((e) => e.language === 'en' && e.id === 'pg001_h')!
  expect(entry.audios.primary?.source).toBe('imported')
  expect(entry.audios.secondary?.source).toBe('generated')
})

it('counts only application-owned storage on a mounted data volume', async () => {
  const before = await system.store.totalBytes()
  await fs.mkdir(path.join(root, 'lost+found'))
  await fs.writeFile(path.join(root, 'lost+found', 'filesystem-metadata'), Buffer.alloc(4096))
  expect(await system.store.totalBytes()).toBe(before)
})

it('bounds total in-flight entries even when a job requests three workers', async () => {
  let active = 0,
    maximum = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  transport.mockImplementation(async () => {
    active++
    maximum = Math.max(active, maximum)
    await gate
    active--
    return payload()
  })
  const job = await start({ scope: 'all', concurrency: 3 })
  try {
    await vi.waitFor(() => expect(active).toBe(2))
  } finally {
    release()
  }
  const done = await finish(job.id)
  expect(done.completed).toBe(6)
  expect(maximum).toBe(2)
})

it('connects a static frontend using a separate bearer session and exact CORS origin', async () => {
  expect((await system.app.request('/?connect=1')).headers.get('Cross-Origin-Opener-Policy')).toBe(
    'unsafe-none',
  )
  expect((await system.app.request('/')).headers.get('Cross-Origin-Opener-Policy')).toBe(
    'same-origin',
  )
  const response = await call(
    '/auth/connect',
    'POST',
    { state: '7e92d38c-9425-4f1e-a098-e90127fd93a3' },
    cookie,
    { Origin: 'http://localhost' },
  )
  expect(response.status).toBe(200)
  const { token, origin } = (await response.json()) as { token: string; origin: string }
  expect(origin).toBe('https://pages.example')
  const headers = { Origin: origin, Authorization: `Bearer ${token}` }
  const books = await call('/books', 'GET', undefined, '', headers)
  expect(books.status).toBe(200)
  expect(books.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  expect(await books.json()).toHaveLength(1)
  // Frontend requests must not fall back to first-party cookies or invalid bearer tokens.
  expect((await call('/books', 'GET', undefined, cookie, { Origin: origin })).status).toBe(401)
  expect(
    (
      await call('/books', 'GET', undefined, cookie, {
        Origin: origin,
        Authorization: 'Bearer invalid',
      })
    ).status,
  ).toBe(401)
  await call('/auth/logout', 'POST', {}, '', headers)
  expect((await call('/books', 'GET', undefined, '', headers)).status).toBe(401)
  expect((await call('/books')).status).toBe(200)
})
it('rejects foreign-origin grants/password forms and exposes CORS only to the configured frontend', async () => {
  const response = await call(
    '/auth/connect',
    'POST',
    { state: '7e92d38c-9425-4f1e-a098-e90127fd93a3' },
    cookie,
    { Origin: 'https://pages.example' },
  )
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(
    (
      await call(
        '/auth/login',
        'POST',
        { username: 'tester', password: 'test-password-long-enough' },
        '',
        { Origin: 'https://pages.example' },
      )
    ).status,
  ).toBe(403)
  const preflight = await call('/books', 'OPTIONS', undefined, '', {
    Origin: 'https://pages.example',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,x-requested-with',
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
    'authorization',
  )
  const foreign = await call('/books', 'OPTIONS', undefined, '', {
    Origin: 'https://attacker.invalid',
    'Access-Control-Request-Method': 'POST',
  })
  expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull()
})

it('normalizes with only a personal OpenAI key and never sends it to Gemini', async () => {
  transport.mockImplementation(async () => Response.json(normalizationPayload()))
  const response = await call(
    `/books/${bookId}/jobs`,
    'POST',
    request({ operation: 'normalize', scope: 'selected', ids: ['pg002_n'] }),
    cookie,
    { 'X-OpenAI-Key': 'personal-openai-only' },
  )
  expect(response.status).toBe(202)
  expect((await finish(((await response.json()) as Job).id)).completed).toBe(1)
  expect(transport).toHaveBeenCalledTimes(1)
  expect(transport.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
  expect(transport.mock.calls[0][1]!.headers).toMatchObject({
    Authorization: 'Bearer personal-openai-only',
  })
  for (const file of await filesUnder(path.join(root, 'books'))) {
    if (file.endsWith('.json') || file.endsWith('.jsonl'))
      expect(await fs.readFile(path.join(root, 'books', file), 'utf8')).not.toContain(
        'personal-openai-only',
      )
  }
})
it('uses separate service secrets for OpenAI normalization and Gemini speech and accounts for both', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'service-openai')
  vi.stubEnv('GEMINI_API_KEY', 'service-gemini')
  vi.stubEnv('SERVICE_DAILY_CHARACTERS', '1000')
  vi.stubEnv('SERVICE_GLOBAL_DAILY_CHARACTERS', '1000')
  transport.mockImplementation(async (url, init) => {
    const headers = init!.headers as Record<string, string>
    if (url === 'https://api.openai.com/v1/responses') {
      expect(headers.Authorization).toBe('Bearer service-openai')
      expect(headers).not.toHaveProperty('x-goog-api-key')
      return Response.json(normalizationPayload())
    }
    expect(String(url)).toMatch(
      /^https:\/\/generativelanguage.googleapis.com\/v1beta\/interactions$/,
    )
    expect(headers['x-goog-api-key']).toBe('service-gemini')
    expect(headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(init!.body as string).input[0].content[0].text).toBe('Twelve flowers')
    return payload()
  })
  const done = await finish(
    (
      await start({
        scope: 'selected',
        ids: ['pg002_n'],
        credentialMode: 'service',
        settings: { ...DEFAULT_SETTINGS, normalize: true },
      })
    ).id,
  )
  expect(done.completed).toBe(1)
  expect(transport).toHaveBeenCalledTimes(2)
  expect(await system.jobs.used(done.ownerId)).toBe(
    'A garden has 12 flowers.'.length + 'Twelve flowers'.length,
  )
  const entry = (await entries()).find((e) => e.language === 'en' && e.id === 'pg002_n')!
  expect(entry.text).toBe('A garden has 12 flowers.')
  expect(entry.speechText).toBe('Twelve flowers')
  expect(entry.audios.primary?.provider).toBe('gemini')
})
it('requires an OpenAI key for normalization without falling back between credential modes', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'service-openai')
  vi.stubEnv('GEMINI_API_KEY', 'service-gemini')
  vi.stubEnv('SERVICE_DAILY_CHARACTERS', '1000')
  const response = await call(
    `/books/${bookId}/jobs`,
    'POST',
    request({ operation: 'normalize' }),
    cookie,
    { 'X-Gemini-API-Key': 'personal-gemini' },
  )
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('OpenAI API key')
  vi.stubEnv('OPENAI_API_KEY', '')
  const service = await call(
    `/books/${bookId}/jobs`,
    'POST',
    request({ operation: 'normalize', credentialMode: 'service' }),
    cookie,
    { 'X-OpenAI-Key': 'personal-openai' },
  )
  expect(service.status).toBe(400)
  expect(await service.text()).toContain('OpenAI API key')
  expect(transport).not.toHaveBeenCalled()
})
it.each(['gemini-2.5-flash', 'gpt-4.1-mini'])(
  'resolves legacy normalization setting %s, preserves historical jobs and skips the old cache',
  async (legacyModel) => {
    const old = await finish((await start({ scope: 'selected', ids: ['pg001_p'] })).id)
    const legacy = { ...DEFAULT_SETTINGS, normalizationModel: legacyModel }
    old.request.settings = legacy
    await system.store.saveJob(old)
    await system.store.saveSettings(old.ownerId, bookId, 'en', legacy)
    const dir = system.store.dir(old.ownerId, bookId)
    const oldSettings = await fs.readFile(path.join(dir, 'settings.json'), 'utf8')
    const detail = (await (await call(`/books/${bookId}`)).json()) as BookDetail
    expect(detail.settings.en.normalizationModel).toBe('gpt-6-luna')
    expect(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).toBe(oldSettings)
    const originalText = 'A garden has 12 flowers.'
    const legacyCache = hash(
      JSON.stringify([
        legacyModel.startsWith('gemini-') ? 'core-tts-1' : 'core-tts-openai-1',
        'en',
        originalText,
        legacy.normalizationModel,
        legacy.profile,
        legacy.math,
      ]),
    )
    await fs.mkdir(path.join(dir, '.cache/text'), { recursive: true })
    await fs.writeFile(
      path.join(dir, '.cache/text', `${legacyCache}.json`),
      JSON.stringify({ text: 'Legacy cached reading' }),
    )
    transport.mockClear()
    transport.mockImplementation(async () => Response.json(normalizationPayload()))
    const patch = {
      operation: 'normalize' as const,
      scope: 'selected' as const,
      ids: ['pg002_n'],
      settings: legacy,
    }
    const done = await finish((await start(patch)).id)
    expect(done.request.settings.normalizationModel).toBe('gpt-6-luna')
    expect(done.completed).toBe(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string).model).toBe('gpt-6-luna')
    expect((await finish((await start(patch)).id)).completed).toBe(1)
    expect(transport).toHaveBeenCalledTimes(1)
    expect(
      (await system.store.jobs(old.ownerId, bookId)).find((j) => j.id === old.id)!.request.settings
        .normalizationModel,
    ).toBe(legacyModel)
    expect(
      (await entries()).find((e) => e.language === 'en' && e.id === 'pg002_n')!.speechText,
    ).toBe('Twelve flowers')
  },
)
it('does not publish partial normalization or call speech after incomplete OpenAI output', async () => {
  transport.mockImplementation(async () =>
    Response.json({ ...normalizationPayload(), status: 'incomplete' }),
  )
  const before = (await entries()).find((e) => e.language === 'en' && e.id === 'pg002_n')!
  const done = await finish(
    (
      await start({
        scope: 'selected',
        ids: ['pg002_n'],
        settings: { ...DEFAULT_SETTINGS, normalize: true },
      })
    ).id,
  )
  expect(done.failed).toBe(1)
  expect(transport).toHaveBeenCalledTimes(1)
  expect((await entries()).find((e) => e.language === 'en' && e.id === 'pg002_n')).toEqual(before)
})

it('accepts a one-time recovery code only once when requests overlap', async () => {
  const account = await register('recovery_race')
  // A concurrent session writer may leave an incomplete atomic-write temp file.
  await fs.writeFile(path.join(root, 'sessions', 'unrelated.json.pending.tmp'), '{')
  const passwords = ['first-password-long-enough', 'second-password-long-enough']
  const attempts = await Promise.all(
    passwords.map((password) =>
      call(
        '/auth/recover',
        'POST',
        {
          username: 'recovery_race',
          password,
          recoveryCode: account.data.recoveryCode,
        },
        '',
      ),
    ),
  )
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 400])
  const winner = attempts.findIndex((r) => r.status === 200)
  expect(
    (
      await call(
        '/auth/login',
        'POST',
        { username: 'recovery_race', password: passwords[winner] },
        '',
      )
    ).status,
  ).toBe(200)
  expect(
    (
      await call(
        '/auth/login',
        'POST',
        { username: 'recovery_race', password: passwords[1 - winner] },
        '',
      )
    ).status,
  ).toBe(400)
})

it('serves suffix and oversized audio ranges and describes unsatisfiable ranges', async () => {
  const url = `/books/${bookId}/audio?language=en&id=pg001_h`
  const suffix = await call(url, 'GET', undefined, cookie, { Range: 'bytes=-10' })
  expect(suffix.status).toBe(206)
  expect(Buffer.from(await suffix.arrayBuffer())).toEqual(tone.subarray(-10))
  const oversized = await call(url, 'GET', undefined, cookie, { Range: 'bytes=0-999999' })
  expect(oversized.status).toBe(206)
  expect(Buffer.from(await oversized.arrayBuffer())).toEqual(tone)
  const invalid = await call(url, 'GET', undefined, cookie, { Range: `bytes=${tone.length}-` })
  expect(invalid.status).toBe(416)
  expect(invalid.headers.get('Content-Range')).toBe(`bytes */${tone.length}`)
  for (const range of ['bytes=-0', 'bytes=-', 'bytes=20-10', 'bytes=99999999999999999999-'])
    expect((await call(url, 'GET', undefined, cookie, { Range: range })).status).toBe(416)
  const user = await system.auth.user(cookie.split('=')[1])
  const audio = await system.store.audioPath(user!.id, bookId, 'en', 'pg001_h', 'primary')
  await fs.writeFile(audio, '')
  const empty = await call(url)
  expect(empty.status).toBe(200)
  expect((await empty.arrayBuffer()).byteLength).toBe(0)
})

it('reports cached normalization and labels normalization failures accurately', async () => {
  transport.mockImplementation(async () => Response.json(normalizationPayload()))
  const options = { scope: 'selected' as const, ids: ['pg002_n'], operation: 'normalize' as const }
  expect((await finish((await start(options)).id)).completed).toBe(1)
  const cached = await finish((await start(options)).id)
  expect(cached.cached).toBe(1)
  expect(cached.results[0].status).toBe('cached')
  expect(transport).toHaveBeenCalledTimes(1)
  transport.mockImplementation(async () => Response.json({ status: 'incomplete' }))
  const failed = await finish((await start({ ...options, force: true })).id)
  const logs = await (await call(`/books/${bookId}/jobs/${failed.id}/logs`)).json()
  expect(logs).toEqual([
    expect.objectContaining({ operation: 'normalization', status: 'failed', model: 'gpt-6-luna' }),
  ])
})

it('estimates only eligible speech entries without starting jobs or calling a provider', async () => {
  const plan = async (patch: Partial<RunRequest> = {}) =>
    RunPlan.parse(await (await call(`/books/${bookId}/plan`, 'POST', request(patch))).json())
  const missing = await plan()
  expect(missing.count).toBe(5)
  expect(missing.speechCost?.lowUsd).toBeGreaterThan(0)
  const all = await plan({ language: '*', scope: 'all' })
  expect(all.count).toBe(12)
  expect(all.speechCost!.lowUsd).toBeGreaterThan(missing.speechCost!.lowUsd!)
  const single = await plan({ scope: 'selected', ids: ['pg001_h'] })
  expect(single.characters).toBe('A seed becomes a story'.length)
  expect(single.speechCost!.highUsd).toBeLessThan(missing.speechCost!.highUsd!)
  expect((await plan({ operation: 'normalize' })).speechCost).toBeUndefined()
  await call(`/books/${bookId}/entry`, 'PUT', {
    language: 'en',
    id: 'pg001_h',
    version: 0,
    muted: true,
  })
  const muted = await plan({ scope: 'selected', ids: ['pg001_h'] })
  expect(muted).toMatchObject({
    count: 0,
    characters: 0,
    muted: 1,
    speechCost: { lowUsd: 0, highUsd: 0 },
  })
  const form = new FormData()
  form.set('language', 'en')
  form.set('id', 'pg001_p')
  form.set('version', '0')
  form.set('audio', new File([new Uint8Array(tone)], 'voice.wav', { type: 'audio/wav' }))
  expect((await call(`/books/${bookId}/audio`, 'POST', form)).status).toBe(200)
  const protectedPlan = await plan({ scope: 'selected', ids: ['pg001_p'] })
  expect(protectedPlan).toMatchObject({ count: 0, protected: 1, speechCost: { highUsd: 0 } })
  const replacing = await plan({ scope: 'selected', ids: ['pg001_p'], replaceManual: true })
  expect(replacing.speechCost!.highUsd).toBeGreaterThan(0)
  expect(await (await call(`/books/${bookId}/jobs`)).json()).toEqual([])
  expect(transport).not.toHaveBeenCalled()
})
