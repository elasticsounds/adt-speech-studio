import fs from 'node:fs/promises'
const data = process.env.DATA_DIR ?? '/data'
await fs.mkdir(data, { recursive: true })
// Fly mounts volumes as root. Adjust only the mount root, then run as node.
if (process.getuid?.() === 0) {
  await fs.chown(data, 1000, 1000)
  process.setgid(1000)
  process.setuid(1000)
}
await import('../dist/api/server.mjs')
