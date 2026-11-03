import { apiUrl } from '../hosting'
import { FileLink } from './FileLink'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { LoaderCircle, CircleCheck, AlertCircle, List, Square } from 'lucide-react'
import type { Job } from '@speech/types'
import { api } from '../api'
import { Button, ErrorNotice, Modal } from './ui'

export function JobsPanel({
  book,
  job,
  onRefresh,
  onRetry,
}: {
  book: string
  job: Job
  onRefresh: () => void
  onRetry: (ids: string[]) => void
}) {
  const [logsOpen, setLogsOpen] = useState(false)
  const logs = useQuery({
    queryKey: ['logs', book, job.id, job.completed, job.failed],
    queryFn: () => api.logs(book, job.id),
    enabled: logsOpen,
  })
  const cancel = useMutation({ mutationFn: () => api.cancel(book, job.id), onSuccess: onRefresh })
  const finished = job.completed + job.failed,
    percent = Math.round((finished / Math.max(1, job.total)) * 100),
    running = job.status === 'running'
  const failed = job.results.filter((r) => r.status === 'failed')
  const pending = job.request.ids.filter(
    (id) => !job.results.some((r) => r.id === id && r.status !== 'failed'),
  )
  return (
    <div
      className={`mb-5 rounded-xl border p-4 ${job.failed ? 'border-amber-200 bg-amber-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {running ? (
            <LoaderCircle size={17} className="animate-spin text-emerald-800" />
          ) : job.failed ? (
            <AlertCircle size={17} className="text-amber-600" />
          ) : (
            <CircleCheck size={17} className="text-emerald-800" />
          )}
          {running
            ? job.request.operation === 'normalize'
              ? 'Preparing spoken text…'
              : 'Recording your ADT…'
            : job.status === 'completed'
              ? 'Generation finished'
              : job.status === 'cancelled'
                ? 'Generation cancelled'
                : job.status === 'interrupted'
                  ? 'Generation interrupted'
                  : 'Generation stopped'}
        </div>
        <span className="text-xs text-stone-500">
          {finished} of {job.total} · {job.cached} reused
          {job.failed ? ` · ${job.failed} failed` : ''}
        </span>
      </div>
      <div className="my-3 h-1.5 overflow-hidden rounded-full bg-emerald-100">
        <div
          className="h-full bg-emerald-700 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-stone-500">
          {job.request.operation === 'normalize'
            ? job.request.settings.normalizationModel
            : `${job.request.settings.model} · ${job.request.settings.voice}`}{' '}
          · {job.language === '*' ? 'All languages' : job.language}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="min-h-7 px-2 py-1 text-xs"
            onClick={() => setLogsOpen(true)}
          >
            <List size={13} />
            Details
          </Button>
          {running ? (
            <Button
              variant="secondary"
              className="min-h-7 px-2 py-1 text-xs"
              busy={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <Square size={12} />
              Cancel
            </Button>
          ) : pending.length > 0 ? (
            <Button
              variant="secondary"
              className="min-h-7 px-2 py-1 text-xs"
              onClick={() => onRetry(pending)}
            >
              Retry unfinished ({pending.length})
            </Button>
          ) : failed.length > 0 ? (
            <Button
              variant="secondary"
              className="min-h-7 px-2 py-1 text-xs"
              onClick={() => onRetry(failed.map((r) => r.id))}
            >
              Retry failed
            </Button>
          ) : null}
        </div>
      </div>
      {failed[0] && <p className="mt-3 text-xs leading-5 text-amber-800">{failed[0].error}</p>}
      <ErrorNotice error={cancel.error} />
      {logsOpen && (
        <Modal title="Generation details" onClose={() => setLogsOpen(false)} wide>
          <p className="mb-4 text-sm text-stone-500">
            Recent requests and outcomes for this job. API credentials are excluded.
          </p>
          <FileLink
            filename="generation-log.jsonl"
            className="mb-4 inline-flex text-xs font-medium text-emerald-800 underline"
            href={apiUrl(`/books/${book}/jobs/${job.id}/logs?download=1`)}
          >
            Download complete log
          </FileLink>
          <ErrorNotice error={logs.error} />
          <div className="space-y-3">
            {logs.data?.length ? (
              logs.data.map((log, i) => (
                <details key={i} className="rounded-xl border border-stone-200 p-4">
                  <summary className="cursor-pointer text-xs font-medium">
                    {log.status} · {log.entryId} · {log.operation} · {log.model}
                  </summary>
                  <div className="mt-3 space-y-3 text-xs">
                    <p className="text-stone-400">
                      {new Date(log.at).toLocaleString()} · Attempt {log.attempt}
                    </p>
                    <p className="font-semibold">Input</p>
                    <pre className="whitespace-pre-wrap break-words rounded bg-stone-50 p-3">
                      {log.input}
                    </pre>
                    <p className="font-semibold">Instructions</p>
                    <pre className="whitespace-pre-wrap break-words rounded bg-stone-50 p-3">
                      {log.instructions || 'Default'}
                    </pre>
                    <p className="font-semibold">Result</p>
                    <pre className="whitespace-pre-wrap break-words rounded bg-stone-50 p-3">
                      {log.response}
                    </pre>
                  </div>
                </details>
              ))
            ) : (
              <p className="text-sm text-stone-500">No completed requests yet.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
