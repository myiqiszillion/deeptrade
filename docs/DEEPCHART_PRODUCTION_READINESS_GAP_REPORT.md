# DeepChart — Trades E2E closure & production readiness gaps

Assessment: **13/10/2026 ICT**. Release inspected: `4f6f462cc3d4158a199985182880f41652e43c6d`.

**Trades acceptance CLOSED / PASS trong controlled scope đã được Operator chấp nhận. Production readiness còn các gate riêng bên dưới.** Không chạy lại Live, regression hoặc staging trong assessment này; chỉ đọc source, reports, kiểm tra hashes artifacts và tạo tài liệu này. Không sửa source, SQLite, artifacts hoặc các báo cáo lịch sử; không commit/push/deploy.

Ký hiệu bằng chứng: **Genuine** = records/evidence thực đã đo; **Offline** = fixtures/test reports đã PASS; **Code** = nhánh source được đọc, chưa phải kết quả operational acceptance. Một risk từ Code chưa có reproduction được ghi rõ, không mặc định là lỗi runtime đã tái hiện. Các offline tests bên dưới là **đề xuất, chưa thực thi trong task này**.

## 1. Acceptance matrix và closure

| Phase / hạng mục | Status được chấp nhận | Bằng chứng và phạm vi |
|---|---|---|
| Docker recovery / offline staging | PASS tại lần nghiệm thu trước | 42/42; WAL, users/rules persistence và backup integrity. Không chứng minh genuine trade ingestion/recovery |
| Metadata / ES symbology / calendar | PASS trong pre-flight tương ứng | ES.c.0 → 10252 → ESZ6; schema availability không phải entitlement |
| Standalone CME Trades, 12/10 | Genuine PASS | 24 received / 24 decoded; gateway auth, ACK1, DBN v3; chưa analytics/UI E2E ở phase này |
| Live MBP-10, 12/10 | ENTITLEMENT DENIED | Authentication thành công, ACK0, depth0, gateway `Not authorized for mbp-10 schema`, exit2 |
| Controlled isolated engines/observer offline | Offline PASS | 50-record cap; volume1275, BUY425/SELL442/UNKNOWN408, CVD-17; UNKNOWN giữ riêng |
| Isolated genuine Trades E2E, 12/10 | Genuine PASS | 50/50 accepted, volume260, BUY120/SELL140/UNKNOWN0, CVD-20; private observer digest MATCH |
| Normal Terminal fixture integration | Offline PASS | Normal ChartSession/App/components; trailing/final BAR/PROFILE; ES→NQ routing; cross-bar và UNKNOWN cases |
| Controlled normal Terminal offline | Offline PASS | Cap/sparse/deadline/watchdogs; volume1275, CVD-17, actual React numeric match |
| P0 incident containment, 13/10 | VERIFIED | Offline isolation17/17, P0 13/13, browser19/19; impact attribution vẫn UNKNOWN, Operator đã tiếp nhận |
| Regular Terminal genuine Trades, 13/10 | **Genuine PASS** | **50 received / 50 decoded / 50 accepted; V173, BUY90/SELL83/UNKNOWN0, CVD+7, POC7844.50; normal ChartSession/WS, Footprint/CVD/Profile/candles và React digest MATCH** |
| Genuine cross-bar BAR_CLOSE | NOT VERIFIED | Regular genuine cohort chỉ có một bar; không có BAR_CLOSE. Offline boundary test không thay thế genuine evidence |
| Ordinary backend / multi-symbol / reconnect / persistence / long-session | NOT VERIFIED với genuine operational evidence | Controlled context memory, single ES, không reconnect/history/GEX; không suy PASS cho ordinary runtime |
| Clock/latency, genuine UNKNOWN, full-session coverage | NOT VERIFIED / NOT OBSERVED | Local-vendor clock comparison chưa được xác minh; UNKNOWN0 trong genuine cohorts; coverage PARTIAL |
| Public redistribution / licensing | NOT VERIFIED | Live trades ACK không chứng minh quyền public display/distribution |

