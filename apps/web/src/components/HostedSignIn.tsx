import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { API_ORIGIN, SOURCE_URL, setSessionToken } from '../hosting'
import { api } from '../api'
import { Button, ErrorNotice, Logo } from './ui'

export function HostedSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [error, setError] = useState(''),
    [waiting, setWaiting] = useState(false)
  const pending = useRef<{ popup: Window; state: string } | null>(null)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== API_ORIGIN ||
        event.source !== pending.current?.popup ||
        event.data?.state !== pending.current?.state ||
        event.data?.type !== 'adt-connected' ||
        typeof event.data?.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(event.data.token)
      )
        return
      setSessionToken(event.data.token)
      pending.current = null
      setWaiting(false)
      onSignedIn()
    }
    window.addEventListener('message', receive)
    const timer = setInterval(() => {
      if (pending.current?.popup.closed) {
        pending.current = null
        setWaiting(false)
      }
    }, 500)
    return () => {
      window.removeEventListener('message', receive)
      clearInterval(timer)
    }
  }, [onSignedIn])
  const signIn = () => {
    if (pending.current && !pending.current.popup.closed) {
      pending.current.popup.focus()
      return
    }
    setError('')
    const state = crypto.randomUUID(),
      popup = window.open(
        `${API_ORIGIN}/?connect=1&state=${state}`,
        '_blank',
        'popup,width=1040,height=850',
      )
    if (!popup) {
      setError('Allow the sign-in window to open, then try again.')
      return
    }
    pending.current = { popup, state }
    setWaiting(true)
  }
  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f8f5] p-6">
      <main className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-9 shadow-sm">
        <Logo />
        <h1 className="mt-10 text-3xl font-semibold tracking-tight">A voice for every book.</h1>
        <p className="mt-4 text-sm leading-7 text-stone-500">
          Review your ADT’s language, fill missing recordings, and choose a new narrator.
        </p>
        <p className="my-6 text-sm leading-7 text-stone-500">
          Sign in or create an account in the secure window, then return to your workspace here.
        </p>
        <ErrorNotice error={error} />
        <Button onClick={signIn} className="mt-4 w-full">
          {waiting ? 'Return to sign-in window' : 'Sign in or create an account'}
        </Button>
        <p className="mt-6 text-xs leading-6 text-stone-400">
          Interface hosted on GitHub Pages. Private books and speech generation run on our Fly
          server.
        </p>
        <a className="mt-4 block text-xs text-stone-400 underline" href={SOURCE_URL}>
          Application source · AGPL-3.0
        </a>
      </main>
    </div>
  )
}

export function ConnectionGrant({ username }: { username: string }) {
  const state = new URLSearchParams(location.search).get('state') ?? ''
  const grant = useMutation({
    mutationFn: () => api.connect(state),
    onSuccess: (result) => {
      if (!window.opener)
        throw new Error(
          'The original window was closed. Return to the workspace and sign in again.',
        )
      window.opener.postMessage(
        { type: 'adt-connected', token: result.token, state: result.state },
        result.origin,
      )
      window.close()
    },
  })
  return (
    <div className="grid min-h-screen place-items-center bg-[#f7f8f5] p-6">
      <main className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold">Continue as {username}</h1>
        <p className="my-5 text-sm leading-6 text-stone-500">
          Return to ADT Speech Studio on GitHub Pages. Your books stay private to your account.
        </p>
        <ErrorNotice error={grant.error} />
        <Button busy={grant.isPending} onClick={() => grant.mutate()} className="w-full">
          Continue to GitHub workspace
        </Button>
      </main>
    </div>
  )
}
