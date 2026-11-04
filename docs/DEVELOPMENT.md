# Development setup

## Requirements

- Node.js 22
- npm and access to install the lockfile dependencies
- For live server-side video frame verification, the maintained FFmpeg 9.0.2 runtime described in [production deployment notes](PRODUCTION_DEPLOY.md)

## Local fixture mode

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Use `APP_ANALYSIS_MODE=fixture` for local walkthrough and fixture behavior. Fixture data is synthetic; it is not evidence of a provider result, video quality, form acceptance, or field performance.

## Live provider mode

Live mode requires `APP_ANALYSIS_MODE=live`, a server-only `META_API_KEY` (or documented `MODEL_API_KEY` alias), and the required FFmpeg runtime for video frame verification. Set `FFMPEG_PATH` when the executable is not on `PATH`. Do not use a `NEXT_PUBLIC_*` variable for credentials. Never commit local environment files, tenant data, identifying media, raw provider bodies, or provider file IDs.

Live calls can transfer clips or stills to configured providers and may incur cost. Use only rights-cleared staged/mock-unit media with no personal or tenant information, and review current provider retention terms. The `npm run test:live` check is separate from fixture checks and does not establish video quality.

## Existing project checks

The project CI workflow runs the SDD docs validator, lint, typecheck, unit checks, build, and browser acceptance. The locally configured commands are listed in [the feature verification plan](sdd/features/habitability-walkthrough-mvp/04-verification.md). Follow the repository's SDD task ownership and verification rules when changing implementation or documentation.

## Configuration references

- `.env.example` lists supported environment variable names without secret values.
- [Runbook](RUNBOOK.md) describes the historical team workflow.
- [Production deployment notes](PRODUCTION_DEPLOY.md) contain dated infrastructure state; verify it before reuse.