Luồng genuine đã nghiệm thu: Databento TCP → production decoder → controlled fresh MarketContext **normal fanout** → production engines → normal ChartSession JSON → WebSocket service → App → FootprintCanvas (footprint/candles), CVDPanel, ProfileOverlay. Không AcceptanceObserver DTO trên normal App. Đây là controlled bridge, không ordinary backend subscription-manager startup.

Regular session `7ecacd1f-9da9-4c21-b4ee-e81738f85351`: 22:22:05.436→22:22:13.847 ICT, **RECORD_CAP/CLOSED, 8.411 s, exit0**. Instrument **10252/ESZ6**. Price bins: 7844.25=27 (BUY11/SELL16), 7844.50=133 (BUY66/SELL67), 7844.75=13 (BUY13/SELL0). One-minute cohort OHLCV **7844.25/7844.75/7844.25/7844.50/173**. Profile EXACT/PARTIAL; EXACT chỉ là exact aggregation của observed input.

Normal messages: TICK50, BAR_UPDATE31, PROFILE_UPDATE22; final watermark50 cập nhật sau socket destroy và React numeric match. BAR_CLOSE không quan sát. ERROR3 là local scope/history rejection, không gateway errors. Gateway errors0; parser-error counter độc lập/raw DBN không lưu; không khẳng định toàn phiên nhận đủ. Live connection/subscription counts trong runner là guarded-path reporting, không independent packet capture.

### Evidence bảo toàn

