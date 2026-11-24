# Development setup

## Requirements

- Node.js 22 and npm
- Network access to install the locked dependencies

## Local fixture mode

From the repository root, run the commands for your shell.

**PowerShell**

```powershell
npm.cmd ci
$env:APP_ANALYSIS_MODE = 'fixture'
npm.cmd run dev
```

**Bash or Zsh**

```sh
npm ci
APP_ANALYSIS_MODE=fixture npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start the walkthrough. This mode lets you try the capture and manual review workflow without provider credentials. See the [quick walkthrough](../README.md#try-it-locally) for a bundled clip and steps. The test-pattern clip exercises the local video controls. It does not produce a live AI result.

## Live provider mode

Copy `.env.example` to `.env.local` before configuring live analysis. Use `Copy-Item .env.example .env.local` in PowerShell or `cp .env.example .env.local` in Bash. Set `APP_ANALYSIS_MODE=live` for that launch and clear any fixture-mode shell override first. Live analysis requires a server-side `META_API_KEY` (or `MODEL_API_KEY`) and FFmpeg. Set `FFMPEG_PATH` if the executable is missing from `PATH`. Keep provider credentials out of `NEXT_PUBLIC_*` variables and version control.

A live analysis request sends the selected media to configured providers and may incur cost. Use rights-cleared staged/mock-unit media without personal or tenant information. Review the providers' terms and retention practices.

## Checks

| Check | Command |
|---|---|
| Markdown files and local links | `node scripts/verify-docs.mjs` |
| Lint and TypeScript | `npm run lint` and `npm run typecheck` |
| Unit and API checks | `npm run test:unit` (media checks require FFmpeg) |
| Production build | `npm run build` |
| Fixture browser acceptance | `npx playwright install chromium`, then `npm run test:e2e` |

PowerShell users can substitute `npm.cmd` and `npx.cmd` for `npm` and `npx` if their execution policy blocks PowerShell shims.

See [architecture](ARCHITECTURE.md), [privacy and safety](PRIVACY_AND_SAFETY.md), and the [evaluation protocol](evaluation/protocol.md) for how to interpret fixture and live results.
