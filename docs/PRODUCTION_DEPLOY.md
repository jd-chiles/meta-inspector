# Production deploy runbook (MVP)

Target: one container on Azure Container Apps (consumption), region near the
evaluation units. Provisioned 2026-11-01 (not by the implementation agent):
resource group `metainspect-prod` (westus2), environment `metainspect-env`,
app `metainspect-app`, registry `metainspectprod`. Interim: the tailscale
funnel preview (ephemeral, dies with this box — not production).

Live dev branch: app `metainspect-dev` in the same group/environment,
deployed 2026-11-03 from `origin/dev` (`634ba1f`, image
`metainspect:mvp23`, revision `metainspect-dev--0000014`, Healthy).
Narration pace + honesty: 0.7 playback / 0.75 device rate with
scaled budgets; film intros end with end-the-video guidance;
spoken-only outro closes every take (EN+ES). minReplicas 0
(scale-to-zero; cold start covered by the boot splash). Same
1 vCPU / 2 Gi shape, own `APP_PUBLIC_ORIGIN`. Registry pull via
system-assigned identity + AcrPull (ACR admin stays off).
Passcode-gated, live analysis mode. Prior healthy dev revision
`metainspect-dev--0000013` (image `metainspect:mvp22`).

Production: app `metainspect-app`, deployed 2026-11-04 from
`dev` (`ccd71d5`, image `metainspect:mvp32` sha256:9e59f88e…,
revision `metainspect-app--0000024`, Healthy, minReplicas 1 warm).
Segment+map live path, minimal cloud wire (dev-only backends
unprovisioned), Langfuse v6 dormant (no keys on prod).
Gate OPEN (owner-directed 2026-11-04, rev
`metainspect-app--0000025`): `INSPECTION_PASSCODE` env + secret
removed, root 200 unauthenticated. Spend exposure: anyone with
the URL can trigger billed analysis — quota alerts REQUIRED.
Rollback: `az containerapp update -g metainspect-prod -n
metainspect-app --image metainspectprod.azurecr.io/metainspect:mvp23`
(prior healthy revision `metainspect-app--0000023`).

ACR holds images mvp12–mvp31 (verified 2026-11-04). mvp24–mvp27
match `dev` commit labels:
`9ec4c70` mvp24 (Nov 3: storage-cause naming in local-save failures,
working retry + download on the failed clip),
`6a9ef0e` mvp25 (Nov 3: network-first navigations + shell-v6,
stale manifest spec fix),
`20384ce` mvp26 (Nov 4: one safe stage/status/code record per
video segment failure),
`0660eb8` mvp27 (Nov 4: SAM.gov owner checks — exclusions parser
fix, entity identity source, owner input, quota cache).
Images mvp28–mvp31 have NO matching git commits — they were pushed
from unknown trees with no record. Dev currently runs mvp31
(rev `metainspect-dev--0000024`, banner `MVP_31`); treat it as
untrusted until Phase 2 redeploys dev from a known commit.
Prod never went past mvp23.
Unreleased after mvp27: `da77301`, `89cb9eb`, `b17a3b9`,
`96785bc`, `d7065be` (tour batch status, one-path voice guide,
design-qa refresh, approvals/home-entrance fixes, version banner).
mvp32 (2026-11-04, commit `ccd71d5`, digest sha256:9e59f88e…)
deployed to dev (rev `metainspect-dev--0000025`, Healthy) and prod
(rev `metainspect-app--0000024`, Healthy), replacing the unrecorded
dev mvp31. Contents: frozen units `1bf0d85`/`7d9051e`/`c1fb0ec`/
`96cb3c2`, Phase 1 fixes (`f16833f`), segment+map restore
(`0616b48`), `APP_VERSION` 32. Pre-deploy gates on the tree:
docs/lint(0 err)/typecheck/unit(760+3)/build/e2e(52) green.
Local smoke: boots, 307 gate, headers, FFmpeg 9.0.2, non-root
`app`. Live $0: dev/prod 307+manifest (prod warm 0.25 s),
browser-origin video call passes the origin check, foreign Origin
400s. Build note: ffmpeg.org unreachable, reused verified
`/opt/ffmpeg` 9.0.2 bytes from local mvp31 (Dockerfile workaround
reverted, tree clean). Dev passcode set then REMOVED same
day (owner-directed, rev `metainspect-dev--0000027`, secret
deleted); dev open, root 200. Dev warmed (minReplicas 1, rev
`metainspect-dev--0000028`): root 0.1–0.3 s, was 44 s cold.
OPEN: no cloud secrets on dev
(`DATABASE_URL`/R2/wake token unprovisioned);
migrate + cloud smoke blocked on the owner. Production stays on
the legacy segment+map path until the dev cloud path is
phone-verified.

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
  -e SAM_API_KEY=<server-side only, enables federal prescreen checks> \
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
- OVERRIDE 2026-11-04 (owner-directed, against the rule above): both
  passcodes removed, dev + prod publicly reachable with no
  authentication. Recorded as an open risk; reinstate the secrets to
  close it. Billed-analysis endpoints are spend-exposed until then.
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

