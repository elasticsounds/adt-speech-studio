import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  UploadCloud,
  ArrowUpRight,
  BookOpen,
  Languages,
  AudioLines,
  Plus,
  FileArchive,
} from 'lucide-react'
import type { BookSummary } from '@speech/types'
import { api } from '../api'
import { Button, ErrorNotice } from './ui'

export function Library({
  books,
  onOpen,
  onUploaded,
}: {
  books: BookSummary[]
  onOpen: (id: string) => void
  onUploaded: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null),
    [drag, setDrag] = useState(false)
  const upload = useMutation({ mutationFn: api.upload, onSuccess: (book) => onUploaded(book.id) })
  const take = (file?: File) => {
    if (file) upload.mutate(file)
  }
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 lg:px-10">
      <div className="mb-9 flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-widest text-emerald-800 uppercase">
            Your private library
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">A voice for every book.</h1>
          <p className="mt-3 text-sm text-stone-500">
            Upload an ADT, review its words, and make every page speak.
          </p>
        </div>
        <span className="hidden rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-500 sm:block">
          {books.length} {books.length === 1 ? 'book' : 'books'}
        </span>
      </div>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept=".zip,application/zip"
        aria-label="Upload ADT ZIP"
        onChange={(e) => {
          take(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          if (!upload.isPending) take(e.dataTransfer.files[0])
        }}
        className={`relative mb-7 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? 'border-emerald-600 bg-emerald-50' : 'border-stone-200 bg-white'}`}
      >
        <span className="mb-4 rounded-2xl bg-[#edf4ee] p-4 text-emerald-800">
          <UploadCloud size={28} />
        </span>
        <h2 className="text-lg font-semibold">
          {upload.isPending ? 'Opening your ADT…' : 'Drop your ADT here'}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500">
          Export a reader ZIP from ADT Studio, then bring it here.
          <br />
          Your original book always stays intact.
        </p>
        <Button onClick={() => input.current?.click()} busy={upload.isPending} className="mt-5">
          <Plus size={16} />
          Choose ADT ZIP
        </Button>
        <p className="mt-3 text-[11px] text-stone-400">ZIP files · up to 1 GB</p>
      </div>
      <ErrorNotice error={upload.error} />
      {books.length > 0 ? (
        <>
          <div className="mt-10 mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Your ADTs</h2>
            <p className="text-xs text-stone-400">Only visible to you</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {books.map((book) => (
              <button
                key={book.id}
                onClick={() => onOpen(book.id)}
                className="group rounded-2xl border border-stone-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-700/40 hover:shadow-sm"
              >
                <div className="mb-5 flex items-start justify-between">
                  <span className="rounded-xl bg-[#edf4ee] p-3 text-emerald-800">
                    <BookOpen size={23} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    className="text-stone-300 transition group-hover:text-emerald-800"
                  />
                </div>
                <h3 className="line-clamp-2 min-h-12 font-semibold leading-6">{book.title}</h3>
                <div className="mt-4 flex gap-4 text-xs text-stone-500">
                  <span className="flex items-center gap-1.5">
                    <Languages size={14} />
                    {book.languages.length} languages
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AudioLines size={14} />
                    {book.recorded.toLocaleString()} / {book.total.toLocaleString()}
                  </span>
                </div>
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full bg-emerald-700"
                    style={{ width: `${(book.recorded / Math.max(book.total, 1)) * 100}%` }}
                  />
                </div>
                <p className="mt-3 truncate text-[11px] text-stone-400">
                  Added {new Date(book.createdAt).toLocaleDateString()}
                </p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-5 py-5 sm:grid-cols-3">
          {[
            {
              icon: FileArchive,
              title: 'Bring your book',
              text: 'Works directly with exported reader ZIPs. No original PDF needed.',
            },
            {
              icon: Languages,
              title: 'Check the words',
              text: 'Review each language and edit the text your readers will hear.',
            },
            {
              icon: AudioLines,
              title: 'Give it a voice',
              text: 'Fill missing recordings or change the narrator for the whole book.',
            },
          ].map((item) => (
            <div key={item.title} className="p-3">
              <item.icon size={20} className="mb-3 text-emerald-800" />
              <h3 className="mb-2 text-sm font-semibold">{item.title}</h3>
              <p className="text-xs leading-6 text-stone-500">{item.text}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
