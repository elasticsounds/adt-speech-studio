import { useEffect, useState, type AudioHTMLAttributes } from 'react'
import { REMOTE_API, audioSource } from '../hosting'
export function Recording({
  src,
  ...props
}: AudioHTMLAttributes<HTMLAudioElement> & { src: string }) {
  const [url, setUrl] = useState(REMOTE_API ? '' : src),
    [error, setError] = useState('')
  useEffect(() => {
    if (!REMOTE_API) {
      setUrl(src)
      return
    }
    const controller = new AbortController()
    let objectUrl = ''
    setUrl('')
    setError('')
    void audioSource(src, controller.signal)
      .then((value) => {
        objectUrl = value
        if (controller.signal.aborted) URL.revokeObjectURL(value)
        else setUrl(value)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])
  return error ? (
    <span role="alert" className="text-xs text-red-700">
      {error}
    </span>
  ) : url ? (
    <audio {...props} src={url} />
  ) : (
    <span className="text-xs text-stone-500">Loading recording…</span>
  )
}
