# Production Safety Phase 03 — Durable Ingestion & Recovery

Ngày đo: 14/10/2026 ICT. **P0-D OFFLINE VERIFIED trong finite fixture scope. Production Ready: CHƯA ĐẠT.**

## 1. Release và phạm vi

- Baseline: `767a067c599a3ef255d1569c06eccd7ebdd88da6`.
- Final implementation Git HEAD: `ca31082edc43b85cb40521d887854296e9c85a6f`; local commit, không push.
- Báo cáo này được tạo sau commit để ghi đúng SHA cuối; là deliverable untracked, như report Phase 02. Tracked working tree sạch.
- Phase 01 activation gate và Phase 02 identity được giữ nguyên. Genuine Regular Terminal E2E trước đó vẫn là PASS trong controlled scope; không chạy lại hoặc suy ra durability từ phiên đó.
- Chỉ fixtures/mock TCP loopback và SQLite memory/temp. Không Live, paid historical, GEX/options vendor requests, billing/licensing, public deployment, Stripe Live hoặc thay host clock.

Files changed:

- `package.json`
- `server/src/chart/chartService.ts`
- `server/src/index.ts`
- `server/src/marketData/marketContext.ts`
- `server/src/storage/marketDataStore.ts`
- `server/test/durability.test.ts`
- `server/test/fixtures/durabilityCrash.ts`
- `server/test/ordinaryRuntime.test.ts`

## 2. Lỗi được chứng minh và sửa tối thiểu

Trước patch, `saveTrades` INSERT từng row ngoài transaction, dùng INSERT OR IGNORE và nuốt lỗi. Một batch lỗi giữa chừng có thể giữ prefix; MarketContext tiếp tục analytics/WebSocket và cache ID khiến retry bị bỏ qua dù chưa lưu. Patch dùng kết quả transaction tường minh, chỉ cache ID/cập nhật session/analytics sau commit.

`saveBar` cũng nuốt lỗi. Patch trả boolean cho ordinary MarketContext: lỗi materialized bar cache dừng ingest, giữ authoritative committed trades, ghi projectionFailed và yêu cầu rebuild. Không viết lại Footprint/CVD/Profile, không đổi DBN constants, identity encoding, schema SQL hoặc re-key legacy.

Historical chart caller hiện kiểm tra commit result trước khi ghi checkpoint hoặc dùng fetched ticks. Không chạy historical trong nhiệm vụ này. `saveTrade`/`saveTradesBatch` wrappers throw rõ nếu transaction fail; ordinary callback sử dụng result, không để exception SQLite kill backend.

Test ordinary Phase 01 có race giữa client socket.write counter và receipt tại mock TCP server; sửa đúng một điều kiện chờ cả counter và command thực nhận, không thay policy hay command.

## 3. Durability state contract

| State | Ý nghĩa thực tế |
| --- | --- |
| RECEIVED | Record đến handleTrade sau decoder; counter này không phải tổng packet DBN/network records |
| ACCEPTED | Valid và chưa trùng ID/payload trong cache/DB; tăng trước SQL |
| PERSIST_PENDING | Transaction synchronous đang thực thi; ordinary một trade; batch tối đa 10.000 |
| PERSISTED | COMMIT trả thành công; inserted IDs/count chỉ tăng sau commit |
| PERSIST_FAILED | BEGIN/validation/INSERT/COMMIT lỗi; return FAILED với NOT_STARTED / ROLLED_BACK / UNKNOWN |
| PUBLISHED | Hoàn thành normal fan-out path hoặc bounded acceptance path; không phải browser delivery ACK |
| RESTORED | Committed rows được load vào normal context cache/analytics; bounded window, không full-session completeness |

Chính sách **durable-before-publish, fail-closed**. Application pending/retry queue capacity = 0, không automatic retry/reconnect. Batch >10.000 bị từ chối trước BEGIN. SQLite busy_timeout=5.000ms là lock wait hữu hạn hiện có, không vendor retry. Không hứa exactly-once, không suy mất/đủ toàn feed từ counters.

Ordinary lỗi ghi/read identity → sticky FAILED, feed UNAVAILABLE, đóng feed, không cập nhật cache/analytics/TICK cho record chưa commit. startFeed và feed status callbacks không được ghi đè block; cần Operator reconcile/reopen. Projection failure giữ committed trade nhưng cohort không được gọi complete. UNKNOWN rollback outcome → store BLOCKED, không nhận write tiếp trên instance đó.

