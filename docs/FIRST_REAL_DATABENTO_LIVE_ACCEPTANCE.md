# First Real Databento Live Acceptance — 12/10/2026

Post-live read-only follow-up: see [entitlement findings and Trades E2E plan](POST_LIVE_ENTITLEMENT_AND_E2E_PLAN.md). Trades PASS 24/24; depth ENTITLEMENT DENIED, **VENDOR CONFIRMATION REQUIRED**. Existing log hashes preserved; incomplete record-level evidence marked NOT CAPTURED. No new live execution or source changes in the follow-up.

## Real live execution — latest acceptance decision, 18:30 ICT, 12/10/2026

**BLOCKED for full live acceptance: mbp-10 entitlement denied. Trades are successfully verified; analytics/WebSocket/browser with these genuine records remain NOT VERIFIED.** This section supersedes earlier NOT TESTED results for A/B and retains the recovery history below.

### Execution and fresh pre-flight

- Operator explicitly reconfirmed A and conditional B. UTC pre-flight started 2026-10-12 11:28:44 / 18:28:44 ICT; both executions occurred on the authorized date.
- Git HEAD `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`; app running healthy, proxy running. Staging previously verified 42/42 and SQLite integrity ok after reboot.
- Fresh dry-run exit 0, calendar OPEN/ETH at 06:28:53 Chicago. Vendor mapping was freshly resolved again within both live runs: ES.c.0 → instrument 10252 → ESZ6, effective `[2026-10-12, 2026-10-13)`.
- GLBX.MDP3 metadata lists trades and mbp-10; this is schema availability, not account entitlement. Actual trades entitlement was confirmed by live ACK and genuine records. Actual mbp-10 entitlement was denied by the gateway.
- Exact authorized commands were run once each, sequentially, with `--duration 30 --max-records 50 --live`. No retries or additional harness subscriptions.
- Logs: `scratch/live_trades_20261012.log`, `scratch/live_mbp10_20261012.log`. Only masked key information appears; no raw authentication secrets logged.

### A. Genuine CME Trades — PASS

| Measurement | Evidence |
|---|---|
| Start / calendar evaluation | 18:29:05 ICT / 11:29:05 UTC, OPEN/ETH |
| Authentication | CRAM-SHA256 success, gateway session 3013795247 |
| DBN metadata | v3, 120-byte metadata header |
| Actual ACK | 1 observed SystemMsg code 1: Subscription request for trades data succeeded |
| Real market records / decoded | 24 / 24 trade structures counted by production parseDbnRecord; zero reported validation/parser errors |
| Invalid records | 0 reported |
| Gateway error records / heartbeats | 0 / 0 |
| Mapping evidence | Administrative rtype 0x16 instrument 10252; three trade samples instrument 10252 match fresh mapping |
| Sample 1 | price 7864.75, size 2, BUY, tsMs 1791804548556, sequence 2267152 |
| Sample 2 | price 7864.5, size 10, SELL, tsMs 1791804550254, sequence 2267180 |
| Sample 3 | price 7864.5, size 1, BUY, tsMs 1791804550255, sequence 2267215 |
| Duration / disconnect | 30.0 seconds; TIMEOUT_30S |
| Cleanup / exit | Harness teardown clears timer and destroys socket; process completed, exit 0 |

Receipt of genuine CME records confirms trading activity during this sample, beyond calendar inference. Side values above are decoder output, not inferred from price changes. The harness accepts BUY/SELL/UNKNOWN but only retains three samples; complete per-record side distribution, raw side bytes, explicit rtype histogram, all-record mapping assertions, first/last event timestamps and first/last receive timestamps are not exported and therefore NOT VERIFIED independently. Sample event timestamps span 11:29:08.556–11:29:10.255 UTC; these are not claimed as the full run's first/last events. The harness invokes the production trade decoder, but no raw DBN capture was retained for a separate audit. Cleanup is evidenced by normal teardown path and process termination, not a separate TCP FIN trace.

### B. Genuine CME MBP-10 — FAIL: entitlement denied

