import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { inside } from './files.js'

export const MAX_UPLOAD = 1024 * 1024 * 1024
export const MAX_EXPANDED = 2 * 1024 * 1024 * 1024
export async function extractArchive(
  file: string,
  destination: string,
  limits = { bytes: MAX_EXPANDED, files: 25000 },
) {
  const archive = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (e, z) => (e ? reject(e) : resolve(z!)),
    ),
  )
  const seen = new Set<string>()
  let total = 0
  let count = 0
  await fs.mkdir(destination, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) => {
      archive.close()
      reject(e)
    }
    archive.on('error', fail)
    archive.on('end', resolve)
    archive.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        const isDirectory = entry.fileName.endsWith('/')
        const name = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName
        const target = inside(destination, name)
        const canonical = name.normalize('NFC').toLowerCase()
        const type = (entry.externalFileAttributes >>> 16) & 0xf000
        if (type !== 0 && type !== 0x8000 && type !== 0x4000)
          throw new Error('Archive contains a link or special file.')
        if (seen.has(canonical)) throw new Error('Archive contains duplicate file paths.')
        seen.add(canonical)
        if (
          ++count > limits.files ||
          entry.uncompressedSize > limits.bytes ||
          total + entry.uncompressedSize > limits.bytes
        )
          throw new Error('ADT exceeds extraction limits.')
        if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted ZIPs are not supported.')
        if (isDirectory) {
          await fs.mkdir(target, { recursive: true })
          archive.readEntry()
          return
        }
        await fs.mkdir(path.dirname(target), { recursive: true })
        const input = await new Promise<NodeJS.ReadableStream>((res, rej) =>
          archive.openReadStream(entry, (e, s) => (e ? rej(e) : res(s!))),
        )
        let bytes = 0
        const guard = new Transform({
          transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length
            total += chunk.length
            if (total > limits.bytes || bytes > entry.uncompressedSize)
              done(new Error('ADT exceeds extraction limits.'))
            else done(null, chunk)
          },
        })
        await pipeline(input, guard, createWriteStream(target, { flags: 'wx', mode: 0o600 }))
        archive.readEntry()
      })().catch(fail)
    })
    archive.readEntry()
  })
  return { files: count, bytes: total }
}

export async function zipFiles(
  destination: string,
  items: Array<{ name: string; file?: string; data?: Buffer }>,
) {
  const zip = new yazl.ZipFile()
  const output = pipeline(zip.outputStream, createWriteStream(destination, { mode: 0o600 }))
  for (const item of items) {
    if (item.data) zip.addBuffer(item.data, item.name)
    else zip.addFile(item.file!, item.name)
  }
  zip.end()
  await output
}
