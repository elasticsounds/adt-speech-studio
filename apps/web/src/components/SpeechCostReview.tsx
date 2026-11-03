import type { RunRequest, SpeechCost } from '@speech/types'

function dollars(value: number) {
  if (value > 0 && value < 0.0001) return '< $0.0001'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

export function SpeechCostReview({
  request,
  cost,
  loading,
  languages,
}: {
  request: RunRequest
  cost?: SpeechCost
  loading: boolean
  languages: string[]
}) {
  const known = cost?.lowUsd !== undefined && cost.highUsd !== undefined
  const albanian = (request.language === '*' ? languages : [request.language]).some((code) =>
    /^(sq|als|alb)(-|_|$)/i.test(code),
  )
  return (
    <div className="my-4 space-y-3 text-xs leading-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-live="polite">
        <p className="font-medium text-stone-700">Estimated TTS cost (USD)</p>
        <p className="mt-1 text-xl font-semibold text-stone-900">
          {loading
            ? 'Calculating…'
            : known
              ? `${dollars(cost!.lowUsd!)}${cost!.lowUsd === cost!.highUsd ? '' : ` – ${dollars(cost!.highUsd!)}`}`
              : 'Estimate unavailable'}
        </p>
        <p className="mt-2 text-stone-600">
          Assumes all selected recordings are generated fresh. Cached results may reduce charges.
          This is an estimate, not a spending limit; actual charges can exceed it. Retries and taxes
          are extra.
        </p>
        {request.settings.normalize && (
          <p className="mt-2 text-stone-700">
            OpenAI normalization ({request.settings.normalizationModel}) costs extra and is
            excluded. Spoken text and its character count may change after normalization.
          </p>
        )}
        {!loading && cost && (
          <details className="mt-2 text-stone-500">
            <summary className="cursor-pointer">Rates and estimate assumptions</summary>
            <p className="mt-2">{cost.basis}</p>
            <a className="underline" href={cost.sourceUrl} target="_blank" rel="noreferrer">
              Provider pricing · checked {cost.ratesChecked}
            </a>
          </details>
        )}
      </div>
      {request.settings.model === 'gemini-3.8-flash-lite-tts' && albanian && (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
          Albanian is not on Google’s published Flash-Lite language list. Full Gemini 3.8 Flash TTS
          lists Albanian; consider selecting it for this language.{' '}
          <a
            className="underline"
            target="_blank"
            rel="noreferrer"
            href="https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts"
          >
            Supported languages
          </a>
        </p>
      )}
      <p className="font-medium text-stone-800">
        Are you sure you want to {request.scope === 'missing' ? 'generate' : 'regenerate'} these
        recordings?{' '}
        {request.credentialMode === 'personal'
          ? 'Continuing may incur charges on your API key.'
          : 'Continuing may incur charges on the service API key and uses your shared service allowance.'}
      </p>
    </div>
  )
}
