# Production Safety Phase 04 — Provenance, Coverage & UNKNOWN Integrity

Ngày nghiệm thu offline: 14/10/2026 ICT. **P0-E OFFLINE VERIFIED trong finite fixture scope. Production Ready: CHƯA ĐẠT.** Không triển khai P0-F/P1/P2, không chạy Databento Live/historical có phí/MBP-10/trading orders; không đổi licensing, billing, clock, Stripe Live hoặc public deployment. Không push.

## 1. Release identity và bảo toàn

- Baseline: `ca31082edc43b85cb40521d887854296e9c85a6f`.
- Final implementation Git HEAD: `eabb19918ee3bcd4cbf57f4ea3d74cf9e5a459ac` — local commit sau mandatory checks PASS.
- Tracked tree sạch sau commit. Báo cáo này là deliverable local untracked, viết sau commit để ghi full final SHA trực tiếp. Các reports untracked cũ được giữ nguyên.
- Phase 01–03 reports và private manifests đã kiểm tra; Phase 03 manifest SHA256 vẫn `b537ca88251f56432830f48d1fd41d67e678f48570da86b01f57163450cf5eaa`. Không sửa/xóa evidence cũ.
- Genuine Trades Regular Terminal E2E trước đó vẫn là acceptance riêng đã PASS. Phase 04 không dùng fixture để mở rộng genuine acceptance.

Files changed:

- `client/src/App.tsx`
- `client/src/components/Profile/ProfileOverlay.tsx`
- `client/src/components/Status/TerminalStatusBar.tsx`
- `client/src/services/websocket.ts`
- `client/src/types/index.ts`
- `package.json`
- `scripts/verify_regular_terminal.mjs`
- `server/src/databento/client.ts`
- `server/src/databento/liveClient.ts`
- `server/src/marketData/dataEvidence.ts`
- `server/src/marketData/databentoHistoryProvider.ts`
- `server/src/marketData/marketContext.ts`
- `server/src/marketData/types.ts`
- `server/src/profileEngine.ts`
- `server/src/replaySession.ts`
- `server/src/session.ts`
- `server/src/storage/marketDataStore.ts`
- `server/src/types.ts`
- `server/test/provenance.test.ts`
- `server/test/tradeIdentity.test.ts`
- `server/test/unit/profileEngine.test.ts`

## 2. Reproduced issues và phạm vi sửa

**Đã tái hiện trước patch:** hai DBN-format fixtures có instrument IDs 10252/10253, cùng logical symbol ES, được ordinary MarketContext cộng chung thành 2 records / volume4. Profile legacy numeric provenance EXACT, coverage UNKNOWN, không có source/contract evidence trong aggregate. Log `scratch/phase04_before.log` giữ nguyên. Sau patch, record thứ hai khác contract bị chặn trước SQL/analytics: accepted1 / volume2, UNAVAILABLE, Operator reconciliation required.

Baseline unit test cũng chứng minh `setCoverage('COMPLETE')` có thể đặt COMPLETE trên engine trống mà không có proof. Không tìm thấy production caller dùng COMPLETE setter trong source hiện tại; không khẳng định đã xảy ra trên genuine feed. Setter nay downgrade yêu cầu chưa có proof xuống PARTIAL; metadata observation trống vẫn UNKNOWN.

**Rủi ro nhận diện từ source:** provider string hoặc DBN format/ID không chứng minh origin; source/coverage không xuyên suốt SQLite/replay/DTO; UNKNOWN side có trong Profile internal levels nhưng chưa có trường riêng trên DTO. Bổ sung contract metadata, source envelope trong cột hiện có, DTO indicators và UNKNOWN volume output. Không thay DBN constants, native price/side/ID/ns decoding hoặc công thức Footprint/CVD/Profile/Candles.

**Regression do patch đã sửa:** regular acceptance snapshot thiếu metadata mới trên DTO bars, gây deep-equality/digest mismatch. Snapshot nay khớp DTO shape; giữ nguyên digest check, không bỏ fields/numeric assertions để ép PASS. Profile metadata được ghi nhận trước BAR fan-out để observation boundary có latest committed tick. Trade commit vẫn trước analytics/publication.

## 3. Source / quality / coverage contract

`DataEvidence` là metadata riêng với legacy `Profile.provenance`. Legacy EXACT nói phép cộng raw values; không có nghĩa vendor source hay full session. UI dùng DataEvidence source/quality/coverage và reason để tránh diễn giải sai.

