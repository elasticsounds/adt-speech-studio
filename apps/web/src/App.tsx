import { REMOTE_API, SOURCE_URL } from './hosting'
import { HostedSignIn, ConnectionGrant } from './components/HostedSignIn'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, KeyRound, LogOut, ChevronRight, ExternalLink } from 'lucide-react'
import type { Credentials } from '@speech/types'
import { api } from './api'
import { AuthScreen } from './components/AuthScreen'
import { Library } from './components/Library'
import { Workspace } from './components/Workspace'
import { CredentialsDialog } from './components/CredentialsDialog'
import { Logo, ErrorNotice } from './components/ui'

export default function App() {
  const client = useQueryClient(),
    me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const books = useQuery({ queryKey: ['books'], queryFn: api.books, enabled: !!me.data?.user })
  const info = useQuery({ queryKey: ['info'], queryFn: api.info, enabled: !!me.data?.user })
  const [book, setBook] = useState(new URLSearchParams(location.search).get('book') ?? ''),
    [keys, setKeys] = useState<Credentials>({}),
    [keyDialog, setKeyDialog] = useState(false),
    [mode, setMode] = useState<'personal' | 'service'>('personal')
  const open = (id: string) => {
    setBook(id)
    history.replaceState(null, '', id ? `?book=${id}` : location.pathname)
    window.scrollTo(0, 0)
  }
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      setKeys({})
      open('')
      client.clear()
      void client.invalidateQueries({ queryKey: ['me'] })
    },
  })
  if (me.isPending)
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f8f5]">
        <Logo />
      </div>
    )
  if (!me.data?.user && REMOTE_API)
    return (
      <HostedSignIn
        onSignedIn={() => {
          void client.invalidateQueries({ queryKey: ['me'] })
        }}
      />
    )
  if (!me.data?.user)
    return (
      <AuthScreen
        onSignedIn={() => {
          void client.invalidateQueries({ queryKey: ['me'] })
        }}
      />
    )
  if (!REMOTE_API && new URLSearchParams(location.search).get('connect') === '1')
    return <ConnectionGrant username={me.data.user.username} />
  const current = books.data?.find((b) => b.id === book)
  return (
    <div className="min-h-screen bg-[#f7f8f5]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-stone-200 bg-[#f4f5f0] p-5 lg:flex">
        <div className="mb-10 mt-2">
          <Logo />
        </div>
        <button
          onClick={() => open('')}
          className={`mb-6 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${!book ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:bg-white/60'}`}
        >
          <BookOpen size={17} />
          My ADTs
          <span className="ml-auto rounded-md bg-stone-100 px-1.5 text-xs text-stone-500">
            {books.data?.length ?? 0}
          </span>
        </button>
        <p className="mb-3 px-3 text-[10px] font-semibold tracking-widest text-stone-400 uppercase">
          Recent workspaces
        </p>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {books.data?.slice(0, 12).map((b) => (
            <button
              key={b.id}
              onClick={() => open(b.id)}
              className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-xs leading-5 ${book === b.id ? 'bg-[#e3ece2] font-medium text-emerald-900' : 'text-stone-500 hover:bg-white/70'}`}
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-40" />
              <span className="line-clamp-2">{b.title}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-xl border border-stone-200 bg-white/70 p-3">
          <p className="mb-1 text-xs font-semibold text-emerald-950">Made for listening.</p>
          <p className="text-[11px] leading-5 text-stone-500">
            Same book. A new voice.
            <br />
            Your original is always preserved.
          </p>
        </div>
        <a
          href={SOURCE_URL}
          className="mt-4 flex items-center gap-1.5 px-2 text-[10px] text-stone-400"
        >
          Source code · AGPL-3.0 <ExternalLink size={10} />
        </a>
      </aside>
      <div className="lg:pl-60">
        <header className="flex min-h-17 items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <button onClick={() => open('')} className="shrink-0 font-medium text-stone-500">
              My ADTs
            </button>
            {book && (
              <>
                <ChevronRight size={13} className="shrink-0 text-stone-300" />
                <span className="truncate text-stone-700">{current?.title ?? 'Workspace'}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              aria-label="AI connection"
              onClick={() => setKeyDialog(true)}
              className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${keys.gemini || keys.openai || mode === 'service' ? 'bg-emerald-500' : 'bg-amber-400'}`}
              />
              <KeyRound size={13} />
              <span className="hidden sm:inline">AI connection</span>
            </button>
            <span className="hidden text-xs text-stone-500 sm:block">{me.data.user.username}</span>
            <button
              className="icon-button text-stone-400"
              aria-label="Sign out"
              onClick={() => logout.mutate()}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <ErrorNotice error={books.error ?? logout.error} />
        {book ? (
          <Workspace
            key={book}
            bookId={book}
            keys={keys}
            mode={mode}
            info={info.data}
            onBack={() => open('')}
            onKeys={() => setKeyDialog(true)}
          />
        ) : (
          <Library
            books={books.data ?? []}
            onOpen={open}
            onUploaded={(id) => {
              void client.invalidateQueries({ queryKey: ['books'] })
              open(id)
            }}
          />
        )}
      </div>
      {keyDialog && (
        <CredentialsDialog
          keys={keys}
          setKeys={setKeys}
          mode={mode}
          setMode={setMode}
          info={info.data}
          onClose={() => setKeyDialog(false)}
        />
      )}
    </div>
  )
}
