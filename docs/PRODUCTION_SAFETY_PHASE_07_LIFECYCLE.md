# Production Safety Phase 07 — P1 Operational Lifecycle & Recovery

**OFFLINE VERIFIED trong phạm vi các fixture/mock hữu hạn bên dưới. Production readiness vẫn NOT YET ACCEPTED. Không Databento Live mới.**

Hoàn tất: 14/10/2026 18:57 ICT.
Baseline: `8c999a78f581bc6ebdc18e094e02bfa009e94044`.
Final implementation HEAD: `d33b4bb00a9a00e4f47b272b7fd210cc417dce45`.
Local commit: `fix: consume runtime approvals durably and bound lifecycle recovery`. Không push.
Tracked tree sạch. Báo cáo này tạo sau code commit để ghi literal final SHA, giữ untracked cùng các báo cáo/evidence đã có.

## 1. Baseline và phạm vi

Baseline khớp Operator; Docker app healthy/proxy running. Giữ nguyên các báo cáo, private evidence, SQLite và backups. Hash evidence Phase 06 vẫn `96f3cde9458a26aa3d13e1a07e60e71d9e1e4f8b3a8544c78d9f74e39639120f`.

Chỉ sửa activation lease, cancellation, pending attachment và fail-closed recovery có bằng chứng. Không sửa DBN constants/decoder algorithms, engine math hay market-data SQL schema. Không bật reconnect, không mở rộng ES-only production capability sang NQ.

## 2. Reproduced failures và fixes

| Lỗi tái hiện offline | Actual trước sửa | Expected / sửa tối thiểu |
| --- | --- | --- |
| Reuse approval qua boot | Hai gate cùng approval đều attempt=1, command=1 | Atomic durable reservation; boot sau bị từ chối cùng approvalId |
| Readiness sau disconnect | Promise vẫn pending sau 10ms, chờ hết timeout | Bounded waiter set; disconnect reject và clear tất cả timers |
| Pending initialization shutdown | `disposeAll` vẫn pending khi connect không resolve | Track initializing contexts; cancellation giải phóng transition và disconnect |
| Late pane sau whole-session detach | Owner/subscriber vẫn 1 sau pending attach hoàn tất | Session epoch invalidates cả owners chưa đăng ký |
| Projection rebuild fault | Exception thoát khỏi addSubscriber, projection chưa fail-closed | Discard partial in-memory projection, BLOCKED; durable rows giữ nguyên |
| Oversized metadata | Advertised length >1MiB vẫn giữ stream chờ thêm | Reject length và ordinary input buffer >1MiB; close ngay |
| Expiry giữa buffered records | Nhận 2 thay vì 1 khi clock hết hạn sau record đầu | Check wall/monotonic deadline trước từng record |

Các reproduction logs có trong private manifest. Không suy rằng những lỗi này đã gây sự cố genuine trước đây.

Synchronous mock connect-factory failure cũng kiểm chứng attempt đã tiêu thụ và timers được clear; không retry. Phase 06 backend fixture từng đặt legacy record ở future minute boundary, có thể chưa lọt query beforeTime; test chuyển baseline về quá khứ 3 phút, không thay timestamp parser/production clock. Lần soak đầu thiếu chờ ES detach trong harness; sửa phép chờ cả ES/NQ, không bỏ assertion.

## 3. Durable approval lease / restart policy

- Default OFF: provider none, key alone, profile OFF/invalid/expired vẫn không mở vendor.
- Approved ordinary runtime cần `DATABENTO_APPROVAL_LEDGER`: absolute path tới **ledger riêng**, khác application SQLite. Runtime production yêu cầu file đã được Operator provision trước; thiếu file/path hoặc lỗi ledger => denied. Phase này chỉ provision các fixture DB trong OS temp, không tạo ledger production.
- Ledger dùng SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, journal DELETE; unique approvalId + boot owner. Reserve tại boot, trước transport. **Crash trước attempt cũng tiêu thụ approval**, cần approvalId mới, không tự reclaim.
- Attempts/subscription command được commit vào ledger trước TCP creation/socket.write. Budget **1 connection attempt / 1 trades subscription / 1 counted ACK** cho approval; boot lại cùng ID bị từ chối. Hai child processes tranh cùng approval: một reservation, một denied.
- Scope giữ GLBX.MDP3 / ES / ES.c.0 / trades; NQ/mbp-1/mbp-10/TBBO/history/GEX/quote-board/reconnect không được cấp quyền.
- Wall highwater bền vững từ chối observable clock rollback; deadline monotonic của boot không kéo dài khi UTC lùi. Buffered records kiểm tra expiry riêng từng record.
- REVOKED fixture ledger bị từ chối; active ordinary socket kiểm tra authorization trước incoming chunk và poll 1 giây, close trước BLOCKED. Poll phụ thuộc scheduling của event loop, không phải SLA real-time.
- Không public activation/revoke endpoint. Không retry/reconnect; không retry classification hoặc backoff mới được bật.

