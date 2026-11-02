import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { X, LoaderCircle, AlertCircle, AudioLines } from 'lucide-react'

export function Button({
  children,
  variant = 'primary',
  busy = false,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  busy?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`btn ${variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : variant === 'ghost' ? 'btn-ghost' : 'btn-secondary'} ${className}`}
    >
      {busy && <LoaderCircle size={16} className="animate-spin" />}
      {children}
    </button>
  )
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      <AlertCircle className="mt-0.5 shrink-0" size={16} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  ) : null
}
export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-900 text-white">
        <AudioLines size={23} />
      </span>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">ADT Speech Studio</div>
        <div className="mt-0.5 text-[11px] font-medium tracking-[0.13em] text-stone-500 uppercase">
          Words into voices
        </div>
      </div>
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={`fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-2xl border border-stone-200 bg-white p-0 shadow-2xl backdrop:bg-stone-950/40 ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
      aria-label={title}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="text-xs font-semibold text-stone-600">{label}</span>
        {children}
      </label>
      {hint && <p className="text-xs leading-relaxed text-stone-500">{hint}</p>}
    </div>
  )
}
export function Status({
  entry,
  slot = 'primary',
}: {
  entry: {
    muted: boolean
    speechText: string
    audios: Record<
      string,
      { exists: boolean; source: string; textHash?: string; stale?: boolean } | undefined
    >
  }
  slot?: string
}) {
  const a = entry.audios[slot]
  const label = entry.muted
    ? 'Muted'
    : !a?.exists
      ? 'Missing'
      : a.stale
        ? 'Outdated'
        : a.source === 'manual'
          ? 'Manual'
          : 'Ready'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ${label === 'Missing' || label === 'Outdated' ? 'bg-amber-50 text-amber-700' : label === 'Muted' ? 'bg-stone-100 text-stone-500' : label === 'Manual' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-800'}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${label === 'Missing' || label === 'Outdated' ? 'bg-amber-400' : label === 'Muted' ? 'bg-stone-400' : label === 'Manual' ? 'bg-blue-400' : 'bg-emerald-500'}`}
      />
      {label}
    </span>
  )
}