`getDurability` / `getTradeDurability` là counters theo lifetime instance. `/healthz` và `/api/v1/status` expose context counters/reason. COMMITTED_OBSERVATION không có nghĩa full durable session; acceptance mode trả NOT_DURABLE_ACCEPTANCE vì vẫn chủ ý bypass SQL. lastCommittedId trong memory reset sau restart, không giả checkpoint restored. Test đọc rowid cuối theo provider/symbol để đối soát durable insertion watermark; đây không phải venue sequence watermark hay persisted consumer offset.

## 4. Atomic transaction và recovery policy

BEGIN IMMEDIATE → validate + indexed identity check → plain INSERT (require changes=1) → COMMIT. Exact duplicates được skip rõ, conflicting payload fail và rollback cả batch. Atomicity gồm tất cả mới/duplicate decisions của batch; không lưu prefix khi INSERT/constraint/COMMIT fail. BEGIN failure không insert. ROLLBACK failure không được khẳng định rows chưa commit, trả UNKNOWN và khóa store.

WAL / synchronous FULL giữ nguyên. Committed trades là source cho replay/rebuild; bars là materialized cache, không cùng transaction trade. Lỗi cache được báo FAILED riêng, không rollback trade đã commit hoặc phát healthy state. Không tự reconcile production bars/SQLite trong nhiệm vụ này.

Normal restoration hiện vẫn giới hạn 1.000 rows gần đây/đủ mới, history cache 5.000, footprint retention hiện có. Test 7 rows chứng minh phạm vi này; không chứng minh recovery dài hạn/toàn phiên hoặc cache vượt window. Không có durable publication outbox, browser receipt ledger hoặc restart-consumer checkpoint. Crash sau commit trước publish cần reload/rebuild từ committed rows; không hứa giao lại TICK đúng một lần.

## 5. Fault injection — 18 cases, exit 0

| 1. SQLITE_LOCKED | PASS | entire batch rolled back; zero committed; zero pending |
| 2. SQLITE_FULL | PASS | entire batch rolled back; zero committed; zero pending |
| 3. SQLITE_IOERR | PASS | entire batch rolled back; zero committed; zero pending |
| 4. SQLITE_BUSY actual writer lock | PASS | fail without insert or application retry |
| 5. batch partial failure / actual constraint rollback | PASS | prefix rolled back, zero rows |
| 6. COMMIT failure | PASS | rollback all, never count committed |
| 7. rollback failure / uncertain outcome | PASS | UNKNOWN, store blocked, no success claim or retry |
| 8. capacity exceeded | PASS | reject oversized batch; no application pending/retry queue |
| 9. ordinary commit-before-publication / out-of-order | PASS | 7 durable records before 7 TICK messages; exact independent numbers |
| 10. ordinary failure containment | PASS | no analytic/TICK mutation; disconnect once; sticky FAILED |
| 11. derived bar persistence failure | PASS | trade retained; FAILED projection, stop ingestion, require rebuild; no healthy complete claim |
| 12. crash before commit | PASS | no row survives uncommitted crash |
| 13. crash after commit | PASS | committed row survives no publication; restart overlap not duplicated |
| 14. disk restart / duplicate overlap | PASS | exact IDs and independent analytics, zero committed-record loss |
| 15. WAL online backup / restore | PASS | snapshot exact at boundary; later commit explicitly outside snapshot |
| 16. WAL checkpoint / restart | PASS | all 8 committed rows survive checkpoint |
| 17. isolated corruption detection | PASS | fail integrity/read; never report restored complete |
| 18. normal context restoration | PASS | restore bounded window; no duplicate overlap publication |

LOCKED/FULL/IOERR dùng test-local statement/exec overrides trên DB tạm; không ép disk đầy hoặc tạo lỗi thiết bị thật. BUSY dùng writer lock SQLite thật, timeout 0 trong fixture. Partial batch failure dùng SQLite trigger RAISE(ABORT) thật. Crash child chỉ mở temp DB rồi process.exit tại boundary: before COMMIT exit 71, after COMMIT exit 72; không kill backend production. Test wrapper exit 0 nghĩa observed failure đúng expected, không nghĩa lỗi SQLite là successful ingest.