Ledger storage/permissions/backup-restore phải được Operator bảo vệ: không xóa hoặc rollback ledger để tái dùng approval. Anti-tamper/anti-rollback storage và production provisioning/revocation workflow chưa được nghiệm thu. Không cam kết chống sửa file bởi privileged Operator. Mất/corrupt ledger cần reconciliation, không tự rebuild hoặc khôi phục approval đã tiêu thụ.

## 4. Cancellation và cleanup

22 lifecycle cases PASS: child crash sau reservation/attempt/subscription, concurrent boots, missing ledger, clock rollback/expiry, revoked profile, delayed TCP connect cancellation, half-open cancellation, remote close, split DBN record, entitlement/auth errors, revocation trước subscription và khi idle, synchronous factory throw, oversized metadata, expiry giữa records, never-resolving initialization, late pane và backpressure overflow.

Mock socket teardown: destroyed=true, listeners=0, readiness waiters=0, approval/authorization/reconnect timers cleared. Một attempt, không reconnect. Production native TCP loopback test Phase 01 vẫn gửi đúng:

```text
schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1
```

Auth khác ACK; default warm context + nhiều authenticated browsers/reload dùng chung feed. Shutdown pending init không tái insert context; whole-session detach invalidates pending owner dù socket còn open. Invalid late callbacks bị generation/disposed guard loại.

Một feed implementation bên ngoài không tuân thủ disconnect/cancel contract hoặc tự mở tài nguyên sau cancellation chưa được bảo đảm bởi fixture này; native client hiện tạo socket đồng bộ và destroy qua disconnect.

## 5. Recovery/replay reconciliation

5 Phase 07 recovery cases PASS trên fixture SQLite riêng, thêm Phase 03 durability/Phase 04 provenance/Phase 06 contract regression:

- Child crash **sau commit, trước onTickRecord/fanout**: exit 84; một durable record qty2 SELL còn nguyên. Cold restore: restored=1, published counter=0, health INDETERMINATE, coverage PARTIAL. Overlap của record đó không commit/publish lại.
- Hai records mới: accepted=2, persisted=2, published fanout counter=2. DB tổng 3 unique records; independent oracle volume6, BUY1, SELL2, UNKNOWN3, CVD -1, POC100.50. Footprint/Profile/CVD khớp.
- Warm restart restored=3; duplicate deliveries không thêm persistence, volume vẫn6/CVD -1. Replay cùng cohort volume6.
- Injected rebuild failure => BLOCKED, projectionFailed=1, restored=0, partial tick/engine state bỏ; cả 3 durable rows vẫn còn. Không gắn trạng thái healthy/complete.
- Bounded restoration: 1000/1005 rows được load; health không LIVE, coverage PARTIAL, không tải gap history.

Phase 03 tiếp tục kiểm chứng SQL fault/unknown outcome, crash trước/sau commit, WAL backup/reopen; Phase 06 giữ contract boundary/legacy UNKNOWN fail-closed. Record IDs là DBN record equivalence, không phải global execution ID. Published counter là server fanout, không chứng minh mọi consumer đã nhận đủ; không có durable consumer outbox/watermark mới trong phase này.

## 6. Finite offline soak và independent UI oracle

Actual normal index → MarketContext → ChartSession → product WebSocket → App/FootprintCanvas/CVDPanel/ProfileOverlay, không AcceptanceObserver. Dữ liệu được inject qua guarded offline context fixture; đây không phải native vendor throughput test. Hai React browsers authenticated, một loopback WS consumer pause đọc, 10 pane attach/detach cycles, một browser reload/rejoin, monotonic stall/recovery simulation. Không vendor reconnect.

Giới hạn: 60s hard soak watchdog; 1000 additional records, 500/symbol; 1 worker; 2 browsers + 1 slow WS; server/test JS heap <768MiB, mỗi browser JS heap <512MiB; messages <20000; context tick cache <=5000. Wall soak đo được **5.262s**. Fixture event times trải nhiều minute bars, không dùng để đo feed latency.

