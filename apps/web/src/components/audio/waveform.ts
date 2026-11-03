export function waveformPeaks(samples: Float32Array, bars = 96) {
  const count = Math.min(bars, samples.length)
  const peaks = Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * samples.length) / count),
      end = Math.floor(((i + 1) * samples.length) / count)
    let power = 0
    for (let j = start; j < end; j++) power += samples[j] * samples[j]
    return Math.sqrt(power / Math.max(1, end - start))
  })
  const maximum = Math.max(0.001, ...peaks)
  return peaks.map((p) => p / maximum)
}
export function activeWord(words: Array<{ start: number; end: number }>, time: number) {
  return words.findIndex((word) => time >= word.start && time < word.end)
}
