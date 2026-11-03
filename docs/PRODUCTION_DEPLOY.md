# Production deploy runbook (MVP)

Target: one container on Azure Container Apps (consumption), region near the
evaluation units. Provisioned 2026-11-01 (not by the implementation agent):
resource group `metainspect-prod` (westus2), environment `metainspect-env`,
app `metainspect-app`, registry `metainspectprod`. Interim: the tailscale
funnel preview (ephemeral, dies with this box — not production).

Live dev branch: app `metainspect-dev` in the same group/environment,
deployed 2026-11-03 from `origin/dev` (`500c521`, image
`metainspect:mvp17`, revision `metainspect-dev--0000008`, Healthy).
Sprints S0–S4 + Langfuse join-mode fix: 6-wide SAM with 2-room
parallel analysis, 30 s analysis cap, Muse Voice Transcribe ASR,
participant co-signature, visual-alarms flag, LAHSA-schema JSON +
case note + bilingual landlord fix list, re-inspection mode, offline
queue, GPS attestation, pre-screen card, Spanish tour, detector test
shot, Langfuse tracing (dev secrets wired). minReplicas 0
(scale-to-zero; cold start covered by the boot splash). Same
1 vCPU / 2 Gi shape, own `APP_PUBLIC_ORIGIN`. Registry pull via
system-assigned identity + AcrPull (ACR admin stays off).
Passcode-gated, live analysis mode.

Production: app `metainspect-app`, deployed 2026-11-03 from
`origin/dev` (`500c521`, image `metainspect:mvp17`, revision
`metainspect-app--0000018`, Healthy, minReplicas 1 warm). Same
feature set as dev above; no Langfuse secrets on prod so tracing
stays dormant there. Passcode-gated, live analysis mode.
Rollback: `az containerapp update -g metainspect-prod -n
metainspect-app --image metainspectprod.azurecr.io/metainspect:mvp16`
(prior healthy revision `metainspect-app--0000017`).

Redeploy: build + push a new tag, `az containerapp update` with the
app name, re-verify 307 + origin probes. Note: `.dockerignore` must
keep excluding `.muse`/`.agents` — agent worktrees carry full
node_modules and will fill the build disk otherwise.

## Image

```bash
docker build -t metainspect:<sha> .
docker run -d -p 3000:3000 \
  -e APP_ANALYSIS_MODE=live \
  -e META_API_KEY=<server-side only> \
  -e META_MODEL=muse-spark-1.3 \
  -e META_API_BASE_URL=https://api.meta.ai/v1 \
  -e FFMPEG_PATH=/usr/bin/ffmpeg \
  -e FISH_API_KEY=<server-side only> \
  -e FISH_VOICE_ID=<owner voice id> \
  -e INSPECTION_PASSCODE=<pilot shared passcode> \
  -e APP_PUBLIC_ORIGIN=https://<app-fqdn> \
  metainspect:<sha>
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Verified 2026-10-31: image builds, serves 200, `/sw.js` is no-store,
baseline security headers present. Never bake `META_API_KEY` into the
image; mount it as a container secret. No `NEXT_PUBLIC_*` secrets exist.

## Azure Container Apps (provisioned; redeploy per release)

The environment above already exists with secrets for the Meta key,
passcode, and Fish vars, env `APP_ANALYSIS_MODE=live`, external ingress
on port 3000, and `minReplicas 0` / `maxReplicas 2`. Verified
2026-11-01 (read-only): the app responds `307 → /unlock` with baseline
headers, so the passcode gate is active.

1. `docker build -t metainspectprod.azurecr.io/metainspect:<tag> .`
   (FFMPEG compiles from source; allow time) → `docker push`.
2. `az containerapp update -g metainspect-prod -n metainspect-app --image
   metainspectprod.azurecr.io/metainspect:<tag>`.
3. Confirm health: `curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n"
   https://<fqdn>/` → `307 /unlock`. Any other status is a failed deploy.
