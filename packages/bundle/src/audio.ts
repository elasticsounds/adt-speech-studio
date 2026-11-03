import fs from 'node:fs/promises'

/** Read only WAV chunk headers; never load a whole book's audio for a cost preview. */
export async function wavDuration(file: string): Promise<number | undefined> {
  const fd = await fs.open(file, 'r')
  try {
    const size = (await fd.stat()).size,
      header = Buffer.alloc(16)
    if (
      size < 44 ||
      (await fd.read(header, 0, 12, 0)).bytesRead !== 12 ||
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'WAVE'
    )
      return
    let offset = 12,
      rate = 0,
      data = 0
    for (let chunk = 0; offset + 8 <= size && chunk < 1024; chunk++) {
      await fd.read(header, 0, 8, offset)
      const kind = header.toString('ascii', 0, 4),
        length = header.readUInt32LE(4)
      if (offset + 8 + length > size) return
      if (kind === 'fmt ' && length >= 16) {
        await fd.read(header, 0, 16, offset + 8)
        if (![1, 3].includes(header.readUInt16LE(0))) return
        rate = header.readUInt32LE(8)
      }
      if (kind === 'data') data += length
      offset += 8 + length + (length % 2)
    }
    return rate && data ? data / rate : undefined
  } finally {
    await fd.close()
  }
}
