import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
export function inside(base: string, relative: string): string {
  if (
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    path.posix.isAbsolute(relative) ||
    /^[a-zA-Z]:/.test(relative) ||
    relative.split('/').some((s) => s === '..' || s === '.' || s === '')
  )
    throw new Error('Unsafe file path in ADT.')
  const resolved = path.resolve(base, relative)
  if (!resolved.startsWith(path.resolve(base) + path.sep))
    throw new Error('Unsafe file path in ADT.')
  return resolved
}
export async function jsonFile<T>(file: string): Promise<T> {
  if ((await fs.stat(file)).size > 32 * 1024 * 1024)
    throw new Error('A JSON file exceeds the 32 MB safety limit.')
  return JSON.parse(await fs.readFile(file, 'utf8')) as T
}
export async function atomicJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 })
  await fs.rename(tmp, file)
}
export async function exists(file: string) {
  try {
    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}
export async function filesUnder(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed.')
    if (entry.isDirectory()) out.push(...(await filesUnder(root, rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out
}
export async function directoryBytes(root: string): Promise<number> {
  try {
    let n = 0
    for (const name of await filesUnder(root)) n += (await fs.stat(path.join(root, name))).size
    return n
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw e
  }
}
