# Cloud provisioning runbook — thin-client pipeline (R2 + Postgres + worker)

Owner-executed, agent-verified. The cloud pipeline (forward-ported from the
`meta-inspector-production` backup) needs three provisioned services before
any cloud launch: private object storage, Postgres, and worker execution.
Nothing here is provisioned yet. Do every step in order; the agent verifies
at the end. Never paste secrets into chat, docs, or shell history — set them
only via the `az containerapp secret set` commands below (values stay out of
the repo; this file carries names only).

## Cost shape ($0 pilot)

| Service | Free allowance | Pilot fit |
|---|---|---|
| Cloudflare R2 | 10 GB storage, 1M writes, 10M reads/month, $0 egress | Sources are deleted after processing; ~24 MB evidence per inspection. Hundreds of inspections fit. |
| Neon Postgres (free) | 0.5 GB storage, 100 compute-hours/month, scale-to-zero | Job rows are keys + metadata only. Fine for pilot. |
| Azure Container Apps grant | 180k vCPU-s, 360k GiB-s, 2M requests/month per subscription | Covers dev at minReplicas 0 with wake-on-demand. |

Flags, not blockers: Cloudflare may ask for a card on file even for free
R2 usage (allowances still apply). Prod's existing warm replica
(minReplicas 1) likely already spends past the ACA free grant — that is
existing spend, unchanged by this work. The worker below runs
in-web-process on dev at minReplicas 0 so it adds nothing. A dedicated
always-on worker app is the paid step-up, only if scale-to-zero is ever
observed killing a job (no such observation today).

## Part 1 — Neon Postgres (15 min)

1. Create a Neon account and a project named `metainspect-dev`
   (region: nearest to westus2, e.g. US West).
2. In the Neon dashboard, copy BOTH connection strings for the default
   database (they differ only in host/port):
   - **Direct** (`...neon.tech:5432/...`, no `-pooler`): used by the
     worker, instrumentation, and migrations. pg-boss requires LISTEN and
     session advisory locks, which the pooled endpoint breaks. Do not swap
     these.
   - **Pooled** (`...-pooler....neon.tech:6432/...`): used by the web app
     for short session/job queries.
3. Give the agent NOTHING yet — secrets are set via Azure CLI in Part 3,
   and the agent runs migrations (`npm run db:migrate`) against the dev
   app once set. If you prefer to run migrations yourself first, the
   command is `DATABASE_URL='<direct>' npm run db:migrate` from the repo
   root (this creates the job + session tables; it is idempotent).
4. Confirm in Neon that connection counts stay near zero when idle
   (scale-to-zero working).

## Part 2 — Cloudflare R2 bucket (20 min)

1. In the Cloudflare dashboard (or `wrangler`), create a bucket named
   `metainspect-media-dev`. Keep it private: disable `r2.dev` public
   access, attach no custom domain.
2. Create an API token scoped to **Object Read & Write** on ONLY this
   bucket (no admin). Save the access key id + secret for Part 3.
3. Set bucket CORS to exactly this shape, replacing the origin with the
   dev app origin (no wildcard, no extra headers):
   `PUT,GET` from `https://metainspect-dev.livelyriver-978b26d8.westus2.azurecontainerapps.io`,
   allowed headers `content-type, if-none-match`, expose none, maxAge 300.
4. Set lifecycle expiration as an orphan backstop: `media/*` → 7 days,
   `evidence/*` → 30 days. Per-session deletion remains the primary path;
   lifecycle never substitutes for it.
5. Copy your 32-hex-character account id for Part 3.

## Part 3 — Azure dev app wiring (10 min, owner or agent with `az`)

Generate one wake token (32+ random chars, e.g.
`openssl rand -hex 24`) and set secrets + env on `metainspect-dev`
(resource group `metainspect-prod`):

```sh
az containerapp secret set -g metainspect-prod -n metainspect-dev \
  --secrets R2_ACCESS_KEY_ID='<from Part 2>' \
            R2_SECRET_ACCESS_KEY='<from Part 2>' \
            VIDEO_JOB_WAKE_TOKEN='<generated>' \
            DATABASE_URL='<Neon DIRECT string — worker + migrations>'
az containerapp update -g metainspect-prod -n metainspect-dev --set-env-vars \
  CLOUDFLARE_ACCOUNT_ID='<32-hex>' \
  R2_BUCKET_NAME='metainspect-media-dev' \
  APP_ANALYSIS_MODE='live' \
  VIDEO_WORKER_IN_WEB_PROCESS='1' \
  VIDEO_JOB_WAKE_URL='https://metainspect-dev.livelyriver-978b26d8.westus2.azurecontainerapps.io/api/internal/video-worker/start'
```

Notes: secret-backed vars resolve via `secretref` automatically on update.
`DATABASE_URL` here is the DIRECT string (the in-web worker needs it).
`VIDEO_JOB_WAKE_URL` points at the app's own internal start route in this
topology. Do not set any of these on `metainspect-app` (prod) — prod stays
on the legacy workflow until the dev cloud path is phone-verified.

## Part 4 — Agent verification (after the port lands + deploy)

1. `npm run db:migrate` exit 0 (tables exist, idempotent re-run clean).
2. `node tests/live/cloud-job-smoke.mjs --self-test` — offline, no creds.
3. `npm run test:live` — one real cloud job: signed upload → verify →
   dispatch → poll → cleanup. Proves connectivity only, not quality.
4. Phone on LTE against dev: film one room, approve upload + processing,
   review, sign, download one server export. Record device/OS/revision.

## Rollback

Cloud state is additive: R2 objects + Postgres rows. Roll back the app by
repointing `metainspect-dev` at the prior image tag; then delete the dev
bucket's `media/*` keys and truncate the job/session tables. No client
data migrates (the legacy browser store is untouched by rollback).
