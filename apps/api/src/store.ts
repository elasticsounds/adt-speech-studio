import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  Book,
  Entry,
  Job,
  Settings,
  type BookSummary,
  WordTimings,
  type VoiceSlot,
} from '@speech/types'
import { hydrateImportedTimings, writeWordTimings } from '../../../packages/bundle/src/timings.js'
import {
  atomicJson,
  directoryBytes,
  exists,
  filesUnder,
  inside,
  jsonFile,
  hash,
} from '../../../packages/bundle/src/files.js'
import { entryKey } from '../../../packages/bundle/src/catalog.js'

export class Store {
  private loaded = new Map<string, { book: Book; entries: Map<string, Entry> }>()
  private locks = new Map<string, Promise<void>>()
  private bookBytes?: Promise<Map<string, number>>
  constructor(readonly root: string) {}
  dir(owner: string, book: string) {
    if (!/^[0-9a-f-]{36}$/.test(owner) || !/^[0-9a-f-]{36}$/.test(book))
      throw new Error('Workspace not found.')
    return path.join(this.root, 'books', owner, book)
  }
  async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(id) ?? Promise.resolve()
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(id, hold)
    await before
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(id) === hold) this.locks.delete(id)
    }
  }
  private usage() {
    // Rebuild once after restart. All book mutations below update these totals
    // under storage-admission; no stale persistent index or per-clip tree walk.
    return (this.bookBytes ??= (async () => {
      const totals = new Map<string, number>()
      const root = path.join(this.root, 'books')
      for (const owner of await fs.readdir(root).catch((e) => {
        if (e.code === 'ENOENT') return [] as string[]
        throw e
      }))
        totals.set(owner, await directoryBytes(path.join(root, owner)))
      return totals
    })().catch((e) => {
      this.bookBytes = undefined
      throw e
    }))
  }
  async ownerBytes(owner: string) {
    return (await this.usage()).get(owner) ?? 0
  }
  async totalBytes() {
    let total = [...(await this.usage()).values()].reduce((a, b) => a + b, 0)
    // Identity and daily allowance files are small and written independently.
    for (const dir of ['accounts', 'sessions', 'usage'])
      total += await directoryBytes(path.join(this.root, dir))
    return total
  }
  async writeFiles<T>(
    owner: string,
    files: string[],
    additional: number | undefined,
    fn: () => Promise<T>,
  ) {
    return this.exclusive('storage-admission', async () => {
      const usage = await this.usage()
      if (additional !== undefined) await this.capacity(owner, additional)
      const size = async () => {
        let bytes = 0
        for (const file of files) {
          const stat = await fs.stat(file).catch((e) => {
            if (e.code === 'ENOENT') return null
            throw e
          })
          if (stat) bytes += stat.isDirectory() ? await directoryBytes(file) : stat.size
        }
        return bytes
      }
      const before = await size()
      try {
        return await fn()
      } finally {
        try {
          usage.set(owner, (usage.get(owner) ?? 0) + (await size()) - before)
        } catch (e) {
          this.bookBytes = undefined
          throw e
        }
      }
    })
  }
  async capacity(owner: string, additional = 0) {
    const used = await this.ownerBytes(owner),
      total = await this.totalBytes()
    if (
      used + additional > Number(process.env.MAX_OWNER_BYTES ?? 2 * 1024 ** 3) ||
      total + additional > Number(process.env.MAX_STORAGE_BYTES ?? 7 * 1024 ** 3)
    )
      throw new Error('Storage quota reached. Delete unused ADTs before continuing.')
    const disk = await fs.statfs(this.root)
    if (disk.bavail * disk.bsize < additional + 64 * 1024 ** 2)
      throw new Error('Server storage is nearly full. Your original ADT is safe.')
  }
  private trimCache() {
    while (this.loaded.size > 6) this.loaded.delete(this.loaded.keys().next().value!)
  }
  async load(owner: string, id: string) {
    const key = `${owner}/${id}`
    const cached = this.loaded.get(key)
    if (cached) {
      this.loaded.delete(key)
      this.loaded.set(key, cached)
      return cached
    }
    const dir = this.dir(owner, id)
    const book = Book.parse(await jsonFile(path.join(dir, 'book.json')))
    if (book.ownerId !== owner || book.id !== id) throw new Error('Workspace not found.')
    const baseline = Entry.array().parse(await jsonFile(path.join(dir, 'baseline.json')))
    const entries = new Map(baseline.map((e) => [entryKey(e.language, e.id), e]))
    const revisions = path.join(dir, 'revisions')
    try {
      for (const file of await filesUnder(revisions)) {
        if (!file.endsWith('.json')) continue
        const entry = Entry.parse(await jsonFile(path.join(revisions, file)))
        const k = entryKey(entry.language, entry.id)
        if (entries.has(k) && entry.version > entries.get(k)!.version) entries.set(k, entry)
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    await hydrateImportedTimings(dir, book, [...entries.values()])
    const state = { book, entries }
    this.loaded.set(key, state)
    this.trimCache()
    return state
  }
  async initialize(book: Book, entries: Entry[]) {
    const dir = this.dir(book.ownerId, book.id)
    await atomicJson(path.join(dir, 'baseline.json'), entries)
    await atomicJson(path.join(dir, 'book.json'), book)
    this.loaded.set(`${book.ownerId}/${book.id}`, {
      book,
      entries: new Map(entries.map((e) => [entryKey(e.language, e.id), e])),
    })
    this.trimCache()
  }
  async revise(
    owner: string,
    id: string,
    language: string,
    textId: string,
    version: number,
    patch: Partial<Entry>,
    action: string,
    signal?: AbortSignal,
  ) {
    return this.exclusive(id, async () => {
      const state = await this.load(owner, id)
      const key = entryKey(language, textId)
      const current = state.entries.get(key)
      if (!current) throw new Error('Text entry not found.')
      if (current.version !== version)
        throw new Error('This entry changed. Reload it before saving.')
      const next = Entry.parse({
        ...current,
        ...patch,
        id: textId,
        language,
        version: version + 1,
        updatedAt: new Date().toISOString(),
        action,
      })
      for (const audio of Object.values(next.audios))
        if (audio) audio.stale = !!audio.textHash && audio.textHash !== hash(next.speechText.trim())
      const file = path.join(
        this.dir(owner, id),
        'revisions',
        key,
        `${String(next.version).padStart(8, '0')}.json`,
      )
      await fs.mkdir(path.dirname(file), { recursive: true })
      await this.writeFiles(
        owner,
        [file],
        Buffer.byteLength(JSON.stringify(next)) + 65536,
        async () => {
          signal?.throwIfAborted()
          await fs.writeFile(file, JSON.stringify(next), { flag: 'wx', mode: 0o600 })
        },
      )
      state.entries.set(key, next)
      return next
    })
  }
  async summary(owner: string, id: string): Promise<BookSummary> {
    const { book, entries } = await this.load(owner, id)
    const { ownerId: _owner, root: _root, ...publicBook } = book
    return {
      ...publicBook,
      total: entries.size,
      recorded: [...entries.values()].filter((e) => e.audios.primary?.exists).length,
    }
  }
  async list(owner: string) {
    const root = path.join(this.root, 'books', owner)
    let dirs: string[] = []
    try {
      dirs = await fs.readdir(root)
    } catch {
      return []
    }
    const books: BookSummary[] = []
    for (const id of dirs) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue
      try {
        books.push(await this.summary(owner, id))
      } catch {
        /* Incomplete upload is not a workspace. */
      }
    }
    return books.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async history(owner: string, id: string, language: string, textId: string) {
    await this.load(owner, id)
    const dir = this.dir(owner, id),
      key = entryKey(language, textId)
    const baseline = Entry.array()
      .parse(await jsonFile(path.join(dir, 'baseline.json')))
      .find((e) => e.language === language && e.id === textId)
    if (!baseline) throw new Error('Text entry not found.')
    const history = [baseline]
    try {
      for (const file of await fs.readdir(path.join(dir, 'revisions', key)))
        if (file.endsWith('.json'))
          history.push(Entry.parse(await jsonFile(path.join(dir, 'revisions', key, file))))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    await hydrateImportedTimings(dir, (await this.load(owner, id)).book, history)
    return history.sort((a, b) => b.version - a.version)
  }
  async settings(owner: string, id: string) {
    await this.load(owner, id)
    const file = path.join(this.dir(owner, id), 'settings.json')
    return (await exists(file)) ? z.record(z.string(), Settings).parse(await jsonFile(file)) : {}
  }
  async saveSettings(owner: string, id: string, language: string, settings: Settings) {
    return this.exclusive(id, async () => {
      const all = await this.settings(owner, id)
      if (!(await this.load(owner, id)).book.languages.includes(language))
        throw new Error('Language not found.')
      const next = { ...all, [language]: settings }
      const history = path.join(
        this.dir(owner, id),
        'settings-history',
        `${Date.now()}-${randomUUID()}.json`,
      )
      const current = path.join(this.dir(owner, id), 'settings.json')
      await this.writeFiles(owner, [history, current], undefined, async () => {
        await atomicJson(history, next)
        await atomicJson(current, next)
      })
    })
  }
  async jobs(owner: string, id: string) {
    await this.load(owner, id)
    const dir = path.join(this.dir(owner, id), 'jobs')
    const jobs: Job[] = []
    try {
      for (const f of await fs.readdir(dir))
        if (f.endsWith('.json')) jobs.push(Job.parse(await jsonFile(path.join(dir, f))))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
  }
  async saveJob(job: Job) {
    const file = path.join(this.dir(job.ownerId, job.bookId), 'jobs', `${job.id}.json`)
    await this.exclusive(`job-${job.id}`, () =>
      this.writeFiles(job.ownerId, [file], undefined, () => atomicJson(file, job)),
    )
  }
  async audioPath(
    owner: string,
    id: string,
    language: string,
    textId: string,
    slot: 'primary' | 'secondary',
    version?: number,
  ) {
    const state = await this.load(owner, id)
    const entry =
      version === undefined
        ? state.entries.get(entryKey(language, textId))
        : (await this.history(owner, id, language, textId)).find((e) => e.version === version)
    const audio = entry?.audios[slot]
    if (!audio?.exists) throw new Error('Recording not found.')
    return inside(this.dir(owner, id), audio.file)
  }
  async saveTimings(
    owner: string,
    id: string,
    entry: Entry,
    slot: VoiceSlot,
    timings: WordTimings,
    source: 'generated' | 'manual',
    signal?: AbortSignal,
  ) {
    const data = JSON.stringify(WordTimings.parse(timings))
    const file = path.join(this.dir(owner, id), 'blobs', `timing-${hash(data)}.json`)
    const ref = await this.writeFiles(owner, [file], Buffer.byteLength(data) + 65536, async () => {
      signal?.throwIfAborted()
      return writeWordTimings(this.dir(owner, id), entry, slot, timings, source)
    })
    return this.revise(
      owner,
      id,
      entry.language,
      entry.id,
      entry.version,
      { audios: { ...entry.audios, [slot]: { ...entry.audios[slot]!, timings: ref } } },
      source === 'manual' ? 'Edited word timestamps' : 'Generated word timestamps',
      signal,
    )
  }
  async delete(owner: string, id: string) {
    await this.load(owner, id)
    const dir = this.dir(owner, id)
    await this.writeFiles(owner, [dir], undefined, () => fs.rm(dir, { recursive: true }))
    this.loaded.delete(`${owner}/${id}`)
  }
}
