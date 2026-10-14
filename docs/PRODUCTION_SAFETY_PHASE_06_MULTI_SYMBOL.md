# Production Safety Phase 06 — P0-B Multi-Symbol Isolation & Contract Routing

**P0-B: OFFLINE VERIFIED trong phạm vi fixture/mock và regular Terminal mô tả bên dưới. Không Live mới; production readiness NOT YET ACCEPTED.**

Ngày hoàn tất: 14/10/2026 18:21 ICT.
Baseline: `ee2655aa340fd9286aaebd9b1cfa99100f10f2b8`.
Final implementation HEAD: `8c999a78f581bc6ebdc18e094e02bfa009e94044`.
Local commit: `fix: isolate pane ownership and symbol-scoped market state`. Không push.

Baseline tracked tree sạch; Docker app healthy, proxy running, provider none/key empty/start OFF. Tất cả báo cáo untracked/private evidence cũ giữ nguyên. Evidence Phase 05 SHA256 đối chiếu vẫn `ecd2a2485645b3038abda2f2743df7457c00e704dd3333e784e5dc2633851b1b`. Báo cáo này tạo sau code commit để ghi literal final SHA, giữ untracked như các phase trước.

## 1. Reproduced failures và source risks

| Finding | Bằng chứng trước fix | Sửa tối thiểu |
| --- | --- | --- |
| Named NQ attachment đổi primary ES | Offline baseline probe: primary NQ sau ES+NQ attach, mong đợi ES | Owner id riêng; chỉ default owner đổi primary symbol/timeframe |
| Whole socket cleanup bỏ sót ES | Baseline unsubscribe: ES subscriber=1, NQ=0; subscriptions vẫn ES/NQ | Detach mọi owned/subscribed symbol; clear subscription/evidence references |
| Close button cycle layout | Actual two-browser UI: click Close, NQ subscriber vẫn 2 thay vì 1; source onClose=cycleLayoutMode | Close trở về single theo đúng button title; unsubscribe pane owner |
| Microstructure cross-symbol window | Baseline module probe: ES BUY2/NQ SELL3, cả hai snapshot buy1/sell1, volumeImbalance -0.2 thay vì +1/-1 | Tick windows theo symbol; MarketContext truyền explicit symbol, công thức không đổi |

Source risks, được phân biệt với reproduced numeric failures:

- Secondary onTick tự nâng LIVE dù backend health stopped; bỏ tick-based promotion và dùng backend feedHealth/reason. Actual final tick + stopped status regression chứng minh không hồi sinh LIVE.
- Một shared generation cho named panes có thể làm pending attach của pane khác bị bỏ; thêm per-owner generations, kiểm chứng concurrent ownership và pending manager shutdown.
- Pending context có thể được insert sau disposeAll theo source ordering; test delayed initialization yêu cầu manager disposed, late completion đóng context, map không tái sinh.
- Cache/replay trước đây giữ metadata-less legacy rows cùng known contract. Phase 06 áp dụng policy bảo thủ: known-contract window loại rows không chứng minh contract membership, vẫn giữ rows nguyên trong DB. Vendor ingestion bị BLOCKED nếu chỉ có legacy cache chưa reconcile.

Không suy rằng các risk nguồn đã gây incident genuine trước đây. Không audit/refactor toàn hệ thống, không thay DBN constants/decoder/Footprint/CVD/Profile math.

## 2. Data path và subscription ownership

Normal flow giữ registry -> one MarketContext per symbol -> production decoder/identity -> commit-before-publish -> per-context Footprint/Profile/CVD -> ChartSession -> symbol-routed WebSocket listener -> actual React components.

Client SUBSCRIBE/UNSUBSCRIBE có optional `subscriptionId`: default cho primary, pane2/3/4 cho secondary. Đây là browser routing ownership, **không vendor approval capability**. Server vẫn validate symbol, timeframe, AccessPolicy và immutable ordinary runtime profile trước attach.

- Multiple owners cùng symbol/timeframe trên một ChartSession dùng một context attachment. Đóng một owner không xóa owner còn lại.
- Primary switch detach old symbol khi không có owner khác, giữ named owners độc lập.
- Primary subscribedSymbol/timeframe không bị secondary ghi đè. Mỗi owner có generation riêng; unsubscribe invalidates owner request.
- Whole WebSocket close detach tất cả symbols và clear evidence providers/subscriptions. Default warm ES vẫn được giữ theo thiết kế; warm retention không là vendor activation ngoài profile.
- Browser reconnect chỉ khôi phục requests của pane hiện hữu trên existing multiplexer; không thêm vendor retry/capability. P1 recovery/long soak chưa thực hiện.
- **Same symbol với differing timeframes trong cùng một socket được reject bằng SUBSCRIPTION_OWNERSHIP_CONFLICT**; giữ active timeframe, không âm thầm trộn BAR streams. Muốn hỗ trợ đầy đủ cần phase riêng về per-owner/timeframe DTO; phase này chỉ xác nhận matching timeframe và ES/NQ independent cohorts.