| Dimension | Contract |
| --- | --- |
| Source | VENDOR_LIVE / VENDOR_HISTORICAL chỉ từ producer transport đã biết; injected TCP/WS/fetch và offline guard → LOCAL_FIXTURE. PERSISTED_VENDOR chỉ giữ lineage vendor đã có trong envelope; provider/ID/format không tạo proof. LEGACY/UNKNOWN khi origin thiếu; MIXED khi nhiều origin |
| Quality | EXACT cho observations có provenance tường minh; ESTIMATED khi có synthetic OHLCV distribution, không nâng lại exact khi thêm ticks; UNKNOWN khi có input provenance thiếu. Numeric values vẫn giữ nguyên để reconcile |
| Coverage | Observation/cohort/window chỉ PARTIAL; trống UNKNOWN. Không tự COMPLETE từ record cap, commit success, exact aggregation, ACK hoặc full fixture delivery |
| Side | BUY/SELL/UNKNOWN giữ riêng. UNKNOWN signed contribution = 0; không suy aggressor từ estimated bars hoặc missing side |
| Identity | Header/ID tuple giữ dataset/publisher/instrument khi thực sự có metadata. Contract key là `dataset/publisher/instrument`, **không phải resolved contract name**; không tự tạo ESZ6 hoặc ns cho legacy |
| Boundary | fromTs/toTs là event-ms bounds quan sát, không chứng minh interval liên tục. CVD baseline OBSERVED_START là engine observation scope, không full-session baseline hoặc latency/freshness proof |

Record evidence trên Tick khác annotation trên aggregate DTO: bars/Profile/TPO mang **observation-cohort scope**, không phải vendor-produced bar hay attestation riêng từng bar. Coverage và source cho candle history thiếu metadata vẫn UNKNOWN/PARTIAL. UI thay label “Vendor bars” bằng “OHLCV bars · source unverified”; không gọi estimates/fixtures là genuine trades.

`originalSource` không được tự nâng UNKNOWN thành vendor; contradictory originalSource bị bỏ qua. Metadata envelope không phải chữ ký cryptographic; trust boundary là internal producer + committed storage. Không expose endpoint để client tự kích hoạt vendor hoặc đặt provenance.

## 4. Prevent contamination / restoration / replay

- Một context bind một known contract key sau successful trade commit. Key khác trong cùng context bị fail-closed trước persist/cache/analytics. Không tự rollover sang contract mới, mở thêm feed hoặc resubscribe.
- History/replay/restoration chọn contract cohort theo newest event có trusted identity; known keys khác bị loại khỏi view và ghi PARTIAL boundary. Không xóa rows trong DB. Legacy thiếu contract giữ dưới UNKNOWN/LEGACY, quality UNKNOWN và PARTIAL; **không chứng minh legacy thuộc contract đang bind**.
- Ticks overlap được stable-ID dedup trước seed/replay. Window provenance không nâng coverage. Venue sequence jumps/reset/wrap không biến thành fake missing counts.
- Profile reset tạo observation ledger mới; historical estimate không để lại EXACT/COMPLETE claims trong cohort mới. Boundaries/reasons gồm SQLite/restart/missing contract/estimate/failure, lưu bounded sets.
- ChartSession dùng evidence provider theo symbol và live/replay mode; remove/dispose giải phóng provider. Replay messages có symbol tường minh. Existing frontend symbol routing và generation guards giữ nguyên.
- Failure persistence/projection đặt PARTIAL reason và UNAVAILABLE; không biến fail-closed thành healthy provenance. Empty/expired cache không được seed hoặc gọi vendor history để bù.

**SQLite compatibility:** không thêm schema/migration. New explicit record evidence dùng `trade-source-v1:` JSON envelope trong `source_provider` TEXT hiện có; storage adapters decode trả lại sourceProvider string và evidence. Plain old provider strings vẫn đọc được, classify LEGACY vì origin chưa captured. Exact duplicate không rewrite row hoặc enrich legacy metadata. Các reader raw SQL ngoài adapter sẽ thấy envelope cho rows mới; không khẳng định compatibility với external raw-SQL consumers chưa được kiểm thử.

## 5. Offline acceptance cases

