import { fetchApi, apiUrl, REMOTE_API, sessionToken, setSessionToken } from './hosting'
import type {
  Credentials,
  BookSummary,
  BookDetail,
  Entry,
  Job,
  RunPlan,
  RunRequest,
  PublicUser,
  ServerInfo,
  CallLog,
} from '@speech/types'

async function request<T>(url: string, options: RequestInit = {}, keys?: Credentials): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.method && options.method !== 'GET') headers.set('X-Requested-With', 'ADTSpeech')
  if (options.body && typeof options.body === 'string')
    headers.set('Content-Type', 'application/json')
  if (keys?.gemini) headers.set('X-Gemini-API-Key', keys.gemini)
  if (keys?.openai) headers.set('X-OpenAI-Key', keys.openai)
  const response = await fetchApi(url, { ...options, headers })
  const data = await response
    .json()
    .catch(() => ({ error: 'The server returned an unexpected response.' }))
  if (!response.ok) throw new Error(data.error ?? 'Request failed.')
  return data as T
}
const post = <T>(url: string, body: unknown, keys?: Credentials) =>
  request<T>(url, { method: 'POST', body: JSON.stringify(body) }, keys)
export const api = {
  me: () =>
    REMOTE_API && !sessionToken()
      ? Promise.resolve({ user: null })
      : request<{ user: PublicUser | null }>('/auth/me'),
  auth: (mode: string, body: unknown) =>
    post<{ user: PublicUser; recoveryCode?: string }>(`/auth/${mode}`, body),
  logout: () => post('/auth/logout', {}).finally(() => setSessionToken(null)),
  connect: (state: string) =>
    post<{ token: string; origin: string; state: string }>('/auth/connect', { state }),
  info: () => request<ServerInfo>('/info'),
  books: () => request<BookSummary[]>('/books'),
  book: (id: string) => request<BookDetail>(`/books/${id}`),
  upload: (file: File) =>
    request<BookSummary>('/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    }),
  remove: (id: string) => request(`/books/${id}`, { method: 'DELETE' }),
  edit: (book: string, body: unknown) =>
    request<Entry>(`/books/${book}/entry`, { method: 'PUT', body: JSON.stringify(body) }),
  history: (book: string, e: Entry) =>
    request<Entry[]>(
      `/books/${book}/history?${new URLSearchParams({ language: e.language, id: e.id })}`,
    ),
  restore: (book: string, body: unknown) => post<Entry>(`/books/${book}/restore`, body),
  uploadAudio: (book: string, data: FormData) =>
    request<Entry>(`/books/${book}/audio`, { method: 'POST', body: data }),
  jobs: (book: string) => request<Job[]>(`/books/${book}/jobs`),
  plan: (book: string, body: RunRequest) => post<RunPlan>(`/books/${book}/plan`, body),
  run: (book: string, body: RunRequest, keys: Credentials) =>
    post<Job>(`/books/${book}/jobs`, body, keys),
  cancel: (book: string, job: string) => post(`/books/${book}/jobs/${job}/cancel`, {}),
  logs: (book: string, job: string) => request<CallLog[]>(`/books/${book}/jobs/${job}/logs`),
  export: (book: string) => post<{ id: string }>(`/books/${book}/export`, {}),
  files: (book: string) => request<string[]>(`/books/${book}/files`),
}
export const audioUrl = (book: string, entry: Entry, slot = 'primary', download = false) =>
  apiUrl(
    `/books/${book}/audio?${new URLSearchParams({ language: entry.language, id: entry.id, slot, version: String(entry.version), ...(download ? { download: '1' } : {}) })}`,
  )
