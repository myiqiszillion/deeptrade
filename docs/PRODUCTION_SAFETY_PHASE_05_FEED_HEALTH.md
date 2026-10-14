# Production Safety Phase 05 — P0-F Feed Truth & Freshness

**P0-F: OFFLINE VERIFIED. Không có Live acceptance mới.**

Ngày hoàn tất: 14/10/2026 17:21 ICT.

Baseline Git HEAD: `eabb19918ee3bcd4cbf57f4ea3d74cf9e5a459ac`.
Final implementation Git HEAD: `ee2655aa340fd9286aaebd9b1cfa99100f10f2b8`.
Local commit: `fix: separate vendor feed health from browser transport status`. Không push.

Working tree baseline không có tracked changes. Các báo cáo untracked và private artifacts Phase 01–04 được giữ nguyên. SHA256 evidence Phase 01–04 đã đối chiếu: `0f1b4ea9bac0d3f30f4aea6e9ed46da68fdc419c123ccb06e0b2f5a37a43f8b2`, `950e336fc1f1a4b3f16f0fc6d73be8769b6df62c850afefa8ec9205e4d230105`, `b537ca88251f56432830f48d1fd41d67e678f48570da86b01f57163450cf5eaa`, `d5c20eca7e356991d30b7e4a41d029a9848c3e4c0750439a16efd4eef3b24e6a`.

Báo cáo này được tạo sau implementation commit để ghi literal final SHA; giữ untracked như các báo cáo Phase 02–04. Không stage các tài liệu/artifacts cũ.

## 1. Trạng thái trước và gap được tái hiện

- Native TCP ordinary đã phân biệt auth với ACK trong counter, nhưng ACK phát `LIVE`; TCP acceptance/non-ordinary trước đây có thể phát LIVE ngay ở authentication.
- MarketContext chuyển LIVE khi nhận trade mà không cần health policy; status chỉ có LIVE/UNAVAILABLE.
- App tự `setFeedStatus('LIVE')` khi flush pending ticks, có thể ghi đè trạng thái terminal đã dừng.
- Browser checker dùng `lastMessageTs` chung (bao gồm PONG), từng phát feed STALE từ browser transport.
- TerminalStatusBar gắn nhãn REALTIME/sub-second/licensed khi chưa có bằng chứng cho latency/licensing; trường Latency thực tế là browser RTT.
- Actual UI test tái hiện: App nhận INIT/TICK nhưng `isConnected=false`. `setListeners` đăng ký listener map, còn lifecycle callbacks gửi vào legacy listener rỗng. Sửa chỉ đường broadcast lifecycle/health/close; symbol routing của market DTO giữ nguyên.
- Controlled offline test tái hiện final bar metadata không khớp digest: khi public status đã UNAVAILABLE, `setFeedStatus(UNAVAILABLE)` bỏ qua final INIT. Sửa force final status và đóng health trước final publication, sau socket destruction. Không bỏ đối soát digest.

## 2. Health contract và transition table

Giữ public `feedStatus: LIVE | UNAVAILABLE` tương thích. Bổ sung optional `feedHealth` vào INIT_STATE và HTTP status/health; snapshot có state, reason, auth/ACK/transport flags, timestamp/counter tách biệt. UI đọc state/reason chi tiết, không coi socket browser là vendor health.

| Evidence/event | Internal/UI state | Public feedStatus | Điều kiện/reason |
| --- | --- | --- | --- |
| Runtime OFF/key alone/invalid scope | DISABLED | UNAVAILABLE | Không activation; không transport attempt |
| Approved connect attempt | CONNECTING | UNAVAILABLE | Chưa auth; TCP open chỉ ghi transportAt |
| Auth success | AUTHENTICATED | UNAVAILABLE | Chưa subscription ACK |
| Subscription command sent | SUBSCRIBING | UNAVAILABLE | Chờ gateway ACK |
| Actual SystemMsg ACK, chưa accepted trade | INDETERMINATE | UNAVAILABLE | Subscription accepted; market freshness chưa đo |
| ACK + accepted observation, local age <=30s, static calendar open | LIVE | LIVE | Recent accepted observation; không attestation về latency/continuity |
| ACK/heartbeat nhưng observation cũ hoặc không có | INDETERMINATE | UNAVAILABLE | Quiet versus stalled UNKNOWN; không tạo synthetic trades |
| Validated vendor activity im lặng >60s | STALE | UNAVAILABLE | Local policy; quiet versus stalled vẫn UNKNOWN, không vendor SLA |
| Static calendar closed (khi còn vendor activity) | MARKET_CLOSED | UNAVAILABLE | Không chứng minh holiday/vendor session truth |
| Error/denial/remote close/manual stop | UNAVAILABLE | UNAVAILABLE | Terminal reason sticky; late callback không phục hồi |
| Persistence/identity/contract failure hoặc approval expiry | BLOCKED | UNAVAILABLE | Operator reconciliation/renewed profile required |