| 1 | DBN format / origin / controlled cohort coverage | PASS / 0 |
| 2 | historical estimate + raw fixtures | PASS / 0 |
| 3 | UNKNOWN / event-time / sequence jumps / independent analytics | PASS / 0 |
| 4 | actual ChartSession DTO serialization | PASS / 0 |
| 5 | history/live overlap | PASS / 0 |
| 6 | distinct contract rejection | PASS / 0 |
| 7 | SQLite source / legacy compatibility | PASS / 0 |
| 8 | bounded normal context restoration | PASS / 0 |
| 9 | contract-filtered history/replay window | PASS / 0 |
| 10 | replay source / overlap / isolated cohort | PASS / 0 |
| 11 | cohort reset / empty observation | PASS / 0 |
| 12 | failed persistence / malformed cached metadata | PASS / 0 |
| 13 | expired/empty cache | PASS / 0 |

Browser symbol switch/stale ES callbacks và actual React indicators được kiểm tra riêng trong Regular Terminal offline suite. Các tests dùng DB memory/temp, synthetic fixture bytes/fake dependencies; guard violations 0. Không dùng real API key hoặc vendor requests. Case corruption là source-envelope parsing, không sửa staging data.

Independent oracle cho cohort: **5 unique records / volume15; BUY3 / SELL3 / UNKNOWN9; CVD0; POC5000**. Price bins: 5000→7 (BUY3, UNKNOWN4), 5000.25→3 (SELL3), 5000.50→5 (UNKNOWN5). Unknown sum trên Profile levels/total =9, Footprint UNKNOWN bins=9; signed unknown contribution0.

Candles theo event-time, gồm late event và ba minute buckets:

| Bucket tương đối | O/H/L/C | Volume | Final CVD |
| --- | --- | --- | --- |
| base | 5000 / 5000 / 5000 / 5000 | 3 | +3 |
| base+60s | 5000.25 / 5000.50 / 5000.25 / 5000.50 | 8 | 0 |
| base+120s | 5000 / 5000 / 5000 / 5000 | 4 | 0 |

Native-format fixture + historical estimate20 cho Profile total35, MIXED / ESTIMATED / PARTIAL; không coi estimated buy/sell distribution là genuine aggressor evidence. Legacy missing metadata giữ nguyên ID/row, không thêm vendorIdentity/eventTsNs. Disk reopen count5 / volume15; replay count5 / volume15, delivery REPLAY, UNKNOWN quality do legacy, coverage PARTIAL. Contract window test loại4 other-contract rows, giữ1 newer-contract và1 unverified legacy; không gọi đây là exact contract completeness.

## 6. Actual React Terminal

Regular fixture suite qua normal TICK/BAR_UPDATE/BAR_CLOSE/PROFILE_UPDATE → App → FootprintCanvas, candle drawing branch, CVDPanel, ProfileOverlay. Independent numeric asserts giữ nguyên: observed volume14, BUY7/SELL3/UNKNOWN4, CVD+4, POC100; final quiet-stop volume15, UNKNOWN5, CVD+4. React props và DOM text xác nhận `LOCAL_FIXTURE · EXACT · PARTIAL`, “CVD observed baseline” và UNKNOWN side volume riêng.

Switch ES→NQ: NQ volume6, CVD−6; late ES callback không trộn volume/metadata vào NQ. Screenshot chỉ bổ trợ; pass dựa trên numeric props/assertions và actual DTOs/DOM.

Controlled Trades offline regular-terminal: 50 records, final React digest MATCH, RECORD_CAP/CLOSED, exit0. Label OFFLINE ONLY — NOT LIVE PASS. Isolated acceptance bypass SQL vẫn giữ NOT_DURABLE_ACCEPTANCE; không dùng run này để suy durable/genuine/full-session acceptance.

## 7. Regression exit codes và staging

| Check | Result / exit |
| --- | --- |
| Typecheck server/client | PASS / 0 |
| Unit / Integration | PASS / 0 |
| Ordinary Phase 01 | PASS / 0; mock attempts/command/ACK1/1/1; external history/HTTP0 |
| Identity Phase 02 | PASS / 0; 8/8 persisted/restored, ns/ID/dedup/legacy giữ nguyên |
| Durability Phase 03 | 18 cases PASS / 0 |
| Provenance Phase 04 | 13 cases PASS / 0 |
| P0 / Offline isolation | 13/13 và17/17 PASS / 0 |
| Regular Terminal / Controlled offline | PASS / 0 |
| Browser E2E final | 19/19 PASS / 0; teardown0 remaining processes |
| Production build / Docker build | PASS / 0 |
| Staging final | 42/42 PASS / 0 |

