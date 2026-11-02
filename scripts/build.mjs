import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
await build({
  entryPoints: ['apps/api/src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  outfile: 'dist/api/server.mjs',
})
// Offer the deployed application's corresponding source, excluding secrets/data.
const allowed = [
  'apps',
  'packages',
  'scripts',
  'config',
  'docs',
  'tests',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'playwright.config.ts',
  'LICENSE',
  'NOTICE',
  'README.md',
  'Dockerfile',
  'fly.toml',
  '.env.example',
  '.gitignore',
  '.dockerignore',
  '.prettierrc.json',
  '.prettierignore',
  '.github',
]
const zip = new yazl.ZipFile(),
  output = pipeline(zip.outputStream, createWriteStream('dist/web/source.zip'))
async function add(name) {
  let stat
  try {
    stat = await fs.lstat(name)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const child of await fs.readdir(name)) await add(path.join(name, child))
  } else zip.addFile(name, `adt-speech-studio/${name}`)
}
for (const name of allowed) await add(name)
zip.end()
await output
