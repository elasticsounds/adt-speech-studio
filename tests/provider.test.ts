import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_SETTINGS } from '@speech/types'
import {
  synthesize,
  normalizeText,
  speechSignature,
  pcmToWav,
  validWav,
} from '../packages/tts/src/provider.js'
import { tone, normalizationPayload } from './fixture.js'

beforeEach(() => {
  process.env.PROVIDER_INTERVAL_MS = '0'
})
describe('Speech provider contracts', () => {
  it('wraps Gemini PCM once and sends the selected legacy model/voice and instructions', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/L16;rate=24000',
                    data: tone.subarray(44).toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    )
    const result = await synthesize(
      'Hello',
      { ...DEFAULT_SETTINGS, model: 'gemini-2.5-flash-preview-tts', instructions: 'Warm voice' },
      'secret',
      new AbortController().signal,
      fetcher,
    )
    expect(result).toEqual(tone)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('gemini-2.5-flash-preview-tts:generateContent')
    const request = JSON.parse(init.body as string)
    expect(request.contents[0].parts[0].text).toBe(
      '### PERFORMANCE\nWarm voice\n\n#### TRANSCRIPT\nHello',
    )
    expect(request.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Kore',
    )
  })
  it('uses Gemini 3.8 style metadata without speaking the instructions or double-wrapping WAV', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'audio', mime_type: 'audio/wav', data: tone.toString('base64') }],
          },
        ],
      }),
    )
    const result = await synthesize(
      'Hello',
      { ...DEFAULT_SETTINGS, model: 'gemini-3.8-flash-tts', instructions: 'Warm voice' },
      'secret',
      new AbortController().signal,
      fetcher,
    )
    expect(result).toEqual(tone)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/interactions$/)
    const part = JSON.parse(init.body as string).input[0].content[0]
    expect(part.text).toBe('Hello')
    expect(part.annotations[0].style).toBe('Warm voice')
  })
  it('never treats absent audio as a success and never changes model after failure', async () => {
    const fetcher = vi.fn(async () => Response.json({ candidates: [{ finishReason: 'OTHER' }] }))
    await expect(
      synthesize('Hello', DEFAULT_SETTINGS, 'secret', new AbortController().signal, fetcher),
    ).rejects.toThrow('no audio')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not expose a provider error that echoes the personal API key', async () => {
    const fetcher = vi.fn(async () => new Response('key secret leaked', { status: 403 }))
    await expect(
      synthesize('Hello', DEFAULT_SETTINGS, 'secret', new AbortController().signal, fetcher),
    ).rejects.toThrow('API key or access')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('normalizes text independently and retains full language guidance', async () => {
    const fetcher = vi.fn(async () => Response.json(normalizationPayload()))
    const output = await normalizeText(
      '12 flowers',
      'en',
      { ...DEFAULT_SETTINGS, profile: 'Preserve the meaning.' },
      'secret',
      new AbortController().signal,
      fetcher,
    )
    expect(output.text).toBe('Twelve flowers')
    expect(output.prompt).toContain('Preserve the meaning.')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' })
    expect(init.headers).not.toHaveProperty('x-goog-api-key')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-6-luna')
    expect(body.reasoning).toEqual({ effort: 'none' })
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(body.text.format.schema.additionalProperties).toBe(false)
  })
  it('uses the existing OpenAI speech contract with WAV output', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(tone)))
    await expect(
      synthesize(
        'Hello',
        { ...DEFAULT_SETTINGS, provider: 'openai', model: 'gpt-4o-mini-tts', voice: 'coral' },
        'secret',
        new AbortController().signal,
        fetcher,
      ),
    ).resolves.toEqual(tone)
    const body = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    )
    expect(body.response_format).toBe('wav')
    expect(body.voice).toBe('coral')
  })
  it('rejects incompatible settings before contacting a provider', async () => {
    const fetcher = vi.fn()
    await expect(
      synthesize(
        'Hello',
        { ...DEFAULT_SETTINGS, provider: 'openai', model: 'tts-1', instructions: 'Warm' },
        'secret',
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toThrow('does not support')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keys reuse on all effective speech inputs', () => {
    const key = speechSignature('Hello', DEFAULT_SETTINGS, 'en')
    for (const patch of [
      { voice: 'Puck' },
      { model: 'gemini-2.5-pro-preview-tts' },
      { instructions: 'Slow' },
      { temperature: 0.8 },
    ])
      expect(speechSignature('Hello', { ...DEFAULT_SETTINGS, ...patch }, 'en')).not.toBe(key)
    expect(speechSignature('Hello', DEFAULT_SETTINGS, 'es')).not.toBe(key)
    expect(speechSignature('Hello again', DEFAULT_SETTINGS, 'en')).not.toBe(key)
  })
  it('finalizes streaming WAV length markers without changing the audio', () => {
    const streamed = Buffer.from(tone)
    streamed.writeUInt32LE(0xffffffff, 4)
    streamed.writeUInt32LE(0xffffffff, 40)
    expect(validWav(streamed)).toEqual(tone)
    expect(() => validWav(streamed.subarray(0, -1))).toThrow('incomplete WAV samples')
  })
  it('rejects empty, truncated and malformed audio', () => {
    expect(() => validWav(Buffer.alloc(50))).toThrow()
    expect(() => validWav(tone.subarray(0, -1))).toThrow()
    expect(() => pcmToWav(Buffer.alloc(1))).toThrow()
  })
  it('honors cancellation before contacting the provider', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn()
    await expect(
      synthesize('Hello', DEFAULT_SETTINGS, 'secret', controller.signal, fetcher),
    ).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

it.each([
  { status: 'incomplete', output: normalizationPayload().output },
  {
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'Cannot comply' }],
      },
    ],
  },
  normalizationPayload(null, 'Cannot preserve meaning'),
  normalizationPayload('<math>x</math>'),
  { status: 'completed', output: [] },
])('rejects unusable OpenAI normalization output', async (payload) => {
  await expect(
    normalizeText(
      '12 flowers',
      'en',
      DEFAULT_SETTINGS,
      'secret',
      new AbortController().signal,
      async () => Response.json(payload),
    ),
  ).rejects.toThrow()
})

it('keeps explicitly pinned alternative OpenAI models compatible', async () => {
  const fetcher = vi.fn(async () => Response.json(normalizationPayload()))
  await normalizeText(
    '12 flowers',
    'en',
    { ...DEFAULT_SETTINGS, normalizationModel: 'gpt-4.1-mini-2025-04-14' },
    'secret',
    new AbortController().signal,
    fetcher,
  )
  const body = JSON.parse(
    (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
  )
  expect(body.model).toBe('gpt-4.1-mini-2025-04-14')
  expect(body).not.toHaveProperty('reasoning')
})
