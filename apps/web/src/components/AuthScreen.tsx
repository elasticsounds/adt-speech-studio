import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Check, FileAudio, ShieldCheck, Sparkles } from 'lucide-react'
import { api } from '../api'
import { Button, ErrorNotice, Field, Logo } from './ui'

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login'),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState(''),
    [recovery, setRecovery] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      api.auth(mode, { username, password, ...(mode === 'recover' ? { recoveryCode: code } : {}) }),
    onSuccess: (data) => {
      if (data.recoveryCode) setRecovery(data.recoveryCode)
      else onSignedIn()
    },
  })
  return (
    <div className="min-h-screen bg-[#f7f8f5] lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative overflow-hidden bg-[#153d34] p-8 text-white lg:p-16">
        <div className="flex items-center gap-3 text-xl font-semibold">
          <span className="rounded-xl bg-white/10 p-2">
            <FileAudio size={25} />
          </span>
          ADT Speech Studio
        </div>
        <div className="mx-auto max-w-lg py-16 lg:py-28">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-emerald-100">
            <Sparkles size={13} /> A little more voice. A lot more access.
          </span>
          <h1 className="text-5xl leading-[1.12] font-semibold tracking-[-0.045em] lg:text-6xl">
            Every word deserves
            <br />
            <span className="text-[#b7ddbd]">to be heard.</span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-emerald-50/70">
            Bring your accessible digital textbook. Review the language, fill the gaps, and find the
            right voice for every page.
          </p>
          <div className="mt-10 flex h-24 items-center gap-1.5 opacity-70" aria-hidden="true">
            {Array.from({ length: 45 }, (_, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-[#b7ddbd]"
                style={{
                  height: `${12 + Math.abs(Math.sin(i * 0.48) * Math.cos(i * 0.16)) * 80}px`,
                }}
              />
            ))}
          </div>
          <div className="mt-10 flex flex-wrap gap-5 text-xs text-emerald-50/70">
            <span className="flex items-center gap-2">
              <Check size={15} />
              Gemini & OpenAI
            </span>
            <span className="flex items-center gap-2">
              <Check size={15} />
              Your original stays safe
            </span>
          </div>
        </div>
        <p className="text-xs text-emerald-100/50">Built for accessible digital textbooks.</p>
      </section>
      <section className="flex min-h-[70vh] items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          {recovery ? (
            <>
              <ShieldCheck className="mb-5 text-emerald-800" size={36} />
              <h2 className="text-2xl font-semibold tracking-tight">Keep your recovery code</h2>
              <p className="my-4 text-sm leading-6 text-stone-500">
                Save this code somewhere safe. You can use it to reset your password. We don’t
                collect an email address.
              </p>
              <code className="mb-4 block break-all rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm select-all">
                {recovery}
              </code>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(recovery)
                }}
                variant="secondary"
                className="mb-3 w-full"
              >
                Copy recovery code
              </Button>
              <Button onClick={onSignedIn} className="w-full">
                Continue to my ADTs <ArrowRight size={16} />
              </Button>
            </>
          ) : (
            <>
              <div className="mb-10 lg:hidden">
                <Logo />
              </div>
              <p className="mb-3 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
                Your speech workspace
              </p>
              <h2 className="text-3xl font-semibold tracking-tight">
                {mode === 'register'
                  ? 'Make yourself at home.'
                  : mode === 'recover'
                    ? 'Let’s get you back in.'
                    : 'Welcome back.'}
              </h2>
              <p className="mt-3 mb-8 text-sm leading-6 text-stone-500">
                {mode === 'register'
                  ? 'Create a free account. Your ADTs are private, and you can bring your own API key.'
                  : mode === 'recover'
                    ? 'Enter your recovery code and choose a new password.'
                    : 'Sign in to give your ADTs a voice.'}
              </p>
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  mutation.mutate()
                }}
              >
                <Field label="Username">
                  <input
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    pattern="[a-z0-9][a-z0-9_-]{2,39}"
                    placeholder="Your username"
                    required
                    minLength={3}
                  />
                </Field>
                <Field
                  label={mode === 'recover' ? 'New password' : 'Password'}
                  hint={mode !== 'login' ? 'At least 12 characters.' : ''}
                >
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder="Your password"
                    required
                    minLength={12}
                  />
                </Field>
                {mode === 'recover' && (
                  <Field label="Recovery code">
                    <input
                      className="input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                  </Field>
                )}
                <ErrorNotice error={mutation.error} />
                <Button busy={mutation.isPending} className="w-full py-3">
                  {mode === 'register'
                    ? 'Create account'
                    : mode === 'recover'
                      ? 'Reset password'
                      : 'Sign in'}
                  <ArrowRight size={16} />
                </Button>
              </form>
              <p className="mt-7 text-center text-sm text-stone-500">
                {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
                <button
                  className="font-semibold text-emerald-800 underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode(mode === 'login' ? 'register' : 'login')
                    mutation.reset()
                  }}
                >
                  {mode === 'login' ? 'Create an account' : 'Sign in'}
                </button>
              </p>
              {mode === 'login' && (
                <button
                  className="mt-4 block w-full text-center text-xs text-stone-500 hover:text-emerald-800"
                  onClick={() => {
                    setMode('recover')
                    mutation.reset()
                  }}
                >
                  Forgot your password?
                </button>
              )}
            </>
          )}
          <p className="mt-12 text-center text-[11px] leading-5 text-stone-400">
            AI-generated speech can make mistakes. Review recordings before sharing.
            <br />
            <a href="/source.zip" className="underline">
              Application source · AGPL-3.0
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}