## 3. Independent numerical oracle

DBN-shaped bytes được đưa qua production `parseDbnRecord`, không fixture giả được gắn genuine. Fixture routing keys: ES `GLBX.MDP3/17/800001`, NQ `GLBX.MDP3/17/800002`. Publisher/instrument values **là fixture IDs**, không Databento continuous mapping mới.

Interleaved ES/NQ dùng cùng event ms, prices và sizes nhưng sides khác nhau; unique vendor-record IDs giữ dataset/publisher/instrument/ns. Duplicates trong mỗi symbol không tăng volume, cache hay SQL counters của symbol kia.

| Cohort | Records | Volume | BUY | SELL | UNKNOWN | CVD | POC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ES initial | 4 | 14 | 7 | 3 | 4 | +4 | 100 |
| NQ initial | 4 | 14 | 7 | 2 | 5 | +5 | 100 |
| ES final UI | 5 | 15 | 8 | 3 | 4 | +5 | 100 |
| NQ final UI | 5 | 16 | 7 | 4 | 5 | +3 | 100 |

Initial levels ES: 100 => BUY2/SELL0/UNKNOWN4; 100.25 => SELL3; 100.5 => BUY5. NQ: 100 => BUY4/SELL2; 100.25 => BUY3; 100.5 => UNKNOWN5. Independent oracle kiểm OHLCV/event-ms bar boundaries, per-price volume, final CVD, totals, POC và accepted/persisted counters; không chỉ dùng screenshots.

Initial candles của cả hai có volume 9 và 5; first OHLC 100/100.25/100/100, second 100.5/100.5/100.5/100.5. Final ES second bar volume6, close100; NQ second bar volume7, close100.25. Backend actual DTO/React numeric checks giữ BUY/SELL/UNKNOWN riêng. Same legacy ID/price/timestamp được kiểm riêng trong ES/NQ legacy-only fixture cohorts: +2/-2 CVD, một row mỗi symbol, metadata UNKNOWN.

## 4. Contract/rollover policy

Contract key là dataset/publisher/instrument từ validated identity tuple, không inferred symbol name, trading date hoặc venue sequence scope. Active cohort bind key sau successful commit; changed key bị BLOCKED trước SQL/cache/analytics mutation. Không reconnect, đổi subscription hoặc auto-rollover khi mismatch.

Offline tests thay riêng dataset, publisher, instrument và instrument ở next-day rollover boundary: mỗi case chỉ record đầu persisted; mismatch không vào engines, reason reconciliation required. Rollover không bỏ guard chỉ vì đi qua session boundary.

`contractWindow` cho restoration/replay chỉ giữ latest observed known contract, loại known old-contract rows **và rows thiếu contract metadata**. Đây là bounded history window, không vendor-authoritative continuous mapping. Legacy-only history vẫn UNKNOWN; khi vendor trade có key đến sau legacy-only cache, phải stop/reconcile, không tự gộp. Không xóa/rekey legacy SQL rows.

Regression Phase 03 giữ original durable cohort 7 records/volume19 trong database; known-contract restoration nay 6/17, legacy row vẫn nguyên. Phase 04 SQL legacy compatibility giữ 5/15; known-contract restored/replay observation là 4/11, coverage PARTIAL. Thay đổi expected values chỉ tại filtered restoration boundaries; ingest/original SQL oracle không nới lỏng.

**Actual ES.c.0 resolved contract-name mapping từ native SymbolMapping/metadata vẫn NOT VERIFIED trong phase này.** Native client administrative mapping records chưa được dùng làm independent name-to-instrument proof. First per-feed binding tin cậy vào subscription-scoped callback/identity; không hardcode fixture IDs hay suy ESZ*/NQZ*. Nếu không có authoritative evidence để reconcile, giữ BLOCKED và Operator quyết định cohort mới. Không tuyên bố correct genuine multi-symbol mapping từ fixtures.

## 5. Backend offline cases

`pnpm test:multi:offline`: **16/16 PASS**, exit 0.

