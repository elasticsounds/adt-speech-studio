# ADT Speech Studio

A standalone web workspace for language strings and text-to-speech in exported **ADT Studio reader ZIPs**.

**Hosted app:** https://adt-speech-studio.fly.dev

## Use it

1. Create an account and save your recovery code. No invitation or email is needed.
2. Upload the reader ZIP exported from ADT Studio, up to 1 GB. A ZIP with one enclosing folder is also accepted. Catalogs are limited to 25,000 entries and 8 million combined display/spoken characters.
3. Open **AI connection** and paste your Gemini API key. Keys stay in browser memory for this tab and server memory during the job; they are not saved. Reloading the page requires entering the key again.
4. Inspect **Language strings** and **Speech**, search by text or ID, edit spoken text, and listen to recordings.
5. Choose a model, voice and delivery instructions. Use **Generate missing**, select particular entries, or **Regenerate all**. The confirmation lets you include every imported language. Changing settings alone does not start a paid request.
6. **Download ADT** to get a reader ZIP containing your changes. Your original ZIP is always downloadable too.

Gemini is the default provider. OpenAI speech is also supported. Optional normalization uses Gemini regardless of the speech provider and can prepare numbers, abbreviations, symbols and mathematical expressions without changing display text. The language profiles are adapted from ADT Studio.

Private workspaces are separated by account. Model API charges are billed to the supplied key. The hosted pilot has a 2 GB storage allowance per account, including the original ZIP, extracted files, audio history and exports. Delete unused workspaces to free space. It currently uses one persistent server; it is not a high-availability service.

## What is included

- Current reader `content/i18n/<locale>/texts.json`, optional `speech_texts.json`, audio maps, primary and secondary narrators.
- Missing-file detection, language/ID search, status filters, audio playback/download and manual WAV/MP3/OGG/FLAC upload.
- Separate display/spoken text, mute, immutable revisions, restoration and protection for manual edits/recordings.
- Gemini and OpenAI model/voice selection, style instructions, provider-specific temperature or speed.
- Normalization by itself or before speech, editable locale guidance, mathematical speech preparation.
- Background jobs, progress, cancellation, retry unfinished entries, inspectable input/output logs and content-addressed caching. A changed voice/model/text/style has a different cache signature. Force generation bypasses reuse.
- Streamed, bounded ZIP import; archive paths, symlinks and duplicates rejected. Uploaded HTML/JavaScript is never executed or served from the application origin.
- Export preserving reader pages, assets, activities, IDs and unrelated files. Updated audio invalidates only its stale timing entries. Recognized offline-preloader data is refreshed without executing its code.
- Optional server-funded credentials with per-account and global daily character allowances, including retries. No automatic fallback from a personal key to a service key.

## First-release boundaries

The interface is English. This app does not generate translations, add language folders, edit reader pages or accept full Studio project/database archives. It needs the exported reader layout above. Books with an unknown custom offline preloader can be inspected and exported unchanged; changed export is blocked rather than risk stale offline data.

New speech does not generate word timings. Existing timing data is retained only for unchanged recordings; regenerated recordings use the reader's sentence-level playback behavior. Preview models and voice availability depend on your provider account. Review generated speech before distributing a textbook.

## Develop locally

Requires Node.js 22.12+ and pnpm 10.

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:55020. The API runs on port 55021 and stores data in `.data/`. Configure environment variables in your shell; `.env.example` documents them (the app does not automatically load `.env`). For a local fixture: `pnpm fixture`.

```sh
pnpm test             # provider, import/export, API/security/storage regression checks
pnpm build            # strict TypeScript check + frontend/server build + corresponding source archive
pnpm exec playwright install chromium
pnpm test:e2e         # actual browser workflow, using a test-only mock provider
```

## Deploy / operate

The checked-in Fly configuration uses one shared CPU, 1 GB RAM and a 10 GB persistent volume in `iad`. Keep exactly **one writer instance**; the queue and locks are in-process. At most three jobs and two entry operations run concurrently across the server to bound memory while decoding audio. Auto-stop is disabled so generation can continue after closing the browser. Do not scale horizontally without replacing the job/locking architecture.

For a new deployment, choose your own app name and update `app` and `APP_ORIGIN` in `fly.toml`, then:

```sh
fly apps create YOUR_APP --org YOUR_ORG
fly volumes create speech_data --app YOUR_APP --region iad --size 10 --yes
fly deploy --remote-only --ha=false
```

For the existing deployment, run `fly deploy --remote-only --ha=false`. Provider keys are **not** required for bring-your-own-key use. To enable shared generation, configure `GEMINI_API_KEY` and/or `OPENAI_API_KEY` as Fly secrets, then set positive `SERVICE_DAILY_CHARACTERS` and `SERVICE_GLOBAL_DAILY_CHARACTERS` in the deployment environment. Those limits count submitted characters per attempt, not dollar cost. Choose conservative allowances; each new account has its own allowance.

Production requires `APP_ORIGIN` to exactly match the public HTTPS origin, without a trailing slash. Cookies are HttpOnly, Secure on HTTPS and SameSite Strict. `DATA_DIR` must be persistent. Account credentials are scrypt hashes; session and recovery tokens are hashed at rest. Recovery codes rotate when used. There is no email reset path.

All of a book's original files, revisions, blobs, jobs, logs and exports live under `DATA_DIR/books/<owner>/<book>/`. Identity records and shared service usage live separately under `DATA_DIR`. Back up the entire persistent volume, including identity records. Fly volume snapshots are a recovery aid, not a substitute for your own tested backups. Deleting a workspace removes its live directory; older backups may retain it. Retain the downloaded original/updated ZIP for important work.

Interrupted jobs are marked interrupted at startup and can be retried from the UI with credentials supplied again. Successful entries and histories survive restarts. Duplicate downloads of an unchanged revision reuse its existing export instead of consuming more disk. Storage capacity is enforced on imports, audio, revisions and export admission.

## Verification

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the tested release, including live-provider checks and the real ADT round trip. CI uses deterministic mock responses so it never consumes paid API quota.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for attribution to ADT Studio. Each production build offers its corresponding application source at `/source.zip`, excluding secrets and user data. Repository visibility does not restrict that source offer.
