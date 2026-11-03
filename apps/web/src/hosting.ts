export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '')
export const REMOTE_API = !!API_ORIGIN && API_ORIGIN !== location.origin
export const SOURCE_URL = `${import.meta.env.BASE_URL}source.zip`
const SESSION_KEY = `adt-session:${API_ORIGIN}`
export function sessionToken() {
  return REMOTE_API ? sessionStorage.getItem(SESSION_KEY) : null
}
export function setSessionToken(token: string | null) {
  if (token) sessionStorage.setItem(SESSION_KEY, token)
  else sessionStorage.removeItem(SESSION_KEY)
}
export function apiUrl(route: string) {
  return `${API_ORIGIN}/api${route}`
}
export async function fetchApi(route: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers),
    token = sessionToken()
  if (REMOTE_API && token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(apiUrl(route), {
    ...options,
    headers,
    credentials: REMOTE_API ? 'omit' : 'same-origin',
  })
}
export async function downloadFile(url: string, filename: string) {
  if (!REMOTE_API) {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    return
  }
  const parsed = new URL(url, location.href)
  if (parsed.origin !== new URL(API_ORIGIN).origin || !parsed.pathname.startsWith('/api/'))
    throw new Error('Invalid download location.')
  const response = await fetchApi(parsed.pathname.slice(4) + parsed.search)
  if (!response.ok)
    throw new Error((await response.json().catch(() => null))?.error ?? 'Download failed.')
  const actual =
    response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? filename
  const blob = URL.createObjectURL(await response.blob()),
    a = document.createElement('a')
  a.href = blob
  a.download = actual
  a.click()
  setTimeout(() => URL.revokeObjectURL(blob), 60000)
}
export async function audioSource(url: string, signal?: AbortSignal) {
  if (!REMOTE_API) return url
  const parsed = new URL(url),
    response = await fetchApi(parsed.pathname.slice(4) + parsed.search, { signal })
  if (!response.ok) throw new Error('Unable to load this recording.')
  return URL.createObjectURL(await response.blob())
}
