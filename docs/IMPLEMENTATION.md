# Standalone implementation

The owner explicitly requested a new repository and working hosted implementation on 2026-11-02, narrowing the first release to exported ADT reader ZIPs, language-string inspection, missing-audio repair and full regeneration with another model. Access is open to anyone who signs in. This supersedes the proposed in-monorepo placement in ADT Studio SPEC-0023; that upstream PR is not merged or represented as independently approved.

The standalone application uses React, Hono and TypeScript. It adapts the ADT Studio reader-file contract, Gemini speech conventions, normalization profiles and immutable-history principles. It does not require a full Studio database or PDF. Original files remain immutable; per-entry revisions point at immutable content-addressed audio. Export overlays only changed catalogs/audio/timecodes and recognized offline data.

Public accounts use username/password sign-up with scrypt hashing and first-party HttpOnly sessions, so deployment does not depend on obtaining an OAuth application. Account recovery uses a one-time recovery code; no email identity is asserted. Workspaces are private. Credentials for model calls are held only in memory or configured through server environment secrets. Service-funded calls require explicit configured quotas; personal keys never fall back to service credentials.

The first release prioritizes the requested speech workflow. It supports Gemini and OpenAI, voice/style settings, editing/normalization, per-entry and bulk operations, retries/cancellation, audio upload/history and export. Translation generation, image translation, reader editing and new language creation remain separate features. Word timings are preserved only for unchanged audio; regenerated audio uses sentence highlighting. English UI ships first.

Verification must cover unsafe ZIPs, cross-account isolation, credential handling, protected manual recordings, cache signatures, cancellation, history, both Gemini request families, and an actual browser upload/edit/generate/export workflow. Mocked provider tests are distinct from paid live-provider verification. Deployment requires a persistent volume and exactly one API writer instance.

## GitHub hosting follow-up

The owner subsequently requested GitHub hosting. Issue #3 moves the frontend to GitHub Pages while retaining the existing Fly backend, accounts, private storage and background jobs. GitHub Pages is static hosting and cannot run the API or hold persistent user workspaces. The backend also continues to serve its own frontend as a fallback.

Cross-site access uses an explicitly granted, independently revocable bearer session. Password forms and grants stay on the backend origin; the Pages tab verifies the popup source, backend origin and nonce before accepting a session. Exact-origin CORS and authorization headers support API calls, audio and downloads without third-party cookies. Cross-origin cookie authentication and password forms are rejected. The sign-in document alone permits a cross-origin opener; other backend documents retain opener isolation.

The deployment workflow runs unit/security tests and browser flows before building the production Pages artifact. Cross-site browser coverage uses different hostnames, clears all backend cookies after sign-in, then exercises reload, upload, playback, generation, export and logout. Personal provider keys remain memory-only. GitHub never receives user uploads or model credentials.

## OpenAI normalization — owner-requested amendment (issue #5)

All new standalone normalization and normalization-before-speech requests use OpenAI Responses with the existing spoken-text JSON contract. The default is `gpt-4.1-mini`, with the model still editable. Gemini remains a speech provider. Personal mode requires an OpenAI key for normalization; service mode uses `OPENAI_API_KEY`. No credential mode silently falls back to the other.

Legacy Gemini normalization selections resolve to the OpenAI default for future runs and current settings shown in the UI. Existing files, historical job requests, entity revisions and audio remain intact. A new cache version prevents reuse of Gemini normalization results as OpenAI results. Refusals, incomplete responses and invalid results fail without publishing a revision. Tests cover provider routing, credential separation, legacy settings, cache/history and normalization followed by Gemini speech. Independent review remains required before merge.
