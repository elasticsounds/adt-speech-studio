import { GEMINI_MODELS, type Entry, type Settings, type SpeechCost } from '@speech/types'

// Standard paid rates, not Batch/Flex or account-specific credits. Keep sources in the UI.
export function estimateSpeechCost(
  entries: Entry[],
  settings: Settings,
  replaceManual: boolean,
  now = new Date(),
): SpeechCost {
  const sourceUrl =
    settings.provider === 'gemini'
      ? 'https://ai.google.dev/gemini-api/docs/pricing'
      : 'https://developers.openai.com/api/docs/pricing'
  const base = { sourceUrl, ratesChecked: '2026-11-03' }
  const lengths = entries.map((e) =>
    settings.normalize && (!e.manualSpeech || replaceManual)
      ? Math.max(e.text.trim().length, e.speechText.trim().length)
      : e.speechText.trim().length,
  )
  const characters = lengths.reduce((sum, n) => sum + n, 0)
  if (settings.provider === 'openai') {
    const rate = settings.model === 'tts-1' ? 15 : settings.model === 'tts-1-hd' ? 30 : undefined
    if (rate !== undefined) {
      const usd = (characters * rate) / 1e6
      return {
        ...base,
        lowUsd: usd,
        highUsd: usd,
        basis: `$${rate} per million spoken characters.`,
      }
    }
    return {
      ...base,
      basis:
        settings.model === 'gpt-4o-mini-tts'
          ? 'Published rates: $0.60 per million input tokens and $12 per million audio tokens. Audio token usage cannot be reliably predicted here.'
          : 'No verified price is configured for this model. Check the provider pricing before continuing.',
    }
  }
  if (!GEMINI_MODELS.includes(settings.model))
    return { ...base, basis: 'No verified price is configured for this model.' }
  const promotional = now.getTime() < Date.parse('2027-01-01T00:00:00Z')
  const modern = settings.model.startsWith('gemini-3.8-')
  const textRate = modern
    ? promotional
      ? 0.5
      : 1
    : settings.model === 'gemini-2.5-flash-preview-tts'
      ? 0.5
      : 1
  const audioRate = modern
    ? (settings.model === 'gemini-3.8-flash-lite-tts' ? 12 : 18) * (promotional ? 0.5 : 1)
    : settings.model === 'gemini-2.5-flash-preview-tts'
      ? 10
      : 20
  // Duration and text token counts are heuristics, not billing measurements or a cap.
  // Per-clip floors allow for pauses in short captions and glossary entries.
  const lowSeconds = lengths.reduce((sum, n) => sum + (n ? Math.max(0.5, (n * 60) / 1000) : 0), 0)
  const highSeconds = lengths.reduce((sum, n) => sum + (n ? Math.max(2, (n * 60) / 600) : 0), 0)
  const promptCharacters = characters + entries.length * (settings.instructions.length + 40)
  return {
    ...base,
    lowUsd: ((promptCharacters / 4) * textRate + lowSeconds * 25 * audioRate) / 1e6,
    highUsd: ((promptCharacters / 2) * textRate + highSeconds * 25 * audioRate) / 1e6,
    basis: `Rates: $${textRate}/M text tokens + $${audioRate}/M audio tokens (25 audio tokens/second). Assumes 600–1,000 spoken characters/minute, 2–4 characters/text token including delivery instructions, and 0.5–2 seconds minimum per clip. Voice, language and pace affect duration.${modern && promotional ? ' Promotional rates through December 31, 2026; rates double January 1, 2027.' : ''}`,
  }
}
