import fs from 'node:fs/promises'
import path from 'node:path'
import {
  WordTimings,
  type Entry,
  type Book,
  type VoiceSlot,
  type TimingReference,
} from '@speech/types'
import { inside, jsonFile, hash } from './files.js'

export function hasWordTimings(entry: Entry, slot: VoiceSlot) {
  const audio = entry.audios[slot],
    ref = audio?.timings
  return !!(
    audio?.exists &&
    !audio.stale &&
    ref &&
    ref.audioFile === audio.file &&
    ref.textHash === hash(entry.speechText.trim())
  )
}
function fromReader(value: any): WordTimings | null {
  const words = value?.timecodes?.[1]?.word_timestamps
  if (!Array.isArray(words) || !words.length || words.length > 20000) return null
  const result = WordTimings.safeParse({
    words: words.map((w: any) => ({ word: w?.text, start: w?.start, end: w?.end })),
    text: words.map((w: any) => (typeof w?.text === 'string' ? w.text : '')).join(' '),
    duration: Math.max(...words.map((w: any) => (typeof w?.end === 'number' ? w.end : 0))),
  })
  return result.success ? result.data : null
}
async function timingJson(file: string): Promise<any> {
  if ((await fs.stat(file)).size > 32 * 1024 ** 2)
    throw new Error('Timing file exceeds the size limit.')
  return jsonFile(file)
}
/** Derive metadata from immutable imported files, including pre-feature workspaces. */
export async function hydrateImportedTimings(
  dir: string,
  book: Pick<Book, 'root' | 'languages'>,
  entries: Entry[],
) {
  for (const language of book.languages) {
    const base = `original/${book.root}content/i18n/${language}/timecode/`
    const primary = await timingJson(inside(dir, base + 'timecode_output.json')).catch(() => ({}))
    const voices = await timingJson(inside(dir, base + 'timecode_voices.json')).catch(() => ({}))
    for (const entry of entries.filter((e) => e.language === language)) {
      for (const slot of ['primary', 'secondary'] as const) {
        const audio = entry.audios[slot]
        if (
          !audio?.exists ||
          audio.source !== 'imported' ||
          audio.timings ||
          audio.textHash !== hash(entry.speechText.trim())
        )
          continue
        const fromVoices = slot === 'secondary' || !Object.hasOwn(primary ?? {}, entry.id)
        const map = fromVoices ? voices?.[slot] : primary
        const data = fromReader(Object.hasOwn(map ?? {}, entry.id) ? map[entry.id] : undefined)
        if (data)
          audio.timings = {
            file: base + (fromVoices ? 'timecode_voices.json' : 'timecode_output.json'),
            format: 'reader',
            source: 'imported',
            audioFile: audio.file,
            textHash: audio.textHash,
            duration: data.duration,
            wordCount: data.words.length,
          }
      }
    }
  }
}
export async function readWordTimings(
  dir: string,
  entry: Entry,
  slot: VoiceSlot,
): Promise<WordTimings | null> {
  if (!hasWordTimings(entry, slot)) return null
  const ref = entry.audios[slot]!.timings!
  const raw = await timingJson(inside(dir, ref.file)).catch(() => null)
  if (ref.format === 'reader') {
    const map = ref.file.endsWith('/timecode_voices.json') ? raw?.[slot] : raw
    return fromReader(Object.hasOwn(map ?? {}, entry.id) ? map[entry.id] : undefined)
  }
  const parsed = WordTimings.safeParse(raw)
  return parsed.success ? parsed.data : null
}
export async function writeWordTimings(
  dir: string,
  entry: Entry,
  slot: VoiceSlot,
  value: WordTimings,
  source: 'generated' | 'manual',
): Promise<TimingReference> {
  const audio = entry.audios[slot]
  if (!audio?.exists || audio.stale)
    throw new Error('Generate a current recording before creating word timestamps.')
  const data = WordTimings.parse(value),
    bytes = JSON.stringify(data)
  const file = `blobs/timing-${hash(bytes)}.json`
  await fs.mkdir(path.join(dir, 'blobs'), { recursive: true })
  await fs.writeFile(inside(dir, file), bytes, { flag: 'wx', mode: 0o600 }).catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
  return {
    file,
    format: 'speech',
    source,
    audioFile: audio.file,
    textHash: hash(entry.speechText.trim()),
    duration: data.duration,
    wordCount: data.words.length,
  }
}
export function readerTimecode(data: WordTimings) {
  return {
    timecodes: [
      null,
      { word_timestamps: data.words.map((w) => ({ text: w.word, start: w.start, end: w.end })) },
    ],
  }
}
