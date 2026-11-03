import { Settings2, Sparkles, ShieldCheck, Info } from 'lucide-react'
import {
  GEMINI_MODELS,
  OPENAI_MODELS,
  GEMINI_VOICES,
  OPENAI_VOICES,
  type Settings,
} from '@speech/types'
import { Field } from './ui'
import { TimestampNotice } from './TimestampNotice'

export function SettingsPanel({
  value,
  onChange,
  disabled,
}: {
  value: Settings
  onChange: (s: Settings) => void
  disabled: boolean
}) {
  const patch = (s: Partial<Settings>) => onChange({ ...value, ...s })
  return (
    <aside className="rounded-2xl border border-stone-200 bg-white p-5 lg:sticky lg:top-5">
      <div className="mb-5 flex items-center gap-2">
        <Settings2 size={17} className="text-stone-500" />
        <h2 className="text-sm font-semibold">Voice & generation</h2>
      </div>
      <fieldset disabled={disabled} className="space-y-5 disabled:opacity-60">
        <Field label="Speech provider">
          <div className="grid grid-cols-2 rounded-lg bg-stone-100 p-1">
            {(['gemini', 'openai'] as const).map((provider) => (
              <button
                key={provider}
                onClick={() =>
                  patch({
                    provider,
                    model: provider === 'gemini' ? GEMINI_MODELS[0] : OPENAI_MODELS[0],
                    voice: provider === 'gemini' ? 'Kore' : 'coral',
                    temperature: undefined,
                  })
                }
                className={`rounded-md px-3 py-2 text-xs font-medium transition ${value.provider === provider ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
              >
                {provider === 'gemini' ? 'Gemini' : 'OpenAI'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Model">
          <select
            aria-label="Model"
            className="input text-xs"
            value={value.model}
            onChange={(e) => patch({ model: e.target.value })}
          >
            {(value.provider === 'gemini' ? GEMINI_MODELS : OPENAI_MODELS).map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Voice"
          hint={
            value.model.startsWith('gemini-3.8')
              ? 'A preset or a regional voice ID supported by your model.'
              : undefined
          }
        >
          <input
            className="input"
            list="voices"
            value={value.voice}
            onChange={(e) => patch({ voice: e.target.value })}
          />
          <datalist id="voices">
            {(value.provider === 'gemini' ? GEMINI_VOICES : OPENAI_VOICES).map((voice) => (
              <option key={voice} value={voice} />
            ))}
          </datalist>
        </Field>
        <Field
          label="Delivery instructions"
          hint="Accent, tone and pace. The words themselves stay the same."
        >
          <textarea
            className="input min-h-24 resize-y text-xs leading-5"
            maxLength={4000}
            value={value.instructions}
            onChange={(e) => patch({ instructions: e.target.value })}
            placeholder="Warm, clear and friendly. Read at a calm pace."
          />
        </Field>
        <details className="rounded-xl border border-stone-200">
          <summary className="cursor-pointer px-3 py-3 text-xs font-medium text-stone-600">
            Advanced voice settings
          </summary>
          <div className="space-y-4 px-3 pb-4">
            {value.provider === 'gemini' ? (
              <Field
                label="Temperature"
                hint="Leave blank for the model default. Very low values may fail on older Gemini models."
              >
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={value.temperature ?? ''}
                  onChange={(e) =>
                    patch({
                      temperature: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              </Field>
            ) : (
              <Field label="Speed">
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0.25"
                  max="4"
                  value={value.speed}
                  onChange={(e) => patch({ speed: Number(e.target.value) })}
                />
              </Field>
            )}
          </div>
        </details>
        <div className="border-t border-stone-100 pt-5">
          <label className="flex cursor-pointer items-start justify-between gap-3">
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles size={14} className="text-emerald-700" />
                Normalize before speech
              </span>
              <span className="mt-2 block text-xs leading-5 text-stone-500">
                Prepare numbers, abbreviations and math with OpenAI.
              </span>
            </span>
            <input
              aria-label="Normalize before speech"
              type="checkbox"
              className="mt-1 accent-emerald-800"
              checked={value.normalize}
              onChange={(e) => patch({ normalize: e.target.checked })}
            />
          </label>
        </div>
        <div className="border-t border-stone-100 pt-5">
          <label className="flex items-start justify-between gap-3 text-sm font-semibold">
            Word-by-word highlighting
            <input
              type="checkbox"
              className="mt-1 accent-emerald-800"
              checked={value.wordHighlighting}
              onChange={(e) => patch({ wordHighlighting: e.target.checked })}
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            Generate word timestamps after speech. Uses an OpenAI key even with Gemini;
            transcription costs extra. Turn off to generate audio only.
          </p>
          {value.wordHighlighting && <TimestampNotice />}
        </div>
        <details className="rounded-xl border border-stone-200">
          <summary className="cursor-pointer px-3 py-3 text-xs font-medium text-stone-600">
            Text preparation settings
          </summary>
          <div className="space-y-4 px-3 pb-4">
            <Field label="Normalization model (OpenAI)">
              <input
                className="input text-xs"
                value={value.normalizationModel}
                onChange={(e) => patch({ normalizationModel: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={value.math}
                onChange={(e) => patch({ math: e.target.checked })}
                className="accent-emerald-800"
              />
              Convert math to spoken words
            </label>
            <Field label="Language guidance">
              <textarea
                className="input min-h-28 text-xs leading-5"
                maxLength={12000}
                value={value.profile}
                onChange={(e) => patch({ profile: e.target.value })}
              />
            </Field>
            <p className="text-xs leading-5 text-stone-500">
              Normalization uses an OpenAI key and preserves your display text. Manually edited
              speech is kept.
            </p>
          </div>
        </details>
      </fieldset>
      <div className="mt-5 flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-[11px] leading-5 text-stone-500">
        <Info size={15} className="mt-0.5 shrink-0" />
        Open a recording’s waveform to review synchronized word highlighting. Generated timestamps
        are included in the downloaded ADT. In recent readers, enable Settings → Highlight → Word.
        Older readers and Easy Read may use sentence highlighting.
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-emerald-800">
        <ShieldCheck size={14} />
        Changing settings never starts a paid job.
      </p>
    </aside>
  )
}
