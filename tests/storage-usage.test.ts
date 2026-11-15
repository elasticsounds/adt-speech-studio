import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Store } from '../apps/api/src/store.js'
import { directoryBytes } from '../packages/bundle/src/files.js'

let root: string, store: Store, dir: string
const owner = '00000000-0000-4000-8000-000000000001'
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-usage-'))
  store = new Store(root)
  dir = path.join(root, 'books', owner, 'book')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'original.zip'), Buffer.alloc(100))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

it('AC-1: counts existing books once and performs no book walk on repeated admission', async () => {
  expect(await store.ownerBytes(owner)).toBe(100)
  const scan = vi.spyOn(fs, 'readdir')
  for (let i = 0; i < 20; i++) await store.capacity(owner, 10)
  expect(
    scan.mock.calls.filter(([p]) => String(p).startsWith(path.join(root, 'books'))),
  ).toHaveLength(0)
  await fs.mkdir(path.join(root, 'sessions'))
  await fs.writeFile(path.join(root, 'sessions', 'test.json'), Buffer.alloc(50))
  expect(await store.totalBytes()).toBe(150)
})

it('AC-1: tracks replacement, append, partial failure, removal and startup reconciliation', async () => {
  const file = path.join(dir, 'audio.wav')
  const check = async () =>
    expect(await store.ownerBytes(owner)).toBe(
      await directoryBytes(path.join(root, 'books', owner)),
    )
  await store.writeFiles(owner, [file], 80, () => fs.writeFile(file, Buffer.alloc(80)))
  await check()
  await store.writeFiles(owner, [file], 20, () => fs.writeFile(file, Buffer.alloc(20)))
  await store.writeFiles(owner, [file], 10, () => fs.appendFile(file, Buffer.alloc(10)))
  await expect(
    store.writeFiles(owner, [file], 5, async () => {
      await fs.appendFile(file, Buffer.alloc(5))
      throw new Error('interrupted write')
    }),
  ).rejects.toThrow('interrupted write')
  await check()
  expect(await new Store(root).totalBytes()).toBe(await store.totalBytes())
  await store.writeFiles(owner, [dir], undefined, () => fs.rm(dir, { recursive: true }))
  expect(await store.ownerBytes(owner)).toBe(0)
})

it('AC-1: serializes quota admission so concurrent writes cannot spend the same space', async () => {
  vi.stubEnv('MAX_OWNER_BYTES', '200')
  const outcomes = await Promise.allSettled(
    [1, 2].map((n) => {
      const file = path.join(dir, `${n}.wav`)
      return store.writeFiles(owner, [file], 75, () => fs.writeFile(file, Buffer.alloc(75)))
    }),
  )
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await store.ownerBytes(owner)).toBe(175)
  expect(await directoryBytes(dir)).toBe(175)
})
