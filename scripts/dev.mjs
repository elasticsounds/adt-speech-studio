import { spawn } from 'node:child_process'
const children = [
  spawn('pnpm', ['exec', 'tsx', 'watch', 'apps/api/src/server.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: process.env.API_PORT ?? '55021' },
  }),
  spawn('pnpm', ['exec', 'vite'], { stdio: 'inherit' }),
]
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const child of children) child.kill(signal)
  })
for (const child of children)
  child.on('exit', (code) => {
    if (code) for (const other of children) other.kill()
  })