Một Browser E2E run ban đầu fail TC13 vì page trắng, layout button không xuất hiện. Targeted TC13 và full suite chạy lại PASS không sửa code; **nguyên nhân blank page NOT VERIFIED**, không gán là lỗi provenance hoặc tuyên bố đã fix. Initial failed log retained. Backend envelope guard bổ sung cuối không thay UI code; metadata/identity/durability/build/regular/control/staging tests đã chạy lại.

Docker app healthy, proxy running trên loopback; provider none, API key empty, runtimeStart0, profile empty; vendor counters attempts/commands/ACK0/0/0. No history/GEX/quote/reconnect activation. Rebuild/up không down -v/reset volume.

Before/after actual SQLite: **66.238 trades / 1.236 bars**, integrity ok, FK violations0. Full trade row payload SHA256 `7d34e9b1128ba307b08c1836ec7df3643339a25eb22832bba75b78195509c613` giữ nguyên; schema SHA256 `e52d6592da8b25d78b72aa1192a048539f227548c7838746ad6a1900109af2f2` giữ nguyên. **10 baseline backups giữ nguyên từng hash; total12** sau protected verification snapshots. Staging verifier chỉ được override backup command với BACKUP_KEEP=100000, không đổi runtime retention env; không destructive restore.

Compiled local/container hashes match:

- `marketData/dataEvidence.js 87f8ef50ef5fa0f0f6ebafd206f5f716acfdaab19c3c157a9463bbb8855c7f7b`
- `marketData/marketContext.js 50474ef789eaad2cff20daf4bf7c9eb6a0caf10db94d35ca2974a117ce59f75f`
- `profileEngine.js c09b7ed55d85769287d0ad26ece001002637bb823a99d845afc647ff44203a7f`
- `storage/marketDataStore.js 21a7d16802c8b04ddf98898ce4ee3d8592ace7f53ab1ec27bbb671674c8906c7`

## 8. Private evidence và outstanding gates

Manifest: `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase04-1791955799505\evidence.json`

SHA256: `d5c20eca7e356991d30b7e4a41d029a9848c3e4c0750439a16efd4eef3b24e6a`.

Chứa oracle,13 case results, actual source metadata, test exit codes/log hashes, full-row/schema before/after hashes, backup hashes và final HEAD. Fixture SQLite/evidence copy được bảo toàn ở cùng private directory; không xóa private artifacts cũ. Manifest không chứa API key/JWT; raw logs chỉ được hash. Actual React evidence: `C:/Users/Administrator/.codex/private-acceptance/regular-terminal-offline-1791955439960`; controlled: `C:/Users/Administrator/.codex/private-acceptance/deepchart-1791955446632`.

UNKNOWN / NOT VERIFIED:

- New metadata propagation với genuine vendor/durable production data chưa chạy; không mở stream hoặc upgrade old acceptance. PERSISTED_VENDOR genuine branch chưa được nghiệm thu bằng new genuine cohort.
- Completeness toàn phiên/prefix gaps, venue sequence continuity, resolved contract-name proof, anonymous/legacy execution identity vẫn không thể suy từ observed window.
- Historical/cache OHLCV không đủ tạo genuine per-price/aggressor microstructure; cache bar metadata sau persistence vẫn thiếu khi schema chưa lưu lineage, được UNKNOWN.
- Long-running calendar rollover/CVD lifetime scope, multiple symbols live, reconnect/resubscribe và contract rollover operational policy chưa nghiệm thu. Strict key change hiện dừng, không auto recovery.
- Feed freshness, auth vs ACK, quiet/closed/stale market, clocks/latency telemetry và transport connectivity truth thuộc P0-F; không suy từ provenance hoặc 50-record run.
- Financial P0 session-specific attribution vẫn UNKNOWN đã được Operator chấp nhận; không kết luận cost0 từ local rows/logs. MBP-10 NOT AUTHORIZED; DOM/Heatmap BLOCKED BY VENDOR ENTITLEMENT.

**READY để xin Operator phê duyệt P0-F OFFLINE Feed Truth & Freshness**, không có nghĩa P0-F VERIFIED hay Production Ready. Dừng; không tự triển khai bước tiếp theo hoặc chạy Live.
