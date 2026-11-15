# Generation performance

Owner authorized implementation on 2026-11-15 after reviewing the production investigation and local `tts-generate.mjs` comparison. This records that approved scope before implementation. Independent review is still required before merge; no Fly resize or production restart is authorized by this specification.

## Evidence and decisions

Three speech-only production jobs had been running for about 53 hours. The API repeatedly scans all books for quota checks, holds only two entry slots across all users, and spaces each key's requests by one second. A bounded file-counting probe did not finish in 20 seconds; a separate CPU observation showed about 91% steal time. The local Node script uses the same Gemini 3.8 request with eight adaptive concurrent requests and shares identical in-flight generations.

Keep the provider/model, book format, immutable revisions, account isolation, explicit paid confirmation and single-writer architecture. No new dependency, migration, CPU resize or paid benchmark is needed for the code changes.

## Acceptance criteria

- AC-1: Reconcile book byte totals once per process, then account for successful and partially failed writes, replacements, imports, exports and deletion. Quota checks must not walk existing books per clip. Account/session/service-usage files remain included in the global quota. Restart rebuilds totals from files; external book mutations require a stopped server. Keep admission serialized and retain the free-disk reserve.
- AC-2: Use bounded, configurable job/provider concurrency with cancellation, fair queuing and adaptive reduction/recovery after rate limits. Defaults permit four entry workers per job and eight server-wide, with four provider requests per credential/endpoint pool. Keep all existing credential checks and service allowances; never persist keys. A configured request-start interval remains available for restrictive quotas.
- AC-3: Within a job, identical pending speech requests share generation and reuse its book-local artifact. Forced regeneration still bypasses old cache entries. Failures/cancellation cannot leak slots, publish late audio, reuse across accounts/credentials or prevent retries. Each entry retains its own revision.
- AC-4: Bound intermediate job checkpoint writes while preserving terminal receipts and restart recovery. Record redacted numerical entry timing information in existing inspectable call logs, without changing their public schema or exposing keys/text in server telemetry.

## Verification and rollout

Focused draft PR slices cover storage accounting, request scheduling, and job batching/reuse. Regression tests must exercise byte accounting against actual disk usage (including failed writes and restart), quota races, cancellation, provider backoff and duplicate generation. Run formatting, types/build, unit/API and browser suites with mocked providers. Report synthetic performance measurements separately from real Gemini timings.

Push review branches only. The current Pages deployment branch stays unchanged. Fly deployment/resize requires a separate rollout preserving completed audio and restarting only unfinished entries after active jobs are safely stopped or drained. First benchmark the same uncached English/Albanian entries and key/project as the desktop script; compare provider time, storage time, throughput and retries at concurrency 2, 4 and 8. A performance CPU trial remains a separately approved operational option.