| Oracle cuối (bao gồm 5 seed trades/symbol) | ES | NQ |
| --- | ---: | ---: |
| Received / accepted / persisted / published counter | 505/505/505/505 | 505/505/505/505 |
| Total volume | 1515 | 1516 |
| BUY / SELL / UNKNOWN volume | 507 / 505 / 503 | 506 / 503 / 507 |
| CVD | +2 | +3 |
| POC | 100.00 | 100.00 |
| Minute bars | 10 | 10 |

Independent candle oracle đối chiếu toàn bộ timestamp/OHLCV với actual React props. Price-bin totals/POC và BUY/SELL/UNKNOWN/CVD đối chiếu độc lập với props của regular components; source LOCAL_FIXTURE, coverage PARTIAL. Final stopped health UNAVAILABLE và final numeric updates khớp cả hai browsers.

## 7. Memory / queue / timer / socket observations

10 samples: max server+Vite+harness JS heap **199.84MiB**, max process RSS **386.49MiB**; browser JS heaps **14.75, 38.24MiB**. Đây là sample maxima, không phải continuous peak/leak proof hoặc day-long soak.

Trong samples: pending durable queue=0, liveBuffer=0, bounded history505/symbol. Peak authenticated backend WebSocket sessions từ log: **3**; final log0. Slow client là socket loopback thật bị pause/resume/terminate; không khẳng định nó nhận đầy đủ mọi record. Overflow >16MiB được test riêng bằng ChartSession assertion: close1008, không gọi send/queue thêm.

Soak bắt đầu sau phần final-stop của UI fixture trước đó; nó inject cohort tiếp vào test context và dùng health simulation, không có active vendor/feed timers. Context timers sampled0. Lifecycle tests riêng kiểm chứng active native-client mock timers/cleanup. Sau backend close: cả ES/NQ disposed=true, subscribers0, timers0, liveBuffer0, feed=null. Browser E2E runner teardown báo remaining processes0. Không suy ra mọi global timer/OS allocation hoặc long-lived genuine lifecycle đã được chứng minh không leak.

## 8. Mandatory regression và exit codes

| Check | Exit | Result |
| --- | ---: | --- |
| `build` | 0 | PASS |
| `test:integration` | 0 | PASS |
| `test:unit` | 0 | PASS |
| `test:isolation` | 0 | PASS |
| `verify:p0` | 0 | PASS |
| `test:lifecycle:offline` | 0 | PASS |
| `test:ordinary:offline` | 0 | PASS |
| `typecheck:all` | 0 | PASS |
| `test:multi:offline` | 0 | PASS |
| `test:durability:offline` | 0 | PASS |
| `test:health:offline` | 0 | PASS |
| `test:identity:offline` | 0 | PASS |
| `test:provenance:offline` | 0 | PASS |
| `test:multi:ui` | 0 | PASS |
| `controlled-trades-offline` | 0 | PASS |
| `test:soak:offline` | 0 | PASS |
| `test:terminal:offline` | 0 | PASS |
| `test:e2e` | 0 | PASS |
| `docker-build` | 0 | PASS |
| `staging` | 0 | PASS |
| `docker-up` | 0 | PASS |

Phase 01–06 giữ PASS; health20, multi-symbol16, P0 13/13, isolation17/17, Browser19/19, controlled offline50/digest MATCH, staging42/42. Unit/integration/build/typecheck đều PASS. Native/runtime source sửa xong trước mandatory vòng cuối. Sau đó chỉ chuẩn hóa CRLF/BOM ba test files; affected lifecycle22 + recovery5 chạy lại PASS, git whitespace check sạch. Không đổi code runtime sau verification.

## 9. Docker / SQLite / backup

Docker app healthy/proxy running trên loopback. Offline override provider=none, API key rỗng, START=0, profile rỗng. Runtime counters attempt/command/ACK=0; default ES health DISABLED, không vendor/auth/market observation. Hash của sáu compiled runtime modules trong app khớp local dist (manifest).

Application SQLite: integrity ok, FK violations0, trades66238, bars1236. Trade schema hash và full trade payload hash trước/sau không đổi:

- Schema: `e52d6592da8b25d78b72aa1192a048539f227548c7838746ad6a1900109af2f2`.
- Trade payload: `7d34e9b1128ba307b08c1836ec7df3643339a25eb22832bba75b78195509c613`.

