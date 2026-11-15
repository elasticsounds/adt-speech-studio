import { hash } from '../../bundle/src/files.js'

export function boundedSetting(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name] ?? fallback)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** FIFO per credential/endpoint. A permit covers the entire response body. */
export class ProviderPool {
  private active = 0
  private limit: number
  private successes = 0
  private pausedUntil = 0
  private nextStart = 0
  private lastCut = -Infinity
  private timer?: ReturnType<typeof setTimeout>
  private queue: Array<{ grant: () => void; signal: AbortSignal }> = []
  touched = Date.now()
  constructor(
    private maximum: number,
    private interval = 0,
  ) {
    this.limit = maximum
  }
  get idle() {
    return this.active === 0 && this.queue.length === 0
  }
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.queue = this.queue.filter((q) => q !== item)
        reject(signal.reason)
        this.drain()
      }
      const item = {
        signal,
        grant: () => {
          signal.removeEventListener('abort', abort)
          this.active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            this.active--
            this.drain()
          })
        },
      }
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(item)
      this.drain()
    })
  }
  private drain() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.touched = Date.now()
    while (this.active < this.limit && this.queue.length) {
      const wait = Math.max(this.pausedUntil, this.nextStart) - Date.now()
      if (wait > 0) {
        this.timer = setTimeout(() => this.drain(), wait)
        return
      }
      this.nextStart = Date.now() + this.interval
      this.queue.shift()!.grant()
    }
  }
  limited(milliseconds: number) {
    const now = Date.now()
    if (now - this.lastCut >= 3000) {
      this.limit = Math.max(1, Math.floor(this.limit / 2))
      this.lastCut = now
    }
    this.successes = 0
    this.pausedUntil = Math.max(this.pausedUntil, now + milliseconds)
    this.drain()
  }
  succeeded() {
    if (++this.successes >= 8 && Date.now() >= this.pausedUntil) {
      this.limit = Math.min(this.maximum, this.limit + 1)
      this.successes = 0
      this.drain()
    }
  }
}

const pools = new Map<string, ProviderPool>()
export function providerPool(key: string, url: string) {
  // Never retain credentials; callers still supply their own key for each request.
  const id = hash(JSON.stringify([key, url]))
  for (const [k, pool] of pools)
    if (pool.idle && Date.now() - pool.touched > 600000) pools.delete(k)
  let pool = pools.get(id)
  if (!pool) {
    pool = new ProviderPool(
      boundedSetting('PROVIDER_CONCURRENCY', 4, 1, 8),
      boundedSetting('PROVIDER_INTERVAL_MS', 0, 0, 60000),
    )
    pools.set(id, pool)
  }
  return pool
}