4. REQUIRED on ACA: `APP_PUBLIC_ORIGIN=https://<fqdn>` (exact public
   origin, scheme + host, no path). Proven 2026-11-01: ACA preserves the
   browser `Origin` header while the container sees an internal
   request URL, so without this var every browser video request fails
   400 "Submit the video from this app." (the marker fallback only
   engages when Origin is absent). Set it with:
   `az containerapp update -g metainspect-prod -n metainspect-app
   --set-env-vars APP_PUBLIC_ORIGIN=https://<fqdn>`
   Status 2026-11-01: SET on `metainspect-app` (revision ...0000009,
   owner-approved) and verified — a browser-identical request now
   passes the origin check (fails only on an intentionally bad stage).
   Optional env (working defaults; unset in production): `META_MODEL`,
   `META_API_BASE_URL`. `FFMPEG_PATH` ships in the image. Without the
   Fish vars the spoken guide falls back to the device voice and mic
   answers stay tap-only.

Still owner-side: custom domain + managed TLS, subscription cost/quota
alerts, and named operational owner. Deployed 2026-11-02: `mvp13`
(revision `metainspect-app--0000015`, 100% traffic, Healthy) from
`101a67f` (single-entrance tour, capture dashboard, live-proof
removal). Prior: `mvp8` (revision `metainspect-app--0000010`) from
HEAD `4fe3218` plus verified uncommitted sprint work. Build note:
ffmpeg.org was unreachable from every network here (timeouts from the
sandbox and from Azure), so the from-source FFmpeg stage could not
fetch; `mvp8` reuses `/opt/ffmpeg` from `metainspect:prod-proof`, whose
bytes match `install-ffmpeg-runtime.sh` output (script identical since
38d51d3; minimal 9.0.2 config verified). Dockerfile change was
temporary and reverted — `git status` clean for it. Rebuild cleanly
from source when upstream recovers.
After any redeploy, re-verify one live room end to end from a physical
phone on LTE (not wifi): film, auto-analysis, report, sign-off, export
download.

## PWA rollout

- Users open the public URL in Safari/Chrome → Add to Home Screen.
- Service-worker shell cache is versioned (`shell-v3`); bump the name in
  `public/sw.js` + `src/features/walkthrough/offline.ts` + its spec on any
  shell-breaking deploy so installed clients update. `/sw.js` is no-store.
- Icon/manifest: `public/manifest.webmanifest`.

## Rollback

Repoint the container app at the previous image tag. Client data is
local-only (IndexedDB), so rollback never migrates user data; a fresh SW
version still ships with the rollback image.

## Access control (in-app passcode gate)

- All app pages and `/api/video/*` sit behind middleware (`src/middleware.ts`)
  whenever `INSPECTION_PASSCODE` is set: one shared pilot passcode checked
  server-side (timing-safe), stateless HMAC session cookie (HttpOnly,
  Secure, SameSite=Lax, 30 days), unlock attempts throttled to 10 per
  10 minutes per IP per instance. Unit-tested in
  `tests/unit/server/auth.test.ts`. The passcode never enters the browser
  bundle, logs, or exports.
- Without `INSPECTION_PASSCODE` the gate is OPEN (CI/test behavior). The
  production container must always set it as a secret. Rotation is instant:
  changing the secret invalidates every issued cookie (the HMAC key is the
  passcode itself).
- Pilot-grade only: one shared secret, no per-inspector identity, no
  server-side session revocation list. Decide before wider launch whether
  per-inspector keys are needed. Set Azure cost/quota alerts on the
  subscription regardless — the passcode gates people, not spend.

## Retention policy (as implemented)

- Room clips, stills, decisions, signatures: device-local IndexedDB only.
  The server never writes them to disk; FFmpeg temp files are removed
  after decode.
- Server memory only: mapping still leases (15-minute TTL, one-time),
  session dedupe entries (6-hour TTL). Both vanish on restart/redeploy.
- Provider side: Meta Files uploads use 3600 s expiry; SAM/Muse
  processing retention follows Meta/Baseten terms (the UI says so; local
  delete does not reach providers).
- Container logs: Next.js request logs only. Keys, provider bodies, file
  IDs, and media bytes are never logged by the app.
- Operational owner: TBD (owner to name before production exposure).

## Known production limits (MVP)

- Unaudited per-user actions: the shared passcode cannot attribute runs.
- HSTS/CSP are host concerns: the app sets baseline headers
  (nosniff, referrer-policy, DENY framing, camera/mic permissions,
  COOP) but no HSTS (set at ingress if required) and no CSP
  (Mediabunny blob/worker decoding needs per-route tuning; see
  `next.config.mjs`).
- Single-region, no status page. Container logs are the audit trail for
  provider failures.
