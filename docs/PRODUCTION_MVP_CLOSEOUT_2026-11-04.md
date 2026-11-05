# Production MVP Close-Out Sprint — VPS + walkthroughkit.com

**Sprint window:** 2026-11-04 21:15 → 23:15 UTC (2h, hard stop)
**Owner decision:** Ship on new OVH VPS `vps-27b87dbf` (15.204.81.189 / 100.125.105.36 ts.net) with custom domain `walkthroughkit.com`. Fold into existing SDD MVP (TASK-103→113) without changing their acceptance — VPS is operational cutover, not a scope change.

## Where we are (factual baseline 2026-11-04)

- **Code:** `dev` at `fe31f5d` on top of mvp32 image `ccd71d5` / `APP_VERSION 32`. `verify-sdd` + focused validator green on that tree; lint 0 err / typecheck 0 / unit 760+3 / build + e2e 52/52 green pre-deploy. No TASK-103→113 marked accepted; native SDD state still pending (handoff-only mode).
- **Azure (current prod):** `metainspect-prod` westus2, env `metainspect-env`, app `metainspect-app` (`mvp32` rev 0000024 Healthy) + `metainspect-dev` (rev 0000025 Healthy). Registry `metainspectprod.azurecr.io`. `APP_PUBLIC_ORIGIN` set on both apps. Passcodes **removed** owner-directed 2026-11-04 → public, no auth (spend-exposed).
- **VPS (new):** Debian 12, 1 vCPU / 7.6 GiB RAM / 74 GiB disk (**98% used / 1.5 GiB free — block**), tailscaled `vps-27b87dbf-1` (100.125.105.36), Next.js `next-server` running on 127.0.0.1:3100 → ts.net tailnet proxy `https://vps-27b87dbf-1.taile8712d.ts.net:3100` (tailnet-only, no funnel, no 80/443). `.env` has `META_API_KEY`, `APP_ANALYSIS_MODE=live`, `APP_PUBLIC_ORIGIN=https://vps-27b87dbf-1.taile8712d.ts.net:3100`, `FFMPEG_PATH=/home/hermes/.local/ffmpeg-9.0.2/bin/ffmpeg`. `FISH_*` + `LANGFUSE_*` present in `.env.local`.
- **Domain:** `walkthroughkit.com` has **no A record** (NXDOMAIN). `app.walkthroughkit.com` resolves to Azure `20.112.45.178` but hostname binding is `Disabled` → TLS reset. Registry holds `app.walkthroughkit.com` as custom domain, not apex.
- **Voice fix branch:** `/tmp/voicefix` detached at `ccd71d5` → 10 tracked changes + ~180 new `public/voice/*.mp3` (expanding inventory to 40+ guide + film intros), `APP_VERSION 34`. Not merged; runs concurrently, file sets disjoint from VPS infra.
- **Blockers:** Disk full; no public 80/443 listener; no TLS for apex; no cost/abuse controls with open endpoints; no fresh phone LTE run on VPS; no video quality gate pass (gate remains open).

## Decision log (2h scope)

