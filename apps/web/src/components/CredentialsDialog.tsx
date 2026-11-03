import { KeyRound, ShieldCheck, ExternalLink } from 'lucide-react'
import type { Credentials, ServerInfo } from '@speech/types'
import { Button, Field, Modal } from './ui'

export function CredentialsDialog({
  keys,
  setKeys,
  mode,
  setMode,
  info,
  onClose,
}: {
  keys: Credentials
  setKeys: (keys: Credentials) => void
  mode: 'personal' | 'service'
  setMode: (mode: 'personal' | 'service') => void
  info?: ServerInfo
  onClose: () => void
}) {
  return (
    <Modal title="AI connection" onClose={onClose}>
      <div className="mb-6 flex items-start gap-3 rounded-xl bg-emerald-50 p-4">
        <ShieldCheck className="shrink-0 text-emerald-800" size={20} />
        <p className="text-sm leading-6 text-emerald-950">
          Keys stay in this browser session and are sent securely for your jobs. They are never
          saved in your ADT.
        </p>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <Button
          variant={mode === 'personal' ? 'primary' : 'secondary'}
          onClick={() => setMode('personal')}
        >
          Use my keys
        </Button>
        <Button
          variant={mode === 'service' ? 'primary' : 'secondary'}
          disabled={!info?.service.gemini && !info?.service.openai}
          onClick={() => setMode('service')}
        >
          Service allowance
        </Button>
      </div>
      {mode === 'personal' ? (
        <div className="space-y-5">
          <Field label="Google / Gemini API key" hint="Used for Gemini speech generation.">
            <input
              type="password"
              className="input font-mono"
              autoComplete="off"
              placeholder="Paste your Gemini key"
              value={keys.gemini ?? ''}
              onChange={(e) => setKeys({ ...keys, gemini: e.target.value.trim() })}
            />
          </Field>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800"
          >
            Get a Gemini API key <ExternalLink size={12} />
          </a>
          <Field
            label="OpenAI API key"
            hint="Required for word timestamps, text normalization and OpenAI speech."
          >
            <input
              type="password"
              className="input font-mono"
              autoComplete="off"
              placeholder="Paste your OpenAI key"
              value={keys.openai ?? ''}
              onChange={(e) => setKeys({ ...keys, openai: e.target.value.trim() })}
            />
          </Field>
          <p className="text-xs leading-5 text-stone-500">
            Generation is billed by the provider to your API account. A key with billing and access
            to your selected model is required.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 p-4">
          <p className="font-semibold">
            {info?.remainingCharacters.toLocaleString()} characters remaining today
          </p>
          <p className="mt-2 text-sm text-stone-500">
            Shared generation is limited per account. Retries also use the allowance.
          </p>
        </div>
      )}
      <Button onClick={onClose} className="mt-7 w-full">
        <KeyRound size={16} /> Done
      </Button>
    </Modal>
  )
}
