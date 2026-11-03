import { expect, it } from 'vitest'
import { waveformPeaks, activeWord } from '../apps/web/src/components/audio/waveform.js'
it('renders real amplitudes for silence and clips shorter than the waveform bar count', () => {
  expect(waveformPeaks(new Float32Array())).toEqual([])
  expect(waveformPeaks(new Float32Array([0, 0]))).toEqual([0, 0])
  expect(waveformPeaks(new Float32Array([0, 0.5, 1, -0.5]))).toEqual([0, 0.5, 1, 0.5])
})
it('highlights only the word at the seek/playback time, including gaps and clip end', () => {
  const words = [
    { start: 0, end: 0.2 },
    { start: 0.3, end: 0.7 },
  ]
  expect(activeWord(words, 0.1)).toBe(0)
  expect(activeWord(words, 0.2)).toBe(-1)
  expect(activeWord(words, 0.3)).toBe(1)
  expect(activeWord(words, 0.7)).toBe(-1)
})

it('tolerates media-clock rounding at real Whisper word boundaries', () => {
  const words = [
    { start: 0, end: 0.699999988079071 },
    { start: 0.699999988079071, end: 1.100000023841858 },
  ]
  expect(activeWord(words, 0.699999)).toBe(1)
  expect(activeWord(words, 0.65)).toBe(0)
  expect(activeWord(words, 1.1)).toBe(-1)
})
