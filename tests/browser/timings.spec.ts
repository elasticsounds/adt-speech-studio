import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fixtureFiles, tone } from '../fixture.js'
import { zipFiles, extractArchive } from '../../packages/bundle/src/archive.js'
import { pcmToWav } from '../../packages/tts/src/provider.js'

test('timestamp-only confirmation, word playback, seeking and exported reader timings', async ({
  page,
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-timings-'))
  const audio = pcmToWav(Buffer.concat(Array.from({ length: 20 }, () => tone.subarray(44))))
  const files = fixtureFiles().filter((f) => !f.name.includes('/timecode/'))
  files.find((f) => f.name.endsWith('audio/original.wav'))!.data = audio
  const fixture = path.join(root, 'book.zip')
  await zipFiles(fixture, files)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Username', { exact: true }).fill(`timings_${Date.now()}`)
  await page.getByLabel('Password', { exact: true }).fill('a-strong-timing-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByRole('button', { name: 'Continue to my ADTs' }).click()
  await page.getByLabel('Upload ADT ZIP').setInputFiles(fixture)
  await expect(page.getByRole('heading', { name: 'The little world of plants' })).toBeVisible()
  await page.getByRole('button', { name: 'AI connection' }).click()
  await page.getByLabel('OpenAI API key', { exact: true }).fill('pages-openai-key')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // No Gemini key is needed, even with normalization toggled in unsaved speech settings.
  await page.getByLabel('Voice', { exact: true }).fill('Puck')
  await page.getByLabel('Normalize before speech', { exact: true }).check()
  let posted = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/jobs')) posted++
  })
  await page.getByRole('button', { name: 'Generate missing timestamps', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1 entries')
  await expect(dialog).toContainText('Model: whisper-1')
  await expect(dialog).toContainText('Estimated word-timestamp cost (USD)')
  await expect(dialog).not.toContainText('Estimated TTS cost (USD)')
  await expect(dialog).not.toContainText('OpenAI normalization (')
  await expect(dialog).toContainText('$0.0002')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(posted).toBe(0)
  await page.getByRole('button', { name: 'Waveform pg001_h', exact: true }).click()
  await expect(dialog).toContainText('No current word timestamps')
  await page.getByRole('button', { name: 'Generate word timestamps', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm paid timestamp generation', exact: true }).click()
  await expect(page.getByText('Generation finished', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('Puck')
  await page.getByRole('button', { name: 'Waveform pg001_h', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Audio waveform' })).toBeVisible()
  const first = page.getByRole('button', { name: 'Seek to word 1: Every', exact: true })
  const second = page.getByRole('button', { name: 'Seek to word 2: plant', exact: true })
  await expect(first).toHaveAttribute('aria-current', 'true')
  await page.getByLabel('Playback speed', { exact: true }).selectOption('0.5')
  await page.getByRole('button', { name: 'Play recording', exact: true }).click()
  await expect(second).toHaveAttribute('aria-current', 'true', { timeout: 4000 })
  await page.getByRole('button', { name: 'Pause recording', exact: true }).click()
  await second.click()
  await expect(second).toHaveAttribute('aria-current', 'true')
  await first.click()
  await expect(first).toHaveAttribute('aria-current', 'true')
  await page.getByLabel('Highlight each word during playback').uncheck()
  await expect(first).not.toHaveAttribute('aria-current')
  await page.getByLabel('Seek recording', { exact: true }).fill('1.25')
  await page.getByLabel('Highlight each word during playback').check()
  await expect(second).toHaveAttribute('aria-current', 'true')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ADT', exact: true }).click()
  const target = path.join(root, 'export.zip'),
    out = path.join(root, 'export')
  await (await download).saveAs(target)
  await extractArchive(target, out)
  expect(await fs.readFile(path.join(out, 'content/i18n/en/audio/original.wav'))).toEqual(audio)
  const map = JSON.parse(
    await fs.readFile(path.join(out, 'content/i18n/en/timecode/timecode_output.json'), 'utf8'),
  )
  expect(map.pg001_h.timecodes[1].word_timestamps[1]).toEqual({ text: 'plant', start: 1, end: 2 })
  expect(errors).toEqual([])
  await fs.rm(root, { recursive: true, force: true })
})
