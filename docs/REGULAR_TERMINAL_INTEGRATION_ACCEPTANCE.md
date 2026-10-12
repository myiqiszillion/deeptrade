# Regular Terminal integration — offline acceptance, 12/10/2026

**OFFLINE REGULAR TERMINAL PASS. Genuine Live Terminal E2E: NOT VERIFIED.** Không chạy lại isolated Live acceptance đã PASS, không mở Databento connection hoặc retest MBP-10.

Baseline Git HEAD: `153f09f94e5d5e1798adede97105655f28781c15`. Revision chứa sửa lỗi/test/báo cáo này được xác định bằng `git log -1 --format=%H -- docs/REGULAR_TERMINAL_INTEGRATION_ACCEPTANCE.md`; full hash được ghi trong handoff. Không push.

## 1. Normal data path và khác biệt

Normal path: DatabentoLiveClient → FeedHandlers.onTrade → MarketContext.handleTrade → validate/dedup → MarketTrade thành Tick → normal FootprintEngine(s), ProfileEngine, VWAP/Tape → ChartSession.send JSON → backend WebSocket → client/services/websocket symbol dispatch → App React state → FootprintCanvas (footprint hoặc candles), CVDPanel, ProfileOverlay.

Normal fanout phát TICK, BAR_UPDATE/BAR_CLOSE, PROFILE_UPDATE; bars theo event-time milliseconds, CVD là field trong FootprintEngine bars. App mergeBar, setCurrentCVD và setVolumeProfile; candle drawing là branch chartMode=candles trong FootprintCanvas, không có engine candle riêng cần viết lại. Footprint totalVol giữ UNKNOWN, bid/ask chỉ volume có side; CVD UNKNOWN contribution=0. Profile total gồm UNKNOWN nhưng mức unknown được suy ra từ total-buy-sell nếu DTO không có field riêng.

Isolated acceptance dùng fresh context fast path và private ACCEPTANCE snapshots/digest, không ChartSession normal messages; source/session/mapping/raw side/receive ns nằm trong private trace. Normal runtime có history/store seed, multiplex symbols, GEX maintenance và throttling, không mặc định bounded trades-only. Normal Tick/Bar DTO không giữ đầy đủ dataset/instrument_id/raw-side/cohort watermark; instrument ở UI là catalog metadata. Đây là giới hạn cho future genuine reconciliation, không tự mở rộng sửa DTO trong task này.

## 2. Fixture harness và isolation

Lệnh tái lập sau backend build:

```powershell
pnpm test:terminal:offline
```

`scripts/verify_regular_terminal.mjs` boot **normal server/index + actual ChartSession**, normal App qua Vite loopback; không AcceptanceObserver. Env trước dynamic imports: NODE_ENV=test, provider none, API key rỗng, STORAGE_PATH=:memory:, host 127.0.0.1. Backend fetch bị chặn và đếm; **externalCalls=0**. Không đọc .env thật. Test admin/login dùng credentials/JWT fixture trong DB memory, token không lưu artifact; không thay đổi account/billing staging thật.

Một helper in-process `offlineTerminalTestContext` chỉ được gọi khi test/none/no-key/in-memory; không endpoint. Fixture normalized trades đi vào handleTrade normal branch (private method truy cập tại JS test runtime); không vendor factory hoặc decoder transport. Context provider/source được label fixture. Sidebar Profile, FootprintCanvas và CVDPanel thật mount; test đọc **current React Fiber tree** memoized props từ committed state, không stale DOM alternate. Test chuyển candle mode bằng button thật, xác minh canvas dimensions >0; screenshot chỉ bổ trợ. Named header callback chọn NQ để kiểm tra normal symbol switch. Đây là product WS subscription against fixture server; **vendor subscriptions=0**.

Artifact được gắn **OFFLINE PASS — NOT LIVE**; screenshot có banner OFFLINE FIXTURE. Không trộn SQLite cũ hoặc historical bars. Normal App vẫn có thể gửi FETCH_HISTORY tới backend, nhưng chỉ nhận response memory/empty; không Databento historical request, không external GEX/options fetch.

## 3. Hai lỗi được chứng minh và sửa tối thiểu

### Trailing updates bị mất khi không còn tick