| Measurement | Evidence |
|---|---|
| Start / calendar evaluation | 18:29:51 ICT / 11:29:51 UTC, OPEN/ETH |
| Authentication | CRAM-SHA256 success, gateway session 3013796194 |
| DBN metadata | v3, 120-byte metadata header |
| Actual ACK | 0; FAIL |
| Real depth records / decoded | 0 / 0 |
| Gateway error | 1 ErrorMsg: Not authorized for mbp-10 schema |
| Parser/Corrupt counter | 1 reported; harness also increments this counter for gateway ErrorMsg, so this is not proof of a binary parser corruption |
| Heartbeats | 0 |
| Duration / disconnect | 1.1 seconds; GATEWAY_ERROR: Not authorized for mbp-10 schema |
| Cleanup / exit | Immediate harness teardown clears timer/destroys socket; process completed, exit 2 |
| rtype 0x0A, ten levels, sizes, order counts, timestamps, sequence, sentinels | NOT VERIFIED: no depth records received |

The zero-record cause is explicitly entitlement denial, not market inactivity/closure despite the harness's generic zero-record labels. Depth decoder cannot be marked PASS. No purchase or entitlement upgrade was attempted.

### C. Layered acceptance

| Component | Status | Real evidence |
|---|---|---|
| Gateway authentication | PASS | Both CRAM-SHA256 handshakes |
| DBN metadata | PASS | Both v3 headers |
| Subscription ACK | PASS for trades / FAIL for mbp-10 | Trades code-1 ACK; depth ErrorMsg denial |
| Real Trades | PASS, 24 | Genuine live DBN trade structures |
| Production Trades Decoder | PASS, 24 | Validated price/size/side/timestamp structures; zero reported errors |
| Real MBP-10 | FAIL, 0 | Gateway schema authorization denial |
| Depth Decoder | NOT TESTED, 0 | No depth records |
| MarketContext / Analytics / Footprint / CVD / Volume Profile | NOT VERIFIED | Standalone harness does not feed backend analytics |
| DOM / Liquidity Heatmap | NOT VERIFIED | No real depth updates |
| WebSocket with genuine records | NOT VERIFIED | Earlier staging connectivity checks do not prove vendor propagation |
| React Browser with genuine records | NOT VERIFIED | No browser live session measured |

### D. Final decision and stop

**BLOCKED**, specifically for MBP-10 entitlement; trades portion PASS. Full LIVE ACCEPTED is not justified. Both authorized live harness processes have exited, their sockets/timers torn down. No extra browser streaming, OPRA/EQUS subscription, paid historical request, trading order, Stripe Live, public production, source edit, commit or push was initiated. Any entitlement/cost change requires Operator action; no further live session will be opened automatically.

## Post-reboot verification — latest status, 18:16 ICT, 12/10/2026

**INFRASTRUCTURE RECOVERED. Staging 42/42 PASS. Live acceptance remains NOT TESTED, awaiting Operator confirmation.** This section supersedes the earlier infrastructure BLOCKED statuses below; earlier entries remain the diagnostic history.

