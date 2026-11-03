import fs from 'node:fs/promises'
import path from 'node:path'
import {
  WordTimings,
  type Entry,
  type Job,
  type CallLog,
  type RunRequest,
  type SpeechCost,
} from '@speech/types'
import { Store } from './store.js'
import { readWordTimings } from '../../../packages/bundle/src/timings.js'
import { inside, hash, atomicJson, jsonFile } from '../../../packages/bundle/src/files.js'
import { wavDuration } from '../../../packages/bundle/src/audio.js'
import {
  transcribeWords,
  timingSignature,
  timingPrompt,
  MAX_TRANSCRIPTION_BYTES,
  TIMESTAMP_MODEL,
} from '../../../packages/tts/src/timestamps.js'

export async function runTimestampJob(
  store: Store,
  job: Job,
  entry: Entry,
  key: string,
  signal: AbortSignal,
  transport: typeof fetch,
  onAttempt: (attempt: number, characters: number) => Promise<void>,
  log: (status: CallLog['status'], response: string, instructions: string) => Promise<void>,
) {
  const { ownerId: owner, bookId, request } = job,
    slot = request.slot,
    dir = store.dir(owner, bookId)
  const audio = entry.audios[slot]
  if (!audio?.exists || audio.stale)
    throw new Error('Generate current audio before creating word timestamps.')
  const retained =
    !request.force && audio.timings?.source !== 'manual'
      ? await readWordTimings(dir, entry, slot)
      : null
  if (retained) {
    await log(
      'cached',
      JSON.stringify(retained),
      'Reused timestamps matching this recording and spoken text.',
    )
    return { entry, cached: true }
  }
  const file = inside(dir, audio.file)
  if ((await fs.stat(file)).size > MAX_TRANSCRIPTION_BYTES)
    throw new Error('Word timestamps require audio smaller than 25 MB. The recording is kept.')
  const bytes = await fs.readFile(file),
    audioHash = hash(bytes)
  const cache = path.join(
    dir,
    '.cache',
    'timings',
    `${timingSignature(audioHash, entry.language, entry.speechText)}.json`,
  )
  const existing = request.force ? null : await jsonFile(cache).catch(() => null)
  const parsed = WordTimings.safeParse(existing)
  let data: WordTimings,
    cached = false
  const instructions = JSON.stringify({
    audioFile: audio.file,
    audioHash,
    language: entry.language,
    prompt: timingPrompt(entry.speechText),
    model: TIMESTAMP_MODEL,
  })
  if (parsed.success) {
    data = parsed.data
    cached = true
  } else {
    // For unknown/compressed duration, 8 kbit/s is a conservative allowance equivalent.
    const duration = await wavDuration(file).catch(() => undefined)
    const allowance = Math.max(
      entry.speechText.length,
      Math.ceil(((duration ?? bytes.length / 1000) / 60) * 1000),
    )
    data = await transcribeWords(
      bytes,
      path.basename(file),
      entry.language,
      entry.speechText,
      key,
      signal,
      transport,
      (n) => onAttempt(n, allowance),
    )
    signal.throwIfAborted()
    await store.exclusive('storage-admission', async () => {
      await store.capacity(owner, Buffer.byteLength(JSON.stringify(data)) + 65536)
      signal.throwIfAborted()
      await atomicJson(cache, data)
    })
  }
  signal.throwIfAborted()
  const updated = await store.saveTimings(owner, bookId, entry, slot, data, 'generated', signal)
  await log(cached ? 'cached' : 'done', JSON.stringify(data), instructions)
  return { entry: updated, cached }
}

export async function estimateTimestampCost(
  dir: string,
  entries: Entry[],
  request: RunRequest,
): Promise<SpeechCost> {
  const base = {
    sourceUrl: 'https://developers.openai.com/api/docs/models/whisper-1',
    ratesChecked: '2026-11-03',
  }
  let low = 0,
    high = 0,
    unknown = false
  for (const e of entries) {
    if (request.operation === 'timestamps') {
      const duration = await wavDuration(inside(dir, e.audios[request.slot]!.file)).catch(
        () => undefined,
      )
      if (duration === undefined) {
        unknown = true
        continue
      }
      low += Math.max(1, Math.ceil(duration))
      high += Math.max(1, Math.ceil(duration))
    } else {
      const n = request.settings.normalize
        ? Math.max(e.text.length, e.speechText.length)
        : e.speechText.length
      low += Math.max(1, Math.ceil((n * 60) / 1000))
      high += Math.max(2, Math.ceil((n * 60) / 600))
    }
  }
  return {
    ...base,
    ...(unknown ? {} : { lowUsd: (low * 0.006) / 60, highUsd: (high * 0.006) / 60 }),
    basis: `OpenAI Whisper: $0.006 per audio minute; seconds rounded up for this estimate. ${unknown ? 'Some recording durations are unavailable; check their playback duration before continuing.' : request.operation === 'timestamps' ? 'Based on measured WAV duration.' : 'Assumes 600–1,000 spoken characters/minute and short-clip pauses.'} Fresh transcription assumed; cached timings may reduce charges. Retries are extra.`,
  }
}
