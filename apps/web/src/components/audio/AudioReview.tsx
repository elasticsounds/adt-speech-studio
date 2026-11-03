import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Entry, VoiceSlot } from '@speech/types'
import { Play, Pause } from 'lucide-react'
import { api, audioUrl } from '../../api'
import { Button, ErrorNotice } from '../ui'
import { useWaveform } from './useWaveform'
import { activeWord } from './waveform'
import { TimingEditor } from './TimingEditor'

const timeLabel = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`
export function AudioReview({
  book,
  entry,
  slot,
  onUpdated,
  disabled = false,
  onGenerate,
}: {
  book: string
  entry: Entry
  slot: VoiceSlot
  onUpdated: () => void
  disabled?: boolean
  onGenerate?: () => void
}) {
  const source = useWaveform(audioUrl(book, entry, slot)),
    ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1),
    [highlight, setHighlight] = useState(true),
    [selected, setSelected] = useState<number | null>(null),
    [error, setError] = useState('')
  const timings = useQuery({
    queryKey: ['timings', book, entry.language, entry.id, entry.version, slot],
    queryFn: () => api.timings(book, entry, slot),
  })
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      setTime(ref.current?.currentTime ?? 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])
  const seek = (value: number) => {
    if (ref.current) {
      ref.current.currentTime = Math.max(0, Math.min(duration, value))
      setTime(ref.current.currentTime)
    }
  }
  const words = timings.data?.words ?? [],
    active = highlight ? activeWord(words, time) : -1
  return (
    <div className="space-y-3" data-testid="audio-review">
      <audio
        ref={ref}
        src={source.url || undefined}
        preload="metadata"
        onLoadedMetadata={() =>
          setDuration(Number.isFinite(ref.current?.duration) ? ref.current!.duration : 0)
        }
        onPlay={() => {
          document.querySelectorAll('audio').forEach((a) => {
            if (a !== ref.current) a.pause()
          })
          setPlaying(true)
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setTime(ref.current?.currentTime ?? 0)}
        onError={() => {
          if (source.url) setError('Unable to play this recording.')
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          disabled={!source.url}
          onClick={() => {
            if (playing) ref.current?.pause()
            else void ref.current?.play().catch(() => setError('Unable to play this recording.'))
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        <span className="text-xs tabular-nums text-stone-600">
          {timeLabel(time)} / {timeLabel(duration)}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs">
          Speed
          <select
            className="input !w-auto !py-1 text-xs"
            value={speed}
            onChange={(e) => {
              const s = Number(e.target.value)
              setSpeed(s)
              if (ref.current) ref.current.playbackRate = s
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="relative h-20 rounded-lg bg-stone-100 p-2" data-testid="audio-waveform">
        {source.peaks.length ? (
          <svg
            viewBox="0 0 100 48"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label="Audio waveform"
          >
            {source.peaks.map((peak, i) => (
              <rect
                key={i}
                x={(i * 100) / source.peaks.length}
                y={24 - Math.max(1, peak * 23)}
                width={Math.max(0.25, 85 / source.peaks.length)}
                height={Math.max(2, peak * 46)}
                rx="0.3"
                className={
                  i / source.peaks.length <= time / Math.max(0.01, duration)
                    ? 'fill-emerald-700'
                    : 'fill-stone-400'
                }
              />
            ))}
          </svg>
        ) : (
          <p className="pt-5 text-center text-xs text-stone-500">
            {source.error
              ? 'Waveform unavailable'
              : source.url
                ? 'Decoding waveform…'
                : 'Loading recording…'}
          </p>
        )}
        <input
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:opacity-30"
          type="range"
          aria-label="Seek recording"
          min={0}
          max={duration || 0.01}
          step="0.01"
          value={Math.min(time, duration)}
          disabled={!duration}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>
      {(source.error || error) && (
        <p role="alert" className="text-xs text-amber-800">
          {source.error || error}
        </p>
      )}
      <ErrorNotice error={timings.error} />
      {timings.data ? (
        <>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="accent-emerald-800"
              checked={highlight}
              onChange={(e) => setHighlight(e.target.checked)}
            />
            Highlight each word during playback
          </label>
          <p className="text-[11px] text-stone-500">
            Timed transcript · {words.length} words ·{' '}
            {entry.audios[slot]?.timings?.source ?? 'imported'}. Click a word to seek or edit its
            timing.
          </p>
          <div
            className="max-h-52 overflow-auto rounded-xl bg-white p-3 text-sm leading-8"
            aria-label="Timed transcript"
          >
            {words.map((word, i) => (
              <span key={i}>
                <button
                  type="button"
                  aria-label={`Seek to word ${i + 1}: ${word.word}`}
                  aria-current={active === i ? 'true' : undefined}
                  title={`${word.start.toFixed(2)}–${word.end.toFixed(2)} seconds`}
                  className={`rounded px-1 ${active === i ? 'bg-emerald-700 text-white' : selected === i ? 'bg-emerald-100 text-emerald-950' : 'text-stone-700 hover:bg-stone-100'}`}
                  onClick={() => {
                    seek(word.start)
                    setSelected(i)
                  }}
                >
                  {word.word}
                </button>{' '}
              </span>
            ))}
          </div>
          {selected !== null && (
            <TimingEditor
              key={`${entry.version}/${selected}`}
              book={book}
              entry={entry}
              slot={slot}
              timings={timings.data}
              index={selected}
              onSaved={onUpdated}
              disabled={disabled}
            />
          )}
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer">Word timecodes (seconds)</summary>
            <div className="max-h-52 overflow-auto">
              <table className="mt-2 w-full text-left">
                <thead>
                  <tr>
                    <th>Word</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {words.map((w, i) => (
                    <tr key={i}>
                      <td>{w.word}</td>
                      <td>{w.start.toFixed(2)}</td>
                      <td>{w.end.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="text-xs text-stone-500">
          {timings.isPending
            ? 'Loading word timings…'
            : 'No current word timestamps. Generate them to enable synchronized highlighting.'}
        </p>
      )}
      {onGenerate && (
        <Button
          variant="secondary"
          className="text-xs"
          disabled={disabled || !!entry.audios[slot]?.stale}
          onClick={onGenerate}
        >
          {timings.data ? 'Regenerate word timestamps' : 'Generate word timestamps'}
        </Button>
      )}
    </div>
  )
}