- Operator confirmed manual Windows reboot. Verification began 18:15:22 ICT / 11:15:22 UTC and completed dry-run at 18:16:03 ICT / 11:16:03 UTC.
- Git HEAD unchanged: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`; no source edits, rebuild, commit or push.
- `wsl --list --verbose`: `docker-desktop` Running, WSL2. Docker already running; no additional Desktop launch required.
- `docker version`: responsive Linux server 29.8.2, API 1.56, Docker Desktop 4.94.0. `docker info` returned ServerVersion 29.8.2. Existing app/proxy containers running; no compose up or volume recreation needed.
- App healthcheck healthy after verification. Proxy has no Docker healthcheck configured; its operational health is supported by successful HTTPS frontend/API/WebSocket tests through Caddy. Ports remain bound to 127.0.0.1.
- Direct read-only SQLite `PRAGMA integrity_check` on `/app/data/market_data.sqlite` returned `ok`.
- `node scratch/staging_full_verification.mjs`: **TOTAL 42 / PASSED 42 / FAILED 0**, process exit **0**. Verified WAL, account/alert persistence after the suite's app restart, online backup, and backup snapshot integrity `ok`.
- Suite created two staging test accounts and one alert. Its existing backup retention logic pruned the old snapshot `market_data-2026-10-10T19-22-16-493Z.sqlite`; it did not delete the active database or recreate volumes. New snapshot: `backups/market_data-2026-10-12T11-15-42-784Z.sqlite`, reporting 93 trades / 1013 bars. Stored counts are not evidence of today's real live acceptance.
- Fresh dry-run: same authorized GLBX.MDP3 / ES.c.0 / trades command with `--dry-run` and date-specific mapping output, exit **0**. Metadata lists GLBX.MDP3 and supports both trades and mbp-10. Fresh mapping **10252 / ESZ6**, effective `[2026-10-12, 2026-10-13)`, saved to `scratch/cme_mapping_20261012_acceptance.json`.
- Calendar evaluated 06:16:02 Chicago / 18:16:02 ICT and reported OPEN/ETH. Actual exchange halt state and live subscription entitlement remain NOT VERIFIED; dry-run catalog membership and its authentication banner are not proof of live CRAM authentication or entitlement.
- Staging health reported `feedStatus: LIVE`; the suite verified WebSocket INIT_STATE and ping/pong. It did not establish actual vendor records flowing through analytics or React. No live harness invocation or new vendor subscription was explicitly initiated by this task; backend-reported status alone is not vendor provenance evidence.
- Live A/B remain NOT TESTED: no genuine record counts, live ACK, trade/depth validation or socket-cleanup evidence collected. No paid historical request, purchase, billing/Stripe change or public deployment performed.
- Today is still **12/10/2026 ICT**. Per latest instruction, stop after dry-run and await explicit Operator confirmation before A/B. Authorization does not extend into 13/10/2026.

## Controlled Windows reboot handoff — 17:50 ICT, 12/10/2026

- Read-only snapshot at 10:50:12 UTC / 17:50:12 ICT: Docker Desktop/backend processes still present; `WslService` and `vmcompute` Running; `vmmemWSL` present. These do not establish Engine health.
- Backend log at 10:50:08 UTC: `_ping` still HTTP 500 after 13m20s; extension IPC calls continue to time out. Earlier bounded Desktop restart exited 1. DeepChart remains **BLOCKED**, live A/B **NOT TESTED**.
- Unsaved-work check found a Notepad++ window title beginning `*`, indicating an unsaved buffer. Edge, ChatGPT/Codex, multiple Node/Python processes and a Windows Terminal titled `node deposit-watch.mjs` are running. Their business purpose and safe interruption state were not established. Process inspection cannot prove every application has saved its work.
- Operator must save Notepad++ and other work, review/stop or checkpoint important background tasks (including `deposit-watch.mjs`) as appropriate, then manually restart Windows using Start → Power → Restart. No Windows restart, further Docker restart, WSL shutdown/reset, registry change or source change was executed in this handoff.
- After Operator confirms reboot: check `wsl --list --verbose`, start the installed Desktop if needed, run `docker version`, `docker info`, `docker compose ps`; if containers are stopped, `docker compose up -d` without volume deletion. Verify app/proxy health and SQLite integrity/persistence, then run `node scratch/staging_full_verification.mjs`. Rebuild only with evidence of image/source mismatch. If the Engine still fails, collect fresh logs and report observed errors without destructive recovery.
- Live gate: staging must pass 42/42 before fresh dry-run, current-date mapping, actual session and entitlement checks, then A and conditional B within original limits. Authorization expires with 12/10/2026 ICT; later execution requires new Operator approval.
- Git HEAD unchanged: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`. SQLite intact remains NOT VERIFIED; no database/volume was deleted or reset. Awaiting Operator's manual reboot confirmation.

## Recovery attempt — latest result, 17:41 ICT on 12/10/2026

**BLOCKED remains the current decision.** Recovery was attempted from approximately 17:36:47 to 17:41:37 ICT (10:36:47–10:41:37 UTC), within today's authorization. The earlier sections below preserve the original pre-flight evidence; they do not represent a successful staging or live run.

### Docker cause and recovery evidence

