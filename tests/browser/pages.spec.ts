import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeFixture } from '../fixture.js'

test('GitHub Pages layout uses first-party sign-in and bearer-only upload, audio and downloads', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-pages-')),
    fixture = await makeFixture(path.join(root, 'book.zip'))
  await page.goto('http://localhost:55024/adt-speech-studio/')
  await expect(page.getByRole('button', { name: 'Sign in or create an account' })).toBeVisible()
  expect(await page.locator('input[type=password]').count()).toBe(0)
  const opened = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Sign in or create an account' }).click()
  const popup = await opened
  await popup.getByRole('button', { name: 'Create an account' }).click()
  await popup.getByLabel('Username', { exact: true }).fill(`pages_${Date.now()}`)
  await popup.getByLabel('Password', { exact: true }).fill('a-strong-pages-password')
  await popup.getByRole('button', { name: 'Create account', exact: true }).click()
  await popup.getByRole('button', { name: 'Continue to my ADTs' }).click()
  await popup.getByRole('button', { name: 'Continue to GitHub workspace' }).click()
  await expect(page.getByLabel('Upload ADT ZIP')).toBeAttached()
  // Remove all backend cookies: the GitHub frontend must work independently.
  await context.clearCookies()
  await page.getByLabel('Upload ADT ZIP').setInputFiles(fixture)
  await expect(page.getByRole('heading', { name: 'The little world of plants' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'The little world of plants' })).toBeVisible()
  const audioRequest = page.waitForRequest((r) => r.url().includes('/audio?'))
  await page.getByRole('button', { name: 'Play pg001_h', exact: true }).click()
  expect((await audioRequest).headers().authorization).toMatch(/^Bearer /)
  const waveformRequest = page.waitForRequest((r) => r.url().includes('/audio?'))
  await page.getByRole('button', { name: 'Waveform pg001_h', exact: true }).click()
  expect((await waveformRequest).headers().authorization).toMatch(/^Bearer /)
  await expect(page.getByRole('img', { name: 'Audio waveform' })).toBeVisible()
  await page.getByRole('button', { name: 'Seek to word 1: A', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Seek to word 1: A', exact: true }),
  ).toHaveAttribute('aria-current', 'true')
  await page.getByLabel('Word end (seconds)').fill('0.08')
  await page.getByRole('button', { name: 'Save word timing' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Waveform pg001_h', exact: true }).click()
  await expect(page.getByText(/Timed transcript.*manual/)).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: 'AI connection' }).click()
  await page.getByLabel('Google / Gemini API key', { exact: true }).fill('pages-test-key')
  await page.getByLabel('OpenAI API key', { exact: true }).fill('pages-openai-key')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select pg002_n', exact: true }).check()
  await page.getByRole('button', { name: 'Normalize', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('gpt-6-luna')
  await page.getByRole('button', { name: 'Start normalization', exact: true }).click()
  await expect(page.getByText('Generation finished', { exact: true })).toBeVisible()
  await expect(page.getByText('gpt-6-luna · en', { exact: true })).toBeVisible()
  await page.getByLabel('Normalize before speech', { exact: true }).check()
  await page.getByLabel('Word-by-word highlighting', { exact: true }).check()
  await page.getByRole('button', { name: 'Generate missing', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Estimated word-timestamp cost (USD)')
  await expect(page.getByRole('dialog')).toContainText('Word timestamps: whisper-1')
  await page.getByRole('button', { name: 'Confirm paid generation', exact: true }).click()
  // Wait for the new speech job, not the previous normalization completion.
  await expect(page.getByText('gemini-3.8-flash-tts · Kore · en', { exact: true })).toBeVisible()
  await expect(page.getByText('Generation finished', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Waveform pg001_p', exact: true }).click()
  await expect(page.getByText(/Timed transcript.*generated/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Seek to word 2: plant', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ADT', exact: true }).click()
  await (await download).saveAs(path.join(root, 'updated.zip'))
  expect((await fs.stat(path.join(root, 'updated.zip'))).size).toBeGreaterThan(1000)
  const original = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download original ADT' }).click()
  expect((await original).suggestedFilename()).toBe('original-adt.zip')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in or create an account' })).toBeVisible()
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((k) => k.startsWith('adt-session:')),
    ),
  ).toHaveLength(0)
  expect(errors).toEqual([])
  await fs.rm(root, { recursive: true, force: true })
})
