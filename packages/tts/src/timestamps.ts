import path from 'node:path'
import { WordTimings } from '@speech/types'
import { hash } from '../../bundle/src/files.js'
import { request, boundedJson } from './provider.js'

export const TIMESTAMP_MODEL = 'whisper-1'
export const MAX_TRANSCRIPTION_BYTES = 25_000_000
export const TIMESTAMP_SHUTDOWN = '2027-02-26'
export function timingPrompt(text: string) {
  return text.trim().slice(-1000)
}
export function timingSignature(audioHash: string, language: string, text: string) {
  return hash(
    JSON.stringify(['word-timings-1', TIMESTAMP_MODEL, audioHash, language, timingPrompt(text)]),
  )
}
/** Port of Studio's Whisper word-timing contract; no audio is generated here. */
export async function transcribeWords(
  audio: Buffer,
  fileName: string,
  language: string,
  text: string,
  key: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
  onAttempt: (n: number) => Promise<void> = async () => {},
): Promise<WordTimings> {
  const ext = path.extname(fileName).toLowerCase()
  if (!['.wav', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.webm'].includes(ext))
    throw new Error(
      'Word timestamps require WAV, MP3, MP4, M4A or WebM audio. Upload a supported recording first.',
    )
  if (!audio.length || audio.length > MAX_TRANSCRIPTION_BYTES)
    throw new Error(
      'Word timestamps require a nonempty recording smaller than 25 MB. Shorten or replace this recording.',
    )
  const base = language.split(/[-_]/)[0].toLowerCase()
  const hint = /^[a-z]{2}$/.test(base) ? base : undefined
  let attempts = 0
  const post = async (withLanguage: boolean) => {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], {
        type: ext === '.wav' ? 'audio/wav' : 'application/octet-stream',
      }),
      `recording${ext}`,
    )
    form.append('model', TIMESTAMP_MODEL)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')
    if (withLanguage && hint) form.append('language', hint)
    form.append('prompt', timingPrompt(text))
    return request(
      'https://api.openai.com/v1/audio/transcriptions',
      { Authorization: `Bearer ${key}` },
      form,
      key,
      signal,
      transport,
      async () => onAttempt(++attempts),
    )
  }
  let response: Response
  try {
    response = await post(!!hint)
  } catch (error) {
    // Studio retries unsupported language hints (notably sq) using auto-detection.
    if (!hint || !(error instanceof Error) || !error.message.includes('HTTP 400')) throw error
    response = await post(false)
  }
  const payload = await boundedJson(response)
  const result = WordTimings.safeParse({
    text: payload.text ?? '',
    words: payload.words,
    duration: payload.duration,
  })
  if (!result.success)
    throw new Error(
      'OpenAI returned invalid or empty word timestamps. Your recording is unchanged; retry or review the audio.',
    )
  signal.throwIfAborted()
  return result.data
}