- File: `server/src/marketData/marketContext.ts`.
- Reproduction: burst 4 normalized trades BUY 2 @100, SELL 3 @100.25, UNKNOWN 4 @100, BUY 5 @100.5; event timestamps 15:33:58–15:34:01 UTC, gọi liên tiếp trong cùng wall-clock throttle window.
- Expected: Footprint/Profile volume 14, CVD +4, current bar cuối volume 9.
- Actual trước fix: 4 TICK nhưng UI Footprint volume **5**, Profile **2**, CVD **-1**. Normal WS leading update và BAR_CLOSE có, nhưng current-bar/profile cuối không được gửi nếu không có trade tiếp theo.
- Cause: BAR_UPDATE 100ms và PROFILE_UPDATE 500ms chỉ kiểm tra tại arrival; không trailing flush.
- Fix: một trailing analytics timer 500ms/context phát current bar và profile bằng ChartSession normal messages; stopFeed clear timer và flush sau disconnect, rồi status UNAVAILABLE. Không reconnect/new vendor stream để flush. Replay subscribers bị skip. Engines/DBN constants không đổi.
- Regression: fixture burst, idle tail, immediate stop sau trade UNKNOWN bổ sung; assert BAR_UPDATE/PROFILE_UPDATE explicit cuối, không dựa chỉ INIT_STATE.

### Primary listener vẫn route theo ES sau chọn NQ

- File: `client/src/services/websocket.ts`.
- Reproduction: normal TerminalHeader chọn NQ; inject NQ SELL 6 @201 rồi late ES BUY 20. Expected NQ volume 6/CVD -6, không late ES contamination. Actual trước fix: NQ-labelled main chart nhận old ES bar volume **30**, bỏ NQ messages.
- Cause: setListeners bind default entry ở ES; subscribe đổi activeSubscription nhưng không đổi symbol của default listener.
- Fix: retarget **default primary listener only** khi subscribe. Named secondary pane routes giữ nguyên; backend multiplex có thể tiếp tục gửi ES cho pane có nhu cầu, main route phải filter đúng NQ.
- Regression: real App symbol-selection callback, backend symbol subscription, NQ instrument pointValue20, ES late-frame rejection, NQ volumes/CVD độc lập.

Không viết lại Footprint/CVD/Profile algorithms, không đổi protocol constants, không refactor toàn hệ thống.

## 4. Numeric component results

| Check | Actual offline result |
|---|---|
| Initial ES accepted fixtures | 4 trades, total 14; BUY7 / SELL3 / UNKNOWN4 |
| Footprint / Profile | 14 / 14; price bins 100=6, 100.25=3, 100.5=5 |
| CVD | 2-3+0+5 = **4** |
| ES Profile POC | **100** |
| Provenance / coverage | **EXACT / UNKNOWN**, isEstimated=false; UNKNOWN is conservative, not COMPLETE |
| 15:33:00 UTC bar | O100 H100.25 L100 C100.25 V5; BUY2 SELL3 |
| 15:34:00 UTC bar | O100 H100.5 L100 C100.5 V9; BUY5 SELL0; UNKNOWN4 at price100 |
| Candle drawing mode | Actual FootprintCanvas chartMode=candles; same asserted OHLCV bars |
| Final immediate stop | Additional UNKNOWN1 @101; ES total **15**, CVD **4**; current-bar volume10; explicit BAR_UPDATE and PROFILE_UPDATE delivered |
| Symbol/instrument | ES pointValue50/tickSize0.25; switch NQ pointValue20, chart symbol NQ |
| NQ isolation | SELL6 → volume6, CVD **-6**; late ES20 did not alter NQ state |
| Browser errors / external calls | **0 / 0** |

Recorded normal message counts in final fixture run: TICK **7** (5 initial/final ES +1 NQ +1 late ES multiplex frame), BAR_UPDATE **8**, BAR_CLOSE **1**, PROFILE_UPDATE **8**; INIT_STATE6, PONG1 are not numeric market-data proof. Engine accepted fixtures and current UI state are asserted independently against known input sizes/prices/events. Primary ignored the late ES message while multiplex retained explicit per-symbol routing.

Regular Profile coverage UNKNOWN differs from isolated PARTIAL; no full-session completeness established, so test asserts never COMPLETE and reports UNKNOWN honestly. EXACT refers to observed input aggregation, not vendor provenance. Normal global instrument/source details still need genuine contract/cohort trace in a future bounded test.

