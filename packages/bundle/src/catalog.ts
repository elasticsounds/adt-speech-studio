import fs from 'node:fs/promises'
import path from 'node:path'
import { parseHTML } from 'linkedom'
import { z } from 'zod'
import { Book, Entry, type AudioRecord } from '@speech/types'
import { exists, filesUnder, inside, jsonFile, hash } from './files.js'

const StringMap = z.record(z.string().max(512), z.string().max(100000))
export function plainText(text: string): string {
  if (!/<[a-z!/]/i.test(text)) return text
  const { document } = parseHTML(`<html><body>${text}</body></html>`)
  for (const node of document.querySelectorAll('script,style')) node.remove()
  return (document.body.textContent ?? '').trim()
}
export function entryKey(language: string, id: string) {
  return hash(JSON.stringify([language, id]))
}
export function audioTextHash(entry: Pick<Entry, 'speechText'>) {
  return hash(entry.speechText.trim())
}
export function category(id: string): Entry['category'] {
  return id.includes('_ans_')
    ? 'answer'
    : id.endsWith('_easy_read')
      ? 'easy-read'
      : /^gl(?:\d|_)/.test(id)
        ? 'glossary'
        : /_im\d+/.test(id)
          ? 'caption'
          : 'text'
}
export async function readCatalog(
  bookDir: string,
  meta: Omit<Book, 'root' | 'languages' | 'sourceLanguage' | 'warnings' | 'title'>,
) {
  const original = path.join(bookDir, 'original')
  const files = await filesUnder(original)
  const catalogPaths = files
    .map((file) => ({ file, match: file.match(/^(.*)content\/i18n\/([^/]+)\/texts\.json$/) }))
    .filter((item) => item.match)
  const roots = new Set(catalogPaths.map((item) => item.match![1]))
  if (roots.size !== 1)
    throw new Error('Upload one ADT reader ZIP containing content/i18n/<language>/texts.json.')
  const root = [...roots][0]
  const bundleDir = path.join(original, root)
  const config = (await exists(path.join(bundleDir, 'assets/config.json')))
    ? await jsonFile<Record<string, unknown>>(path.join(bundleDir, 'assets/config.json'))
    : {}
  const warnings: string[] = []
  const entries: Entry[] = []
  const languages = catalogPaths.map((item) => item.match![2]).sort()
  if (new Set(languages.map((l) => l.toLowerCase().replaceAll('_', '-'))).size !== languages.length)
    throw new Error('Conflicting locale aliases found; keep one spelling per locale in your ADT.')
  let broken = 0
  let catalogCharacters = 0
  for (const language of languages) {
    if (!/^[a-zA-Z]{2,8}(?:[-_][a-zA-Z0-9]{2,8})*$/.test(language))
      throw new Error('Unsupported locale folder in ADT.')
    const localeDir = inside(bundleDir, `content/i18n/${language}`)
    const texts = StringMap.parse(await jsonFile(path.join(localeDir, 'texts.json')))
    const optional = async (name: string) =>
      (await exists(path.join(localeDir, name)))
        ? StringMap.parse(await jsonFile(path.join(localeDir, name)))
        : {}
    const speech = await optional('speech_texts.json')
    const primary = await optional('audios.json')
    const voicesPath = path.join(localeDir, 'audio_voices.json')
    const variants = (await exists(voicesPath))
      ? z
          .object({ voices: z.object({ secondary: z.object({ audios: StringMap }).optional() }) })
          .parse(await jsonFile(voicesPath))
      : null
    const maps = { primary, secondary: variants?.voices.secondary?.audios ?? {} }
    for (const [id, text] of Object.entries(texts)) {
      if (!id || entries.length >= 25000)
        throw new Error('ADT contains too many or invalid text entries.')
      const fallback = /<math[\s>]/i.test(text) ? '' : plainText(text)
      const speechText = Object.hasOwn(speech, id) ? speech[id] : fallback
      catalogCharacters += text.length + speechText.length
      if (catalogCharacters > 8_000_000)
        throw new Error('This ADT exceeds the language catalog size limit (8 million characters).')
      const audios: Entry['audios'] = {}
      for (const slot of ['primary', 'secondary'] as const) {
        const name = Object.hasOwn(maps[slot], id) ? maps[slot][id] : undefined
        if (!name) continue
        const file = inside(localeDir, `audio/${name}`)
        const present = await exists(file)
        if (!present) broken++
        audios[slot] = {
          file: path.relative(bookDir, file).split(path.sep).join('/'),
          exportName: name,
          source: 'imported',
          exists: present,
          textHash: hash(speechText.trim()),
        } satisfies AudioRecord
      }
      entries.push(
        Entry.parse({
          id,
          language,
          text,
          speechText,
          category: category(id),
          page: id.match(/^(pg\d+)/)?.[1],
          version: 0,
          audios,
        }),
      )
    }
  }
  if (!entries.length) throw new Error('This ADT contains no language strings.')
  if (broken)
    warnings.push(
      `${broken} audio references point to missing files. Use Generate missing to repair them.`,
    )
  if (entries.some((e) => !e.speechText.trim() && e.text.trim()))
    warnings.push(
      'Some entries need spoken text, including formulas without a speech version. Normalize or edit these before generating audio.',
    )
  const defaultLang = z.object({ default: z.string().optional() }).safeParse(config.languages)
  const sourceLanguage =
    defaultLang.success && languages.includes(defaultLang.data.default ?? '')
      ? defaultLang.data.default!
      : languages[0]
  const book = Book.parse({
    ...meta,
    root,
    languages,
    sourceLanguage,
    warnings,
    title:
      typeof config.title === 'string'
        ? config.title.slice(0, 500)
        : meta.fileName.replace(/\.zip$/i, ''),
  })
  return { book, entries }
}
