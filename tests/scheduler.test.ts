import { afterEach, expect, it, vi } from 'vitest'
import { ProviderPool } from '../packages/tts/src/scheduler.js'
import { synthesize } from '../packages/tts/src/provider.js'
import { DEFAULT_SETTINGS } from '@speech/types'
import { tone } from './fixture.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
const signal = () => new AbortController().signal
const payload = () =>
  Response.json({
    steps: [
      {
        type: 'model_output',
        content: [{ type: 'audio', data: tone.toString('base64'), mime_type: 'audio/wav' }],
      },
    ],
  })

it('AC-2: queues fairly and removes aborted waiters without leaking capacity', async () => {
  const pool = new ProviderPool(1)
  const release = await pool.acquire(signal())
  const cancelled = new AbortController()
  const waiting = pool.acquire(cancelled.signal)
  const rejected = expect(waiting).rejects.toThrow('cancelled')
  const order: number[] = []
  const two = pool.acquire(signal()).then((done) => {
    order.push(2)
    return done
  })
  const three = pool.acquire(signal()).then((done) => {
    order.push(3)
    return done
  })
  cancelled.abort(new Error('cancelled'))
  await rejected
  release()
  release()
  ;(await two)()
  ;(await three)()
  expect(order).toEqual([2, 3])
  expect(pool.idle).toBe(true)
})

it('AC-2: pauses the whole pool after rate limits and recovers concurrency gradually', async () => {
  vi.useFakeTimers()
  const pool = new ProviderPool(4)
  pool.limited(1000)
  const releases: Array<() => void> = []
  const pending = Array.from({ length: 4 }, () =>
    pool.acquire(signal()).then((done) => {
      releases.push(done)
    }),
  )
  await vi.advanceTimersByTimeAsync(999)
  expect(releases).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  expect(releases).toHaveLength(2)
  for (let i = 0; i < 8; i++) pool.succeeded()
  await Promise.resolve()
  expect(releases).toHaveLength(3)
  releases[0]()
  await Promise.all(pending)
  releases.forEach((done) => done())
  expect(pool.idle).toBe(true)
})

it('AC-2: honors optional request spacing without delaying the first request', async () => {
  vi.useFakeTimers()
  const pool = new ProviderPool(2, 1000)
  const release = await pool.acquire(signal())
  let started = false
  const next = pool.acquire(signal()).then((done) => {
    started = true
    return done
  })
  await vi.advanceTimersByTimeAsync(999)
  expect(started).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  ;(await next)()
  release()
})

it('AC-2: holds a provider slot through body download, isolates keys and aborts queued calls', async () => {
  vi.stubEnv('PROVIDER_CONCURRENCY', '1')
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            stream = c
          },
        }),
      ),
  )
  const first = synthesize('First', DEFAULT_SETTINGS, 'body-test', signal(), fetcher)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  const cancel = new AbortController()
  const second = synthesize('Second', DEFAULT_SETTINGS, 'body-test', cancel.signal, fetcher)
  const rejected = expect(second).rejects.toThrow('cancelled')
  const other = vi.fn<typeof fetch>(async () => payload())
  await expect(
    synthesize('Other', DEFAULT_SETTINGS, 'different-key', signal(), other),
  ).resolves.toEqual(tone)
  expect(fetcher).toHaveBeenCalledTimes(1)
  cancel.abort(new Error('cancelled'))
  await rejected
  stream.enqueue(new TextEncoder().encode(await payload().text()))
  stream.close()
  await expect(first).resolves.toEqual(tone)
  await expect(
    synthesize('After', DEFAULT_SETTINGS, 'body-test', signal(), other),
  ).resolves.toEqual(tone)
})

it('AC-2: releases failed body and allowance permits so later requests can run', async () => {
  vi.stubEnv('PROVIDER_CONCURRENCY', '1')
  const fail = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('body failed'))
          },
        }),
      ),
  )
  await expect(synthesize('A', DEFAULT_SETTINGS, 'failure-test', signal(), fail)).rejects.toThrow(
    'body failed',
  )
  const good = vi.fn<typeof fetch>(async () => payload())
  await expect(
    synthesize('B', DEFAULT_SETTINGS, 'failure-test', signal(), good, async () => {
      throw new Error('allowance')
    }),
  ).rejects.toThrow('allowance')
  expect(good).not.toHaveBeenCalled()
  await expect(synthesize('C', DEFAULT_SETTINGS, 'failure-test', signal(), good)).resolves.toEqual(
    tone,
  )
})
