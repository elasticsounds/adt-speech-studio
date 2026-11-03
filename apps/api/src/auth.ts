import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { Account, Session, type PublicUser } from '@speech/types'
import { atomicJson, exists, hash, jsonFile } from '../../../packages/bundle/src/files.js'

const derive = promisify(scrypt)
export class Auth {
  private attempts = new Map<string, { count: number; until: number }>()
  private accountLocks = new Map<string, Promise<void>>()
  constructor(readonly root: string) {}
  private async withAccount<T>(username: string, fn: () => Promise<T>): Promise<T> {
    const before = this.accountLocks.get(username) ?? Promise.resolve()
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    this.accountLocks.set(username, hold)
    await before
    try {
      return await fn()
    } finally {
      release()
      if (this.accountLocks.get(username) === hold) this.accountLocks.delete(username)
    }
  }
  throttle(key: string, max = 10) {
    const now = Date.now(),
      old = this.attempts.get(key)
    if (!old || old.until < now) this.attempts.set(key, { count: 1, until: now + 15 * 60 * 1000 })
    else if (++old.count > max)
      throw new Error('Too many attempts. Please try again in 15 minutes.')
    if (this.attempts.size > 10000)
      for (const [k, v] of this.attempts) if (v.until < now) this.attempts.delete(k)
  }
  private file(username: string) {
    return path.join(this.root, 'accounts', `${hash(username)}.json`)
  }
  private async password(password: string, salt: string) {
    return (await derive(password, salt, 64)) as Buffer
  }
  async register(username: string, password: string) {
    const dir = path.join(this.root, 'accounts')
    await fs.mkdir(dir, { recursive: true })
    if ((await fs.readdir(dir)).length >= Number(process.env.MAX_ACCOUNTS ?? 1000))
      throw new Error('This server has reached its account capacity.')
    const salt = randomBytes(24).toString('hex'),
      recoveryCode = randomBytes(24).toString('base64url')
    const account: Account = {
      id: randomUUID(),
      username,
      salt,
      passwordHash: (await this.password(password, salt)).toString('hex'),
      recoveryHash: hash(recoveryCode),
      createdAt: new Date().toISOString(),
    }
    try {
      await fs.writeFile(this.file(username), JSON.stringify(account), { flag: 'wx', mode: 0o600 })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('That username is already taken.')
      throw e
    }
    return {
      user: { id: account.id, username },
      recoveryCode,
      token: await this.createSession(account.id),
    }
  }
  async login(username: string, password: string) {
    return this.withAccount(username, () => this.loginAccount(username, password))
  }
  private async loginAccount(username: string, password: string) {
    let account: Account | undefined
    try {
      account = Account.parse(await jsonFile(this.file(username)))
    } catch {}
    const actual = await this.password(password, account?.salt ?? 'invalid-account-constant-salt')
    if (!account || !timingSafeEqual(actual, Buffer.from(account.passwordHash, 'hex')))
      throw new Error('Incorrect username or password.')
    return {
      user: { id: account.id, username: account.username },
      token: await this.createSession(account.id),
    }
  }
  async recover(username: string, password: string, code: string) {
    return this.withAccount(username, () => this.recoverAccount(username, password, code))
  }
  private async recoverAccount(username: string, password: string, code: string) {
    let account: Account
    try {
      account = Account.parse(await jsonFile(this.file(username)))
    } catch {
      throw new Error('Incorrect username or recovery code.')
    }
    if (!timingSafeEqual(Buffer.from(hash(code)), Buffer.from(account.recoveryHash)))
      throw new Error('Incorrect username or recovery code.')
    const salt = randomBytes(24).toString('hex'),
      recoveryCode = randomBytes(24).toString('base64url')
    await atomicJson(this.file(username), {
      ...account,
      salt,
      passwordHash: (await this.password(password, salt)).toString('hex'),
      recoveryHash: hash(recoveryCode),
    })
    const sessions = path.join(this.root, 'sessions')
    for (const f of await fs.readdir(sessions).catch(() => [])) {
      if (!f.endsWith('.json')) continue
      try {
        const session = await jsonFile<Session>(path.join(sessions, f))
        if (session.userId === account.id) await fs.rm(path.join(sessions, f), { force: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    return {
      user: { id: account.id, username },
      recoveryCode,
      token: await this.createSession(account.id),
    }
  }
  async createSession(userId: string) {
    const token = randomBytes(32).toString('base64url')
    await atomicJson(path.join(this.root, 'sessions', `${hash(token)}.json`), {
      userId,
      hash: hash(token),
      expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    } satisfies Session)
    return token
  }
  async user(token: string | undefined): Promise<PublicUser | null> {
    if (!token || token.length > 100) return null
    const file = path.join(this.root, 'sessions', `${hash(token)}.json`)
    if (!(await exists(file))) return null
    const session = Session.parse(await jsonFile(file))
    if (session.expiresAt < Date.now()) {
      await fs.rm(file)
      return null
    }
    for (const name of await fs.readdir(path.join(this.root, 'accounts'))) {
      const user = Account.parse(await jsonFile(path.join(this.root, 'accounts', name)))
      if (user.id === session.userId) return { id: user.id, username: user.username }
    }
    return null
  }
  async logout(token: string | undefined) {
    if (token) await fs.rm(path.join(this.root, 'sessions', `${hash(token)}.json`), { force: true })
  }
}
