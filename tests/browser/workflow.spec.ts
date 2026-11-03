import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { makeFixture } from '../fixture.js'
import { extractArchive } from '../../packages/bundle/src/archive.js'
import { jsonFile } from '../../packages/bundle/src/files.js'

test('sign up, import, inspect, edit, generate missing, change voice and download a working overlay', async ({
  page,
}) => {
  let startedJobs = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/jobs')) startedJobs++
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-e2e-')),
    fixture = await makeFixture(path.join(tmp, 'plants.zip'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Username', { exact: true }).fill(`reader_${Date.now()}`)
  await page.getByLabel('Password', { exact: true }).fill('a-strong-e2e-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Keep your recovery code')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to my ADTs' }).click()
  await page.getByLabel('Upload ADT ZIP').setInputFiles(fixture)
  await expect(page.getByRole('heading', { name: 'The little world of plants' })).toBeVisible()
  await page.getByRole('button', { name: 'AI connection' }).click()
  await page.getByLabel('Google / Gemini API key', { exact: true }).fill('browser-test-key')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gemini-3.8-flash-lite-tts')
  await page.getByLabel('Voice', { exact: true }).fill('Puck')
  await page.getByLabel('Language', { exact: true }).selectOption('es')
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('Kore')
  await page.getByLabel('Voice', { exact: true }).fill('Charon')
  await page.getByLabel('Language', { exact: true }).selectOption('en')
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('Puck')
  for (const selected of [false, true]) {
    if (selected) await page.getByLabel('Select pg001_p', { exact: true }).check()
    await page
      .getByRole('button', {
        name: selected ? 'Generate selected' : 'Generate pg001_p',
        exact: true,
      })
      .click()
    await expect(page.getByRole('dialog')).toContainText('1 entries')
    await expect(page.getByRole('dialog')).toContainText('Estimated TTS cost (USD)')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    if (selected) await page.getByLabel('Select pg001_p', { exact: true }).uncheck()
  }
  expect(startedJobs).toBe(0)
  await page.getByRole('button', { name: 'Edit pg002_n', exact: true }).click()
  await page
    .getByLabel('Spoken text', { exact: true })
    .fill('Our garden has twelve beautiful flowers.')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Our garden has twelve beautiful flowers.')).toBeVisible()
  await page.getByRole('button', { name: 'Generate missing', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('5 entries')
  await expect(dialog).toContainText('Model: gemini-3.8-flash-lite-tts')
  await expect(dialog).toContainText('Voice: Puck')
  await expect(dialog).toContainText('Estimated TTS cost (USD)')
  await expect(dialog).toContainText(/\$0\.\d+/)
  await expect(dialog).toContainText('Are you sure you want to generate')
  await expect(dialog).toContainText('incur charges on your API key')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(startedJobs).toBe(0)
  await page.getByRole('button', { name: 'Generate missing', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm paid generation', exact: true }).click()
  await expect(page.getByText('Generation finished', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play pg001_p', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play pg001_p', exact: true }).click()
  await page.getByLabel('Voice', { exact: true }).fill('Zephyr')
  await page.getByRole('button', { name: 'Regenerate all', exact: true }).click()
  await expect(dialog).toContainText('Voice: Zephyr')
  await expect(dialog).toContainText('Are you sure you want to regenerate')
  await page.getByLabel('Apply to all 2 languages').check()
  await expect(page.getByRole('dialog')).toContainText('12 entries')
  await expect(dialog).not.toContainText('Estimate unavailable')
  await page.getByRole('button', { name: 'Confirm paid generation', exact: true }).click()
  await expect(page.getByText('12 of 12', { exact: false })).toBeVisible()
  await page.getByLabel('Language', { exact: true }).selectOption('es')
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('Zephyr')
  await page.getByLabel('Language', { exact: true }).selectOption('en')
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('Zephyr')
  await page.getByRole('button', { name: 'Language strings', exact: true }).click()
  await page.getByLabel('Search strings').fill('sunlight')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await page.getByLabel('Search strings').fill('')
  await page.getByRole('button', { name: 'Speech', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ADT', exact: true }).click()
  const download = await downloadEvent,
    target = path.join(tmp, 'updated.zip')
  await download.saveAs(target)
  await extractArchive(target, path.join(tmp, 'updated'))
  const en = await jsonFile<Record<string, string>>(
    path.join(tmp, 'updated/content/i18n/en/audios.json'),
  )
  const es = await jsonFile<Record<string, string>>(
    path.join(tmp, 'updated/content/i18n/es/audios.json'),
  )
  expect(Object.keys(en)).toHaveLength(6)
  expect(Object.keys(es)).toHaveLength(6)
  expect(
    await fs.readFile(path.join(tmp, 'updated/content/i18n/en/audio', en.pg001_p)),
  ).toHaveLength(4844)
  expect(await fs.readFile(path.join(tmp, 'updated/pg001_sec001.html'), 'utf8')).toContain(
    'data-activity-id="act1"',
  )
  await page.screenshot({ path: '../speech-studio-workspace.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await expect(page.getByRole('button', { name: 'Download ADT', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI connection', exact: true })).toBeVisible()
  expect(errors).toEqual([])
  await fs.rm(tmp, { recursive: true, force: true })
})

test('mobile sign-in remains usable and does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})