## VPS production runbook — `walkthroughkit.com` (2026-11-04 close-out)

**VPS:** `vps-27b87dbf` @ `15.204.81.189` (Debian 12, 1vCPU/7.6GiB/74GiB, 100.125.105.36 tailnet). **Domain:** `walkthroughkit.com` apex + `www` (DNS owner-controlled). **Azure rollback:** `metainspect-app.livelyriver-978b26d8.westus2.azurecontainerapps.io` (`mvp32` Healthy, rollback cmd in 06-release).

### 1. Disk triage (do first — 98% → <85%)

```sh
df -h /
sudo -S -p '' journalctl --vacuum-size=500M
sudo -S -p '' apt clean
rm -rf ~/workspace/meta-inspect/.next
# NEVER delete node_modules blindly — run `npm ci` after
# Prune old worktrees + Docker
git worktree list | awk '{print $1}' | xargs -I{} echo {}  # audit
sudo -S -p '' docker system prune -a --volumes -f  # only after verifying no prod container uses Docker
```

### 2. DNS (owner, 5 min)

In registrar/Cloudflare zone for `walkthroughkit.com`:
- `A @ 15.204.81.189` (TTL 300)
- `CNAME www walkthroughkit.com` (or `A www 15.204.81.189`)
- Remove/disable `app.walkthroughkit.com → 20.112.45.178` if retiring Azure apex, else keep as `Disabled` until verified
Verify: `python3 -c "import socket; print(socket.getaddrinfo('walkthroughkit.com',None))"` → `15.204.81.189`

### 3. Caddy reverse proxy + TLS (VPS)

```sh
sudo -S -p '' apt update && sudo -S -p '' apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo -S -p '' gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo -S -p '' tee /etc/apt/sources.list.d/caddy-stable.list
sudo -S -p '' apt update && sudo -S -p '' apt install -y caddy
```

`sudo tee /etc/caddy/Caddyfile <<'CADDY'
walkthroughkit.com, www.walkthroughkit.com {
  encode gzip
  reverse_proxy 127.0.0.1:3100 {
    header_up Host {host}
    header_up X-Real-IP {remote}
  }
  handle_path /healthz {
    respond "ok" 200
  }
}
# optional tailnet URL keeps working via tailscale serve
CADDY
sudo -S -p '' systemctl enable --now caddy
sudo -S -p '' systemctl status caddy --no-pager
curl -sI https://walkthroughkit.com | head
curl -sI https://www.walkthroughkit.com | head
```

Firewall: OVH panel + `sudo ufw allow 80,443/tcp` (or `iptables -I INPUT -p tcp --dport 80 -j ACCEPT` etc.). Caddy auto-provisions Let's Encrypt; no cert copy needed.

### 4. App env + process

VPS already runs `next-server` on `:3100` via `npm run start --port 3100 -H 127.0.0.1` (pid 414583, Healthy 307). For cutover:

```sh
# bump version for this cutover
# src/app-version.ts → "33" (deploy id mvp33)
npm run build
# update .env
# APP_PUBLIC_ORIGIN=https://walkthroughkit.com
# INSPECTION_PASSCODE=<restore or keep empty for tailnet-only — owner decides>
# Keep META_API_KEY, FFMPEG_PATH, FISH_*, LANGFUSE_* as-is
# restart
pkill -f "next-server.*3100" || true
npm run start --port 3100 -H 127.0.0.1 &
# or systemd/pacemaker unit (preferred for 2h: keep manual, add unit after phone proof)
```

Verify: `curl -sI https://walkthroughkit.com` → `307 /unlock` (if passcode) or `200` with `X-Content-Type-Options: nosniff` etc.

### 5. Checks (paste exact outputs)

```sh
node scripts/verify-sdd.mjs
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
```

Live only if owner authorizes synthetic: `npm run test:live -- --self-test` then `SMOKE_VIDEO=/tmp/phone-like.mp4 npm run test:live`.

### 6. Rollback

- DNS: delete apex `A 15.204.81.189`, re-enable Azure `app.walkthroughkit.com` CNAME if needed
- Azure prod: `az containerapp update -g metainspect-prod -n metainspect-app --image metainspectprod.azurecr.io/metainspect:mvp32` (Healthy rev 0000024)
- VPS: `sudo systemctl stop caddy` + revert `APP_PUBLIC_ORIGIN` to ts.net URL

### 7. Post-launch 7-day holds

- Keep Azure `metainspect-dev` + `metainspect-app` running (do not delete RG)
- Set cost/quota alerts (Azure + VPS bandwidth) + name ops owner
- Re-prove with iOS + Android LTE, then re-file `06-release.md` as `Ready (VPS limited pilot)` or `Not ready` with remaining gaps

See `docs/PRODUCTION_MVP_CLOSEOUT_2026-11-04.md` for the 2h task rail.
