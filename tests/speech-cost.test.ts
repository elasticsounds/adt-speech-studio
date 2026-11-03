import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS, Entry, GEMINI_MODELS, Settings } from '@speech/types'
import { estimateSpeechCost } from '../apps/api/src/speech-cost.js'

const entry = (characters = 1000) =>
  Entry.parse({
    id: 'text',
    language: 'en',
    text: 'x'.repeat(characters),
    speechText: 'x'.repeat(characters),
    category: 'text',
    version: 1,
    audios: {},
  })
const date = new Date('2026-12-31T23:59:59Z')

it('defaults new settings and provider switching to Lite without replacing explicit models', () => {
  expect(Settings.parse({}).model).toBe('gemini-3.8-flash-lite-tts')
  expect(GEMINI_MODELS[0]).toBe(DEFAULT_SETTINGS.model)
  expect(Settings.parse({ model: 'gemini-3.8-flash-tts' }).model).toBe('gemini-3.8-flash-tts')
})

it.each([
  ['gemini-3.8-flash-lite-tts', 0.00913, 0.01526],
  ['gemini-3.8-flash-tts', 0.01363, 0.02276],
  ['gemini-3.1-flash-tts-preview', 0.03026, 0.05052],
  ['gemini-2.5-flash-preview-tts', 0.01513, 0.02526],
  ['gemini-2.5-pro-preview-tts', 0.03026, 0.05052],
])('estimates %s using standard paid text and audio rates', (model, low, high) => {
  const cost = estimateSpeechCost([entry()], { ...DEFAULT_SETTINGS, model }, false, date)
  expect(cost.lowUsd).toBeCloseTo(low, 8)
  expect(cost.highUsd).toBeCloseTo(high, 8)
})

it('uses the announced Gemini rates after the promotion ends at midnight UTC', () => {
  for (const model of GEMINI_MODELS.slice(0, 2)) {
    const settings = { ...DEFAULT_SETTINGS, model }
    const before = estimateSpeechCost([entry()], settings, false, date)
    const after = estimateSpeechCost([entry()], settings, false, new Date('2027-01-01T00:00:00Z'))
    expect(after.lowUsd).toBe(before.lowUsd! * 2)
    expect(after.highUsd).toBe(before.highUsd! * 2)
    expect(after.basis).not.toContain('Promotional')
  }
})

it('includes repeated instructions, per-clip pauses, and text awaiting normalization', () => {
  const base = estimateSpeechCost([entry()], DEFAULT_SETTINGS, false, date)
  const styled = estimateSpeechCost(
    [entry()],
    { ...DEFAULT_SETTINGS, instructions: 'x'.repeat(4000) },
    false,
    date,
  )
  expect(styled.lowUsd).toBeGreaterThan(base.lowUsd!)
  const short = estimateSpeechCost([entry(1), entry(1)], DEFAULT_SETTINGS, false, date)
  expect(short.highUsd).toBeGreaterThan(0.0006)
  const pending = { ...entry(), speechText: '' }
  expect(
    estimateSpeechCost([pending], { ...DEFAULT_SETTINGS, normalize: true }, false, date),
  ).toEqual(base)
  const manual = { ...pending, speechText: 'x', manualSpeech: true }
  const settings = { ...DEFAULT_SETTINGS, normalize: true }
  expect(estimateSpeechCost([manual], settings, false, date).highUsd).toBeLessThan(base.highUsd!)
  expect(estimateSpeechCost([manual], settings, true, date)).toEqual(base)
  expect(estimateSpeechCost([], DEFAULT_SETTINGS, false, date).highUsd).toBe(0)
})

it.each([
  ['tts-1', 0.015],
  ['tts-1-hd', 0.03],
])('uses character pricing for %s', (model, usd) => {
  const cost = estimateSpeechCost(
    [entry()],
    { ...DEFAULT_SETTINGS, provider: 'openai', model: String(model) },
    false,
    date,
  )
  expect(cost.lowUsd).toBe(usd)
  expect(cost.highUsd).toBe(usd)
})

it('never displays an unknown or unconvertible rate as free', () => {
  const unknown = estimateSpeechCost(
    [entry()],
    { ...DEFAULT_SETTINGS, model: 'future-model' },
    false,
    date,
  )
  expect(unknown.lowUsd).toBeUndefined()
  expect(unknown.highUsd).toBeUndefined()
  const mini = estimateSpeechCost(
    [entry()],
    { ...DEFAULT_SETTINGS, provider: 'openai', model: 'gpt-4o-mini-tts' },
    false,
    date,
  )
  expect(mini.lowUsd).toBeUndefined()
  expect(mini.basis).toContain('$12 per million audio tokens')
})