| Evidence | Private/local path | SHA256 |
|---|---|---|
| Regular genuine, HEAD4f6f462 | `C:\Users\Administrator\.codex\private-acceptance\deepchart-1791904918460\evidence.json` | `0ddf908e228395a78ff418f83035406c472c2683f050c0415f722ed1e173ec0d` |
| Independent reconciliation của regular run | Cùng directory, `independent_reconciliation.json` | PASS; dữ liệu đối soát từ artifact genuine, không fixture |
| Isolated genuine, HEAD153f09f94e5d5e1798adede97105655f28781c15 | `C:\Users\Administrator\.codex\private-acceptance\deepchart-1791819202516\evidence.json` | `8f4c65a0b83162c67e65b2e29c9658f0d4d618f1c61f2e69f123fadba022499c` |
| Standalone trades, HEAD60ee55426063893c3b4f7afbc4a7d8bc055e2cfc | `C:\Users\Administrator\Documents\deepchart\scratch\live_trades_20261012.log` | `61b5b5fe0fbc614498190e3f2aeee70f9f1d55030141cb69f12ff8068ccd3fa4` |
| MBP-10 denial, cùng HEAD60ee554 | `C:\Users\Administrator\Documents\deepchart\scratch\live_mbp10_20261012.log` | `695e8d70daa4d28df16263591cf8d20133dab5a52bdcf349ade1aaba743edfdf` |
| P0 incident extract/impact manifest | `C:\Users\Administrator\.codex\private-acceptance\p0-incident-20261013\` | Excerpt `ccdab2aea409b33c99421e46ae22238d26dc0c1caf46223072ca159bd7204285`; manifests giữ nguyên |

Hai genuine artifact hashes và hai standalone log hashes đã kiểm tra lại read-only trong assessment này. Regular snapshot/browser digest: `825370e7adc085f809f7d1cd7b53869e473625902625e8b1591fa863eeffee40`. Artifacts không bị xóa; raw DBN không có để replay binary independently. Các historical reports mang NOT VERIFIED đúng thời điểm của chúng; regular controlled scope được phase 13/10 cập nhật thành PASS, không sửa ngược lịch sử.

### Những sự cố đã xử lý

- Docker/WSL engine từng blocked; Operator reboot và recovery/staging đã được nghiệm thu. Không coi recovery một lần là host disaster-recovery acceptance.
- Trailing BAR/PROFILE và primary symbol routing đã có reproduction, minimal fixes và offline/UI regression; không viết lại engines.
- P0 unintended connection: ordinary backend nạp env/start vendor ngoài scope. Technical containment VERIFIED; 154 local rows phù hợp window nhưng attribution UNKNOWN. Docker backup trade/bar hashes trước/sau giống nhau. Operator đã kiểm tra Portal và chấp nhận tác động còn UNKNOWN trước lượt 13/10; account cycle usage/balance được Operator báo $0.00 **không chứng minh chi phí riêng P0/lượt này bằng 0**. Không dùng incident làm authorized Live evidence.
- MBP-10 entitlement chưa giải quyết; không thử lại hoặc mua plan.

## 2. Gap P0 — subscription scope, correctness và durability

### P0-A — Ordinary startup, schema allowlist và side effects (item 1)

- **Actual evidence [Code/Genuine incident]:** [index.ts:1478](C:/Users/Administrator/Documents/deepchart/server/src/index.ts:1478) warm default ES trước browser; registry có thể chọn databento khi có key hoặc provider không hợp lệ. Ordinary client mặc định mbp-1 và gửi trades + mbp-1; startFeed ordinary còn gọi history/GEX. Controlled trades-only guard không bảo vệ ordinary runtime; incident P0 đã cho thấy hậu quả thực tế.
- **Expected:** Khởi động vendor chỉ bằng approved runtime profile rõ dataset/symbol/schema/connections/budget; key hoặc browser subscribe không tự mở rộng scope; history/GEX OFF khi chưa được cấp phép.
- **Risk:** Tự connect, phát sinh subscription/usage khác profile dù UI chỉ cần trades.
- **Minimal solution:** Validate fail-closed runtime profile trước warm/start; reject unknown provider/schema; truyền schema tường minh qua factory, trades-only phải là single trades subscription; gate history/GEX/quote-board/reload bằng cùng policy. Không thay parser/engines.
- **Offline acceptance:** Normal entrypoint với sentinel key/default/invalid env; mock factory/loopback TCP, actual command ledger; unapproved boot/browser request/reload = zero connections; approved trades profile = đúng schema, topology và budgets, external fetch0. Giữ offline guard; injection chỉ trong test, không public start endpoint.
- **Live riêng:** Có, sau offline PASS, để nghiệm thu **ordinary profile** được Operator cấp phạm vi riêng. Không dùng lệnh dev/start với key thay thế controlled approval.

### P0-B — ES/NQ đồng thời, identity và contract routing (item 2)

- **Actual evidence [Offline/Code]:** Primary ES→NQ late-ES test PASS; genuine chỉ một ES/10252/ESZ6. Manager tạo context/feed theo symbol và giữ default context warm. Theo default code, hai contexts có thể tạo hai TCP clients và mỗi client trades+mbp-1; đây là source-derived topology, chưa đo actual production wire counts. Normal MarketTrade không giữ instrument/publisher/contract identity đầy đủ; controlled trace có kiểm tra ID riêng.
- **Expected:** Identity, volume, bars và coverage độc lập ES/NQ; số connections/subscriptions khớp profile; thay main symbol không phá named secondary pane hoặc giữ feed ngoài budget.
- **Risk:** Cross-symbol/contract contamination; unintended default ES consumption; contract rollover trộn analytics cũ/mới.
- **Minimal solution:** Explicit feed ownership/approved symbol set; private identity/mapping ledger và contract-change boundary. Chỉ bổ sung DTO identity nếu cần cho correctness và có compatibility regression; không gộp/rewrite engines.
- **Offline acceptance:** Interleave ES/NQ, simultaneous init, rapid unsubscribe/switch, late callbacks, denied symbol, mapping/contract rollover; assert per-instrument bins/OHLCV/CVD và exact subscription counts.
- **Live riêng:** Có, explicit ES/NQ topology và tổng budget; quyền ES-only đã dùng không áp dụng NQ.

### P0-C — Sequence scope, stable dedup và persisted identity (item 4)

- **Actual evidence [Code]:** TCP trade normalized shape có sequence nhưng không id; MarketContext chỉ dedup khi `trade.id` tồn tại, nếu thiếu tạo ID mới. [marketDataStore.ts:675](C:/Users/Administrator/Documents/deepchart/server/src/storage/marketDataStore.ts:675) fallback `t_${ts}_${price}_${size}` không chứa sequence/side/instrument. Hai trades khác nhau cùng millisecond/price/size có thể cùng DB key nhưng được engines xử lý riêng. Ordinary sequence-gap path coi số sequence nhảy là missing count; genuine traces ghi scope NOT CAPTURED. Đây là code-supported risk, chưa có reproduction mới trong task này.
- **Expected:** Distinct trades giữ đủ; exact replay duplicate chỉ tính một lần; engine/store/restart dùng cùng stable identity. Không suy số mất trades từ venue sequence chưa biết scope.
- **Risk:** DB undercount/overwrite, replay double-count, restored CVD/Profile sai hoặc false gap labels.
- **Minimal solution:** Một normalized stable ID dựa trên identity/sequence/full event time đã xác minh, dùng xuyên ingest/store/replay; xác định sequence scope/reset/wrap trước contiguous-gap inference. Nếu scope unknown, ghi observation-gap/coverage UNKNOWN, không invent missing counts.
- **Offline acceptance:** Hai distinct same-ms/price/size trades khác sequence; exact duplicates; replay overlap; out-of-order/wrap/restart. Engine totals = persisted totals = restored totals; shared venue sequence jumps không tạo false missing-trade assertion.
- **Live riêng:** Không cần để tái hiện/sửa deterministic risk; cần vendor scope confirmation và riêng recovery/sequence validation sau đó.

### P0-D — SQLite durability dưới lỗi ghi, WAL/backup/recovery (item 5)

- **Actual evidence [Offline/Code]:** WAL/FULL/busy_timeout và staging backup integrity/persistence đã PASS; controlled genuine cohort dùng memory và bỏ persistence. `saveTrades` catch lỗi, log batch chưa persist, nhưng MarketContext tiếp tục analytics/fanout; chưa có accepted→durable reconciliation cho genuine cohort. P0 local rows không có run attribution đáng tin để thay thế acceptance.
- **Expected:** RPO/RTO được chốt; write failure/degraded durability thấy rõ; không tuyên bố restored coverage đầy đủ khi mất records; backup restore vào sandbox khớp numerics, không chỉ integrity_check.
- **Risk:** UI đúng tức thời nhưng mất records/analytics sau restart; backup hợp lệ nhưng thiếu dữ liệu cần recovery.
- **Minimal solution:** Write outcome/counters + checkpoint boundary, bounded pending/recovery hoặc explicit fail-closed policy theo RPO; atomic handling phù hợp. Verify snapshots và recovery manifest; không thay engines.
- **Offline acceptance:** Temp DB mock SQLITE_BUSY/ENOSPC/write failures, crash child process, WAL-aware snapshot/restore, migration fail-closed. So counts/IDs/side/volume/CVD/Profile/bars trước/sau; không chạm production volumes hoặc fill disk thật.
- **Live riêng:** Không cần cho fault injection; cần một approved genuine ingest→persistent DB→recovery reconciliation, không tiếp tục dùng memory run làm proof.

### P0-E — Provenance/coverage, UNKNOWN và history/contract contamination (item 11)

- **Actual evidence [Genuine/Offline/Code]:** Observed genuine totals EXACT/PARTIAL, UNKNOWN0; fixture UNKNOWN408 đã giữ riêng. Normal startup có history/store priming và session resets; acceptance bỏ các nhánh này. Genuine UNKNOWN case chưa quan sát; normal public DTO không có đầy đủ private cohort identity.
- **Expected:** EXACT không đồng nghĩa COMPLETE; UNKNOWN không suy thành BUY/SELL; CVD baseline/coverage nêu rõ; historical estimates, gaps, contract changes không bị gắn nhãn genuine complete.
- **Risk:** Analytics số đúng cho sample nhưng provenance/coverage hoặc session baseline sai khi vận hành bình thường.
- **Minimal solution:** Propagate source/coverage reasons và identity ở ingest/recovery boundaries; giữ UNKNOWN totals riêng và signed contribution0; gate cache/history theo approved scope. Giữ algorithms đã PASS.
- **Offline acceptance:** Mix exact trades/estimated history/unknown sides/gap/rollover/restart; independent bins/side totals và metadata assertions. Fixture không được mang source DATABENTO_LIVE.
- **Live riêng:** Normal coverage/rollover cần approval riêng; genuine UNKNOWN chỉ đánh dấu nếu tự nhiên xuất hiện trong approved run, không subscribe thêm để ép sample.

### P0-F — Feed truth: auth/ACK/freshness khác WS connectivity (item 7)

- **Actual evidence [Code/Genuine]:** Ordinary client emit LIVE khi auth success trước schema ACK; backend status chỉ LIVE/UNAVAILABLE. Client stale checker dùng lastMessageTs nên pongs có thể giữ connection healthy dù vendor stream treo. Controlled run final Header UNAVAILABLE đã PASS; ordinary stale behavior chưa được nghiệm thu.
- **Expected:** LIVE có nghĩa subscription accepted và data health phù hợp; phân biệt transport, ACK, vendor heartbeat/data age, quiet/closed market, UNAVAILABLE/STALE/recovery. Ping RTT không chứng minh vendor fresh.
- **Risk:** Hiển thị stale/unaccepted data như live, hoặc đánh dấu quiet market là mất feed.
- **Minimal solution:** Định nghĩa health-state contract và reason codes; dùng vendor/data timestamps phù hợp schema/calendar, không chỉ browser PONG. Chỉ đổi status propagation cần thiết.
- **Offline acceptance:** Auth-only, ACK denial, no-records, vendor stall trong khi WS PONG sống, market quiet/closed, stale recovery và stop→pending UI flush. Assert state transitions/reasons.
- **Live riêng:** Có cho operational health sau offline tests, với injection/budgets được Operator cho phép; không cố tạo outage trong phiên chưa được cấp phép.

### P0-G — Licensing / redistribution trước public deployment (item 12)

- **Actual evidence:** Trades gateway ACK và Operator Portal review xác minh phạm vi access đã dùng, không public redistribution. Không có exchange/license approval cho multi-user/public/derived-data distribution trong evidence. App role entitlement không thay exchange permission.
- **Expected:** Written scope cho personal/commercial, display/non-display, internal/external users, devices/team keys, lưu dữ liệu và derived analytics; app entitlement/audit phù hợp scope đó.
- **Risk:** Public market-data redistribution hoặc sử dụng ngoài agreement được chấp thuận.
- **Minimal solution:** Operator/vendor licensing review theo deployment/use-case thực; lưu approved scope/effective date và enforce access/config. Không mua/đổi license trong task này.
- **Offline acceptance:** Denied users/anonymous/export endpoints, per-symbol/schema policy, audit logs; metadata mocks không đóng license gate.
- **Live riêng:** Không cần stream để giải quyết paperwork; public gate cần written approvals và Operator deployment authorization.

Databento phân biệt licensing cho display/non-display/distribution tại [Portal documentation](https://databento.com/docs/portal); CME có các chính sách entitlement/non-display/distribution tại [Information Policies](https://www.cmegroup.com/market-data/license-data/information-policies.html). Vì vậy, kết luận “ACK không tự cấp quyền redistribution” ở đây là scope inference cần xác nhận cho account/use-case, không quyết định pháp lý thay Operator. Không dùng fee-list/marketing tiers để suy giá hoặc quyền L2 của account.

## 3. Gap P1 — long-running operation và recovery

### P1-A — Reconnect/resubscribe lifecycle (item 3)

- **Actual evidence [Code]:** Ordinary reconnect backoff tới30s, không finite retry budget như acceptance; generation/token guards có trong code. Controlled run chủ ý không reconnect, nên không chứng minh ordinary recovery, auth rotation hoặc entitlement denial behavior.
- **Expected/risk:** Một active generation, không double-subscribe/old callbacks, no reconnect sau stop; permanent denial không retry storm hoặc tự đổi schema.
- **Minimal solution:** Explicit recovery policy/max attempts/time/cost limits; classify retryable/permanent errors, exact resubscribe plan và cancellation. Không reset budgets theo mỗi reconnect.
- **Offline acceptance:** Fake clock/transport: half-open/reset, auth denial, metadata/ACK failure, retry then stop, stale generation, key/config change; assert attempts/schema ledger, timers/sockets=0 sau stop.
- **Live riêng:** Có, bounded reconnect/resubscribe trial được cấp **quyền retry tường minh**, không kế thừa no-retry acceptance đã dùng.

### P1-B — Restart/reload và data reconciliation (item 6)

- **Actual evidence [Code/Offline]:** closeServer/dispose paths và cached-store/history initialization có; staging users/rules survive restart. Normal cache priming giới hạn recent trades; chưa chứng minh full analytics rebuild từ genuine durable input hoặc image→Git identity sau reload.
- **Expected/risk:** Boot từ checkpoint đáng tin; không seed+replay+live double count; không mất last bar; reload không mở feed/profile ngoài scope; kết quả tương đương persisted cohort và coverage trung thực.
- **Minimal solution:** After P0 stable identity/durability: deterministic replay boundary, checkpoints và boot/reload decision; release/image/source/schema manifest + rollback plan.
- **Offline acceptance:** Cold/warm/crash restarts, overlapping seed/live input, multiple users, config reload; independently compare all analytics and subscriptions. Restore sandbox, không reset DB ứng dụng.
- **Live riêng:** Có cho genuine ingest/restart/recovery; reuse captured genuine normalized cohort offline trước, không gọi đó là new vendor session acceptance.

### P1-C — Normal ChartSession giữ kết nối lâu / slow consumer (item 8)

- **Actual evidence [Genuine/Offline/Code]:** Genuine session8.411s; browser19/19 và mount/unmount fixture test không phải session nhiều giờ. ChartSession có bufferedAmount limit16MiB; slow consumer close1008, trong khi client1008 cũng được coi như auth refusal.
- **Expected/risk:** Bounded memory/queues/timers; slow client không ảnh hưởng clients khác; close reason rõ và resync canonical state, không replay stale instrument data.
- **Minimal solution:** Align close reasons/codes, bounded fanout policy và resync watermark cần thiết; đo trước tối ưu; không thay engines.
- **Offline acceptance:** Long fixture/replay soak, disconnect/rejoin, multiple ES/NQ users, artificially slow socket, high burst rate; memory/timer/socket census và final digest per client.
- **Live riêng:** Có cho bounded operational soak với duration/record/cost budget riêng; không chạy vô hạn hoặc benchmark bằng paid feed mặc định.

### P1-D — Cross-bar BAR_CLOSE genuine (item 9)

- **Actual evidence:** Offline cross-minute BAR_CLOSE PASS; genuine accepted cohorts nằm trong single minute. OHLCV sample đúng không chứng minh genuine bar finalization across boundary.
- **Expected/risk:** Old bar closed đúng một lần; new bar/event times/volume/CVD chính xác; late correction đúng bar, final updates không mất.
- **Minimal solution:** Acceptance observation phù hợp boundary; chỉ sửa source nếu test chứng minh lỗi mới.
- **Offline acceptance:** Minute/session boundaries, late/out-of-order ticks, throttle/stop gần boundary; compare closed/current bars với event-time independent oracle.
- **Live riêng:** Có, một approved boundary-targeted sample. Có thể chọn thời điểm gần boundary nhưng không kéo dài cap/deadline; nếu không có records cross-bar thì NOT OBSERVED, không auto retry.

## 4. Gap P2 — telemetry và tối ưu dựa trên đo lường

### P2-A — Clock synchronization và latency telemetry (item 10)

- **Actual evidence:** W32Time từng Stopped; genuine local receive sớm hơn vendor timestamp ở các mẫu. App latency callback hiện lấy PONG RTT; không đo vendor feed latency. Không có verified clock offset/reference hoặc packet arrival timestamp.
- **Expected/risk:** Tách event/vendor/local clocks và WS RTT; dùng monotonic durations; không ép feed latency dương. Clock sai lớn ảnh hưởng operational time gates nên phải resolve trước time-sensitive assertions, dù không chặn volume arithmetic đã PASS.
- **Minimal solution:** Read-only status/offset measurements; Operator phê duyệt riêng mọi time-service remediation. Capture synchronization state/uncertainty, label RTT riêng, giữ raw times.
- **Offline acceptance:** Fake clock jumps/skew và timer deadlines; preserve timestamps, no clamping; calendar/boundary assumptions rõ.
- **Live riêng:** Chỉ khi muốn nghiệm thu latency telemetry sau clock verified; không cần Live để kiểm tra host synchronization.

### P2-B — Observability / UI performance

- **Actual evidence:** Private digest/final numeric proof có; raw DBN/full parser counters không lưu; successful-run connection counts không independent wire measurement. 50 records không đo capacity hoặc prolonged UI performance.
- **Expected/risk:** Actual attempt/subscription/ACK/record/error/drop/queue metrics; clean source/scope labels, bounded private artifacts, UI diagnostics phân biệt gateway/local rejection; không leak keys/JWT.
- **Minimal solution:** Instrument existing adapter/fanout, actual counters thay assumed counts; bounded error/cleanup manifests. Safety budget counters thuộc P0-A, dashboard/optimization để P2.
- **Offline acceptance:** Mock malformed/admin/market records, overflow, slow UI và fixture soak; metrics reconciliation/redaction. Không tối ưu hoặc rewrite engine khi chưa đo bottleneck.
- **Live riêng:** Không cần cho instrumentation/fault tests; actual operational telemetry đo trong lượt gap-specific đã được cấp phép, không mở thêm stream chỉ để có dashboard.

## 5. Depth entitlement — danh sách câu hỏi Support, CHƯA GỬI

Giữ nguyên **`GLBX.MDP3 mbp-10 — NOT AUTHORIZED`**, **`DOM / Liquidity Heatmap — BLOCKED`**. [MBP-10 schema documentation](https://databento.com/docs/schemas-and-data-formats/mbp-10) mô tả dataset/schema, không xác minh quyền account. Không suy gói Standard phải mua thêm từ gateway denial; **VENDOR CONFIRMATION REQUIRED**.

Operator có thể gửi ticket với masked account/team/key identifier, dataset/schema, date/time và exact denial, không API secret/JWT:

1. Account/team và key hiện tại được cấp GLBX.MDP3 live schemas nào? MBP-10 bị từ chối vì plan, L2 flag, license, subscriber classification hay provisioning?
2. Plan/license hiện active, effective dates và status nào? L1 trades/mbp-1 entitlement khác L2 mbp-10 ở đâu trong trường hợp account này?
3. Existing plan đã bao gồm L2 hay cần thay đổi quyền? Nếu cần thay đổi, xin liệt kê approval steps và điều khoản; chưa yêu cầu thực hiện thay đổi.
4. Quyền kế thừa theo team/member/key thế nào? Key cần reprovision/refresh hay quyền chưa propagated? Có cần reconnect/rotation sau grant không? Không tự rotate/retry trước trả lời.
5. Internal React display + backend Footprint/CVD/Profile thuộc display/non-display/derived use nào? Personal vs commercial/team use cần license, device/user counting và key sharing constraints gì?
6. Public authenticated multi-user Terminal, derived charts, exports/API redistribution cần approvals nào từ Databento/CME? Có giới hạn raw/derived data retention, backups hoặc historical redistribution không?
7. Nếu quyền/fees thay đổi: recurring/one-off/exchange/vendor/message charges, effective date và phạm vi sử dụng cụ thể là gì? Xin written quote/terms, không giả định mức phí hoặc auto-purchase.
8. Có vendor-assisted entitlement confirmation không mở stream, và cách đối chiếu session-specific usage P0 nếu còn dữ liệu? Không dùng account balance/usage0 để khẳng định session cost0.
9. Sau khi được grant, giới hạn connection/subscription/record rate và test scope nào hợp lệ để nghiệm thu depth? Retest phải được Operator phê duyệt riêng.

## 6. Thứ tự triển khai và các approvals còn cần

1. **Chốt target production profile và licensing scope:** ưu tiên private trades-only ES, depth OFF; ghi topology/budgets/ownership/history-GEX policy. Không tự mở provider để thử.
2. **P0-A/B/C trước:** subscription manifest và normalized identity/dedup/sequence semantics; deterministic tests normal manager, không dùng isolated fast path để claim ordinary startup PASS.
3. **P0-D/E/F:** durable/replay equality, UNKNOWN/coverage boundaries và feed-truth contract. Giữ bộ genuine arithmetic tests đã PASS như regression oracle, không viết lại engines.
4. **P1 offline:** reconnect/stop/reload/crash/slow-consumer/multi-symbol/soak tests, mock transport và temp DB; isolation suite tiếp tục fail-closed. Build/regression cho patch thực tế; staging chỉ rerun khi deployment/storage behavior bị ảnh hưởng.
5. **Gap-specific genuine trials sau approval mới:** cross-bar, ordinary trades profile + persistence, ES/NQ concurrency, recovery, bounded soak. Mỗi trial có date, symbols/schemas, total connections/attempts/subscriptions, total duration/records, retry allowance, approved costs và teardown. Không tự ghép các trials hoặc tái chạy phase đã PASS.
6. **Depth track độc lập:** Support confirmation → Operator quyết định quyền/fees → riêng depth acceptance nếu được cấp phép. Trades-only rollout không quảng bá DOM/Heatmap functioning.
7. **Deployment decision sau mọi gate:** immutable release/image/db-schema identity, tested rollback/recovery runbook và explicit Operator approval; public deployment cần licensing gate riêng.

Các bước 1–4 là kế hoạch có thể triển khai offline, **chưa được thực thi hoặc cấp phép sửa source bởi task này**. Cần Operator phê duyệt phạm vi implementation tối thiểu tiếp theo. Mọi stream mới, paid historical recovery, licensing/billing changes, host clock/service changes và deployment đều cần approvals tương ứng; không suy approval từ acceptance closure.

## 7. Điều kiện tuyên bố Production Ready cho scope đã chọn

- Nêu cụ thể dataset/symbol/schema/deployment/users và những tính năng bị disabled; không gộp trades và depth.
- P0 gates được đóng bằng reproduction/regression thực, không còn implicit vendor activation hoặc unapproved schema/history/GEX; budgets và license scope kiểm tra được.
- Stable identity/sequence policy; accepted/persisted/restored numerics bằng nhau trong phạm vi coverage/RPO đã chốt; WAL/backup/restore/crash recovery và rollback có bằng chứng.
- Ordinary multi-user/multi-symbol/lifecycle/health/recovery/soak đúng scope có offline tests và genuine operational evidence riêng khi cần; BAR_CLOSE genuine và time-sensitive assertions được đo hoặc rõ ràng loại khỏi scope claim.
- Clock/RTT/latency labels trung thực; provenance, UNKNOWN và incomplete coverage không bị che; cleanup/error/budget metrics đủ để vận hành.
- Vendor/Operator xác nhận licensing/redistribution và entitlement phù hợp; public access không bật trước written scope/deployment approval. MBP-10 giữ disabled nếu chưa grant.
- Release identity, runbooks, monitoring ownership, RPO/RTO và operating budgets đã được Operator chấp thuận.

**Quyết định hiện tại:** giữ Trades E2E acceptance PASS; chưa mở ordinary/public production. Hoàn tất tài liệu closure và focused plan này rồi dừng. Không có quyền Live mới được tạo bởi báo cáo.
