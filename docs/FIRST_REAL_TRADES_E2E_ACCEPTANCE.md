# First Real Trades E2E Acceptance — 12/10/2026

**REAL TRADES E2E PASS — phạm vi isolated MarketContext → production engines → private WebSocket → React Acceptance Observer.** Regular React Terminal không được nghiệm thu bởi lượt này. MBP-10/DOM/Heatmap vẫn **BLOCKED BY VENDOR ENTITLEMENT**.

## Execution và pre-flight

- Operator phê duyệt đúng một lượt, không retry. Pre-flight: **22:33:05 ICT / 15:33:05 UTC, 12/10/2026**.
- Git HEAD trước/sau: `153f09f94e5d5e1798adede97105655f28781c15`. Không sửa source, commit hoặc push trong lượt này.
- Docker app running/healthy; Caddy proxy running trước và sau. Ordinary staging container: `FUTURES_PROVIDER=none`, `DATABENTO_API_KEY=` rỗng. Staging 42/42 và SQLite đã PASS trước; không gọi lại suite có mutation trong lượt Live này.
- Snapshot TCP host và `/proc/net/tcp{,6}` trong app: không thấy kết nối port 13000 trước/sau. Đây là quan sát tại hai thời điểm, không phải packet capture toàn host.
- Built worker/context, built React assets và Chromium executable có sẵn. Runner tạo được private directory, browser observer đã attach trước vendor start; POST start và history routes bị 404 trong runner.
- Worker thực hiện calendar gate và metadata/symbology read-only trước socket. Calendar dự kiến mở; genuine records sau ACK chứng minh có hoạt động giao dịch trong mẫu. Resolve lại **ES.c.0 → instrument 10252 → ESZ6**; worker chỉ chấp nhận mapping có effective range chứa ngày query. Range payload gốc không được xuất vào artifact này.
- Exact command, thực thi **một lần**:

```powershell
node scripts/verify_trades_e2e.mjs --live --approval-date 2026-10-12
```

- Scope: GLBX.MDP3 / ES.c.0 / trades only, ≤30s hoặc 50 market records. Không mock transport trong live mode; source artifact **DATABENTO_LIVE**.

## Gateway, records và lifecycle

| Measurement | Actual evidence |
|---|---|
| Authentication | AUTHENTICATED tại 15:33:28.658 UTC / 22:33:28.658 ICT; production TCP CRAM path |
| DBN metadata | `metadataReceived=true`; DBN version/metadata byte length không được export trong artifact này |
| Subscription ACK | **1**, ACKNOWLEDGED tại 15:33:29.279 UTC; stage từ decoded SystemMsg subscription ACK |
| Market records processed tại decoder boundary | **50**; không khẳng định mọi trade thị trường đã được nhận đầy đủ |
| Records decoded / accepted | **50 / 50**, mỗi trace có numeric trade fields và ACCEPTED outcome |
| Rejected / deduplicated | **0 / 0** |
| Dataset/schema | GLBX.MDP3 / trades; accepted branch nhận rtype 0x00. Raw rtype header/histogram không lưu riêng |
| Instrument identity | Cả 50 traces instrument **10252**, contract **ESZ6**, cùng session |
| Gateway errors | **0** |
| Parser errors | Không có framing failure trong completed CLOSED session; parser-error counter độc lập **NOT CAPTURED** |
| Reason / final status | **RECORD_CAP / CLOSED**; final feedStatus **UNAVAILABLE** |
| Streaming lifecycle | CONNECTING 15:33:27.586 → CLOSED 15:33:36.196 UTC: **8.610 giây** |
| Final message elapsed | **8613 ms**, gồm thời gian tới lúc tạo final evidence sau đóng socket; không phải 30s streaming |
| Exit code | **0**, supervisor hoàn tất |

Session ID: `9d0d5ad3-aa5d-4941-97d1-aaf169637dee`; trace IDs `sessionId:1` tới `sessionId:50`. Lifecycle đầy đủ: IDLE → CONNECTING → AUTHENTICATED → ACKNOWLEDGED → RECEIVING → TERMINATING → CLOSED. Không có watchdog termination hoặc retry.

### Timestamps và side

| Field | First trace | Last trace |
|---|---|---|
| Event ns | 1791819209588917773 | 1791819216178264457 |
| Vendor receive ns | 1791819209589258755 | 1791819216178525741 |
| Local receive UTC | 15:33:29.382 | 15:33:36.195 |
| Price / size | 7856.5 / 10 | 7856 / 4 |
| Raw / normalized side | B / BUY | B / BUY |
| Sequence | 5230494 | 5232267 |

Event window: **15:33:29.588917773–15:33:36.178264457 UTC**, tương ứng ICT +7 giờ. Venue sequence scope **NOT CAPTURED**; không suy số trades bị mất từ sequence nhảy.

Local receipt của trace đầu sớm hơn event timestamp vendor khoảng **207 ms**. Giữ nguyên giá trị, không sửa để làm đẹp log. Clock synchronization và cross-clock latency **NOT VERIFIED**; không dùng hai clock này để tuyên bố latency hoặc coverage đầy đủ. Arithmetic và event-order reconciliation vẫn đạt theo recorded vendor event ordering.

