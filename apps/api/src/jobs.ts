import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  Job,
  type Entry,
  type RunRequest,
  type RunPlan,
  type Credentials,
  type CallLog,
} from '@speech/types'
import { Store } from './store.js'
import {
  atomicJson,
  directoryBytes,
  exists,
  hash,
  jsonFile,
} from '../../../packages/bundle/src/files.js'
import { entryKey } from '../../../packages/bundle/src/catalog.js'
import {
  normalizeText,
  normalizationPrompt,
  NORMALIZATION_VERSION,
  redact,
  speechSignature,
  synthesize,
  validWav,
  validateSettings,
} from '../../../packages/tts/src/provider.js'

export class Jobs {
  private active = new Map<
    string,
    { job: Job; controller: AbortController; promise: Promise<void> }
  >()
  private entryCount = 0
  private entryQueue: Array<() => void> = []
  private async acquireEntry(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.entryQueue = this.entryQueue.filter((fn) => fn !== grant)
        reject(signal.reason)
      }
      const grant = () => {
        signal.removeEventListener('abort', abort)
        this.entryCount++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.entryCount--
          this.entryQueue.shift()?.()
        })
      }
      if (this.entryCount < 2) grant()
      else {
        this.entryQueue.push(grant)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }
  constructor(
    readonly store: Store,
    readonly transport: typeof fetch = fetch,
  ) {}
  busy(bookId: string) {
    return [...this.active.values()].some((v) => v.job.bookId === bookId)
  }
  async recover() {
    const booksRoot = path.join(this.store.root, 'books')
    for (const owner of await fs.readdir(booksRoot).catch(() => []))
      for (const book of await this.store.list(owner))
        for (const job of await this.store.jobs(owner, book.id))
          if (job.status === 'running') {
            job.status = 'interrupted'
            job.activeIds = []
            job.updatedAt = new Date().toISOString()
            await this.store.saveJob(job)
          }
  }
  plan(entries: Entry[], request: RunRequest): RunPlan {
    const ids: string[] = []
    let protectedCount = 0,
      muted = 0,
      characters = 0
    for (const e of entries) {
      if (request.language !== '*' && e.language !== request.language) continue
      const target = request.language === '*' ? JSON.stringify([e.language, e.id]) : e.id
      if (request.scope === 'selected' && !request.ids.includes(target)) continue
      const audio = e.audios[request.slot]
      if (e.muted) {
        muted++
        continue
      }
      if (request.operation === 'normalize') {
        if (e.manualSpeech && !request.replaceManual) {
          protectedCount++
          continue
        }
      } else {
        if (request.scope === 'missing' && audio?.exists) continue
        if (
          request.scope === 'outdated' &&
          audio?.exists &&
          audio.signature === speechSignature(e.speechText, request.settings, e.language)
        )
          continue
        if (audio?.source === 'manual' && !request.replaceManual) {
          protectedCount++
          continue
        }
      }
      ids.push(target)
      characters += (request.operation === 'normalize' ? e.text : e.speechText).length
    }
    return { count: ids.length, characters, protected: protectedCount, muted, ids }
  }
  async used(owner: string) {
    const file = path.join(
      this.store.root,
      'usage',
      `${new Date().toISOString().slice(0, 10)}.json`,
    )
    const usage = (await exists(file)) ? await jsonFile<Record<string, number>>(file) : {}
    return usage[owner] ?? 0
  }
  private async reserve(owner: string, characters: number) {
    await this.store.exclusive('usage', async () => {
      const limit = Number(process.env.SERVICE_DAILY_CHARACTERS ?? 0),
        global = Number(process.env.SERVICE_GLOBAL_DAILY_CHARACTERS ?? limit * 10)
      const file = path.join(
          this.store.root,
          'usage',
          `${new Date().toISOString().slice(0, 10)}.json`,
        ),
        usage = (await exists(file)) ? await jsonFile<Record<string, number>>(file) : {}
      if (
        !limit ||
        (usage[owner] ?? 0) + characters > limit ||
        Object.values(usage).reduce((a, b) => a + b, 0) + characters > global
      )
        throw new Error('Service allowance exhausted. Use your own API key or return tomorrow.')
      usage[owner] = (usage[owner] ?? 0) + characters
      await atomicJson(file, usage)
    })
  }
  async start(owner: string, bookId: string, request: RunRequest, credentials: Credentials) {
    return this.store.exclusive('job-admission', async () => {
      if ([...this.active.values()].some((v) => v.job.ownerId === owner))
        throw new Error('You already have a generation job running. Finish or cancel it first.')
      if (this.active.size >= Number(process.env.MAX_CONCURRENT_JOBS ?? 3))
        throw new Error('The server is busy. Please try again shortly.')
      const state = await this.store.load(owner, bookId)
      if (request.language !== '*' && !state.book.languages.includes(request.language))
        throw new Error('Language not found.')
      validateSettings(request.settings)
      if (request.operation === 'speech' && !credentials[request.settings.provider])
        throw new Error('Enter an API key for the selected speech provider.')
      if ((request.operation === 'normalize' || request.settings.normalize) && !credentials.gemini)
        throw new Error('Text normalization needs a Google/Gemini API key.')
      const plan = this.plan([...state.entries.values()], request)
      if (!plan.count)
        throw new Error('No entries match this scope. Check your filters and protected recordings.')
      const now = new Date().toISOString()
      const job: Job = {
        id: randomUUID(),
        bookId,
        ownerId: owner,
        language: request.language,
        request: { ...request, ids: plan.ids },
        status: 'running',
        total: plan.count,
        completed: 0,
        cached: 0,
        failed: 0,
        createdAt: now,
        updatedAt: now,
        activeIds: [],
        results: [],
      }
      for (const language of request.language === '*' ? state.book.languages : [request.language])
        await this.store.saveSettings(owner, bookId, language, request.settings)
      await this.store.saveJob(job)
      const controller = new AbortController()
      const record = { job, controller, promise: Promise.resolve() }
      this.active.set(job.id, record)
      record.promise = this.run(job, plan.ids, credentials, controller.signal).finally(() =>
        this.active.delete(job.id),
      )
      return job
    })
  }
  private async run(job: Job, ids: string[], credentials: Credentials, signal: AbortSignal) {
    const { ownerId: owner, bookId, request } = job,
      dir = this.store.dir(owner, bookId)
    const save = async () => {
      job.updatedAt = new Date().toISOString()
      await this.store.saveJob(job)
    }
    let cursor = 0
    const worker = async () => {
      while (cursor < ids.length && !signal.aborted && job.status === 'running') {
        const id = ids[cursor++]
        const [language, textId] =
          job.language === '*' ? (JSON.parse(id) as [string, string]) : [job.language, id]
        job.activeIds.push(id)
        await save()
        let attempt = 0
        let input = ''
        let instructions = request.settings.instructions
        let model = request.settings.model
        const log = async (status: CallLog['status'], response: string, operation = 'speech') => {
          const keys = Object.values(credentials).filter(Boolean) as string[]
          const value: CallLog = {
            at: new Date().toISOString(),
            entryId: job.language === '*' ? `${language}/${textId}` : id,
            operation,
            model,
            voice: request.settings.voice,
            input: redact(input, keys, 100000),
            instructions: redact(instructions, keys, 40000),
            status,
            response: redact(response, keys, 100000),
            attempt,
          }
          await fs.mkdir(path.join(dir, 'calls'), { recursive: true })
          await fs.appendFile(
            path.join(dir, 'calls', `${job.id}.jsonl`),
            JSON.stringify(value) + '\n',
            { mode: 0o600 },
          )
        }
        let release: () => void = () => {}
        try {
          release = await this.acquireEntry(signal)
          signal.throwIfAborted()
          const state = await this.store.load(owner, bookId)
          let entry = state.entries.get(entryKey(language, textId))!
          await this.store.capacity(owner, 65536)
          const beforeAttempt = async (n: number) => {
            attempt = n
            signal.throwIfAborted()
            if (request.credentialMode === 'service') await this.reserve(owner, input.length)
          }
          if (
            request.operation === 'normalize' ||
            (request.settings.normalize && (!entry.manualSpeech || request.replaceManual))
          ) {
            model = request.settings.normalizationModel
            input = entry.text
            instructions = normalizationPrompt(entry.text, entry.language, request.settings)
            const key = hash(
              JSON.stringify([
                NORMALIZATION_VERSION,
                entry.language,
                input,
                request.settings.normalizationModel,
                request.settings.profile,
                request.settings.math,
              ]),
            )
            const cache = path.join(dir, '.cache', 'text', `${key}.json`)
            let text: string
            if (!request.force && (await exists(cache))) {
              text = (await jsonFile<{ text: string }>(cache)).text
              await log('cached', text, 'normalization')
            } else {
              const normalized = await normalizeText(
                entry.text,
                entry.language,
                request.settings,
                credentials.gemini!,
                signal,
                this.transport,
                beforeAttempt,
              )
              text = normalized.text
              signal.throwIfAborted()
              await atomicJson(cache, { text })
              await log('done', text, 'normalization')
            }
            signal.throwIfAborted()
            entry = await this.store.revise(
              owner,
              bookId,
              entry.language,
              textId,
              entry.version,
              { speechText: text, manualSpeech: false },
              'Normalized speech text',
            )
          }
          if (request.operation === 'normalize') {
            job.completed++
            job.results.push({ id, status: 'done' })
            continue
          }
          input = entry.speechText.trim()
          model = request.settings.model
          instructions = request.settings.instructions
          const signature = speechSignature(input, request.settings, entry.language),
            cached = path.join(dir, '.cache', 'audio', `${signature}.json`)
          let file: string | undefined
          let bytes = 0
          let hit = false
          if (!request.force && (await exists(cached))) {
            const record = await jsonFile<{ file: string }>(cached),
              candidate = path.join(dir, 'blobs', path.basename(record.file))
            if (await exists(candidate)) {
              try {
                const audio = validWav(await fs.readFile(candidate))
                file = candidate
                bytes = audio.length
                hit = true
              } catch {
                /* A damaged cache entry must be regenerated. */
              }
            }
          }
          if (!file) {
            const audio = await synthesize(
              input,
              request.settings,
              credentials[request.settings.provider]!,
              signal,
              this.transport,
              beforeAttempt,
            )
            signal.throwIfAborted()
            file = path.join(dir, 'blobs', `${hash(audio)}.wav`)
            bytes = audio.length
            await this.store.exclusive('storage-admission', async () => {
              await this.store.capacity(owner, bytes + 65536)
              await fs.mkdir(path.dirname(file!), { recursive: true })
              await fs.writeFile(file!, audio, { flag: 'wx', mode: 0o600 }).catch((e) => {
                if (e.code !== 'EEXIST') throw e
              })
            })
            await atomicJson(cached, { file: path.basename(file) })
          }
          signal.throwIfAborted()
          const audio = {
            file: path.relative(dir, file),
            exportName: `tts-${path.basename(file)}`,
            source: 'generated' as const,
            exists: true,
            signature,
            textHash: hash(input),
            provider: request.settings.provider,
            model: request.settings.model,
            voice: request.settings.voice,
            createdAt: new Date().toISOString(),
            bytes,
          }
          await this.store.revise(
            owner,
            bookId,
            entry.language,
            textId,
            entry.version,
            { audios: { ...entry.audios, [request.slot]: audio } },
            hit ? 'Reused cached recording' : 'Generated recording',
          )
          job.completed++
          if (hit) job.cached++
          job.results.push({ id, status: hit ? 'cached' : 'done' })
          await log(hit ? 'cached' : 'done', `WAV ${bytes} bytes; ${path.basename(file)}`)
        } catch (e) {
          if (signal.aborted) break
          const message = redact(
            e instanceof Error ? e.message : 'Generation failed.',
            Object.values(credentials).filter(Boolean) as string[],
          )
          job.failed++
          job.results.push({ id, status: 'failed', error: message })
          await log('failed', message)
          if (/API key|allowance|storage|permissions|Provider quota/.test(message)) {
            job.status = 'failed'
            break
          }
        } finally {
          release()
          job.activeIds = job.activeIds.filter((x) => x !== id)
          await save()
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: request.concurrency }, worker))
      job.status = signal.aborted ? 'cancelled' : job.status === 'failed' ? 'failed' : 'completed'
    } catch {
      job.status = signal.aborted ? 'cancelled' : 'failed'
    } finally {
      job.activeIds = []
      await save()
    }
  }
  async cancel(owner: string, bookId: string, jobId: string) {
    const record = this.active.get(jobId)
    if (!record || record.job.ownerId !== owner || record.job.bookId !== bookId)
      throw new Error('Active job not found.')
    record.controller.abort()
    await record.promise
  }
  async stop() {
    for (const v of this.active.values()) v.controller.abort()
    await Promise.all([...this.active.values()].map((v) => v.promise))
  }
}
