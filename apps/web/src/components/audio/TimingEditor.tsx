import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { Entry, VoiceSlot, WordTimings } from '@speech/types'
import { api } from '../../api'
import { Button, ErrorNotice, Field } from '../ui'

export function TimingEditor({
  book,
  entry,
  slot,
  timings,
  index,
  onSaved,
  disabled,
}: {
  book: string
  entry: Entry
  slot: VoiceSlot
  timings: WordTimings
  index: number
  onSaved: () => void
  disabled: boolean
}) {
  const word = timings.words[index]
  const [text, setText] = useState(word.word),
    [start, setStart] = useState(word.start),
    [end, setEnd] = useState(word.end)
  const save = useMutation({
    mutationFn: () => {
      const words = timings.words.map((w, i) => (i === index ? { word: text, start, end } : w))
      return api.saveTimings(book, entry, slot, {
        ...timings,
        words,
        text: words.map((w) => w.word).join(' '),
      })
    },
    onSuccess: onSaved,
  })
  const dirty = text !== word.word || start !== word.start || end !== word.end
  return (
    <div className="mt-4 rounded-xl border border-stone-200 p-3">
      <p className="mb-3 text-xs font-medium">Edit selected word · changes create a new version</p>
      <fieldset disabled={disabled || save.isPending} className="grid gap-3 sm:grid-cols-3">
        <Field label="Timed word">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Word start (seconds)">
          <input
            className="input"
            type="number"
            min={0}
            max={timings.duration}
            step="0.01"
            value={Number.isFinite(start) ? Number(start.toFixed(3)) : ''}
            onChange={(e) => setStart(e.target.valueAsNumber)}
          />
        </Field>
        <Field label="Word end (seconds)">
          <input
            className="input"
            type="number"
            min={0}
            max={timings.duration}
            step="0.01"
            value={Number.isFinite(end) ? Number(end.toFixed(3)) : ''}
            onChange={(e) => setEnd(e.target.valueAsNumber)}
          />
        </Field>
      </fieldset>
      <ErrorNotice error={save.error} />
      <Button
        className="mt-3 text-xs"
        disabled={
          disabled || !dirty || !text.trim() || !Number.isFinite(start) || !Number.isFinite(end)
        }
        busy={save.isPending}
        onClick={() => save.mutate()}
      >
        Save word timing
      </Button>
    </div>
  )
}