Mỗi case trong private JSON có expected, observed/counters và exitCode. Corruption chỉ ghi hỏng header bản sao; source snapshot giữ nguyên. No transaction migrations trên staging.

## 6. Independent numeric reconciliation

Fixture parse DBN v3 synthetic instrument 10252 → ordinary MarketContext → SQL → normal ChartSession fan-out. Provenance **OFFLINE FIXTURE ONLY**, không genuine vendor. 9 deliveries gồm 7 unique IDs và 2 exact duplicates. Có BUY/SELL/UNKNOWN, same-ms/price/size distinct IDs, legacy ID, late event qua ba minute bars, restart overlap.

| Metric | Accepted | Committed / restored / independent oracle |
| --- | --- | --- |
| Unique records | 7 | 7 / 7 / 7 |
| Volume | 19 | 19 |
| BUY volume | 9 | 9 |
| SELL volume | 4 | 4 |
| UNKNOWN volume | 6 | 6, signed contribution 0 |
| Final CVD | +5 | +5 |
| Profile bins | 5000:6; 5000.25:9; 5000.50:4 | MATCH |
| POC | 5000.25 | MATCH |
| Last inserted committed ID | legacy-original | MATCH; DB rowid insertion order |

BUY records 3, SELL 2, UNKNOWN 2. Independent oracle groups chronological ticks and computes sides, profile, bins, OHLCV without using production engine results. Assert sets of IDs, count, full Footprint bins BUY/SELL/UNKNOWN, CVD, profile levels/POC và candles; live ordinary in-memory engines và restored/replay engines đều khớp. Normal mock socket asserts each TICK already exists in committed DB. Normal context restoration emits INIT_STATE; overlap không thêm volume/TICK.

| Bar epoch ms | O / H / L / C | Volume |
| --- | --- | --- |
| 1791951480000 | 5000 / 5000.25 / 5000 / 5000.25 | 7 |
| 1791951540000 | 5000.5 / 5000.5 / 5000.25 / 5000.25 | 5 |
| 1791951600000 | 5000.25 / 5000.25 / 5000 / 5000 | 7 |

Trade-write failure test: first trade commit/publish rồi next write fail; received 3, accepted 2, persisted 1, failed 1, published 1, pending 0, disconnected 1; subsequent record denied, UI snapshot UNAVAILABLE. Derived-bar failure: persisted 2, published 1, projectionFailed 1, FAILED; hai rows được giữ để rebuild. Không đánh dấu cohort failure là DURABLE COMPLETE.

Legacy `legacy-original` giữ nguyên ID, không fabricated event ns/vendor metadata. Phase 02 regression cũng kiểm tra original ns, same-ms distinctions, exact overlap, namespace, sequence reset/wrap/jump không tạo fake missing counts.

## 7. Crash, WAL backup/restore, RPO/RTO

- Crash trước commit: pending fixture record không survive (count 0); không gọi PERSISTED.
- Crash sau commit trước publish: count 1 / volume 7 survive; overlap redelivery không insert lần hai. Publication không durable ACK.
- Finite cohort disk reopen và analytics reconciliation: RPO committed records = 0; measured reopen/reconciliation/overlap workflow RTO **4.152ms**.
- WAL-aware VACUUM INTO snapshot khi writer transaction còn uncommitted: snapshot 7 rows / volume 19; writer sau đó commit row thứ 8 / volume 99. Snapshot không chứa row sau boundary: **1 row / volume 99 ngoài snapshot**, không giấu loss nếu restore snapshot cũ thay current DB.
- Restore snapshot vào file DB mới + independent analytics: 7 rows/volume19, boundary RPO 0; RTO **7.562ms**. Đây là fixture restore/load/rebuild time, không crash detection/startup/browser time hay production SLA.
- WAL checkpoint rồi reopen live fixture: 8 rows / volume118. Corrupt copy bị phát hiện; không gọi RESTORED complete chỉ bằng integrity.
- Bản staging chỉ backup/read-only integrity; không restore snapshot lên actual DB, không prune backup.

## 8. Regression và deployment verification

