# Verification plan — 11-item + PWA (epoch 3)

Epoch-2 checks (all green on `ca373d3f`) are the baseline; epoch-3 extends coverage, never weakens it. No bypasses, skipped required tests or fixture results labeled live.

## Executable checks (unchanged commands)

- **docs**: `node scripts/verify-sdd.mjs`; timeout 30000ms; browser=false. Maps REQ-001–REQ-013.
- **lint**: `npm run lint`; timeout 120000ms; browser=false. Maps REQ-012.
- **typecheck**: `npm run typecheck`; redCommand `npx tsc --noEmit --strict /tmp/sdd-red-check.ts`; Maps REQ-001, REQ-003, REQ-004, REQ-006, REQ-012, REQ-013.
- **unit**: `npm run test:unit`; redCommand preserved; Maps REQ-001–REQ-008, REQ-010, REQ-011, REQ-013.
- **browser**: `npm run test:e2e`; redCommand preserved; Maps REQ-001–REQ-013.
- **build**: `npm run build`; Maps REQ-003, REQ-009, REQ-012, REQ-013.
- **live-smoke**: `npm run test:live`; Maps REQ-003, REQ-010, REQ-011. Fail-closed without credentials; ledger gap is an accepted SDD-tooling blocker (no evidence-import workflow exists); single coordinator shell proof retained, no second paid call.

## Requirement coverage (deltas vs epoch 2 in bold)

| Requirement | Required behavioral evidence |
|---|---|
| REQ-001 | **11-item catalog loads with stable IDs; mapping-claim rejection while OPEN details remain;** schema/mode tests; browser sees demo label; fake confirmation cannot promote it. |
| REQ-002 | Capture/validation across **all 11 items**; byte/type/dimension/corrupt rejection; prior image preserved; normalized orientation/metadata/digest. |
| REQ-003 | Mock upstream tests; explicit fixture labeling; one recorded live call (historical shell evidence). |
| REQ-004 | Invalid/extra/verdict/long output rejected; uncertainty preserved; required checks retained. |
| REQ-005 | Edit/accept/reject; invalidation on replacement; unresolved checks never AI-completed. |
| REQ-006 | Stale-response/drop races incl. **reconnect-after-offline**; IDs/hash/revisions match. |
| REQ-007 | Refresh recovery, quota, delete/clear-all, URL cleanup; **offline shell launch with saved progress; queued analyses stay pending; explicit sync on reconnect.** |
| REQ-008 | Pending/rejected excluded; escaping; media embeds; repeating banner; **PDF parity (identical policy/content as HTML).** |
| REQ-009 | 360px + desktop; keyboard/focus/labels; **offline/pending states announced with recovery.** |
| REQ-010 | Origin/URL/prompt rejection; limits; timeout/cancel; duplicates; rate limit; safe provider failure; no auto-retries. **SW caches shell only.** |
| REQ-011 | Rights/provenance manifest; dev/eval split; no invented results; live limitation honest; **claims bounded to executed evidence.** |
| REQ-012 | Contracts, scripts, secret-free workflow, stable build; Codex guidance; activation status separate. |
| REQ-013 | **Manifest valid (name/icons/display/theme); SW precaches shell and serves offline fallback; install path works or degrades with guidance; installed launch restores progress; shell boot needs no network.** |

## CI and live verification

Same rules as epoch 2. Browser runs in fixture mode against the loopback production build (`APP_ANALYSIS_MODE=fixture`); the tailscale `:3100` proxy conflict is worked around with a loopback-only web server (`-H 127.0.0.1`), never by weakening tests. PWA offline specs use browser-context offline emulation, not real network cuts. After code, run lint/typecheck/unit/build/browser on one stable fingerprint, then independent code/QA/security/gate review. Release stays not-ready until the mandatory live path and current reviews are proved; form-mapping claims stay blocked on OPEN confirmation details.
