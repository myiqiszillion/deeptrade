# Kế hoạch nghiệm thu genuine Trades E2E — 12/10/2026

HEAD được kiểm tra trước đây: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`. Chỉ inspect source và lập kế hoạch; không chạy app/browser, live hoặc historical trong tác vụ này. Repo không có `.codegraph/`, nên sử dụng đọc source trực tiếp. Bằng chứng runtime hiện có: Trades 24/24 PASS, Docker staging 42/42 PASS, SQLite ok. Đây chưa phải PASS E2E.

## 1. Luồng thực tế và readiness

| Bước | Source / behavior đã đọc |
|---|---|
| Khởi tạo | `server/src/index.ts:324` tạo MarketContextManager với Databento history provider; `:1463` tự khởi tạo DEFAULT_SYMBOL; `:1609` tự subscribe default khi WS session kết nối |
| Registry | `server/src/marketData/registry.ts` xuất factory createMarketDataFeed (không phải class MarketDataRegistry). Chọn provider theo env, kiểm tra cfg.symbols/key, tạo DatabentoLiveClient không truyền schema/session limits |
| Vendor | `server/src/databento/liveClient.ts:359` mặc định mbp-1. TCP `:600–608`: tbbo một subscription; mọi schema khác gửi trades và mbp-1/mbp-10. Kể cả chọn trades hiện cũng gửi trades + mbp-1. Decoder → handlers.onTrade tại `:673` |
| MarketContext | `server/src/marketData/marketContext.ts:395` validate, dedup theo id, theo dõi sequence, đổi MarketTrade thành Tick, persist, cập nhật engine hoặc buffer trong backfill |
| Analytics | footprintEngines.processTick tạo OHLC/levels/delta/CVD; ProfileEngine.processTick tạo volume bins; VWAP/Tape chạy cùng tick. CVD nằm trong FootprintEngine, không có engine CVD riêng trong luồng này |
| WS | MarketContext gửi TICK, BAR_UPDATE/BAR_CLOSE, PROFILE_UPDATE; ChartSession.send serialize JSON qua socket đã auth (`server/src/session.ts`). BAR_UPDATE throttle khoảng 100ms, PROFILE_UPDATE khoảng 500ms |
| React | `client/src/services/websocket.ts:263–295` dispatch theo msg.symbol; `client/src/App.tsx:697–732` cập nhật tick refs, bars, currentCVD/profile; FootprintCanvas/CVDPanel/ProfileOverlay render từ state |

Sẵn sàng về cấu trúc: production trade decoder, validation/fanout, UNKNOWN bucket trong footprint/profile, CVD theo signed volume, message routing và UI consumers. Chưa đo vận hành bằng vendor trades qua toàn chuỗi. Không dùng unit tests hay INIT_STATE làm bằng chứng PASS.

## 2. Những điều kiện hiện tại không đáp ứng phiên kiểm soát

- LiveClient scheduleReconnect (`:708`) tự reconnect; disconnect (`:721`) có intentionallyClosed, generation guard, clear reconnectTimer, destroy TCP. Chưa có lifetime hard timeout/market-record budget. `waitForLive` timeout là readiness wait, không thay thế session budget.
- LiveClient TCP đặt LIVE và resolve connect ngay auth success (`:579`), trước ACK/record. ACK handler hiện không công bố telemetry; gateway ErrorMsg gọi onError nhưng không mặc định terminate ngay.
- Registry không chỉ định trades-only. Index auto default context/subscription, các symbol khác có thể tạo context. Manager giữ default context ngay cả khi hết subscriber; cleanup grace không bảo đảm dừng theo cap. Browser reconnect/resubscribe cũng có thể khởi động lại feed.
- MarketContext.startFeed tự refresh GEX/timer và backfillHistory; reconnect gap cũng backfill. addSubscriber/changeTimeframe prime store trades/bars và ensureHistoryBars; index HISTORY_REQUEST có thể gọi history provider. Đây là các đường cần gate, không chỉ thay historyProvider thành no-op.
- Footprint/Profile có thể seed từ dữ liệu store/history trước lượt thử. Profile hỗ trợ ESTIMATED khi đã seed OHLCV; không được trộn vào cohort nghiệm thu. processTick không tự đặt COMPLETE nhưng cũng chưa đặt PARTIAL với cửa sổ 30s tại context.
- Backend status public hiện LIVE/UNAVAILABLE; không có đầy đủ vendor DISCONNECTED/STALE lifecycle. Frontend có STALE theo local lastTradeTs nhưng WS vẫn open sau vendor disconnect; intentional disconnect không tự chứng minh status được phát đúng.
- Sequence gap logic trong context coi seq > previous+1 là missing trades. Venue sequence cần xác nhận scope (channel/market, không mặc định liên tục theo ES-trades); không suy số trades mất từ sequence nhảy. Trace ghi sequence nguyên trạng và gap reason có căn cứ.

**Cần sửa code tối thiểu trước chạy E2E có giới hạn; chưa sửa trong nhiệm vụ này.**

## 3. Thông tin còn thiếu theo từng lớp

| Field | Hiện tại / thiếu |
|---|---|
| Dataset/schema | LiveClient biết; MarketTrade/Tick không có field tương ứng, không truyền xuyên analytics/WS |
| instrument_id/raw symbol | Parsed wrapper có instrumentId, nhưng callback chỉ truyền parsed.trade. MarketTrade/Tick không giữ instrument hoặc mapping outright |
| Event time | Trade ts → Tick.timestamp giữ milliseconds; mất precision ns gốc |
| Receive time | MarketTrade/Tick có receiveTs tùy chọn; TCP trades parser hiện không đặt vendor ts_recv hoặc local receive time |
| Price/size | Giữ parsed numeric values và normalize price theo tickSize; cần trace raw price và bin price để đối soát |
| Raw/normalized side | B/A/other → BUY/SELL/UNKNOWN → buy/sell/unknown. raw side bị bỏ. aggressorProvenance hiện EXCHANGE_NATIVE kể cả UNKNOWN; cần công bố unknown availability rõ ràng |
| Sequence | Giữ sequenceId qua Tick (string); không giữ scope/channel và không có trace liên kết publication |
| ID | TCP trade không có vendor id; context sinh gen_symbol_timestamp_seq. Cần session-scoped trace id, không dùng venue sequence đơn lẻ làm unique key |
| Provenance/coverage | Tick sourceProvider còn; Profile EXACT/ESTIMATED mô tả phương pháp, không chỉ đích danh dataset. Thiếu cohort/window/source xuyên bar/CVD/WS và side coverage |
| Accept/send/render | Chưa có ledger validate/dedup/buffer/engine accepted, WS send callback/batch trace range, browser receive/render ACK |

## 4. Thiết kế controlled acceptance mode

Một cấu hình opt-in immutable được Operator duyệt: GLBX.MDP3, ES.c.0 (UI alias ES), trades only, 30s, 50 market records, no retry/reconnect/history/GEX/fallback. Fail closed nếu config sai hoặc có context/vendor connection khác. Không khởi chạy thông qua browser subscribe thông thường.

Session controller sở hữu một connection và state IDLE → CONNECTING → AUTHENTICATED → ACKNOWLEDGED → RECEIVING → TERMINATING → CLOSED; FAILED là terminal. Start từ admin/operator local runner không public endpoint. Index/Registry phải chặn startup mặc định, symbol switch, reconnect/resubscribe, options/GEX vendor calls và mọi historical route trong mode này. Browser chỉ attach context đã chuẩn bị, không sở hữu start quyền.

- Timer 30s bắt đầu **trước DNS/TCP connect**, không phụ thuộc receipt/ACK. Bộ đếm market records ngay sau framing, trước validation/dedup; invalid market record vẫn tiêu budget. Chỉ parse/route tối đa 50, đánh dấu stopped trước xử lý remainder chunk.
- Terminal transition idempotent: stop dispatch, clear timer, gọi disconnect không reconnect, invalidate generation, abort history nếu có, cấm tự start lại từ WS. Gateway error/no ACK/no valid records → FAIL, không retry. External runner watchdog phòng backend/event loop treo, kết thúc tiến trình riêng nếu vượt grace cleanup; không kéo dài streaming budget.
- Process riêng và localhost/Caddy staging được chỉ định; không cho chạy song song với backend khác có key/auto-feed. Phải kiểm kê và được Operator duyệt biện pháp suspend context hiện có trước run; không tự đổi billing hay prod.
- Fresh context/engines, empty cohort, không prime store, không history preload. Dữ liệu persistence chỉ ghi nguồn/session thật hoặc vùng staging được duyệt; không xóa SQLite hiện có. Khóa timeframe 1m và symbol ES cho browser acceptance, không split workspace/multi-symbol.

## 5. Trace có giới hạn

Mỗi market record: sessionId, ordinal/traceId, dataset, schema, rtype, instrument_id, requestedSymbol, resolvedSymbol, mapping effective range, sequence (+scope nếu có), eventTsNs, vendorReceiveTsNs, localReceiveTs, price/size, rawSide, normalizedSide, sourceProvider/aggressorProvenance, validation/dedup result, analytics acceptance/rejection reason, footprint bar/bin, signed CVD contribution, WS publication status/messageId, browser receipt/render status.

Không nhầm vendor receive timestamp với local socket receipt. Nếu field không có ghi NOT CAPTURED. Mỗi ledger bước có monotonic time và final count. WS aggregates gắn cohort/watermark/digest thay vì kỳ vọng một bar update trên mỗi trade. Không thêm raw side vào public feed ngoài private acceptance trace nếu không cần.

Log tối đa 50 market entries + tối đa 100 lifecycle/publication summaries, hard byte budget 1 MiB; local private directory, không API key/JWT/auth frame hoặc session token. Đề xuất retention 24 giờ, sau đó xóa riêng artifact trace khi Operator đồng ý; bản acceptance report không chứa credentials được giữ. Trace overrun/drop → FAIL observability, đóng session. Raw DBN chỉ capture nếu Operator duyệt quyền lưu và cùng byte/retention cap; không bắt buộc để test nếu ledger đủ, nhưng báo giới hạn audit.

## 6. Quy tắc analytics và đối soát

Accepted cohort A là records validated/nonduplicate và engine-accepted trong session; ghi rejected reasons riêng. `Σ sizes(A) = Σ footprint totalVol = profile totalVolume`; per-price-bin tổng BUY+SELL+UNKNOWN bằng volume, đối soát tick-size normalization của hai engine. Không dùng dữ liệu lịch sử làm baseline cohort.

- Footprint: engine hiện giữ unknownVol riêng; kiểm tra unknown không đi vào bidVol/askVol; bar buy/sell/total và mỗi level phải khớp ledger.
- CVD: `ΔCVD_i = +size BUY / -size SELL / 0 UNKNOWN`; explicit unknown từ vendor không bị classifier fallback suy diễn. UNKNOWN volume công bố riêng. Volume-weighted side coverage `(buyVolume+sellVolume)/totalVolume`, zero volume → N/A. Trace đòi known raw B/A hoặc UNKNOWN; không chấp nhận quote/tick inference trong mode này.
- Profile: label provider/dataset/contract rõ ràng; provenance EXACT nghĩa exact observed ticks, không nghĩa full session. Coverage **PARTIAL**, reason limited observation, start/end và counts; không COMPLETE. Nếu engine có estimated/stored seed thì FAIL isolation, không âm thầm relabel.
- Candles: OHLC theo event order trong mỗi bucket, quy tắc tie theo stable ordinal; high/low theo normalized price, volume Σ sizes. Bar chứa phần nhỏ cửa sổ phải label partial; không khẳng định nến toàn phút/toàn phiên. Final watermark giúp nhận final snapshot sau throttle.

## 7. WebSocket và React acceptance

Đăng nhập staging trước khi Operator start lượt duy nhất. Capture private WS incoming message IDs/cohort watermarks, compare TICK ledger received = backend accepted (hoặc explicit documented batch count). ChartSession gửi callback success chỉ chứng minh enqueue/write; browser receipt/render cần riêng. Ignore INIT_STATE/ping-pong trong counter market data.

Xác minh App symbol routing ES với mapping ES.c.0/ESZ6; collect state ở onTick/onBarUpdate/onProfileUpdate và browser final digest, screenshot chart/CVD/profile. Canvas screenshot chỉ phụ trợ, không thay numeric reconciliation. Final snapshot flush BAR/PROFILE sau vendor socket đóng để không mất update cuối do throttle; không mở stream lại để flush. Kiểm tra không replay mode/mock fixture/cached history masquerading genuine; source review hiện là vendor path, runtime isolation còn phải đo.

Sau timeout/cap: vendor connection closed, feed UNAVAILABLE với reason session ended (hoặc DISCONNECTED nếu protocol được mở rộng có duyệt), stale tuổi dữ liệu tăng đúng threshold. WS transport có thể còn open để nhận final evidence; không nhầm WS-connected với vendor LIVE. Theo dõi không có reconnect/subscription khác sau teardown trong khoảng quan sát được duyệt, không tự mở phiên mới.

## 8. Files dự kiến thay đổi — chờ Operator phê duyệt

| File | Thay đổi tối thiểu đề xuất |
|---|---|
| server/src/databento/liveClient.ts | trades-only TCP branch, opt-in limits/no reconnect, ACK/error telemetry, bounded teardown, preserve raw metadata; không audit/chỉnh protocol constants |
| server/src/marketData/registry.ts | truyền session policy/dataset/schema, whitelist ES, prohibit extra connection |
| server/src/marketData/marketContext.ts | gate history/store seed/GEX/restart, acceptance trace/engine snapshots, explicit status + final flush, PARTIAL coverage |
| server/src/index.ts | disable default auto-start/WS-driven creation/history endpoints trong mode, local operator orchestration wiring |
| server/src/marketData/types.ts; server/src/types.ts; client/src/types.ts | typed metadata/cohort/coverage/trace watermark cần thiết |
| server/src/session.ts | trace publication success/failure và message identity |
| server/src/profileEngine.ts | chỉ bổ sung window/source metadata nếu context không thể cung cấp qua envelope; không thay thuật toán volume |
| client/src/services/websocket.ts; client/src/App.tsx | bounded acceptance receive/render telemetry, symbol/session guard, side coverage labels |
| client/src/components/Chart/CVDPanel.tsx; client/src/components/Chart/FootprintCanvas.tsx; client/src/components/Profile/ProfileOverlay.tsx | bổ sung nhãn UNKNOWN/coverage nếu parent UI chưa thể hiển thị đủ; không viết lại engines |
| scripts/verify_trades_e2e.mjs (mới) | coordinator local, preflight, single approved start, watchdog, collect private trace/browser digest/report |

Không cần tự viết lại FootprintEngine/CVD algorithm: inspect hiện đã tách UNKNOWN. Tests sau thay đổi được duyệt phải cover trades-only command, no retry on errors/close, no-data timeout, chunk over-cap, browser resubscribe cannot restart, forbidden history calls, UNKNOWN reconciliation, metadata preservation, final throttled flush và regression staging. Offline fixtures dùng kiểm tra safety/logic phải label offline; không ghi LIVE PASS.

## 9. Cleanup và quyết định

Finalize session một lần; freeze cohort; close vendor socket, clear vendor timer/reconnect timer, invalidate callbacks; stop/abort GEX/history/context grace callbacks; publish final digest/status qua WS còn đang auth; close browser observer và WS sau evidence; runner verify exit và không còn TCP subscription. Không dùng compose down -v, xóa volumes/reset DB hoặc dừng host-wide processes.

PASS: ACK thật + valid trades + complete bounded trace + engine/WS/browser numeric equality + đúng source/side/partial coverage + socket closed within cap + zero extra connections/history calls. FAIL: mismatched counters/values, fabricated/seed contamination, unknown-side inference, leak metadata/source, unsafe subscription/timeout/reconnect hoặc missing teardown. BLOCKED: chưa được phê duyệt code/run, session closed/date expired, entitlement/access/staging unavailable, thiếu quan sát để nghiệm thu; không lấy generic harness exit 0 thay evidence.

Hiện **PREPARATION ONLY / E2E NOT VERIFIED**. DOM/Heatmap giữ **BLOCKED BY VENDOR ENTITLEMENT**; Operator cần Databento Support xác nhận live mbp-10 cho GLBX.MDP3 và team/API key. Không thử depth/MBP-1/TBBO thay thế.

Operator cần phê duyệt: (1) scope code/instrumentation tối thiểu trên và regression; (2) cách isolation backend đang chạy, private trace retention; (3) một lượt Trades E2E riêng, ngày chạy và 30s/50-record budget. Ngày khác cần cấp quyền mới; hai lượt trước đã dùng. Không thực thi trong nhiệm vụ này, không sửa source/billing, không mua, không tải paid history, không mở public production hoặc push Git.
