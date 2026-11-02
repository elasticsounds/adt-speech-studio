import { z } from 'zod'

export const Provider = z.enum(['gemini', 'openai'])
export type Provider = z.infer<typeof Provider>
export const VoiceSlot = z.enum(['primary', 'secondary'])
export type VoiceSlot = z.infer<typeof VoiceSlot>
export const Settings = z.object({
  provider: Provider.default('gemini'),
  model: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .default('gemini-3.8-flash-tts'),
  voice: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-zA-Z0-9._:-]+$/)
    .default('Kore'),
  instructions: z.string().max(4000).default(''),
  temperature: z.number().min(0).max(2).optional(),
  speed: z.number().min(0.25).max(4).default(1),
  normalize: z.boolean().default(false),
  math: z.boolean().default(true),
  profile: z.string().max(12000).default(''),
  normalizationModel: z
    .string()
    .regex(/^[a-zA-Z0-9._-]+$/)
    .max(120)
    .default('gemini-2.5-flash'),
})
export type Settings = z.infer<typeof Settings>
export const DEFAULT_SETTINGS = Settings.parse({})
export const GEMINI_MODELS = [
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.1-flash-tts-preview',
  'gemini-2.5-pro-preview-tts',
  'gemini-2.5-flash-preview-tts',
]
export const OPENAI_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
export const GEMINI_VOICES = [
  'Kore',
  'Puck',
  'Charon',
  'Zephyr',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
]
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'onyx',
  'nova',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
]

export const AudioRecord = z.object({
  file: z.string(),
  exportName: z.string(),
  source: z.enum(['imported', 'generated', 'manual']),
  exists: z.boolean(),
  stale: z.boolean().optional(),
  signature: z.string().optional(),
  textHash: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  voice: z.string().optional(),
  createdAt: z.string().optional(),
  bytes: z.number().optional(),
})
export type AudioRecord = z.infer<typeof AudioRecord>
export const Entry = z.object({
  id: z.string(),
  language: z.string(),
  text: z.string(),
  speechText: z.string(),
  category: z.enum(['text', 'caption', 'glossary', 'answer', 'easy-read']),
  page: z.string().optional(),
  version: z.number().int(),
  muted: z.boolean().default(false),
  manualSpeech: z.boolean().default(false),
  audios: z.object({ primary: AudioRecord.optional(), secondary: AudioRecord.optional() }),
  updatedAt: z.string().optional(),
  action: z.string().optional(),
})
export type Entry = z.infer<typeof Entry>
export const Book = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  title: z.string(),
  fileName: z.string(),
  root: z.string(),
  createdAt: z.string(),
  languages: z.array(z.string()),
  sourceLanguage: z.string(),
  fileCount: z.number(),
  bytes: z.number(),
  warnings: z.array(z.string()),
})
export type Book = z.infer<typeof Book>
export const BookSummary = Book.omit({ ownerId: true, root: true }).extend({
  total: z.number(),
  recorded: z.number(),
})
export type BookSummary = z.infer<typeof BookSummary>
export const BookDetail = z.object({
  book: BookSummary,
  entries: z.array(Entry),
  settings: z.record(z.string(), Settings),
  jobs: z.array(z.unknown()),
})
export type BookDetail = z.infer<typeof BookDetail>
export const EditEntry = z
  .object({
    language: z.string().min(1).max(80),
    id: z.string().min(1).max(512),
    version: z.number().int().nonnegative(),
    text: z.string().max(50000).optional(),
    speechText: z.string().max(50000).optional(),
    muted: z.boolean().optional(),
  })
  .strict()
export const RunRequest = z.object({
  language: z.string().min(1).max(80),
  slot: VoiceSlot.default('primary'),
  scope: z.enum(['missing', 'outdated', 'all', 'selected']),
  ids: z.array(z.string().max(512)).max(25000).default([]),
  settings: Settings,
  credentialMode: z.enum(['personal', 'service']).default('personal'),
  operation: z.enum(['speech', 'normalize']).default('speech'),
  force: z.boolean().default(false),
  replaceManual: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(3).default(2),
})
export type RunRequest = z.infer<typeof RunRequest>
export const RunPlan = z.object({
  count: z.number(),
  characters: z.number(),
  protected: z.number(),
  muted: z.number(),
  ids: z.array(z.string()),
})
export type RunPlan = z.infer<typeof RunPlan>
export const Job = z.object({
  id: z.string().uuid(),
  bookId: z.string(),
  ownerId: z.string(),
  language: z.string(),
  request: RunRequest,
  status: z.enum(['running', 'completed', 'cancelled', 'interrupted', 'failed']),
  total: z.number(),
  completed: z.number(),
  cached: z.number(),
  failed: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeIds: z.array(z.string()),
  results: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['done', 'cached', 'failed']),
      error: z.string().optional(),
    }),
  ),
})
export type Job = z.infer<typeof Job>
export const Credentials = z.object({
  gemini: z.string().optional(),
  openai: z.string().optional(),
})
export type Credentials = z.infer<typeof Credentials>
export const Account = z.object({
  id: z.string().uuid(),
  username: z.string(),
  passwordHash: z.string(),
  salt: z.string(),
  recoveryHash: z.string(),
  createdAt: z.string(),
})
export type Account = z.infer<typeof Account>
export const AuthRequest = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{2,39}$/),
    password: z.string().min(12).max(256),
  })
  .strict()
export const RecoveryRequest = AuthRequest.extend({ recoveryCode: z.string().min(20).max(100) })
export const Session = z.object({
  userId: z.string().uuid(),
  expiresAt: z.number(),
  hash: z.string(),
})
export type Session = z.infer<typeof Session>
export const PublicUser = Account.pick({ id: true, username: true })
export type PublicUser = z.infer<typeof PublicUser>
export const ServerInfo = z.object({
  service: z.object({ gemini: z.boolean(), openai: z.boolean() }),
  dailyCharacters: z.number(),
  remainingCharacters: z.number(),
  maxUploadBytes: z.number(),
  profiles: z.record(z.string(), z.string()),
  instructions: z.record(z.string(), z.string()),
})
export type ServerInfo = z.infer<typeof ServerInfo>
export const CallLog = z.object({
  at: z.string(),
  entryId: z.string(),
  operation: z.string(),
  model: z.string(),
  voice: z.string().optional(),
  input: z.string(),
  instructions: z.string(),
  status: z.enum(['done', 'failed', 'cached']),
  response: z.string(),
  attempt: z.number(),
})
export type CallLog = z.infer<typeof CallLog>