| Check | Result |
| --- | --- |
| Typecheck server + client | PASS |
| Unit | PASS |
| Integration | PASS |
| P0 | 13/13 PASS |
| Offline isolation | 17/17 PASS |
| Phase 01 ordinary safety | PASS; mock connection/command/ACK 1/1/1; history/HTTP 0 |
| Phase 02 identity/dedup | PASS |
| Phase 03 durability/faults | 18/18 PASS |
| Regular Terminal offline | PASS: normal TICK/BAR_UPDATE/BAR_CLOSE/PROFILE_UPDATE → actual components |
| Controlled Trades offline regular-terminal | PASS: 50 market records, React final digest MATCH; NOT Live/durable proof |
| Browser E2E | 19/19 PASS; teardown processes 0 |
| Build server + client | PASS |
| Docker offline rebuild + staging | 42/42 PASS |
| Git diff whitespace | PASS |

Docker app healthy, proxy running loopback 80/443. Offline override provider none / key empty / runtimeStart0 / profile empty; ordinary connectionAttempts/subscriptionCommands/ACK = 0/0/0. No history/GEX/quote/reconnect activation.

Before/after actual SQLite: **66.238 trades / 1.236 bars**, integrity ok, foreign key violations 0; trades schema SHA256 `e52d6592da8b25d78b72aa1192a048539f227548c7838746ad6a1900109af2f2` unchanged. 9 existing backups giữ nguyên SHA256, total 10 sau verifier. Verifier tạo test users/rules/restart/online backup theo existing staging checks; không reset volume/DB.

42-check verifier chạy cùng no-prune preload: chỉ thay backup command bằng BACKUP_KEEP=100000, verify exactly one protected command. Không đổi runtime env hoặc retention policy trên container lâu dài. Actual source/dist ↔ container hashes:

- marketDataStore.js: `a6976e9ca83c2e21dc457e50c8a99c40da7409c5c0d145cfe52a16e1b9e60b95`.
- marketContext.js: `a924c1633908eb9b79f0d46c22b52f001d94cf52b18de525e108a4605380078a`.

## 9. Evidence và remaining gates

Private manifest: `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase03-1791951732712\evidence.json`

SHA256: `b537ca88251f56432830f48d1fd41d67e678f48570da86b01f57163450cf5eaa`.

Manifest chứa full case results, log paths/hashes, backup hashes, final SHA, numeric oracle. Archived temp DBs/crash/WAL/snapshot/corrupt-copy evidence tại `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase03-1791951732712\fixture-databases`; không xóa evidence cũ. Không copy API key/JWT vào manifest/fixture artifacts; raw test logs chỉ được hash. Controlled offline private evidence: `C:/Users/Administrator/.codex/private-acceptance/deepchart-1791951571756`; regular terminal: `C:/Users/Administrator/.codex/private-acceptance/regular-terminal-offline-1791951523418`.

Remaining UNKNOWN / NOT VERIFIED:

- Genuine ordinary ingest → durable real DB → restart/recovery chưa đo; cần approval Live riêng, không suy từ controlled genuine 50 records hoặc fixtures.
- Hardware power-loss / real IO fault / disk-full resilience, production RPO/RTO, long throughput và event-loop stall dưới busy wait chưa nghiệm thu.
- Long-window full-session recovery, persisted coverage/source/contract filtering, cache/materialized bar reconciliation ngoài finite fixture, durable consumer watermark/outbox chưa nghiệm thu. Không tự mở history để recovery.
- Global execution identity/anonymous metadata và vendor sequence continuity vẫn UNKNOWN theo Phase 02.
- P0 incident session-specific usage/cost attribution vẫn UNKNOWN đã được Operator chấp nhận; không kết luận cost bằng 0 từ local evidence.
- `GLBX.MDP3 mbp-10 — NOT AUTHORIZED`; DOM/Liquidity Heatmap BLOCKED BY VENDOR ENTITLEMENT. Không thử hoặc mua entitlement.

**Ready để xin triển khai OFFLINE P0-E (provenance/coverage/UNKNOWN/history contamination) và P0-F (auth/ACK/freshness/feed truth). Hai gate chưa VERIFIED.** P0-D prerequisite finite fixture đã PASS, không tự triển khai bước tiếp theo; không có Live authorization mới. Dừng chờ Operator.
