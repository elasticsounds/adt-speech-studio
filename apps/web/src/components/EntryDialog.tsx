import { FileLink } from './FileLink'
import { Recording } from './Recording'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, History, Upload, Save, RotateCcw } from 'lucide-react'
import type { Entry, VoiceSlot } from '@speech/types'
import { api, audioUrl } from '../api'
import { Button, ErrorNotice, Field, Modal, Status } from './ui'

export function EntryDialog({
  book,
  entry,
  slot,
  onClose,
  onUpdated,
}: {
  book: string
  entry: Entry
  slot: VoiceSlot
  onClose: () => void
  onUpdated: () => void
}) {
  const [text, setText] = useState(entry.text),
    [speech, setSpeech] = useState(entry.speechText),
    [muted, setMuted] = useState(entry.muted),
    [showHistory, setShowHistory] = useState(false)
  const dirty = text !== entry.text || speech !== entry.speechText || muted !== entry.muted
  const uploadInput = useRef<HTMLInputElement>(null)
  const history = useQuery({
    queryKey: ['history', book, entry.language, entry.id, entry.version],
    queryFn: () => api.history(book, entry),
    enabled: showHistory,
  })
  const save = useMutation({
    mutationFn: () =>
      api.edit(book, {
        language: entry.language,
        id: entry.id,
        version: entry.version,
        ...(text !== entry.text ? { text } : {}),
        ...(speech !== entry.speechText ? { speechText: speech } : {}),
        muted,
      }),
    onSuccess: () => {
      onUpdated()
      onClose()
    },
  })
  const restore = useMutation({
    mutationFn: (version: number) =>
      api.restore(book, {
        language: entry.language,
        id: entry.id,
        version: entry.version,
        restoreVersion: version,
      }),
    onSuccess: () => {
      onUpdated()
      onClose()
    },
  })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData()
      data.set('audio', file)
      data.set('language', entry.language)
      data.set('id', entry.id)
      data.set('version', String(entry.version))
      data.set('slot', slot)
      return api.uploadAudio(book, data)
    },
    onSuccess: () => {
      onUpdated()
      onClose()
    },
  })
  const close = () => {
    if (!dirty || confirm('Discard your unsaved text changes?')) onClose()
  }
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [dirty])
  return (
    <Modal title="Review language & speech" onClose={close} wide>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <code className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-500">{entry.id}</code>
        <span className="text-xs text-stone-500">
          {entry.language} · Version {entry.version}
        </span>
        <Status entry={entry} slot={slot} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Display text"
          hint="The words shown in the reader. Markup is kept as written."
        >
          <textarea
            className="input min-h-48 resize-y text-sm leading-6"
            aria-label="Display text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field
          label="Spoken text"
          hint="The exact words sent to the speech provider. Your manual changes are protected during normalization."
        >
          <textarea
            className="input min-h-48 resize-y text-sm leading-6"
            aria-label="Spoken text"
            value={speech}
            onChange={(e) => setSpeech(e.target.value)}
          />
        </Field>
      </div>
      <label className="my-5 flex items-center gap-2 text-xs text-stone-600">
        <input
          type="checkbox"
          checked={muted}
          onChange={(e) => setMuted(e.target.checked)}
          className="accent-emerald-800"
        />
        Mute this entry (exclude it from narration)
      </label>
      <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <p className="mb-3 text-xs font-semibold">
          {slot === 'primary' ? 'Primary' : 'Secondary'} recording
        </p>
        {entry.audios[slot]?.exists ? (
          <div className="flex flex-wrap items-center gap-3">
            <Recording controls src={audioUrl(book, entry, slot)} className="h-9 max-w-full" />
            <FileLink
              filename="recording.wav"
              href={audioUrl(book, entry, slot, true)}
              className="btn btn-secondary text-xs"
            >
              <Download size={14} />
              Download
            </FileLink>
          </div>
        ) : (
          <p className="text-sm text-stone-500">
            No recording yet. Save the spoken text, then generate this entry.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-stone-400">
          {entry.audios[slot]?.model && (
            <span>
              {entry.audios[slot]?.model} · {entry.audios[slot]?.voice}
            </span>
          )}
          <span>AI-generated recordings should be reviewed.</span>
        </div>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowHistory(!showHistory)}>
          <History size={15} />
          Version history
        </Button>
        <Button
          variant="secondary"
          disabled={dirty}
          busy={upload.isPending}
          onClick={() => uploadInput.current?.click()}
        >
          <Upload size={15} />
          Upload recording
        </Button>
        <input
          ref={uploadInput}
          className="hidden"
          type="file"
          accept="audio/wav,audio/mpeg,audio/ogg,audio/flac"
          aria-label="Upload recording"
          onChange={(e) => {
            if (e.target.files?.[0]) upload.mutate(e.target.files[0])
          }}
        />
      </div>
      {showHistory && (
        <div className="mb-5 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-stone-200 p-3">
          {history.isPending ? (
            <p className="text-sm text-stone-500">Loading history…</p>
          ) : (
            history.data?.map((version) => (
              <div
                key={version.version}
                className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 p-3"
              >
                <div>
                  <p className="text-xs font-medium">
                    Version {version.version} · {version.action ?? 'Original import'}
                  </p>
                  <p className="mt-1 max-w-md truncate text-xs text-stone-500">
                    {version.speechText}
                  </p>
                  {version.audios[slot]?.exists && (
                    <Recording
                      className="mt-2 h-7 max-w-full"
                      controls
                      preload="none"
                      src={audioUrl(book, version, slot)}
                    />
                  )}
                </div>
                {version.version !== entry.version && (
                  <Button
                    variant="ghost"
                    disabled={dirty}
                    busy={restore.isPending}
                    onClick={() => restore.mutate(version.version)}
                  >
                    <RotateCcw size={14} />
                    Restore
                  </Button>
                )}
              </div>
            ))
          )}
          <ErrorNotice error={history.error} />
        </div>
      )}
      <ErrorNotice error={save.error ?? upload.error ?? restore.error} />
      <div className="mt-6 flex justify-end gap-3 border-t border-stone-100 pt-5">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>
          <Save size={16} />
          Save changes
        </Button>
      </div>
    </Modal>
  )
}