30s/60s là policy quan sát bảo thủ của ứng dụng, **chưa được vendor xác nhận bằng genuine heartbeat cadence hoặc long soak**. LIVE không chứng minh toàn phiên, completeness, delivery tới mọi browser hay clock offset. Legacy in-process fixture providers có thể báo readiness bằng status LIVE; production ordinary registry chỉ dùng native TCP với explicit ACK.

## 3. Auth, ACK và freshness

Native authentication phát AUTHENTICATED; command phát SUBSCRIBING; chỉ decoded SystemMsg ACK phát ACKNOWLEDGED và tăng ordinary ACK counter. Heartbeat/control không tăng accepted/persisted/published market counters. Pre-ACK ordinary records không đi vào MarketContext.

Command giữ nguyên, một command/connection budget mỗi backend boot:

```text
schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1
```

Mock ordinary evidence: connectionAttempts=1, subscriptionCommands=1, subscriptionAcks=1; historyCalls=0, HTTP/options calls=0. ES allowed/NQ denied; warm context và nhiều authenticated browsers dùng cùng context. Không mbp-1/TBBO/mbp-10, implicit subscriptions, reconnect hoặc extra integration.

`waitForLive` cần market observation, không resolve chỉ vì auth/socket open/ACK. Nhánh residual ACK resolver đã được bỏ; fake transport test giữ pending promise qua auth và ACK, chỉ resolve sau trade. `isConnected` là transport/subscription availability, không chứng minh freshness.

## 4. Timestamp, source và clock domains

Snapshot giữ riêng transportAt, authenticatedAt, subscriptionAt, ackAt, vendorControlAt, decoderReceiveAt, acceptedAt, vendorEventAt, persistedAt, publishedAt. Vendor event ns và vendor receive ns được giữ nguyên từ identity tuple; local TCP decoder capture thêm receiveTs, acceptance controller tiếp tục giữ local trace timestamp của nó. Không đổi DBN offsets/constants, event-time normalization hoặc identity tuple.

- Vendor event/receive timestamps: vendor clock domain; event ns lossless trong identity, event ms cho engines.
- Local decoder/accept/commit/publication times: host wall-clock observation, có thể bị skew/jump.
- Freshness ages: `performance.now()` monotonic, không dùng vendor event time để đo timeout.
- Expiry: immutable wall expiry cộng monotonic deadline. Rollback wall không kéo dài approval; forward wall expiry được kiểm tra trên incoming data và health refresh. Socket destroy trước blocked/final snapshot; timer deadline vẫn giữ Phase 01.
- Browser PING/PONG: token correlation + monotonic RTT; UI ghi **Browser RTT**, không feed latency. PONG không gọi vendor health signal hoặc refresh vendor timestamps.
- Không tính/ép latency âm thành dương; không công bố vendor latency khi chưa biết host/vendor offset. Không chỉnh Windows clock/Time service.

`published` là local fan-out path completion, không browser ACK. Acceptance bypass SQL giữ persisted=0; ordinary chỉ accepted/persisted sau SQL commit. Restored SQLite records không trở thành fresh market observations.

## 5. Quiet/closed market và failure precedence

Quiet market vài giây giữ recent observation window, không tự là STALE. Control/heartbeat mới mà không có accepted market record -> INDETERMINATE sau observation window. Static calendar phân biệt daily halt/open, nhưng holidays/actual venue session và clock synchronization vẫn NOT VERIFIED.

