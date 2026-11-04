# Development setup

## Requirements

- Node.js 22
- npm
- Network access to install the locked dependencies

## Local fixture mode

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Use `APP_ANALYSIS_MODE=fixture` for local walkthroughs. Fixture responses are synthetic and do not demonstrate provider output, video quality, form acceptance, or field performance.

## Live provider mode

Live mode requires `APP_ANALYSIS_MODE=live`, a server-only `META_API_KEY` (or the documented `MODEL_API_KEY` alias), and the FFmpeg runtime used by the server-side video path. Set `FFMPEG_PATH` if the executable is not on `PATH`. Never expose credentials through `NEXT_PUBLIC_*` variables or commit local environment files.

A live analysis request sends the selected media to configured providers and may incur cost. Use only rights-cleared staged/mock-unit media without personal or tenant information. Review the providers' current terms and retention practices. A connectivity check does not establish model quality.

## Checks

The project defines documentation, lint, type, unit, browser, and build checks. Run the relevant configured checks for a code change and report exact commands and outcomes. Live provider checks are separate; fixture success must not be described as live evidence.

See [architecture](ARCHITECTURE.md), [privacy and safety](PRIVACY_AND_SAFETY.md), and [evaluation protocol](evaluation/protocol.md).