| # | Case | Result |
| --- | --- | --- |
| 1 | Independent contexts / authenticated pane ownership | PASS |
| 2 | Interleaved production decoder / independent numeric oracle / dedup | PASS |
| 3 | Same-symbol shared ownership / primary switches without leakage | PASS |
| 4 | Same-symbol differing timeframe fails closed | PASS |
| 5 | Independent stale and contract mismatch | PASS |
| 6 | Whole socket unsubscribe / disposed late callback / timer cleanup | PASS |
| 7 | Pending context shutdown cannot resurrect | PASS |
| 8 | Bound instrument mismatch rejected | PASS |
| 9 | Bound publisher mismatch rejected | PASS |
| 10 | Bound dataset mismatch rejected | PASS |
| 11 | Bound rollover boundary mismatch rejected | PASS |
| 12 | Replay contract boundary excludes unknown metadata and overlap | PASS |
| 13 | Legacy-only cache cannot silently bind vendor contract | PASS |
| 14 | Production ES-only capability unchanged | PASS |
| 15 | Same legacy ID / price / timestamp remains symbol-local | PASS |
| 16 | Microstructure symbol-local trade window | PASS |

Multi-symbol harness dùng in-process mock feed channels, callback generations và real production DBN decoder/MarketContext/ChartSession; không giả hai native authenticated vendor TCP sessions. Phase 01 native loopback mock TCP regression riêng xác nhận exact trades-only command/budget/auth vs ACK/expiry. Schema không mở rộng, API keys chỉ sentinel trong injected mocks, environment guard giữ provider none/key empty/memory DB.

## 6. Actual React và browser lifecycle

`pnpm test:multi:ui`: PASS qua normal index/ChartSession, actual WebSocket và hai authenticated React pages:

- Browser 1: ES primary + NQ secondary; browser 2: NQ primary với ProfileOverlay/CVDPanel. FootprintCanvas props độc lập, candle OHLCV, source/contract keys, UNKNOWN volumes và Profile/CVD/POC đối soát.
- Secondary chuyển NQ -> ES -> NQ, matching timeframe. Shared ES hai owners vẫn một session attachment; NQ browser thứ hai không bị detach nhầm.
- Fake ES STALE không đổi NQ LIVE; source LOCAL_FIXTURE, quality EXACT, coverage PARTIAL theo symbol. Không tuyên bố genuine LIVE từ fixture badge.
- Final BAR_CLOSE của cả hai symbols, final BAR_UPDATE/PROFILE_UPDATE và stopped health giữ toàn bộ 15/16 volume. Secondary pending tick không nâng LIVE lại.
- Close split pane chỉ bỏ named owner: NQ subscriber 2 -> 1, ES primary giữ 1. Primary ES -> NQ chuyển đúng numeric state 16/CVD+3 và stopped health, ES subscriber ->0.
- Đóng cả hai browser: ES/NQ subscriber 0; externalCalls=0, uncaught browser errors=[]; shutdown/late callback tests không hồi sinh disposed context.

Actual React result và screenshot bổ trợ: `C:/Users/Administrator/.codex/private-acceptance/multi-terminal-offline-1791975914371`. Numeric props/state lưu trong private ui-result.json. Browser suite **19/19 PASS**, retries=0, teardown remaining processes=0; TC13 không blank page trong final run.

## 7. Runtime capability, budgets và cleanup

Production `ordinaryRuntime.ts`/registry approval capability không đổi: only GLBX.MDP3 / ES / ES.c.0 / trades, connection attempt=1, subscription command=1 per boot; NQ denied. Profile OFF/key alone/invalid schema/provider/expired approval vẫn fail-closed. Browser ownership ids không truyền dataset/schema hay đổi approval.

Mock ordinary evidence: exact `schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1`, auth != ACK, one attempt/command, zero history/options/GEX/quote requests, no reconnect. Runtime expiry, socket close, health precedence và fake clock cases Phase 05 **20/20 PASS**.

Manager disposed flag ngăn new/pending context resurrection; callback checks token + disposed; shutdown waits pending initializations to complete cleanup. No general unbounded-connect cancellation/recovery policy mới: adapters/long operations thuộc P1, native ordinary connect currently creates transport without waiting gateway auth. Cleanup tests kiểm cleared health/trailing timers, detached evidence provider, sockets inactive và no reconnect. Mock disconnect invocation counts có thể lớn hơn một vì teardown idempotent sau prior block; không phải thêm connection.

## 8. Mandatory verification

| Check | Result | Exit |
| --- | --- | --- |
| Typecheck server/client | PASS | 0 |
| Unit / Integration | PASS | 0 |
| Phase 01 ordinary safety / exact mock TCP | PASS | 0 |
| Phase 02 identity | PASS | 0 |
| Phase 03 durability | PASS | 0 |
| Phase 04 provenance | 13 cases PASS; conservative window expectations updated | 0 |
| Phase 05 health | 20 cases PASS | 0 |
| Phase 06 backend | 16 cases PASS | 0 |
| Phase 06 actual UI | two authenticated browsers PASS | 0 |
| P0 / offline isolation | 13/13 and 17/17 PASS | 0 |
| Regular Terminal offline | PASS | 0 |
| Controlled Trades offline regular | 50 records/digest MATCH | 0 |
| Browser E2E | 19/19 PASS | 0 |
| Build server/client | PASS | 0 |
| Docker offline build/up | PASS | 0 |
| Protected staging | 42/42 PASS | 0 |

