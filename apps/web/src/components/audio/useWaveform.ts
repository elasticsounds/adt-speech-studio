import { useEffect, useState } from 'react'
import { fetchApi } from '../../hosting'
import { waveformPeaks } from './waveform'

export function useWaveform(src: string) {
  const [state, setState] = useState<{ url: string; peaks: number[]; error: string }>({
    url: '',
    peaks: [],
    error: '',
  })
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    setState({ url: '', peaks: [], error: '' })
    void (async () => {
      const url = new URL(src, location.href)
      const response = await fetchApi(url.pathname.slice(4) + url.search, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error('Unable to load the recording.')
      if (Number(response.headers.get('content-length')) > 64 * 1024 ** 2)
        throw new Error('This recording is too large for waveform preview. Download it to listen.')
      const blob = await response.blob()
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setState({ url: objectUrl, peaks: [], error: '' })
      let context: AudioContext | undefined
      try {
        context = new AudioContext()
        const decoded = await context.decodeAudioData(await blob.arrayBuffer())
        if (!controller.signal.aborted)
          setState({ url: objectUrl, peaks: waveformPeaks(decoded.getChannelData(0)), error: '' })
      } catch {
        if (!controller.signal.aborted)
          setState({
            url: objectUrl,
            peaks: [],
            error: 'Waveform unavailable; audio playback is still available.',
          })
      } finally {
        await context?.close()
      }
    })().catch((e) => {
      if (!controller.signal.aborted) setState({ url: '', peaks: [], error: e.message })
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])
  return state
}