Persistence và contract/identity block là sticky, ưu tiên hơn transport, heartbeat hoặc late trade. Provenance/quality/coverage Phase 04 giữ nguyên; SOURCE UNKNOWN không được badge LIVE biến thành genuine source proof. Stop/expiry giữ historical charts nhưng kết thúc live observation health. Không auto recover/reconnect từ blocked state.

## 6. Cleanup và final publication

Ordinary expiry/explicit stop invalidate generation, destroy socket và clear timers/listeners, không reconnect. MarketContext token loại callback cũ. Final trailing BAR_UPDATE/PROFILE_UPDATE được flush từ committed analytics; final INIT_STATE phát stopped/BLOCKED reason. Controlled finish force final INIT cả khi public UNAVAILABLE không đổi, sau synchronous socket destroy. Không thay đổi stream record cap hoặc controller hard deadline/supervisor scope.

## 7. Deterministic mock transport / fake clock

`pnpm test:health:offline`: **20/20 PASS**, exit 0. Guard pins provider none, key rỗng, memory/fixture DB; transport là injected mock EventEmitter, credential sentinel chỉ trong test. Fake timer kiểm tra expiry không cần sleep để tạo time transitions. SQLite singleton chỉ xóa **fixture memory rows** giữa cohorts, không chạm staging database.

| Case | Evidence | Result |
| --- | --- | --- |
| 1 | OFF/key present | PASS |
| 2 | Missing/invalid/expired approval | PASS |
| 3 | TCP connecting no auth | PASS |
| 4 | Auth success not ACK | PASS |
| 5 | ACK and committed market observation | PASS |
| 6 | Gateway denied/error | PASS |
| 7 | Control only no market records | PASS |
| 8 | Browser PONG cannot refresh stalled vendor | PASS |
| 9 | Quiet active transport is indeterminate | PASS |
| 10 | Static calendar boundary | PASS |
| 11 | Remote socket close no retry | PASS |
| 12 | Partial/admin/malformed DBN not market freshness | PASS |
| 13 | SQLite failure beats transport health | PASS |
| 14 | Contract mismatch fail closed | PASS |
| 15 | Approval expiry despite wall clock rollback | PASS |
| 16 | Stop and late callbacks inert | PASS |
| 17 | Browser resubscribe shares existing context | PASS |
| 18 | Final committed BAR/PROFILE and stopped DTO | PASS |
| 19 | Wall clock forward expiry closes before blocked snapshot | PASS |
| 20 | Monotonic freshness unaffected by UTC jumps | PASS |

Mỗi case lưu actual state/reason, counters, wall timestamps và các fields ns khi có trong private `health-cases.json`. Missing/malformed/expired profile đều thêm assertions zero connection; UTC/rollback/forward clock, incomplete/admin DBN và malformed framing không làm mới market freshness.

## 8. Actual React / normal WebSocket verification

Actual `ChartSession -> WebSocket -> App -> TerminalStatusBar` dùng regular components, không AcceptanceObserver thay thế.

| Scenario | Actual DOM/state assertion |
| --- | --- |
| ACK chưa trade | FEED INDETERMINATE |
| Accepted fixture trades | FEED LIVE; actual `TerminalStatusBar.isConnected=true`; source LOCAL_FIXTURE/PARTIAL |
| Fake monotonic silence >60s | FEED STALE; reason có UNKNOWN |
| Control trở lại, market quiet | FEED INDETERMINATE |
| Stop | FEED UNAVAILABLE; final status DTO; chart vẫn volume 15/CVD +4/UNKNOWN 5 |
| ES -> NQ | FEED DISABLED; NQ volume 6/CVD -6, không nhận late ES volume |
| Fixture block | FEED BLOCKED, retained charts/provenance |

Regular fixture before-stop: volume 14, BUY 7, SELL 3, UNKNOWN 4, CVD +4, POC 100; actual Footprint/CVD/Profile/candle props vẫn đối soát độc lập. Final committed trade -> volume 15, UNKNOWN 5, final BAR/PROFILE đầy đủ. NQ cohort giữ nguồn LOCAL_FIXTURE và PARTIAL. Browser disconnect không giữ nhãn LIVE; BLOCKED/DISABLED reason vẫn giữ độc lập với browser connection.