## 5. Changed files

- `server/src/marketData/marketContext.ts`: trailing/final normal analytics flush and stopped status.
- `client/src/services/websocket.ts`: default primary symbol route follows selection.
- `server/src/index.ts`: guarded in-process offline test access, no HTTP/WS injection endpoint.
- `scripts/verify_regular_terminal.mjs` (new): real normal-server/App fixture test, React current-state assertions and isolation.
- `package.json`: `test:terminal:offline` entry.
- This report. No chart components/engine algorithms/protocol constants changed.

Private offline evidence: `%USERPROFILE%\.codex\private-acceptance\regular-terminal-offline-1791820661685\result.json`, `before-stop.json`, `terminal.png`. Stored outside Playwright test-results because ordinary Playwright cleanup removes that directory. JWT pattern absent in result; no genuine market payload or API key used by harness. Test artifacts retained.

## 6. Timestamp investigation — read-only existing evidence

[Official Databento Trades fields](https://databento.com/docs/schemas-and-data-formats/trades) define ts_event as matching-engine receipt and ts_recv as Databento capture-server receipt, both Unix nanoseconds. Local receive in controlled trace is Windows Date.now() at decoder boundary, not vendor ts_recv or packet-capture arrival time.

Source inspection: production parser uses header event ns → trade.ts ms; controlled trace reads vendor receive separately and adds local wall clock. No source evidence of event/receive field swapping; raw DBN was not retained, so cannot independently replay binary interpretation. No timestamp or constants were changed.

Existing genuine first trace (not a new Live run): event **1791819209588917773**, vendor receive **1791819209589258755**, local receive **1791819209382ms**. Vendor capture-event delta **0.340982ms**; local is earlier than vendor capture **207.258755ms**.

Across stored 50 traces: vendor capture-event delta **0.192272–1.006369ms**; local minus vendor capture **-243.028391–96.814505ms**, negative **41/50**. These are clock-domain comparisons, not measured network latency. Clock skew/slew or differing clock synchronization is plausible; exact cause/offset is NOT VERIFIED. Read-only `w32tm /query /status` currently returns **service not started, 0x80070426**; this supports checking host clock health but does not establish service state/offset at the earlier run.

No clock service start, resync, registry/time changes or negative-latency clamping. Feed latency remains **NOT VERIFIED** until synchronized reference/offset and capture boundaries are measured under separate approval.

## 7. Regression and staging

| Check | Result |
|---|---|
| pnpm typecheck:all | PASS, exit0 |
| pnpm test:unit | PASS, exit0 |
| pnpm test:integration | PASS, exit0 |
| pnpm verify:p0 | **13/13 PASS**, exit0 |
| pnpm build:all | PASS, exit0 |
| pnpm test:e2e | **19/19 PASS**, exit0 |
| pnpm test:terminal:offline | PASS, exit0; numeric actual UI checks above |
| docker compose build | PASS, exit0 |
| compose up using offline-staging override | App/proxy rebuilt with provider none/key empty |
| staging_full_verification | 42/42 result recorded after rebuild; no volume reset |

SQLite memory used by fixture harness is distinct from staging persistent DB. Staging verification uses existing auth/backup/persistence tests, including retention pruning old backup snapshots; no active DB or volumes deleted/reset. No external live or historical call was authorized/executed.

## 8. Remaining genuine acceptance scope

**Normal Terminal with genuine vendor records remains NOT VERIFIED.** Offline numbers verify normal ChartSession messages and actual source App/components via Vite; packaged Caddy production UI has staging/regression coverage, not this fixture numeric trace or genuine propagation proof.

Future Operator approval must specify one bounded trades-only connection/cohort and how controlled vendor data enters normal fanout safely while disabling normal history/GEX/default extra subscriptions. Existing isolated runner still uses its isolated fast path; simply enabling ordinary backend credentials is not an approved substitute and may subscribe MBP-1/reconnect. Normal DTO contract/trace watermark and clock-domain observability need review for that future scope; this task does not add a new live mode.

MBP-10/DOM/Heatmap stay **BLOCKED BY VENDOR ENTITLEMENT**. No paid history, subscription purchase, licensing/billing/Stripe changes, trading orders, public deployment or remote push. Dừng chờ Operator cấp phép riêng cho Live Terminal E2E.
