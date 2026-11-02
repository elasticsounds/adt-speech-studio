import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { extractArchive, zipFiles } from '../packages/bundle/src/archive.js'
import { readCatalog } from '../packages/bundle/src/catalog.js'
import { exportBook, refreshPreloader } from '../packages/bundle/src/export.js'
import { jsonFile, hash } from '../packages/bundle/src/files.js'
import { makeFixture, fixtureFiles, tone } from './fixture.js'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-archive-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
async function load(wrapper = '') {
  const archive = await makeFixture(path.join(root, 'original.zip'), wrapper)
  const info = await extractArchive(archive, path.join(root, 'original'))
  return readCatalog(root, {
    id: randomUUID(),
    ownerId: randomUUID(),
    createdAt: new Date().toISOString(),
    fileName: 'test.zip',
    fileCount: info.files,
    bytes: info.bytes,
  })
}
it('imports wrapped current readers, preserves ids and detects broken audio', async () => {
  const { book, entries } = await load('book/')
  expect(book.root).toBe('book/')
  expect(book.languages).toEqual(['en', 'es'])
  expect(entries).toHaveLength(12)
  expect(
    entries.find((e) => e.id === 'pg001_p' && e.language === 'en')?.audios.primary?.exists,
  ).toBe(false)
  expect(book.warnings[0]).toContain('missing')
})
it('bounds total expanded bytes before writing an oversized member', async () => {
  const file = path.join(root, 'large.zip')
  await zipFiles(file, [{ name: 'large.txt', data: Buffer.alloc(1000) }])
  await expect(
    extractArchive(file, path.join(root, 'out'), { bytes: 100, files: 10 }),
  ).rejects.toThrow('limits')
})
it('rejects duplicate paths including case-insensitive collisions', async () => {
  const file = path.join(root, 'duplicate.zip')
  await zipFiles(file, [
    { name: 'A.txt', data: Buffer.from('a') },
    { name: 'a.txt', data: Buffer.from('b') },
  ])
  await expect(extractArchive(file, path.join(root, 'out'))).rejects.toThrow('duplicate')
})
it('rejects symlinks from UNIX external attributes', async () => {
  const file = path.join(root, 'link.zip')
  await zipFiles(file, [{ name: 'link.txt', data: Buffer.from('/etc/passwd') }])
  const data = await fs.readFile(file),
    index = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  data.writeUInt32LE((0xa1ff << 16) >>> 0, index + 38)
  await fs.writeFile(file, data)
  await expect(extractArchive(file, path.join(root, 'out'))).rejects.toThrow('link')
})
it('rejects traversal names even when encoded in a valid ZIP central directory', async () => {
  const file = path.join(root, 'traversal.zip')
  await zipFiles(file, [{ name: 'xx/file.txt', data: Buffer.from('bad') }])
  const b = await fs.readFile(file)
  for (let at = 0; (at = b.indexOf('xx/file.txt', at)) >= 0; at += 11) b.write('../file.txt', at)
  await fs.writeFile(file, b)
  await expect(extractArchive(file, path.join(root, 'out'))).rejects.toThrow()
  await expect(fs.stat(path.join(root, 'file.txt'))).rejects.toThrow()
})
it('rejects unsafe audio references before reading outside the extracted book', async () => {
  const files = fixtureFiles()
  files.find((f) => f.name.endsWith('en/audios.json'))!.data = Buffer.from(
    JSON.stringify({ pg001_h: '../../../../../etc/passwd' }),
  )
  const file = path.join(root, 'original.zip')
  await zipFiles(file, files)
  await extractArchive(file, path.join(root, 'original'))
  await expect(
    readCatalog(root, {
      id: randomUUID(),
      ownerId: randomUUID(),
      fileName: 'test.zip',
      fileCount: 1,
      bytes: 1,
      createdAt: new Date().toISOString(),
    }),
  ).rejects.toThrow('Unsafe')
})
it('exports all untouched files byte-for-byte, including an unknown custom preloader', async () => {
  const { book, entries } = await load()
  await fs.writeFile(
    path.join(root, 'original/assets/offline-preloader.js'),
    'custom code never executed',
  )
  const zip = await exportBook(root, book, entries)
  const out = path.join(root, 'out')
  await extractArchive(zip, out)
  for (const item of fixtureFiles().filter((f) => f.name !== 'assets/offline-preloader.js'))
    expect(await fs.readFile(path.join(out, item.name))).toEqual(item.data)
  expect(await fs.readFile(path.join(out, 'assets/offline-preloader.js'), 'utf8')).toBe(
    'custom code never executed',
  )
})
it('publishes new audio, refreshes offline JSON and preserves original activities and unchanged timings', async () => {
  const { book, entries } = await load()
  const entry = entries.find((e) => e.language === 'en' && e.id === 'pg001_p')!
  await fs.mkdir(path.join(root, 'blobs'))
  await fs.writeFile(path.join(root, 'blobs/new.wav'), tone)
  entry.version = 1
  entry.audios.primary = {
    file: 'blobs/new.wav',
    exportName: 'new.wav',
    exists: true,
    source: 'generated',
    textHash: hash(entry.speechText.trim()),
  }
  const out = path.join(root, 'out')
  await extractArchive(await exportBook(root, book, entries), out)
  expect(
    (await jsonFile<Record<string, string>>(path.join(out, 'content/i18n/en/audios.json'))).pg001_p,
  ).toBe('new.wav')
  expect(await fs.readFile(path.join(out, 'content/i18n/en/audio/new.wav'))).toEqual(tone)
  expect(
    await jsonFile(path.join(out, 'content/i18n/en/timecode/timecode_output.json')),
  ).toHaveProperty('pg001_h')
  for (const name of [
    'pg001_sec001.html',
    'imsmanifest.xml',
    'tools/untrusted.js',
    'images/leaf.svg',
  ])
    expect(await fs.readFile(path.join(out, name))).toEqual(
      await fs.readFile(path.join(root, 'original', name)),
    )
  const sandbox = {
    window: { fetch: () => Promise.reject(new Error('unexpected fetch')) },
    Response,
  }
  vm.runInNewContext(
    await fs.readFile(path.join(out, 'assets/offline-preloader.js'), 'utf8'),
    sandbox,
  )
  const response = await (sandbox.window.fetch as unknown as (s: string) => Promise<Response>)(
    './content/i18n/en/audios.json',
  )
  expect(await response.json()).toHaveProperty('pg001_p', 'new.wav')
})
it('drops stale audio/timings after an edit and refuses unknown preloaders for changed exports', async () => {
  const { book, entries } = await load()
  const entry = entries.find((e) => e.language === 'en' && e.id === 'pg001_h')!
  entry.version = 1
  entry.speechText = 'A different sentence'
  const out = path.join(root, 'out')
  await extractArchive(await exportBook(root, book, entries), out)
  expect(await jsonFile(path.join(out, 'content/i18n/en/audios.json'))).not.toHaveProperty(
    'pg001_h',
  )
  expect(
    await jsonFile(path.join(out, 'content/i18n/en/timecode/timecode_output.json')),
  ).not.toHaveProperty('pg001_h')
  expect(() => refreshPreloader('alert(1)', new Map())).toThrow('custom')
})