Private actual React result chứa LIVE/stopped/NQ component props và screenshot final BLOCKED bổ trợ. Controlled offline **50 records**, numeric digest MATCH, exit 0; không genuine records mới.

## 9. Browser failure evidence

Phase 05 không tái hiện blank-page TC13; final TC13 và cả 19 tests PASS. Phase 04 blank-page cause vẫn NOT VERIFIED.

Initial TC10 fail do assertion chỉ chấp nhận REALTIME/UNAVAILABLE/RECONNECTING, actual DOM là DISABLED. Screenshot, console/network/load diagnostics giữ tại `C:/Users/Administrator/.codex/private-acceptance/phase05-browser-failure-1791957096795`. Root đã mount; diagnostics có document 200 và một số auth/config 429 warnings. Đây không phải blank page; không sửa rate limiting ngoài phạm vi. Test expectation được đổi sang backend DISABLED hoặc stopped UNAVAILABLE, với reason OFF/stopped từ authoritative INIT_STATE. Instrumentation lưu failures vào private directory và strip query/headers; retries=0.

Một TC10 failure bổ sung giữ tại `C:/Users/Administrator/.codex/private-acceptance/phase05-browser-failure-1791973002159`: immediate innerText đọc UNAVAILABLE trước authoritative INIT health. Test nay chờ backend reason bằng async assertion, không fixed sleep; final log ghi `FEED: DISABLED / FUTURES_PROVIDER=none: ordinary vendor activation OFF`. TC13 vẫn PASS, không blank page. Không xóa diagnostic hay che failure bằng retry.

Initial controlled mismatch evidence giữ tại `C:/Users/Administrator/.codex/private-acceptance/deepchart-1791957041139`. Không dùng rerun để thay thế sửa gap final INIT. Initial regular failure là listener lifecycle thiếu map broadcast, được fix với actual connected assertion.

## 10. Regression exit codes

| Command / check | Result | Exit |
| --- | --- | --- |
| pnpm typecheck:all | server/client PASS | 0 |
| pnpm test:unit | PASS | 0 |
| pnpm test:integration | PASS | 0 |
| pnpm test:ordinary:offline | budgets/exact command/auth!=ACK PASS | 0 |
| pnpm test:identity:offline | Phase 02 PASS | 0 |
| pnpm test:durability:offline | Phase 03 fault/recovery PASS | 0 |
| pnpm test:provenance:offline | Phase 04 13 cases PASS | 0 |
| pnpm test:health:offline | Phase 05 20 cases PASS | 0 |
| pnpm verify:p0 | 13/13 PASS | 0 |
| pnpm test:isolation | 17/17 PASS | 0 |
| pnpm test:terminal:offline | actual regular UI PASS | 0 |
| node scripts/verify_trades_e2e.mjs --offline --regular-terminal | 50 records, digest MATCH | 0 |
| pnpm test:e2e | 19/19 PASS, no retry, teardown 0 processes | 0 |
| pnpm build:all + final client:build | PASS | 0 |
| Docker build/up offline override | PASS | 0 |
| Protected staging verifier | 42/42 PASS | 0 |

Durability fixture assertion LIVE-without-ACK được sửa thành DISABLED/UNAVAILABLE; durable-before-publish và numeric assertions giữ nguyên. Ordinary ACK-only assertion đổi sang INDETERMINATE. Candle numeric comparison giữ OHLCV/levels nguyên vẹn, so source/coverage riêng vì cohort metadata được cập nhật bởi final INIT.

## 11. Docker và persistence

Build/up dùng `docker-compose.yml` + `deploy/offline-staging.compose.yml`; app healthy, proxy running trên loopback. Staging vendor state DISABLED, provider none, key empty, runtime start 0, profile empty. `/api/v1/status`: attempts/commands/ACK=0; history/GEX/quote/reconnect=false. Không vendor connection/subscription mới.

SQLite `/app/data/market_data.sqlite`: **66238 trades, 1236 bars**, integrity `ok`, foreign key violations 0. Before/after schema SHA256 `e52d6592da8b25d78b72aa1192a048539f227548c7838746ad6a1900109af2f2`; full trade-row payload SHA256 `7d34e9b1128ba307b08c1836ec7df3643339a25eb22832bba75b78195509c613`, không đổi. Volume nguyên vẹn; không migration/reset/delete actual records.