1. **Hosting:** VPS is production for `walkthroughkit.com`; Azure stays as **rollback** (keep `mvp32` image, do not deprovision for 7 days). Reason: fixed cost, single-process lease safety, direct FFmpeg control; avoids ACA scale-to-zero ambiguity.
2. **Domain:** Ship apex `walkthroughkit.com` → VPS `15.204.81.189` (A record) + `www` CNAME → apex. Keep `app.walkthroughkit.com` on Azure **Disabled** until post-launch verification, then either re-bind or retire. User controls DNS — this sprint prepares the VPS to serve and hands the one DNS change to the owner.
3. **TLS:** Caddy (auto Let's Encrypt) fronting `:80 → :443 → 127.0.0.1:3100`. Alternative vetted: Tailscale Funnel for ts.net public URL only — rejected for apex.
4. **Auth:** Launch tailnet-gated **or** passcode-gated — owner must choose in next 30 min; not launching open to internet again (prior passcode removal is recorded risk). Default if no decision: restore `INSPECTION_PASSCODE` on VPS, keep Azure open as-is.
5. **Voice fix:** Does not block; merges after VPS passes health + phone run as `mvp33` patch.

## Non-goals for this 2h window

- No new product scope (Form 1083 unchanged, no HMIS submission, no landlord delivery, no HQS path).
- No video quality claim (gate stays `docs/evaluation/video-clip-gate.md` open).
- No multi-replica, no external R2/Neon worker re-enable (still deferred per `CLOUD_PROVISIONING.md`).

## Stop condition (done = all)

1. Disk <85% (cleanup verified).
2. Caddy serving `https://walkthroughkit.com` → VPS `3100` with valid cert (or tailnet-gated health if DNS deferred).
3. `APP_PUBLIC_ORIGIN=https://walkthroughkit.com` set, app answers `307 → /unlock` or `200` with correct headers.
4. `verify-sdd` + `lint/typecheck/test:unit/test:e2e/build` green on VPS tree (exact commands logged).
5. Synthetic `test:live` connectivity probe (0-candidate OK) + at least one phone LTE walkthrough recorded (device/OS/rev).
6. Release record closed as `Ready for limited pilot (VPS)` or `Not ready` with explicit remaining gaps — no fake pass.

## Ordered slice — 7 tasks (owner → dev)

| # | Task | Owner | Files/area | Exit signal |
|---|------|-------|------------|-------------|
| 1 | **VPS-01 Disk triage** | dev | VPS filesystem | `df -h /` <85%, `.next` + old worktrees pruned, no `node_modules` fill in image |
| 2 | **VPS-02 Reverse proxy + TLS** | dev | VPS `Caddyfile` / systemd | `curl -sI https://walkthroughkit.com` 307/200 + `curl -sI https://www.walkthroughkit.com` 308→apex |
| 3 | **VPS-03 Deploy build** | dev | `src/app-version.ts` → `33`, `Dockerfile` / `pm2` / `systemd` | VPS `mvp33` answers health on `walkthroughkit.com`, `APP_VERSION` banner matches |
| 4 | **VPS-04 DNS cutover** | owner (DNS) | Registrar/Cloudflare zone for `walkthroughkit.com` | `A walkthroughkit.com → 15.204.81.189`, `CNAME www → walkthroughkit.com` verified |
| 5 | **VPS-05 Verify suite** | dev | `scripts/verify-sdd.mjs` + npm checks | Paste exact `verify-sdd/lint/typecheck/unit/e2e/build` outputs; no weakened assertions |
| 6 | **VPS-06 Live + phone proof** | dev+owner | `test:live --self-test` + synthetic + LTE | Phone log: device, OS, rev, room filmed, proposal count, export download |
| 7 | **VPS-07 Docs close-out** | dev | `03-plan.md`, `HOSTING_OPTIONS.md`, `PRODUCTION_DEPLOY.md`, `06-release.md`, `05-change-log.md` | All docs point at VPS, Azure as rollback, review/CI honest, native evidence gap named |

## Voice concurrency

- `/tmp/voicefix` stays on detached worktree; no shared file edits with VPS infra (disjoint: `public/voice/*` + `scripts/voice-inventory.mjs` vs `Caddyfile`/`PRODUCTION_DEPLOY.md`). Voice merges after VPS-05 green as `mvp33` if phone run permits, else next window.

## Risks if we overrun

- Disk stays 98% → build fails. Mitigation: VPS-01 first.
- DNS not cut → launch stays on ts.net tailnet URL (still a valid limited pilot).
- Open endpoints without passcode → spend exposure (same as Azure today). Mitigation: gate the VPS, keep Azure open only as rollback.

## Commands (VPS tree)

```sh
node scripts/verify-sdd.mjs
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e   # builds then runs
npm run build
# live is separate, owner-authorized only:
npm run test:live -- --self-test
SMOKE_VIDEO=/tmp/phone-like.mp4 npm run test:live  # never use client URLs, mock only
```

## Rollback

- `az containerapp update -g metainspect-prod -n metainspect-app --image metainspectprod.azurecr.io/metainspect:mvp32` (prod Healthy rev 0000024)
- Or DNS revert: `app.walkthroughkit.com Disabled` stays, apex `A` removed.
- VPS local data is IndexedDB-only; no migration.

---
*Prepared 2026-11-04 — not a pass. Every gate below must be observed before flipping `06-release.md` to Ready.*
