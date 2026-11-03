import { apiUrl, REMOTE_API, audioSource, downloadFile } from '../hosting'
import { FileLink } from './FileLink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  AudioLines,
  Download,
  FileText,
  Languages,
  Search,
  Play,
  Pause,
  Pencil,
  Sparkles,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Trash2,
  Info,
  Headphones,
} from 'lucide-react'
import {
  DEFAULT_SETTINGS,
  type Credentials,
  type Entry,
  type Job,
  type RunRequest,
  type Settings,
  type ServerInfo,
  type VoiceSlot,
} from '@speech/types'
import { api, audioUrl } from '../api'
import { Button, ErrorNotice, Modal, Status } from './ui'
import { EntryDialog } from './EntryDialog'
import { SettingsPanel } from './SettingsPanel'
import { JobsPanel } from './JobsPanel'
import { SpeechCostReview } from './SpeechCostReview'

function LanguageName({ code }: { code: string }) {
  let name = code
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replaceAll('_', '-')) ?? code
  } catch {}
  return <>{name}</>
}
function AudioPlay({ book, entry, slot }: { book: string; entry: Entry; slot: VoiceSlot }) {
  const ref = useRef<HTMLAudioElement>(null),
    [playing, setPlaying] = useState(false),
    [error, setError] = useState('')
  const loaded = useRef('')
  useEffect(() => {
    return () => {
      if (loaded.current.startsWith('blob:')) URL.revokeObjectURL(loaded.current)
    }
  }, [])
  return (
    <>
      <audio
        ref={ref}
        preload="none"
        src={REMOTE_API ? undefined : audioUrl(book, entry, slot)}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onError={() => setError('Unable to play this recording.')}
      />
      <button
        className="icon-button text-emerald-800"
        aria-label={`${playing ? 'Pause' : 'Play'} ${entry.id}`}
        title={error || 'Play recording'}
        onClick={async () => {
          const audio = ref.current
          if (!audio) return
          if (playing) {
            audio.pause()
            return
          }
          document.querySelectorAll('audio').forEach((a) => {
            if (a !== audio) a.pause()
          })
          if (REMOTE_API && !audio.src) {
            try {
              loaded.current = await audioSource(audioUrl(book, entry, slot))
              audio.src = loaded.current
            } catch {
              setError('Unable to play this recording.')
              return
            }
          }
          void audio
            .play()
            .then(() => {
              setPlaying(true)
              setError('')
            })
            .catch(() => setError('Unable to play this recording.'))
        }}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      {error && (
        <span role="alert" className="text-[10px] text-red-600">
          Playback failed
        </span>
      )}
    </>
  )
}

