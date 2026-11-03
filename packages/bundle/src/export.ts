import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Book, Entry } from '@speech/types'
import { exists, filesUnder, inside, jsonFile, hash } from './files.js'
import { zipFiles } from './archive.js'
import { readWordTimings, readerTimecode } from './timings.js'

/** Replace only the JSON literal in Studio's known preloader, never execute it. */
export function refreshPreloader(source: string, changes: Map<string, Buffer>): string {
  if (!source.startsWith('// offline-preloader.js') || !source.includes('window.fetch'))
    throw new Error('This ADT has a custom offline preloader. Export cannot safely refresh it.')
  const match = /\b(?:var|const|let) INLINE\s*=\s*/.exec(source)
  if (!match) throw new Error('Unrecognized offline preloader data.')
  const start = match.index + match[0].length
  let depth = 0,
    quoted = false,
    escaped = false,
    end = -1
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end < 0) throw new Error('Invalid offline preloader data.')
  const inline = JSON.parse(source.slice(start, end)) as Record<string, unknown>
  for (const [name, data] of changes)
    if (name.endsWith('.json')) {
      const key = Object.hasOwn(inline, name) ? name : `./${name}`
      Object.defineProperty(inline, key, {
        value: JSON.parse(data.toString('utf8')),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
  return source.slice(0, start) + JSON.stringify(inline) + source.slice(end)
}

export async function exportBook(bookDir: string, book: Book, entries: Entry[]) {
  const root = path.join(bookDir, 'original', book.root)
  const all = await filesUnder(root)
  const exportDir = path.join(bookDir, 'exports')
  await fs.mkdir(exportDir, { recursive: true })
  if (entries.every((entry) => entry.version === 0)) {
    const target = path.join(exportDir, `${randomUUID()}.zip`)
    await zipFiles(
      target,
      all.map((name) => ({ name, file: inside(root, name) })),
    )
    return target
  }
  const changes = new Map<string, Buffer>()
  const assets = new Map<string, string>()
  const read = async (name: string): Promise<Record<string, any>> =>
    (await exists(inside(root, name))) ? jsonFile(inside(root, name)) : {}
  const write = (name: string, value: unknown) =>
    changes.set(name, Buffer.from(JSON.stringify(value, null, 2)))
  let hasAudio = false
  let hasTiming = false
  for (const lang of book.languages) {
    const base = `content/i18n/${lang}`
    const texts = await read(`${base}/texts.json`),
      speech = await read(`${base}/speech_texts.json`)
    const primary = await read(`${base}/audios.json`),
      voices = await read(`${base}/audio_voices.json`)
    const secondary = voices.voices?.secondary?.audios ?? {}
    const timings = await read(`${base}/timecode/timecode_output.json`),
      voiceTimings = await read(`${base}/timecode/timecode_voices.json`)
    const stale = { primary: new Set<string>(), secondary: new Set<string>() }
    for (const entry of entries.filter((e) => e.language === lang)) {
      if (entry.version > 0) {
        Object.defineProperty(texts, entry.id, {
          value: entry.text,
          enumerable: true,
          writable: true,
          configurable: true,
        })
        Object.defineProperty(speech, entry.id, {
          value: entry.speechText,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      for (const slot of ['primary', 'secondary'] as const) {
        const audio = entry.audios[slot],
          map = slot === 'primary' ? primary : secondary
        const usable =
          audio?.exists &&
          !entry.muted &&
          (!audio.textHash || audio.textHash === hash(entry.speechText.trim()))
        if (!usable) {
          if (Object.hasOwn(map, entry.id)) delete map[entry.id]
          stale[slot].add(entry.id)
          continue
        }
        hasAudio = true
        if (audio.source !== 'imported') {
          Object.defineProperty(map, entry.id, {
            value: audio.exportName,
            enumerable: true,
            writable: true,
            configurable: true,
          })
          assets.set(`${base}/audio/${audio.exportName}`, inside(bookDir, audio.file))
          stale[slot].add(entry.id)
        }
      }
    }
    // Studio keys timecodes by textId. Legacy variants may include an id field.
    const prune = (map: Record<string, any>, ids: Set<string>) => {
      for (const key of Object.keys(map))
        if (ids.has(key) || ids.has(map[key]?.id) || ids.has(map[key]?.text_id)) delete map[key]
    }
    prune(timings, stale.primary)
    if (voiceTimings.primary) prune(voiceTimings.primary, stale.primary)
    if (voiceTimings.secondary) prune(voiceTimings.secondary, stale.secondary)
    for (const entry of entries.filter((e) => e.language === lang && !e.muted)) {
      for (const slot of ['primary', 'secondary'] as const) {
        if (entry.audios[slot]?.timings?.format !== 'speech') continue
        const data = await readWordTimings(bookDir, entry, slot)
        if (!data) continue
        voiceTimings[slot] ??= {}
        const value = readerTimecode(data)
        Object.defineProperty(voiceTimings[slot], entry.id, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        })
        if (slot === 'primary')
          Object.defineProperty(timings, entry.id, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          })
      }
    }
    hasTiming ||=
      Object.keys(timings).length > 0 || Object.keys(voiceTimings.secondary ?? {}).length > 0
    write(`${base}/texts.json`, texts)
    write(`${base}/speech_texts.json`, speech)
    write(`${base}/audios.json`, primary)
    if (Object.keys(secondary).length || voices.voices) {
      const updated = {
        ...voices,
        defaultVoice: voices.defaultVoice ?? 'primary',
        voices: {
          ...voices.voices,
          primary: {
            ...voices.voices?.primary,
            label: voices.voices?.primary?.label ?? 'Primary',
            audios: primary,
          },
          secondary: {
            ...voices.voices?.secondary,
            label: voices.voices?.secondary?.label ?? 'Secondary',
            audios: secondary,
          },
        },
      }
      write(`${base}/audio_voices.json`, updated)
    }
    if (
      Object.keys(timings).length ||
      (await exists(inside(root, `${base}/timecode/timecode_output.json`)))
    )
      write(`${base}/timecode/timecode_output.json`, timings)
    if (
      Object.keys(voiceTimings).length ||
      (await exists(inside(root, `${base}/timecode/timecode_voices.json`)))
    )
      write(`${base}/timecode/timecode_voices.json`, voiceTimings)
  }
  if (await exists(path.join(root, 'assets/config.json'))) {
    const config = await read('assets/config.json')
    write('assets/config.json', {
      ...config,
      features: { ...config.features, readAloud: hasAudio, highlight: hasTiming },
    })
  }
  if (await exists(path.join(root, 'assets/offline-preloader.js'))) {
    changes.set(
      'assets/offline-preloader.js',
      Buffer.from(
        refreshPreloader(
          await fs.readFile(path.join(root, 'assets/offline-preloader.js'), 'utf8'),
          changes,
        ),
      ),
    )
  }
  const items = new Map(
    all.map((name) => [
      name,
      { name, file: inside(root, name) } as { name: string; file?: string; data?: Buffer },
    ]),
  )
  for (const [name, data] of changes) {
    const original = inside(root, name)
    if ((await exists(original)) && name.endsWith('.json')) {
      try {
        if (
          JSON.stringify(JSON.parse(await fs.readFile(original, 'utf8'))) ===
          JSON.stringify(JSON.parse(data.toString()))
        )
          continue
      } catch {}
    }
    items.set(name, { name, data })
  }
  for (const [name, file] of assets) items.set(name, { name, file })
  const dir = path.join(bookDir, 'exports')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${randomUUID()}.zip`)
  await zipFiles(target, [...items.values()])
  return target
}
