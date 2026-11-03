import { useState, type AnchorHTMLAttributes } from 'react'
import { REMOTE_API, downloadFile } from '../hosting'
export function FileLink({
  filename = 'download',
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { filename?: string }) {
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  return (
    <>
      <a
        {...props}
        aria-busy={loading}
        onClick={
          REMOTE_API
            ? (e) => {
                e.preventDefault()
                if (!props.href || loading) return
                setLoading(true)
                setError('')
                void downloadFile(props.href, filename)
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false))
              }
            : props.onClick
        }
      />
      {error && (
        <span role="alert" className="block text-xs text-red-700">
          {error}
        </span>
      )}
    </>
  )
}
