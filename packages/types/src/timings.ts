import { z } from 'zod'

export const WordTiming = z.object({
  word: z.string().trim().min(1).max(2000),
  start: z.number().nonnegative().finite(),
  end: z.number().nonnegative().finite(),
})
export const WordTimings = z
  .object({
    text: z.string().max(100000),
    duration: z.number().positive().max(14400).finite(),
    words: z.array(WordTiming).min(1).max(20000),
  })
  .superRefine((value, ctx) => {
    value.words.forEach((word, i) => {
      if (
        word.end < word.start ||
        word.end > value.duration + 0.05 ||
        (i > 0 && word.start < value.words[i - 1].start)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['words', i],
          message: 'Word times must be ordered and within the recording duration.',
        })
    })
  })
export type WordTimings = z.infer<typeof WordTimings>
export const TimingReference = z.object({
  file: z.string(),
  format: z.enum(['reader', 'speech']),
  source: z.enum(['imported', 'generated', 'manual']),
  audioFile: z.string(),
  textHash: z.string(),
  duration: z.number().positive(),
  wordCount: z.number().int().positive(),
})
export type TimingReference = z.infer<typeof TimingReference>
export const TimingEdit = z
  .object({
    language: z.string().min(1).max(80),
    id: z.string().min(1).max(512),
    slot: z.enum(['primary', 'secondary']),
    version: z.number().int().nonnegative(),
    timings: WordTimings,
  })
  .strict()
