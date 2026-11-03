# Release verification — 2026-11-02

## Automated

- `pnpm test`: 42 passing tests across provider contracts, streaming WAV handling, ZIP security/preservation, account isolation, CSRF, recovery, exact-origin CORS and separate bearer sessions, immutable history, cancellation, cache behavior, quotas, manual protection, normalization, secondary narration and interrupted-job recovery.
- `pnpm build`: strict TypeScript compilation, Vite frontend and esbuild API production build passed.
- `pnpm test:e2e`: three Chromium tests passed: the desktop workflow (including mobile workspace layout), mobile sign-in, and the separate-origin GitHub Pages workflow. Desktop covers sign-up, import, inspection, speech edit, key connection, missing generation, voice change, all-language generation, playback, search and downloaded ZIP contents. The test provider is mocked and absent from the production bundle.

- `pnpm audit --prod`: no known vulnerabilities. Zod was upgraded to 4.6.7 after the audit identified CVE-2023-54404 in the initial version.

## Live provider

OpenAI `gpt-4o-mini-tts` with `coral` returned a valid 249,644-byte WAV for a short English line. An actual OpenAI streaming WAV exposed unknown-length header markers; the implementation now finalizes those markers and has a regression test. A second live request generated an 82-character Albanian image description for the real ADT below (352,844 bytes).

**Gemini has not been live-tested with an account key.** Automated tests check the legacy generateContent PCM contract and Gemini 3.8 interactions audio/style metadata contract, as well as missing-audio failures, credentials and cancellation. Model access and provider quotas still depend on the user's key.

## Real reader archive

Source: the public `elasticsounds/Libri_new-adt-2` GitHub archive, revision `137054f` (downloaded 2026-11-02), a 304 MB ZIP containing _Ndryshimet Klimatike_. The reader has 100 Albanian language entries, images, videos, reader scripts, activities and an offline preloader.

- Streaming import found the wrapped reader root and all 100 entries.
- A spoken-text edit exported successfully; all 226 other original files were byte-identical. Only the existing offline preloader changed; a speech catalog was added.
- A real OpenAI-generated recording was overlaid for `pg002003_im002`. All 225 other original files were byte-identical; only the existing audio map and offline preloader changed. The generated WAV and speech catalog were added.
- The updated reader opened in Chromium with no page errors. Its generated WAV loaded with a 7.35-second duration.
- Test data, downloaded book content, provider credentials and recordings are excluded from the repository and the application source archive.

## Hosted smoke test

At https://adt-speech-studio.fly.dev, a fresh account uploaded the complete 304 MB reader in Chromium, displayed all 100 entries, connected a personal OpenAI key, generated `pg002003_im002`, played the recording and downloaded a 316,425,706-byte updated ZIP. The generated WAV was 379,244 bytes. The exported reader HTML, quiz HTML, reader runtime and display-text catalog matched the original byte-for-byte. No browser page errors occurred. The temporary production book was deleted after verification.

The first deployment exposed an upload-admission bug caused by scanning the volume's root-owned `lost+found` directory. Storage accounting now scans only application-owned directories; a regression test covers this. Shared model credentials remain disabled. A final health/source-archive check follows deployment of the checked-in release.

## Operating boundaries

One API process and persistent volume are required. The initial deployment uses private accounts with personal keys and disables shared service-funded calls. No new word alignment, translation generation, additional language creation or full Studio project import is included. See README for retention, backup and quota behavior.

## GitHub Pages follow-up

The local Pages build is served under `/adt-speech-studio/` on a different hostname from the API. Its browser test signs up in a first-party popup, grants a separate session, deletes backend cookies, reloads, uploads a reader, plays authenticated audio, generates missing speech with the mock provider, downloads original and updated ZIPs, and signs out. No browser page errors occurred. API tests reject foreign-origin password/grant requests, cookie fallback and revoked bearer sessions. A regression assertion ensures only the connect document relaxes opener isolation.

The Pages production workflow rebuilds after browser tests so the published JavaScript points to the live Fly backend, never the local mock server. Live Pages verification is recorded after deployment.