- Found the actual per-user installation: `C:\Users\Administrator\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`. The Program Files installation path is absent. The original investigation checked only Program Files and therefore missed the installed application.
- Initially Docker Desktop was not running and the Linux-engine pipe was absent. WSL reported `docker-desktop`, version 2, **Stopped**. The reason it originally stopped is **not established** by the available evidence; do not attribute it to a crash or user action.
- Launched the discovered executable once with `Start-Process -WindowStyle Hidden`. Desktop/backend/build processes appeared. Backend log at 10:36:47 UTC recorded `engine linux/wsl state stopped -> starting`.
- `docker version` returned client 29.8.2, context `desktop-linux`, but its server query failed HTTP 500 on `/v1.56/version`. `docker info` failed HTTP 500 on `/v1.56/info`; `docker compose ps --format json` failed HTTP 500 on `/v1.55/containers/json`. These are engine failures; shell wrappers' zero exits do not imply Docker success.
- Backend logs repeatedly recorded `_ping` HTTP 500 and `backend is not running`; at 10:41:04 UTC the engine had not responded after 4m16s. This corroborates an unresponsive backend rather than establishing an API-version mismatch.
- `WslService` was Running; `vmcompute` was Stopped. Executed `Start-Service vmcompute`; it became Running. Hyper-V-Compute Admin event 1001 at 17:38:29 ICT confirms Host Compute Service started successfully. No startup-type/configuration change was made.
- Starting the service did not recover the Engine. `wsl -d docker-desktop --exec /bin/true` and `wsl --status` remained unresponsive for over a minute. Terminated the two task-owned WSL command processes to bound diagnostics; did not issue distro terminate/unregister/reset or global WSL shutdown.
- Made one bounded official restart attempt: `docker desktop restart --timeout 45`. **Exit code 1**: `Failed to stop Docker Desktop`, `processes still running`, `context deadline exceeded`. Desktop processes remained running, and logs continued backend timeouts.
- Diagnostic source: `%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`; Windows Hyper-V-Compute Admin event log. Root cause beyond the observed WSL/compute/backend startup hang is **NOT PROVEN**.

### Staging, live and evidence status after recovery

| Requirement | Latest result |
|---|---|
| Docker Linux Engine | BLOCKED: HTTP 500; bounded restart failed |
| App/proxy healthy | NOT VERIFIED: container API unavailable |
| Staging 42/42 | NOT RUN: Engine prerequisite unmet |
| SQLite volume integrity | NOT VERIFIED: no DB access; no volumes deleted or reset |
| Image/source match | NOT VERIFIED: Engine unavailable; no rebuild performed |
| New dry-run after staging PASS | NOT RUN: staging never passed; earlier dry-run exit 0 remains historical evidence |
| New ES mapping/session/entitlement | NOT RECHECKED after recovery; earlier date-correct mapping preserved |
| Live Trades A | NOT TESTED; no connection, no subscription, no live exit code |
| Live MBP-10 B | NOT TESTED; A PASS condition unmet |
| Authentication/metadata/ACK | NOT VERIFIED today over live gateway |
| Real received/decoded records | 0/0 for each run because neither started |
| Trade price/size/timestamp/side | NOT VERIFIED |
| MBP-10 levels/sizes/order counts | NOT VERIFIED |
| Parser/gateway error records | No live records observed; untested, not a clean-stream PASS |
| Socket cleanup | N/A: no live socket or timer created |
| Analytics/WebSocket/React E2E | NOT VERIFIED: no actual vendor flow measured |

No `compose up`, paid history, live subscriptions, OPRA/EQUS streams, billing changes, public deployment, Stripe Live, source edits, commits or pushes were performed. Existing volumes/backups were not deleted or reset. Git remains `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`. Recovery stops after one launch, service start and one bounded official restart. More intrusive host/WSL recovery requires Operator decision; today's live authorization is not extended to another date.

## A. Execution Information