Backup baseline **12**, final **15**; cả 12 tên/hash baseline giữ nguyên. Ba lượt staging protected backup tạo thêm snapshots, không prune. Chỉ backup command của verifier dùng BACKUP_KEEP=100000 qua preload wrapper; không đổi permanent retention. Restore/integrity probe dùng backup copy theo verifier, không restore đè live SQLite.

## 12. Files thay đổi

- `client/src/App.tsx`
- `client/src/components/Status/TerminalStatusBar.tsx`
- `client/src/services/websocket.ts`
- `client/src/types/index.ts`
- `e2e/terminal.spec.ts`
- `package.json`
- `scripts/verify_regular_terminal.mjs`
- `server/src/acceptance/controlledTrades.ts`
- `server/src/databento/liveClient.ts`
- `server/src/index.ts`
- `server/src/marketData/feedHealth.ts`
- `server/src/marketData/marketContext.ts`
- `server/src/marketData/ordinaryRuntime.ts`
- `server/src/marketData/registry.ts`
- `server/src/marketData/types.ts`
- `server/src/types.ts`
- `server/test/durability.test.ts`
- `server/test/feedHealth.test.ts`
- `server/test/ordinaryRuntime.test.ts`
- `server/test/unit/databentoLive.test.ts`

Không sửa Footprint/CVD/Profile math, stable identity algorithm, DBN protocol constants, SQL schema, history/billing/licensing hay reconnect policy. Code changes nằm trong health, existing transport/context/DTO/UI và regression harness có bằng chứng.

## 13. Evidence và giới hạn

Private manifest: `C:/Users/Administrator/.codex/private-acceptance/production-safety-phase05-1791972672587/evidence.json`.
SHA256: `ecd2a2485645b3038abda2f2743df7457c00e704dd3333e784e5dc2633851b1b`.

Manifest lưu final HEAD/source hashes, 20 snapshots/counters, test exits/log hashes, SQLite before/after, backup names/hashes và runtime state. Numeric artifacts mới không chứa API key hoặc JWT; không đọc key thật cho offline tests.

Actual regular React evidence: `C:/Users/Administrator/.codex/private-acceptance/regular-terminal-offline-1791972945424`.
Controlled offline evidence: `C:/Users/Administrator/.codex/private-acceptance/deepchart-1791972954002`.

NOT VERIFIED / UNKNOWN còn lại:

- Genuine vendor behavior của health policy mới, heartbeat cadence, quiet/stall discrimination và subscription denial combinations thực tế chưa chạy.
- Full-session continuity/completeness, ordinary long session, P1 reconnect/resubscribe/restart/soak và multi-symbol Live chưa nghiệm thu.
- Static calendar holidays, actual CME session authority, host/vendor clock offset và feed latency chưa xác minh. 30s/60s không là vendor SLA.
- Publication không là durable browser ACK; không mới thêm persistent consumer watermark/outbox.
- Genuine provenance/identity/persistence changes của Phase 02–04 vẫn cần phạm vi approval riêng; historical genuine controlled PASS không suy ra ordinary production PASS.
- P0 unintended connection session-specific usage/cost attribution vẫn UNKNOWN đã được Operator chấp nhận; không kết luận cost 0 từ local DB/logs.
- `GLBX.MDP3 mbp-10 — NOT AUTHORIZED`; DOM/Liquidity Heatmap **BLOCKED BY VENDOR ENTITLEMENT**.

## 14. Operational readiness recommendation

Đủ điều kiện bàn giao **P0-F OFFLINE VERIFIED**. Đề xuất Operator chọn riêng bước P1 operational lifecycle/recovery thiết kế và nghiệm thu offline trước; genuine health/quiet/heartbeat acceptance hoặc soak cần approval và giới hạn riêng, không tự triển khai trong phase này. Production readiness vẫn **NOT YET ACCEPTED**.

Không chạy Databento Live, paid historical, MBP-10, trading orders; không mua/đổi plan, billing/licensing, Stripe Live, public deployment, Windows clock hoặc push. Dừng sau handoff.
