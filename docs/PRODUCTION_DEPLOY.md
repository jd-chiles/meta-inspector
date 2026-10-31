# Production deploy runbook (MVP)

Target: one container on Azure Container Apps (consumption), region near the
evaluation units. Interim: the tailscale funnel preview (ephemeral, dies with
this box — not production).

## Image

```bash
docker build -t metainspect:<sha> .
docker run -d -p 3000:3000 \
  -e APP_ANALYSIS_MODE=live \
  -e META_API_KEY=<server-side only> \
  -e META_MODEL=muse-spark-1.3 \
  -e META_API_BASE_URL=https://api.meta.ai/v1 \
  -e FFMPEG_PATH=/usr/bin/ffmpeg \
  -e APP_PUBLIC_ORIGIN=https://<app-fqdn> \
  metainspect:<sha>
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Verified 2026-10-31: image builds, serves 200, `/sw.js` is no-store,
baseline security headers present. Never bake `META_API_KEY` into the
image; mount it as a container secret. No `NEXT_PUBLIC_*` secrets exist.

## Azure Container Apps (owner action — needs a subscription)

1. `az acr create` (or Docker Hub) → `docker push` the image.
2. `az containerapp create --environment <env> --image <ref> --target-port 3000 --ingress external`.
3. Set secrets: `META_API_KEY`, optional `BASETEN_API_KEY`. Set env:
   `APP_ANALYSIS_MODE=live`, `META_MODEL`, `META_API_BASE_URL`,
   `FFMPEG_PATH=/usr/bin/ffmpeg`, `APP_PUBLIC_ORIGIN=https://<fqdn>`.
   `APP_PUBLIC_ORIGIN` must be the exact public origin (scheme + host, no
   path); the video API trusts it plus the request origin.
4. Scale: `minReplicas 0`, `maxReplicas 2`, 2 vCPU / 4 GiB (SAM stills +
   FFmpeg are CPU-heavy; cold start ~30-60 s).
5. Custom domain + managed TLS, then re-verify one live room end to end
   from a physical phone on LTE (not wifi): film, auto-analysis, report,
   sign-off, export download.

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

## Known production limits (MVP)

- No auth: anyone with the URL can run live analysis on the project key.
  Decide before public launch: shared secret, per-inspector keys, or quota
  alerts at minimum.
- No server retention: clips stay on the device; provider-side retention
  follows Meta/Baseten terms (the UI says so; local delete does not reach
  providers).
- Single-region, no status page. Container logs are the audit trail for
  provider failures.