Targeted test failures trước mandatory gồm harness gọi acceptanceSnapshot cho ordinary context, duplicated test-id và Close semantics; harness được sửa đúng actual normal props/API, runtime ownership/Close bugs có bằng chứng riêng. Không dùng rerun để che blank-page, không fixtures thành genuine PASS.

Docker app healthy, proxy loopback running. Staging provider none/key empty/start0/profile empty; native counters attempts/commands/ACK=0, schema null, history/GEX/quote/reconnect=false. Không enable NQ production profile.

Actual SQLite **66238 trades / 1236 bars**, integrity ok, FK0; before/after identical. Schema hash `e52d6592da8b25d78b72aa1192a048539f227548c7838746ad6a1900109af2f2`; full trade payload hash `7d34e9b1128ba307b08c1836ec7df3643339a25eb22832bba75b78195509c613`. Baseline **15 backups**, final **16**, cả 15 names/hashes giữ nguyên; protected backup wrapper BACKUP_KEEP=100000 cho verifier command, không đổi permanent retention. Không reset/delete volumes, actual rows hoặc artifacts.

## 9. Files và private evidence

- `client/src/App.tsx`
- `client/src/components/Chart/SecondaryChartPane.tsx`
- `client/src/services/websocket.ts`
- `client/src/types/index.ts`
- `package.json`
- `scripts/verify_multi_terminal.mjs`
- `server/src/index.ts`
- `server/src/marketData/dataEvidence.ts`
- `server/src/marketData/marketContext.ts`
- `server/src/microstructure/engine.ts`
- `server/src/session.ts`
- `server/test/durability.test.ts`
- `server/test/multiSymbol.test.ts`
- `server/test/provenance.test.ts`

Private manifest: `C:/Users/Administrator/.codex/private-acceptance/production-safety-phase06-1791976576616/evidence.json`.
SHA256: `96f3cde9458a26aa3d13e1a07e60e71d9e1e4f8b3a8544c78d9f74e39639120f`.

Manifest lưu baseline/final SHA, source/log hashes, reproduced baseline observations, 16 case snapshots/oracle, actual UI path/hash, all exit codes, SQLite/backup before/after và runtime status. Numeric artifacts không chứa API key/JWT. Các reports/evidence cũ được bảo toàn.

## 10. NOT VERIFIED và P1 recommendation

- Genuine simultaneous ES/NQ, authoritative continuous mapping/contract names, actual exchange rollover/session/trading-date semantics và venue sequence scope chưa nghiệm thu. Production NQ vẫn không được phép.
- Native two-symbol gateway topology, real entitlement/ACK combinations, reconnect/resubscribe, long soak, network stalls và operational restart/reconciliation cần approval riêng; không suy từ mock channels.
- Same-symbol differing-timeframe owners trên một socket không được hỗ trợ; backend reject, không mở rộng thành per-owner BAR DTO/refactor. Full multi-pane replay behavior và UI recovery sau ownership-conflict chưa nghiệm thu.
- Cache selection là observed known window, không full session; excluded legacy/old-contract rows vẫn tồn tại và cần Operator reconciliation nếu muốn nhập cohort.
- Microstructure nay symbol-local; long-lived contract epoch/restart telemetry policy chưa nghiệm thu. Không thêm P1 lifecycle math hoặc generalized engine rewrite.
- Earlier genuine controlled Trades PASS vẫn historical evidence; không là Phase 06 genuine acceptance. P0 incident session-specific usage/cost attribution giữ UNKNOWN như Operator đã chấp nhận.
- GLBX.MDP3 mbp-10 NOT AUTHORIZED; DOM/Liquidity Heatmap BLOCKED BY VENDOR ENTITLEMENT.

Đề xuất P1 riêng: thiết kế offline bounded lifecycle/recovery và subscription ownership reconciliation, fake transport stalls/restarts/cancellation, explicit contract authority và consumer/persistence watermark, rồi Operator chọn phạm vi genuine test riêng nếu cần. Production readiness vẫn NOT YET ACCEPTED; không tự triển khai P1.

Không Databento Live, paid historical, depth retry, entitlement/billing changes, Stripe Live, public deployment, trading orders, Windows clock changes hoặc Git push. Dừng sau handoff.