export function Workspace({
  bookId,
  keys,
  mode,
  info,
  onBack,
  onKeys,
}: {
  bookId: string
  keys: Credentials
  mode: 'personal' | 'service'
  info?: ServerInfo
  onBack: () => void
  onKeys: () => void
}) {
  const client = useQueryClient()
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId) })
  const jobs = useQuery({
    queryKey: ['jobs', bookId],
    queryFn: () => api.jobs(bookId),
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === 'running') ? 1200 : 5000,
  })
  const activeJob = jobs.data?.find((j) => j.status === 'running'),
    latestJob = activeJob ?? jobs.data?.[0],
    busy = !!activeJob
  const [language, setLanguage] = useState(''),
    [slot, setSlot] = useState<VoiceSlot>('primary'),
    [tab, setTab] = useState<'speech' | 'language'>('speech')
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS),
    [editing, setEditing] = useState<Entry | null>(null),
    [filesOpen, setFilesOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false)
  const [proposal, setProposal] = useState<RunRequest | null>(null),
    [actionError, setActionError] = useState<unknown>(null)
  const seeded = useRef(''),
    drafts = useRef<Record<string, Settings>>({}),
    jobMarker = useRef('')
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['book', bookId] })
    void client.invalidateQueries({ queryKey: ['books'] })
    void client.invalidateQueries({ queryKey: ['jobs', bookId] })
    void client.invalidateQueries({ queryKey: ['info'] })
  }
  useEffect(() => {
    if (detail.data && !language) setLanguage(detail.data.book.sourceLanguage)
  }, [detail.data, language])
  useEffect(() => {
    if (!detail.data || !language || seeded.current === `${bookId}/${language}`) return
    seeded.current = `${bookId}/${language}`
    const key = language.toLowerCase().replaceAll('_', '-'),
      base = key.split('-')[0]
    setSettings(
      drafts.current[language] ??
        detail.data.settings[language] ?? {
          ...DEFAULT_SETTINGS,
          instructions:
            info?.instructions[key] ?? info?.instructions[base] ?? info?.instructions.default ?? '',
          profile: info?.profiles[key] ?? info?.profiles[base] ?? info?.profiles.default ?? '',
        },
    )
  }, [detail.data, bookId, language, info])
  useEffect(() => {
    const marker = latestJob
      ? `${latestJob.id}/${latestJob.status}/${Math.floor(latestJob.completed / 5)}`
      : ''
    if (marker && marker !== jobMarker.current) {
      jobMarker.current = marker
      void client.invalidateQueries({ queryKey: ['book', bookId] })
      void client.invalidateQueries({ queryKey: ['books'] })
    }
  }, [latestJob, bookId, client])
  useEffect(() => {
    setPage(0)
  }, [language, search, filter, slot])
  const plan = useQuery({
    queryKey: ['plan', bookId, proposal],
    queryFn: () => api.plan(bookId, proposal!),
    enabled: !!proposal,
  })
  const files = useQuery({
    queryKey: ['files', bookId],
    queryFn: () => api.files(bookId),
    enabled: filesOpen,
  })
  const run = useMutation({
    mutationFn: () => api.run(bookId, proposal!, keys),
    onSuccess: (job) => {
      for (const lang of job.language === '*' ? detail.data!.book.languages : [job.language])
        delete drafts.current[lang]
      seeded.current = ''
      setProposal(null)
      setSelected(new Set())
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.remove(bookId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['books'] })
      onBack()
    },
  })
  const download = useMutation({
    mutationFn: () => api.export(bookId),
    onSuccess: (data) =>
      downloadFile(apiUrl(`/books/${bookId}/exports/${data.id}`), 'updated-adt.zip'),
  })
  const begin = (
    scope: RunRequest['scope'],
    operation: RunRequest['operation'] = 'speech',
    ids = [...selected],
  ) => {
    setActionError(null)
    run.reset()
    setProposal({
      language,
      slot,
      scope,
      ids,
      settings: { ...settings },
      credentialMode: mode,
      operation,
      force: false,
      replaceManual: false,
      concurrency: 2,
    })
  }
  const retry = (ids: string[]) => {
    if (!latestJob) return
    run.reset()
    setProposal({
      ...latestJob.request,
      scope: 'selected',
      ids,
      force: false,
      credentialMode: mode,
    })
  }
  const entries = useMemo(
    () => detail.data?.entries.filter((e) => e.language === language) ?? [],
    [detail.data, language],
  )
  const recorded = entries.filter(
      (e) => e.audios[slot]?.exists && !e.audios[slot]?.stale && !e.muted,
    ).length,
    missing = entries.filter(
      (e) => !e.audios[slot]?.exists && !e.audios[slot]?.stale && !e.muted,
    ).length
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        const audio = e.audios[slot]
        return (
          (filter === 'all' ||
            (filter === 'missing' && !audio?.exists && !e.muted) ||
            (filter === 'manual' && audio?.source === 'manual') ||
            (filter === 'outdated' && audio?.stale) ||
            (filter === 'muted' && e.muted)) &&
          (!search ||
            `${e.text} ${e.speechText} ${e.id}`.toLowerCase().includes(search.toLowerCase()))
        )
      }),
    [entries, filter, search, slot],
  )
  const rows = filtered.slice(page * 40, (page + 1) * 40),
    pages = Math.max(1, Math.ceil(filtered.length / 40))
  const allSelected = rows.length > 0 && rows.every((e) => selected.has(e.id))
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const connected =
    mode === 'service' ? info?.service[settings.provider] : !!keys[settings.provider]
  if (detail.isPending)
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-stone-500">
        Opening your ADT…
      </div>
    )
  if (detail.error || !detail.data)
    return (
      <div className="p-8">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={16} />
          My ADTs
        </Button>
        <ErrorNotice error={detail.error} />
      </div>
    )
  const { book } = detail.data
  return (
    <main className="mx-auto max-w-[1600px] px-5 py-7 lg:px-8">
      <button
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-emerald-800"
      >
        <ArrowLeft size={14} />
        My ADTs
      </button>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">{book.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <span>
              {book.languages.length} {book.languages.length === 1 ? 'language' : 'languages'}
            </span>
            <span className="text-stone-300">/</span>
            <span>{book.fileCount.toLocaleString()} files</span>
            <span className="text-stone-300">/</span>
            <span>Original safely preserved</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setFilesOpen(true)}>
            <FolderOpen size={15} />
            Files
          </Button>
          <Button disabled={busy} busy={download.isPending} onClick={() => download.mutate()}>
            <Download size={16} />
            Download ADT
          </Button>
        </div>
      </div>
      <ErrorNotice error={download.error ?? actionError} />
      <div className="mb-7 grid grid-cols-3 gap-3">
        <div className="stat-card">
          <span className="stat-icon">
            <FileText size={18} />
          </span>
          <div>
            <p className="text-xl font-semibold tabular-nums">{entries.length.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">Language strings</p>
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-icon">
            <Headphones size={18} />
          </span>
          <div>
            <p className="text-xl font-semibold tabular-nums">{recorded.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">Recordings ready</p>
          </div>
        </div>
        <button className="stat-card text-left" onClick={() => setFilter('missing')}>
          <span className="stat-icon !bg-amber-50 !text-amber-600">
            <AudioLines size={18} />
          </span>
          <div>
            <p className="text-xl font-semibold tabular-nums">{missing.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">Missing recordings</p>
          </div>
        </button>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0">
          {latestJob && (
            <JobsPanel book={bookId} job={latestJob} onRefresh={refresh} onRetry={retry} />
          )}
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 pt-2">
              <div className="flex gap-5">
                {(['speech', 'language'] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setTab(value)}
                    className={`flex items-center gap-2 border-b-2 py-4 text-sm font-medium ${tab === value ? 'border-emerald-800 text-emerald-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
                  >
                    {value === 'speech' ? <AudioLines size={16} /> : <Languages size={16} />}{' '}
                    {value === 'speech' ? 'Speech' : 'Language strings'}
                  </button>
                ))}
              </div>
              <select
                aria-label="Language"
                className="mb-2 max-w-52 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value)
                  setSelected(new Set())
                }}
              >
                {book.languages.map((lang) => (
                  <option key={lang} value={lang}>
                    <LanguageName code={lang} /> ({lang})
                  </option>
                ))}
              </select>
            </div>
            <div className="border-b border-stone-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-40 flex-1">
                  <Search size={15} className="absolute top-2.5 left-3 text-stone-400" />
                  <input
                    className="input !py-2 pl-9 text-xs"
                    placeholder="Search text or ID…"
                    aria-label="Search strings"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="input !w-auto !py-2 text-xs"
                  aria-label="Filter recordings"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All recordings</option>
                  <option value="missing">Missing</option>
                  <option value="outdated">Outdated text</option>
                  <option value="manual">Manual recordings</option>
                  <option value="muted">Muted</option>
                </select>
                <select
                  className="input !w-auto !py-2 text-xs"
                  aria-label="Narrator"
                  value={slot}
                  onChange={(e) => setSlot(e.target.value as VoiceSlot)}
                >
                  <option value="primary">Primary voice</option>
                  <option value="secondary">Secondary voice</option>
                </select>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-stone-400">
                  {selected.size
                    ? `${selected.size} selected`
                    : `${filtered.length.toLocaleString()} entries`}{' '}
                  · <LanguageName code={language} />
                </p>
                <div className="flex flex-wrap gap-2">
                  {selected.size > 0 && (
                    <Button
                      variant="secondary"
                      className="!min-h-8 !py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => begin('selected')}
                    >
                      Generate selected
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="!min-h-8 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => begin(selected.size ? 'selected' : 'all', 'normalize')}
                  >
                    <Sparkles size={13} />
                    Normalize
                  </Button>
                  <Button
                    variant="secondary"
                    className="!min-h-8 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => begin('all')}
                  >
                    <RefreshCw size={13} />
                    Regenerate all
                  </Button>
                  <Button
                    className="!min-h-8 !py-1.5 text-xs"
                    disabled={busy}
                    onClick={() => begin('missing')}
                  >
                    <AudioLines size={14} />
                    Generate missing
                  </Button>
                </div>
              </div>
            </div>
            {!connected && (
              <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/50 px-5 py-3">
                <p className="text-xs text-stone-600">
                  Connect your {settings.provider === 'gemini' ? 'Gemini' : 'OpenAI'} key to
                  generate speech.
                </p>
                <button
                  className="shrink-0 text-xs font-semibold text-emerald-800"
                  onClick={onKeys}
                >
                  Connect key →
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left">
                <colgroup>
                  <col className="w-10" />
                  <col className={tab === 'language' ? 'w-[45%]' : 'w-[38%]'} />
                  {tab === 'speech' && <col className="w-[25%]" />}
                  <col className="w-24" />
                  <col className="w-24" />
                </colgroup>
                <thead className="bg-stone-50/80 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
                  <tr>
                    <th className="py-3 pl-4">
                      <input
                        type="checkbox"
                        aria-label="Select visible entries"
                        className="accent-emerald-800"
                        checked={allSelected}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            rows.forEach((e) => (allSelected ? next.delete(e.id) : next.add(e.id)))
                            return next
                          })
                        }
                      />
                    </th>
                    <th className="px-3 py-3">
                      {tab === 'language' ? 'Language string' : 'Display text'}
                    </th>
                    {tab === 'speech' && <th className="px-3 py-3">Spoken text</th>}
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`group border-t border-stone-100 ${selected.has(entry.id) ? 'bg-emerald-50/40' : 'hover:bg-stone-50/50'}`}
                    >
                      <td className="py-4 pl-4 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${entry.id}`}
                          className="accent-emerald-800"
                          checked={selected.has(entry.id)}
                          onChange={() => toggle(entry.id)}
                        />
                      </td>
                      <td className="px-3 py-4 align-top">
                        <button
                          className="w-full text-left"
                          disabled={busy}
                          onClick={() => setEditing(entry)}
                        >
                          <p className="line-clamp-3 break-words text-xs leading-6 text-stone-700">
                            {entry.text}
                          </p>
                          <p className="mt-1.5 truncate font-mono text-[9px] text-stone-400">
                            {entry.id}
                            <span className="ml-2 font-sans">
                              {entry.category !== 'text' ? entry.category : ''}
                            </span>
                          </p>
                        </button>
                      </td>
                      {tab === 'speech' && (
                        <td className="px-3 py-4 align-top">
                          <p className="line-clamp-3 break-words text-xs leading-6 text-stone-500">
                            {entry.speechText || (
                              <span className="italic text-amber-700">Needs spoken text</span>
                            )}
                          </p>
                          {entry.manualSpeech && (
                            <p className="mt-1 text-[9px] text-blue-600">Edited manually</p>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-4 align-top">
                        <Status entry={entry} slot={slot} />
                      </td>
                      <td className="px-2 py-3 align-top">
                        <div className="flex justify-end">
                          {entry.audios[slot]?.exists ? (
                            <AudioPlay
                              key={`${entry.id}/${entry.version}/${slot}`}
                              book={bookId}
                              entry={entry}
                              slot={slot}
                            />
                          ) : (
                            <button
                              disabled={busy}
                              className="icon-button text-stone-400"
                              aria-label={`Generate ${entry.id}`}
                              onClick={() => begin('selected', 'speech', [entry.id])}
                            >
                              <AudioLines size={16} />
                            </button>
                          )}
                          <button
                            disabled={busy}
                            className="icon-button text-stone-400"
                            aria-label={`Edit ${entry.id}`}
                            onClick={() => setEditing(entry)}
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="px-5 py-14 text-center text-sm text-stone-500">
                  No entries match your search.
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-stone-100 px-5 py-3 text-[11px] text-stone-500">
              <span>
                {filtered.length
                  ? `${page * 40 + 1}–${Math.min((page + 1) * 40, filtered.length)} of ${filtered.length.toLocaleString()}`
                  : '0 entries'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  className="icon-button"
                  disabled={page === 0}
                  aria-label="Previous page"
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={15} />
                </button>
                <span>
                  {page + 1} / {pages}
                </span>
                <button
                  className="icon-button"
                  disabled={page + 1 >= pages}
                  aria-label="Next page"
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
          {book.warnings.length > 0 && (
            <details className="mt-5 rounded-xl border border-stone-200 px-4 py-3">
              <summary className="cursor-pointer text-xs text-stone-500">
                Import notes ({book.warnings.length})
              </summary>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-6 text-stone-500">
                {book.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-5 flex items-center justify-between">
            <FileLink
              filename="original-adt.zip"
              href={apiUrl(`/books/${bookId}/original`)}
              className="text-[11px] text-stone-400 underline underline-offset-2"
            >
              Download original ADT
            </FileLink>
            <button
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-red-600"
            >
              <Trash2 size={12} />
              Delete workspace
            </button>
          </div>
        </section>
        <SettingsPanel
          value={settings}
          onChange={(value) => {
            drafts.current[language] = value
            setSettings(value)
          }}
          disabled={busy}
        />
      </div>
      {editing && (
        <EntryDialog
          book={bookId}
          entry={editing}
          slot={slot}
          onClose={() => setEditing(null)}
          onUpdated={refresh}
        />
      )}
      {proposal && (
        <Modal
          title={
            proposal.operation === 'normalize'
              ? 'Prepare spoken text'
              : proposal.scope === 'missing'
                ? 'Generate missing recordings'
                : 'Regenerate recordings'
          }
          onClose={() => setProposal(null)}
        >
          <div className="mb-5 rounded-xl bg-[#f2f6f1] p-4">
            <p className="text-sm font-semibold">
              Model:{' '}
              {proposal.operation === 'normalize'
                ? proposal.settings.normalizationModel
                : proposal.settings.model}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {proposal.operation === 'speech' ? `Voice: ${proposal.settings.voice} · ` : ''}
              {proposal.language === '*' ? 'All languages' : proposal.language} · {proposal.slot}{' '}
              voice
            </p>
          </div>
          {proposal.scope !== 'selected' && book.languages.length > 1 && (
            <label className="mb-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-emerald-800"
                checked={proposal.language === '*'}
                onChange={(e) =>
                  setProposal({ ...proposal, language: e.target.checked ? '*' : language })
                }
              />
              Apply to all {book.languages.length} languages
            </label>
          )}
          <div className="space-y-3 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-emerald-800"
                checked={proposal.force}
                onChange={(e) => setProposal({ ...proposal, force: e.target.checked })}
              />
              <span>
                Generate fresh results
                <span className="mt-1 block text-xs leading-5 text-stone-500">
                  Bypass saved results, even if text and settings are unchanged.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-emerald-800"
                checked={proposal.replaceManual}
                onChange={(e) => setProposal({ ...proposal, replaceManual: e.target.checked })}
              />
              <span>
                Include manually edited speech / recordings
                <span className="mt-1 block text-xs leading-5 text-stone-500">
                  Previous versions stay available in history.
                </span>
              </span>
            </label>
          </div>
          <div className="my-5 border-y border-stone-100 py-4">
            <p className="text-2xl font-semibold">
              {plan.isFetching ? '…' : (plan.data?.count.toLocaleString() ?? '0')}{' '}
              <span className="text-sm font-normal text-stone-500">entries</span>
            </p>
            <p className="mt-2 text-xs text-stone-500">
              {plan.data?.characters.toLocaleString() ?? '…'} input characters ·{' '}
              {plan.data?.protected ?? 0} protected · {plan.data?.muted ?? 0} muted
            </p>
          </div>
          {proposal.operation === 'speech' && (
            <SpeechCostReview
              request={proposal}
              cost={plan.data?.speechCost}
              loading={plan.isFetching}
              languages={book.languages}
            />
          )}
          <p className="mb-4 flex gap-2 text-xs leading-6 text-stone-500">
            <Info size={15} className="mt-1 shrink-0" />
            {mode === 'personal'
              ? 'This calls your selected AI provider using your key. Provider charges apply.'
              : 'This uses your configured service allowance.'}{' '}
            Large books can take time. You can leave the page and return to the running job.
          </p>
          <ErrorNotice error={run.error ?? plan.error} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setProposal(null)}>
              Cancel
            </Button>
            <Button
              disabled={!plan.data?.count || plan.isFetching || plan.isError}
              busy={run.isPending}
              onClick={() => run.mutate()}
            >
              <AudioLines size={16} />
              {proposal.operation === 'normalize'
                ? 'Start normalization'
                : 'Confirm paid generation'}
            </Button>
          </div>
        </Modal>
      )}
      {filesOpen && (
        <Modal title="Language files & assets" onClose={() => setFilesOpen(false)} wide>
          <p className="mb-4 text-sm text-stone-500">
            Download current language catalogs, or inspect the files in your original ADT.
          </p>
          <div className="mb-5 flex flex-wrap gap-2">
            {['texts', 'speech_texts', 'audios'].map((kind) => (
              <FileLink
                filename={`${kind}.json`}
                key={kind}
                href={apiUrl(`/books/${bookId}/catalog?${new URLSearchParams({ language, kind })}`)}
                className="btn btn-secondary text-xs"
              >
                <Download size={14} />
                {language}/{kind}.json
              </FileLink>
            ))}
          </div>
          <ErrorNotice error={files.error} />
          <pre className="max-h-96 overflow-auto rounded-xl bg-stone-50 p-4 text-xs leading-7 text-stone-500">
            {files.data?.join('\n') ?? 'Loading files…'}
          </pre>
        </Modal>
      )}
      {deleteOpen && (
        <Modal title="Delete this workspace?" onClose={() => setDeleteOpen(false)}>
          <p className="mb-5 text-sm leading-6 text-stone-600">
            This removes the uploaded ADT, all recordings and its version history from this server.
            Download your updated ADT first if you want to keep it.
          </p>
          <ErrorNotice error={remove.error} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Keep workspace
            </Button>
            <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              Delete workspace
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}
