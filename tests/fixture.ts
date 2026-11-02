import fs from 'node:fs/promises'
import path from 'node:path'
import { zipFiles } from '../packages/bundle/src/archive.js'
import { pcmToWav } from '../packages/tts/src/provider.js'

export const tone = pcmToWav(
  Buffer.from(
    Array.from({ length: 2400 }, (_, i) => {
      const sample = Math.round(Math.sin(i * 0.1) * 1000)
      return [sample & 255, (sample >> 8) & 255]
    }).flat(),
  ),
)
export function fixtureFiles(wrapper = '') {
  const json = (data: unknown) => Buffer.from(JSON.stringify(data, null, 2))
  const map = new Map<string, Buffer>([
    [
      'assets/config.json',
      json({
        title: 'The little world of plants',
        languages: { available: ['en', 'es'], default: 'en' },
        features: { readAloud: true, highlight: true, activities: true },
        custom: { preserve: 'yes' },
      }),
    ],
    [
      'content/pages.json',
      json([
        { section_id: 'pg001_sec001', href: 'pg001_sec001.html', title: 'A seed becomes a story' },
        { section_id: 'pg002_sec001', href: 'pg002_sec001.html', title: 'Growing together' },
      ]),
    ],
    [
      'index.html',
      Buffer.from(
        '<!doctype html><html><body><h1>Plant explorer</h1><a href="pg001_sec001.html">Start reading</a></body></html>',
      ),
    ],
    [
      'pg001_sec001.html',
      Buffer.from(
        '<!doctype html><html><body><h1 data-id="pg001_h">A seed becomes a story</h1><p data-id="pg001_p">Every plant begins with a small seed.</p><input data-activity-id="act1" placeholder="Your answer"><script src="./assets/offline-preloader.js"></script></body></html>',
      ),
    ],
    [
      'pg002_sec001.html',
      Buffer.from('<html><body><p data-id="pg002_p">Sunlight helps plants grow.</p></body></html>'),
    ],
    [
      'images/leaf.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1L4 4"/></svg>'),
    ],
    [
      'content/i18n/en/texts.json',
      json({
        pg001_h: 'A seed becomes a story',
        pg001_p: 'Every plant begins with a small seed.',
        pg002_p: 'Sunlight helps plants grow.',
        pg002_n: 'A garden has 12 flowers.',
        gl001: 'Roots carry water to the plant.',
        pg002_ans_a: 'Water and sunshine',
      }),
    ],
    [
      'content/i18n/en/speech_texts.json',
      json({
        pg001_h: 'A seed becomes a story',
        pg001_p: 'Every plant begins with a small seed.',
        pg002_p: 'Sunlight helps plants grow.',
        pg002_n: 'A garden has twelve flowers.',
        gl001: 'Roots carry water to the plant.',
        pg002_ans_a: 'Water and sunshine',
      }),
    ],
    ['content/i18n/en/audios.json', json({ pg001_h: 'original.wav', pg001_p: 'missing.wav' })],
    ['content/i18n/en/audio/original.wav', tone],
    [
      'content/i18n/en/timecode/timecode_output.json',
      json({
        pg001_h: { timecodes: [null, { word_timestamps: [{ text: 'A', start: 0, end: 0.1 }] }] },
      }),
    ],
    [
      'content/i18n/es/texts.json',
      json({
        pg001_h: 'Una semilla se convierte en historia',
        pg001_p: 'Cada planta empieza con una pequeña semilla.',
        pg002_p: 'La luz del sol ayuda a las plantas a crecer.',
        pg002_n: 'Un jardín tiene 12 flores.',
        gl001: 'Las raíces llevan agua a la planta.',
        pg002_ans_a: 'Agua y sol',
      }),
    ],
    ['content/i18n/es/audios.json', json({})],
    ['tools/untrusted.js', Buffer.from('throw new Error("Uploaded scripts must never run")')],
    [
      'imsmanifest.xml',
      Buffer.from('<manifest identifier="original-activity"><resources/></manifest>'),
    ],
  ])
  const inline = Object.fromEntries(
    [...map]
      .filter(([name]) => name.endsWith('.json'))
      .map(([name, data]) => [`./${name}`, JSON.parse(data.toString())]),
  )
  map.set(
    'assets/offline-preloader.js',
    Buffer.from(
      `// offline-preloader.js — auto-generated, do not edit by hand\n(function () {\n  var INLINE = ${JSON.stringify(inline)};\n  var _realFetch = window.fetch.bind(window);\n  window.fetch = function (url) { var data = INLINE[url]; return data ? Promise.resolve(new Response(JSON.stringify(data))) : _realFetch(url); };\n})();`,
    ),
  )
  return [...map].map(([name, data]) => ({ name: `${wrapper}${name}`, data }))
}
export async function makeFixture(file: string, wrapper = '') {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await zipFiles(file, fixtureFiles(wrapper))
  return file
}
