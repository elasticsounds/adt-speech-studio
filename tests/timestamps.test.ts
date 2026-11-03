import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { it, expect, vi } from 'vitest'
import { transcribeWords, timingSignature } from '../packages/tts/src/timestamps.js'
import { wavDuration } from '../packages/bundle/src/audio.js'
import { WordTimings } from '@speech/types'
import { tone } from './fixture.js'

const payload = {
  text: 'Hello world',
  duration: 0.1,
  words: [
    { word: 'Hello', start: 0, end: 0.04 },
    { word: 'world', start: 0.04, end: 0.1 },
  ],
}
const key = 'private-test-key'
const signal = () => new AbortController().signal
it('uses OpenAI multipart word timestamps and retries Albanian without a language hint', async () => {
  const bodies: FormData[] = [],
    charges: number[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init!.headers).toEqual({ Authorization: `Bearer ${key}` })
    bodies.push(init!.body as FormData)
    return bodies.length === 1
      ? new Response('unsupported language', { status: 400 })
      : Response.json(payload)
  })
  const result = await transcribeWords(
    tone,
    'name.wav',
    'sq-AL',
    'Hello world',
    key,
    signal(),
    fetcher,
    async (n) => {
      charges.push(n)
    },
  )
  expect(result).toEqual(payload)
  expect(bodies[0].get('language')).toBe('sq')
  expect(bodies[1].get('language')).toBeNull()
  expect(bodies[1].get('model')).toBe('whisper-1')
  expect(bodies[1].get('timestamp_granularities[]')).toBe('word')
  expect(bodies[1].get('response_format')).toBe('verbose_json')
  expect(bodies[1].get('prompt')).toBe('Hello world')
  expect(charges).toEqual([1, 2])
})
it('rejects malformed times, unsupported audio and aborted work without publishing results', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ ...payload, words: [{ word: 'bad', start: 3, end: 1 }] }),
  )
  await expect(transcribeWords(tone, 'a.wav', 'en', '', key, signal(), fetcher)).rejects.toThrow(
    'invalid or empty',
  )
  fetcher.mockClear()
  await expect(transcribeWords(tone, 'a.ogg', 'en', '', key, signal(), fetcher)).rejects.toThrow(
    'require WAV',
  )
  await expect(
    transcribeWords(Buffer.alloc(25_000_001), 'a.wav', 'en', '', key, signal(), fetcher),
  ).rejects.toThrow('25 MB')
  const cancelled = new AbortController()
  cancelled.abort()
  await expect(
    transcribeWords(tone, 'a.wav', 'en', '', key, cancelled.signal, fetcher),
  ).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
  expect(
    WordTimings.safeParse({ ...payload, words: [payload.words[1], payload.words[0]] }).success,
  ).toBe(false)
})
it('redacts provider errors and does not retry rejected keys with another credential', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(key, { status: 401 }))
  await expect(transcribeWords(tone, 'a.wav', 'en', '', key, signal(), fetcher)).rejects.toThrow(
    'API key',
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('keys timing reuse to audio, language and the exact prompt', () => {
  const a = timingSignature('hash', 'en', 'hello')
  expect(timingSignature('hash', 'en', 'hello')).toBe(a)
  for (const args of [
    ['other', 'en', 'hello'],
    ['hash', 'sq', 'hello'],
    ['hash', 'en', 'changed'],
  ])
    expect(timingSignature(args[0], args[1], args[2])).not.toBe(a)
})
it('reads WAV duration without decoding audio and closes files on invalid headers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timing-wav-')),
    file = path.join(dir, 'a.wav')
  try {
    await fs.writeFile(file, tone)
    expect(await wavDuration(file)).toBeCloseTo(0.1)
    await fs.writeFile(file, 'not a wav')
    expect(await wavDuration(file)).toBeUndefined()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
