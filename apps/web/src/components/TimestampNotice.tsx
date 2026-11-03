export function TimestampNotice() {
  return (
    <p className="mt-2 text-[11px] leading-5 text-stone-500">
      Word timestamps use OpenAI Whisper (whisper-1), $0.006 per audio minute. OpenAI has scheduled
      this model’s retirement for February 26, 2027.{' '}
      <a
        className="underline"
        href="https://developers.openai.com/api/docs/models/whisper-1"
        target="_blank"
        rel="noreferrer"
      >
        Provider details
      </a>
    </p>
  )
}
