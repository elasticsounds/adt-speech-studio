# Release verification — 2026-11-02

## Automated

- `pnpm test`: 52 passing tests across provider contracts, streaming WAV handling, ZIP security/preservation, account isolation, CSRF, recovery, exact-origin CORS and separate bearer sessions, immutable history, cancellation, cache behavior, quotas, manual protection, normalization, secondary narration and interrupted-job recovery.
- `pnpm build`: strict TypeScript compilation, Vite frontend and esbuild API production build passed.
- `pnpm test:e2e`: three Chromium tests passed: the desktop workflow (including mobile workspace layout), mobile sign-in, and the separate-origin GitHub Pages workflow. Desktop covers sign-up, import, inspection, speech edit, key connection, missing generation, voice change, all-language generation, playback, search and downloaded ZIP contents. The test provider is mocked and absent from the production bundle.

- `pnpm audit --prod`: no known vulnerabilities. Zod was upgraded to 4.6.7 after the audit identified CVE-2023-54404 in the initial version.

## Live provider

OpenAI `gpt-4o-mini-tts` with `coral` returned a valid 249,644-byte WAV for a short English line. An actual OpenAI streaming WAV exposed unknown-length header markers; the implementation now finalizes those markers and has a regression test. A second live request generated an 82-character Albanian image description for the real ADT below (352,844 bytes).

**Gemini 3.8 Flash TTS is now live-verified with the service key in the normalization follow-up below.** Automated tests check the legacy generateContent PCM contract and Gemini 3.8 interactions audio/style metadata contract, as well as missing-audio failures, credentials and cancellation. Model access and provider quotas still depend on the user's key.

## Real reader archive

Source: the public `elasticsounds/Libri_new-adt-2` GitHub archive, revision `137054f` (downloaded 2026-11-02), a 316 MB ZIP containing _Ndryshimet Klimatike_. The reader has 100 Albanian language entries, images, videos, reader scripts, activities and an offline preloader.

- Streaming import found the wrapped reader root and all 100 entries.
- A spoken-text edit exported successfully; all 226 other original files were byte-identical. Only the existing offline preloader changed; a speech catalog was added.
- A real OpenAI-generated recording was overlaid for `pg002003_im002`. All 225 other original files were byte-identical; only the existing audio map and offline preloader changed. The generated WAV and speech catalog were added.
- The updated reader opened in Chromium with no page errors. Its generated WAV loaded with a 7.35-second duration.
- Test data, downloaded book content, provider credentials and recordings are excluded from the repository and the application source archive.

## Hosted smoke test

At https://adt-speech-studio.fly.dev, a fresh account uploaded the complete 316 MB reader in Chromium, displayed all 100 entries, connected a personal OpenAI key, generated `pg002003_im002`, played the recording and downloaded a 316,425,706-byte updated ZIP. The generated WAV was 379,244 bytes. The exported reader HTML, quiz HTML, reader runtime and display-text catalog matched the original byte-for-byte. No browser page errors occurred. The temporary production book was deleted after verification.

The first deployment exposed an upload-admission bug caused by scanning the volume's root-owned `lost+found` directory. Storage accounting now scans only application-owned directories; a regression test covers this. Shared model credentials were disabled for the initial release; the owner has since enabled Gemini and OpenAI service secrets with daily allowances. The deployed health check and corresponding source archive were verified successfully.

## Operating boundaries

One API process and persistent volume are required. The initial deployment uses private accounts with personal keys and disables shared service-funded calls. No new word alignment, translation generation, additional language creation or full Studio project import is included. See README for retention, backup and quota behavior.

## GitHub Pages follow-up

The local Pages build is served under `/adt-speech-studio/` on a different hostname from the API. Its browser test signs up in a first-party popup, grants a separate session, deletes backend cookies, reloads, uploads a reader, plays authenticated audio, generates missing speech with the mock provider, downloads original and updated ZIPs, and signs out. No browser page errors occurred. API tests reject foreign-origin password/grant requests, cookie fallback and revoked bearer sessions. A regression assertion ensures only the connect document relaxes opener isolation.

The Pages production workflow rebuilds after browser tests so the published JavaScript points to the live Fly backend, never the local mock server. Live verification at https://elasticsounds.github.io/adt-speech-studio/ passed sign-up, popup handoff, upload, reload, spoken-text editing, real OpenAI generation, recording playback/download, updated/original ZIP downloads, mobile layout and logout revocation, with all backend cookies removed. The generated WAV was 192,044 bytes and four seconds long. Its bytes matched the recording in the exported reader; the edited speech catalog and original activities were preserved. The downloaded original ZIP was byte-identical. No browser page errors occurred. The temporary book was removed.

GitHub's unit/build/browser verification and Pages publishing workflow passed. The public Pages source archive contained 65 allowlisted files, all matching the checked-in source byte-for-byte, with no private data paths. Live Gemini service verification is recorded in the normalization follow-up below.

A separate live Pages check uploaded the 316,022,812-byte real Albanian reader, displayed its 100 entries, and downloaded the original ZIP through authenticated cross-origin fetch. The downloaded file had an identical SHA-256 digest. There were no browser page errors. Both temporary Pages accounts and their books were removed after verification.

## OpenAI normalization follow-up

Issue #5 routes all normalization to OpenAI Responses, with `gpt-4.1-mini` as the default. Automated tests cover personal OpenAI-only normalization, separate service secrets for OpenAI normalization and Gemini speech, quota accounting for both operations, refusal/incomplete-result preservation, legacy settings and cache separation. The Pages browser workflow now normalizes independently and then generates Gemini speech with normalization enabled.

Live OpenAI checks expanded “12” and “3” correctly in both languages: “The garden has twelve flowers and three trees.” and “Ana ka dymbëdhjetë libra dhe tre lapsa.” These calls used the shipped locale guidance and structured-output contract. `pnpm test` (52 tests), `pnpm build` and all three Chromium workflows passed locally. The owner added `OPENAI_API_KEY` to Fly's secret store for shared normalization.

The deployed GitHub Pages workflow also passed using **only service credentials**, with no personal key entered. OpenAI normalized both English and Albanian entries. A fresh combined run used `gpt-4.1-mini` for normalization and `gemini-3.8-flash-tts` for narration, verified in the inspectable job logs. The resulting valid WAV was 223,076 bytes, played for 4.52 seconds in Chromium, and appeared in the downloaded ADT. No browser page errors occurred. The temporary account and book were removed. The job summary now displays the normalization model for normalization-only jobs.