## MarketContext và production analytics

Fresh isolated cohort không dùng SQLite/history/cached bars, GEX hoặc synthetic seed. Cả 50 records accepted bởi MarketContext; total volume **260**.

| Side | Trade count | Volume | CVD contribution |
|---|---:|---:|---:|
| BUY, raw B | 24 | 120 | +120 |
| SELL, raw A | 26 | 140 | -140 |
| UNKNOWN | 0 | 0 | 0 |
| Total | 50 | 260 | **-20** |

Volume-weighted side coverage: **100% trong cohort này**, không ngoại suy ra cả phiên. UNKNOWN handling đã offline verified; genuine UNKNOWN case **NOT OBSERVED** trong lượt này.

Footprint tổng volume **260**, BUY **120**, SELL **140**, UNKNOWN **0**; CVD cuối **-20**, khớp tổng signed contributions trace. Per-trace cumulative footprint/profile/CVD values được lưu, không chỉ final aggregate.

| Price bin | Volume | BUY | SELL | UNKNOWN |
|---|---:|---:|---:|---:|
| 7856.00 | 54 | 19 | 35 | 0 |
| 7856.25 | 36 | 12 | 24 | 0 |
| 7856.50 | 49 | 28 | 21 | 0 |
| 7856.75 | 115 | 55 | 60 | 0 |
| 7857.00 | 6 | 6 | 0 | 0 |
| Total | **260** | **120** | **140** | **0** |

Volume Profile total **260**, same bins/side volumes; provenance **EXACT** đối với observed trades, coverage **PARTIAL**, `isEstimated=false`. POC 7856.75; VAH 7856.75; VAL 7856.25. EXACT không nghĩa full-session COMPLETE.

Candle bucket 1m **15:33:00 UTC / 22:33:00 ICT**, open **7856.5**, high **7857**, low **7856**, close **7856**, volume **260**. `isClosed=false`; đây chỉ là observation window, không phải full-minute/full-session candle. Runner independent assertions đối chiếu open/close theo event order, highs/lows, volumes, price bins và UNKNOWN với accepted traces đều đạt.

## WebSocket → React Observer

- **51 publications SENT**: 50 acceptance snapshots và 1 final snapshot, cùng session/instrument; final watermark **50**.
- **37 browser rendered receipts**. React batching gộp các intermediate messages; không khẳng định 51 renders riêng. Final receipt covers watermark 50 và cùng cohort.
- Final backend digest = recomputed React digest:

`9b2af508bdca4ed0e6307cec25d7c6590d5409818259907525a35481dd4a6ad6`

- Final React numeric receipt: volume **260**, buy **120**, sell **140**, unknown **0**, CVD **-20**. Snapshot SHA-256, totals và signed contributions đều khớp.
- MarketContext uses production FootprintEngine/ProfileEngine; acceptance controller phát snapshot thật của chúng qua WS. Đây là dedicated private observer transport, không chứng minh normal production ChartSession/BAR_UPDATE/PROFILE_UPDATE/regular Terminal canvas path.
- Observer không có start/subscribe/reconnect command. INIT_STATE/ping/pong không dùng để báo E2E PASS. Không chụp screenshot vì numeric evidence đủ cho scope này.

## Cleanup và private artifacts

- Normal finish tại record 50; client disconnect destroys TCP và invalidates generation **trước** final snapshot theo path đã offline tested. Final state UNAVAILABLE, process exit 0; no port-13000 connection thấy sau execution.
- Worker finally đóng browser/BrowserServer, observer WS/server và dispose context; supervisor exited. Packet-level TCP FIN/RST trace và successful-run worker/browser PID inventory **NOT CAPTURED**; cleanup dựa trên terminal lifecycle, completed process và scoped TCP checks.
- Watchdog độc lập không kích hoạt; browser cleanup sau socket-close không làm tăng streaming duration. Không có stream mới để flush.
- Private artifact: `C:\Users\Administrator\.codex\private-acceptance\deepchart-1791819202516\evidence.json`, **68,275 bytes**, dưới 1 MiB. Không raw DBN capture; chỉ allowlisted structured trace/publications/receipts. Giữ nguyên bằng chứng, không auto-delete.
- SHA-256: `8f4c65a0b83162c67e65b2e29c9658f0d4d618f1c61f2e69f123fadba022499c`.

## Final decision và giới hạn

**REAL TRADES E2E PASS**, chỉ với genuine trades → isolated MarketContext → production Footprint/CVD/Profile/candle engines → private WS → React Acceptance Observer. Full regular React Terminal và ordinary ChartSession broadcast path: **NOT VERIFIED**. Full market/session coverage, exchange sequence scope, raw DBN replay audit, clock/latency correctness và genuine UNKNOWN sample: **NOT VERIFIED / NOT CAPTURED** như ghi trên.

MBP-10/DOM/Heatmap: **BLOCKED BY VENDOR ENTITLEMENT**. Không thử lại depth hoặc subscribe schema khác. Không paid historical, mua dịch vụ, sửa plan/billing/licensing/source, Stripe Live, trading orders, public deployment hoặc push. Một lượt được phê duyệt đã dùng hết; dừng, không tự chạy lại.