Không claim byte-identical toàn SQLite file: staging auth/alert tests có các fixture writes được verifier yêu cầu; đối chiếu trên market counts/schema/trade rows như trên. Không reset DB hoặc xóa volumes. **16 backups baseline giữ nguyên name/size/hash; hiện18**, hai protected staging snapshots được thêm qua hai verification rounds. Wrapper chỉ tăng BACKUP_KEEP cho đúng backup command của staging, không sửa retention runtime hoặc prune file nào.

## 10. Files và private evidence

17 implementation/test/harness files trong local commit:

- `package.json`.
- `scripts/lifecycle_soak.mjs`.
- `scripts/verify_multi_terminal.mjs`.
- `server/src/databento/liveClient.ts`.
- `server/src/marketData/approvalLease.ts`.
- `server/src/marketData/marketContext.ts`.
- `server/src/marketData/ordinaryRuntime.ts`.
- `server/src/marketData/registry.ts`.
- `server/src/marketData/types.ts`.
- `server/src/session.ts`.
- `server/test/feedHealth.test.ts`.
- `server/test/fixtures/approvalCrash.ts`.
- `server/test/fixtures/recoveryCrash.ts`.
- `server/test/lifecycle.test.ts`.
- `server/test/multiSymbol.test.ts`.
- `server/test/ordinaryRuntime.test.ts`.
- `server/test/recovery.test.ts`.

Private directory: `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase07-1791979032346`.
Manifest: `evidence.json`; SHA256 `dd692491c2d6e1362ad6d0cae597eb5cfa8588dcffa302f0efcd77794fe331c4`.
Có source/compiled/log hashes, exits, before/after SQLite/backups, lifecycle/recovery cases và actual UI props/oracle. New evidence scan không phát hiện serialized JWT hoặc Databento key. Sentinel credentials chỉ dùng trong guarded mock; không đọc API key thật. Existing evidence không xóa.

## 11. NOT VERIFIED / còn giới hạn

- Ordinary backend genuine vendor lifecycle với lease mới, delayed/half-open behavior thực ở gateway, licensing/session entitlement và continuous contract-name proof.
- Native ES/NQ Live topology; production profile vẫn ES-only, NQ denied. Genuine cross-bar/long session/restart/reconciliation/feed latency chưa suy ra từ fixture hoặc controlled50 records cũ.
- Production ledger provisioning, permissions, durable storage loss/restore/tamper controls và vận hành revocation; không tự deploy/provision ledger trong nhiệm vụ này.
- Long-duration soak, sustained throughput, slow-reader complete delivery, reconnect/resubscribe policy và durable client delivery watermark/outbox. Reconnect vẫn OFF, không có automatic historical gap repair.
- Trusted vendor sequence scope / lossless session completeness / Windows-vendor clock synchronization vẫn cần bằng chứng riêng. Không tự sửa Windows clock hoặc ép latency dương.
- `GLBX.MDP3 mbp-10 — NOT AUTHORIZED`; DOM/Liquidity Heatmap BLOCKED BY VENDOR ENTITLEMENT. Không thử lại.
- Genuine Regular Terminal E2E đã được Operator chấp nhận ở revision cũ, không rerun; không dùng nó để đánh dấu các thay đổi Phase 07 là genuine-verified. P0 session-specific vendor usage/cost attribution vẫn UNKNOWN như hồ sơ đã chấp nhận, không claim zero từ local DB.

## 12. Điều kiện xin ordinary backend Live acceptance riêng

Có cơ sở offline để **đề nghị Operator xem xét** một lượt riêng; chưa tự động GO/Live hoặc Production Ready. Trước thực thi cần:

1. Operator duyệt revision, ngày ICT, scope ES/GLBX.MDP3/trades, unique approvalId, expiry và ngân sách/time/record cap cụ thể; không tái dùng authorization ngày13/10.
2. Operator provision persistent separate ledger và quy trình revoke/reconcile/backup không rollback spent approvals; review fail-closed nếu ledger lỗi. Không cung cấp public activation endpoint.
3. Có supervisor/instrumentation cho ordinary-path acceptance với hard stream deadline và record cap theo phạm vi duyệt, disconnect trước final snapshot; một connection/subscription, no retry. Phase này không bổ sung một ordinary Live runner mới hoặc tự phát lệnh.
4. Re-check staging none/key empty/start OFF, approved release, phiên/entitlement và private trace không credentials. Đo auth/actual ACK, genuine records, durability/analytics, normal WS/React final reconciliation và cleanup; fail thì dừng, không retry.

Dừng sau Phase 07 offline. Không Phase 08, Databento Live, paid historical, depth retry, billing/licensing/subscription changes, Stripe Live, public deployment, trading orders, push hoặc Windows clock/service changes.
