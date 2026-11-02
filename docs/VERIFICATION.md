# Release verification — 2026-11-02

## Automated

- `pnpm test`: 40 passing tests across provider contracts, streaming WAV handling, ZIP security/preservation, account isolation, CSRF, recovery, immutable history, cancellation, cache behavior, quotas, manual protection, normalization, secondary narration and interrupted-job recovery.
- `pnpm build`: strict TypeScript compilation, Vite frontend and esbuild API production build passed.
- `pnpm test:e2e`: desktop workflow, mobile workspace layout and mobile sign-in passed in Chromium. Desktop covers sign-up, import, inspection, speech edit, key connection, missing generation, voice change, all-language generation, playback, search and downloaded ZIP contents. The test provider is mocked and absent from the production bundle.

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

## Operating boundaries

One API process and persistent volume are required. The initial deployment uses private accounts with personal keys and disables shared service-funded calls. No new word alignment, translation generation, additional language creation or full Studio project import is included. See README for retention, backup and quota behavior.
