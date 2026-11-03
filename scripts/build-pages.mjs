import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
const test = process.argv.includes('--test')
const apiOrigin = test ? 'http://127.0.0.1:55023' : 'https://adt-speech-studio.fly.dev'
const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WEB_OUT_DIR: '../../dist/pages',
    VITE_BASE_PATH: '/adt-speech-studio/',
    VITE_API_ORIGIN: apiOrigin,
  },
})
if (result.status !== 0) process.exit(result.status ?? 1)
await fs.copyFile('dist/web/source.zip', 'dist/pages/source.zip')
await fs.writeFile('dist/pages/.nojekyll', '')
// Pages cannot set response headers; constrain the static frontend with a meta CSP.
const html = await fs.readFile('dist/pages/index.html', 'utf8')
const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${apiOrigin}; object-src 'none'; base-uri 'self'; form-action 'self'`
await fs.writeFile(
  'dist/pages/index.html',
  html.replace(
    '<head>',
    `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
  ),
)