- Decision: **BLOCKED — staging infrastructure unavailable before live execution**.
- Pre-flight started: 2026-10-12 17:25:48 ICT / 10:25:48 UTC.
- Dry-run session evaluation: 2026-10-12 17:26:08 ICT / 10:26:08 UTC / 05:26:08 Chicago (CDT).
- Git HEAD: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc` (matches operator authorization).
- Working tree: no tracked changes at start; 21 existing untracked scratch files. Existing files were preserved.
- Docker: `docker compose ps --format json` failed to connect to `npipe:////./pipe/dockerDesktopLinuxEngine`; pipe not found. No container health result is available. No Docker process was returned by the process check. The standard Docker Desktop executable at `C:\Program Files\Docker\Docker\Docker Desktop.exe` was absent. Earlier 42/42 staging results do not establish current health.
- Authorized target: `GLBX.MDP3`, `ES.c.0`; A=`trades`, B=`mbp-10`; sequential, maximum 30 seconds and 50 market records per run, no live retry.
- Fresh vendor symbology: `ES.c.0` → instrument ID **10252** → **ESZ6**, effective `[2026-10-12, 2026-10-13)`. No October 11 mapping used.
- Mapping artifact: `scratch/cme_mapping_20261012_acceptance.json`.
- API key loaded by harness, masked output only; no credential/auth payload saved in this report.
- Read-only metadata returned 30 available datasets including GLBX.MDP3; both `trades` and `mbp-10` are listed as supported.
- **Entitlement qualification:** dataset catalog availability is not proof of this account's live subscription entitlement. The harness labels catalog membership as entitlement, but no live authentication/subscription occurred today. Operator states Standard subscription exists; actual live authorization remains NOT VERIFIED.
- Session: local SessionCalendar reported OPEN/ETH. Consulted [official CME hours](https://www.cmegroup.com/trading-hours.html); the 2026 Globex holiday table does not list October 12 as a Globex holiday. This supports the scheduled session inference, but actual ES matching-engine status/halt state was NOT VERIFIED. No status subscription was opened.
- Dry-run command: `node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema trades --duration 30 --max-records 50 --dry-run --output-mapping scratch/cme_mapping_20261012_acceptance.json`.
- Dry-run process exit code: **0**; shell elapsed **4.405 seconds**. This is metadata/symbology pre-flight success only. The dry-run banner's authentication claim does not establish CRAM authentication.
- Live A/B duration: **0 seconds**; process exit codes: **N/A (not started)**.

## B. Live Trades Results

**NOT TESTED:** Docker health precondition failed. No live TCP gateway connection or subscription was attempted.

| Measurement | Actual result |
|---|---|
| Gateway connection / CRAM-SHA256 authentication | NOT VERIFIED |
| DBN metadata header / subscription ACK | NOT VERIFIED / 0 observed |
| Real market records received / decoded | 0 / 0 (no run) |
| Invalid records / gateway error records / heartbeats | 0 observed, untested |
| rtype 0x00 / instrument match / price / size / side | NOT VERIFIED |
| First/last event timestamp | N/A |
| First/last receive timestamp | N/A |
| Parser errors | No parser exercised; NOT VERIFIED |
| Disconnect reason | N/A; live connection never opened |
| Socket/timer cleanup | N/A; live socket/timer never created |
| Process exit code | N/A; only dry-run exited 0 |

Zero records here reflects no execution, not inactivity or a decoder failure. No synthetic data was used.

## C. Live MBP-10 Results

**NOT TESTED:** A did not run/PASS, so B's authorization condition was not satisfied.

- Authentication, real ACK, framing/length, rtype 0x0A, all ten levels' prices/sizes/order counts, timestamps, mapping, sentinel handling and sequence consistency: NOT VERIFIED.
- Real depth records received/decoded: 0/0 (no run). Invalid and gateway errors: 0 observed, untested.
- Duration 0 seconds; exit code, timestamps, disconnect reason and cleanup: N/A; no socket opened.
- No claim is made about Liquidity Heatmap from depth snapshots.

## D. DeepChart End-to-End Results

| Component | Status | Real Evidence |
|---|---|---|
| Databento Gateway | NOT VERIFIED | No live connection today |
| Subscription ACK | NOT VERIFIED | No subscription |
| Real Trades | NOT TESTED | A blocked by pre-flight |
| Real MBP-10 | NOT TESTED | A PASS condition unmet |
| Production Decoder | NOT VERIFIED | No genuine records processed today |
| MarketContext | NOT VERIFIED | Staging Docker daemon unavailable |
| Footprint | NOT VERIFIED | No vendor trades through backend |
| CVD | NOT VERIFIED | No real trades/aggressor sides observed |
| Volume Profile | NOT VERIFIED | No live provenance verified |
| DOM | NOT VERIFIED | No depth stream |
| Liquidity Heatmap | NOT VERIFIED | No depth updates through backend |
| WebSocket | NOT VERIFIED | No backend live broadcast evidence |
| React Browser | NOT VERIFIED | Live E2E prerequisites unmet |

Untested components are explicitly marked NOT VERIFIED/NOT TESTED rather than falsely recorded as PASS or runtime FAIL. Standalone harness directly imports the built production decoder but does not measure MarketContext → Analytics → WebSocket → React. Browser login, feed state, candles and DISCONNECTED/STALE behavior were not exercised.

## E. Final Decision

**BLOCKED.** Current staging infrastructure could not be validated because Docker's Linux engine pipe is absent. Metadata and date-correct symbology were successfully queried, but live entitlement, actual exchange status, real records, decoding and E2E were not verified. Neither authorized live run was consumed.

No additional subscriptions, paid historical downloads, billing changes, trading orders, Stripe Live, public production, source changes, commits or pushes occurred. Only this report and a fresh mapping artifact were created. Execution stops here as instructed for an infrastructure blocker; restoring staging health is necessary before attempting live validation within the authorized date and limits.
