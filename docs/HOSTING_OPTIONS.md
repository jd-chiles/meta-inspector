# Hosting options for the staged pilot

**Decision status: compare only.** Azure remains the current deployment until the owner approves a tested cutover. No provider account, service, or billing configuration was changed during this comparison. Prices and platform limits change; recheck provider pages and the account’s plan before choosing.

## What the app needs

The repository has a Node 22 / Next.js server and a Dockerfile that installs FFmpeg. Its selected video path is the server-side segment-and-map flow. A prior staged request took about 211 seconds and timed out; another took about 93 seconds before the browser canceled. A hosting candidate therefore needs a long-running request path that can support the actual measured workload, sufficient memory for video handling, access to FFmpeg, environment secrets, logs, health checks, and a predictable way to operate a single app process during the pilot.

The current browser/server mapping lease is process-local. A request routed to another replica, or a restart between stages, can lose that short-lived mapping state. Any multi-replica deployment needs an explicit shared-state or sticky-routing fix and proof. A single instance reduces routing ambiguity but does not protect an in-flight job from restarts. Hosting charges also exclude Meta/Muse, SAM, voice, bandwidth, build, and optional tracing charges.

## Shortlist

| Provider | Cost shape | Fit for this repository | Open questions before a pilot |
|---|---|---|---|
| **Render (leading low-friction candidate)** | Paid web-service compute is a fixed monthly plan per instance. Current docs list 0.5 CPU / 512 MB and 1 CPU / 2 GB plans; check the live price page for the selected plan and add disk, database, bandwidth, and workspace costs as needed. | Officially supports Dockerfile-backed web services, deploys from a Git provider, health checks, logs, and rollbacks. Start with one paid instance sized by a real build and staged-video run. The free plan is unsuitable: it sleeps after 15 minutes idle, has an ephemeral filesystem, and Render says not to use free instances for production. | Verify request duration on the deployed path, FFmpeg build/runtime, instance memory during the staged workload, deploy/restart behavior, and one-instance routing. Get an account-specific total before cutover. |
| **Railway** | Hobby is $5/month and includes $5 of resource usage; usage beyond that credit is charged. It is usage-based rather than a fixed all-in ceiling. | Supports container deployment and provides a clear usage dashboard. The public-networking docs permit a request up to 15 minutes if data keeps transferring, otherwise close it after 5 minutes without data. This appears more compatible with the prior 211-second timeout than Cloudflare's default proxy timeout, but the actual route must be exercised. | Measure a complete request and memory/CPU, estimate monthly usage, verify request heartbeat behavior and restart/routing semantics, and configure spend monitoring. The $5 subscription is a minimum, not a spend cap. |
| **Cloudflare Workers + Containers** | Workers Paid starts at $5/month; container CPU, memory, disk, egress, Durable Objects, Worker requests, and logs can add variable usage. The included allotments and rates depend on current plan and actual resource use. | Containers run full Linux workloads, making FFmpeg possible in principle, but this requires a new Worker/Container integration and deployment shape. Default container outbound request-body limit is 100 MiB. The standard Cloudflare proxy read timeout is 125 seconds, shorter than the prior ~211-second staged request; a different response design or approved limit change would be required. This is not a drop-in host for the existing Next server. | Prototype the actual Next + FFmpeg route, validate upload sizes and timeouts, design durable job/result storage, and calculate all Worker/Container/Durable Object costs before considering it. |

## Recommendation

Evaluate **Render first** as the lowest-friction candidate for the existing Dockerized Node app, and keep Railway as a cost/runtime comparison. Do not cut over based on published plan prices alone: the decisive unknowns are a successful staged run, runtime memory, billable Meta calls, and stable request/result behavior. Cloudflare may become attractive after the app uses an asynchronous durable job design, but that design is explicitly deferred for this pilot.

The pilot decision should use a written monthly estimate with a chosen instance, expected staged requests, bandwidth, database/storage, and alert/quota controls. A provider budget alert is not a hard spending cap. Name the operational owner and escalation contact before opening the pilot.

## Sources checked 2026-11-04

- [Render Docker web services](https://render.com/docs/web-services)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Render pricing](https://render.com/pricing)
- [Render free-service limitations](https://render.com/docs/free)
- [Railway plans and pricing](https://docs.railway.com/pricing/plans)
- [Railway public networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- [Cloudflare Containers limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare 524 request-timeout behavior](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)

## Decision — 2026-11-04 (close-out sprint)

**Chosen: OVH VPS `vps-27b87dbf` (15.204.81.189 / 100.125.105.36) for `walkthroughkit.com`.** Azure remains rollback for 7 days.

| Criterion | VPS (OVH) | Azure Container Apps (incumbent) | Verdict |
|---|---|---|---|
| App fit | Node 22 + Dockerfile + FFmpeg 9.0.2 local — runs today on :3100 | Same Dockerfile, provisioned `metainspect-prod`/`metainspect-app` Healthy | Tie |
| Request duration | Single process, no proxy timeout (prior ~211s kitchen timeout was Azure/Cloudflare limit) | ACA + Cloudflare front has 125s default limit — needs workaround | VPS wins for video |
| State | Process-local lease safe with 1 replica | Multi-replica needs sticky/shared-state fix; scale-to-zero kills leases | VPS wins |
| Cost | Fixed VPS + Meta spend; predictable | Consumption + egress, minReplicas 0 saves but cold start 44s (warmed 0.1s) | VPS predictable |
| Ops | Owner-managed (Caddy, disk, TLS, updates) | Managed ingress, health, registry, identity | Azure wins on ops |
| Domain | Apex `walkthroughkit.com` → 15.204.81.189 + Caddy TLS (this sprint) | `app.walkthroughkit.com` Disabled on 20.112.45.178 → TLS reset | VPS for apex |

**Outcome:** VPS serves apex `walkthroughkit.com` (Caddy + Let's Encrypt). Azure stays as rollback / `app.walkthroughkit.com` for 7 days. Re-evaluate on post-launch phone + cost data.

Sources rechecked 2026-11-04: VPS `curl 307` on :3100, tailnet serve `3100` tailnet-only, DNS apex NXDOMAIN / app → 20.112.45.178 Disabled (python socket.getaddrinfo + `az containerapp hostname list`).

**Remaining:** Azure cost/quota alerts, named ops owner, phone proofs, video quality gate — still open per `06-release.md`. See `docs/PRODUCTION_MVP_CLOSEOUT_2026-11-04.md`.
