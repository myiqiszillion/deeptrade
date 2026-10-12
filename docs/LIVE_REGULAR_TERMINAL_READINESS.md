# Controlled Regular Terminal readiness — 12/10/2026 ICT

## Kết luận

Controlled normal-terminal bridge: **OFFLINE PASS**. Genuine vendor → Regular Terminal: **NOT VERIFIED**, chưa chạy lệnh Live acceptance mới. MBP-10/DOM/Heatmap vẫn **BLOCKED BY VENDOR ENTITLEMENT**. Cần Operator xem sự cố P0 bên dưới và phê duyệt riêng trước lượt Live tiếp theo.

Baseline HEAD: `5ae4c828cea24e793594dc366ec9a16780e43c9a`; bao gồm trailing BAR/PROFILE flush và primary symbol routing. Release revision là commit chứa báo cáo này, xác định bằng `git rev-parse HEAD`. Các tài liệu/scratch untracked có sẵn không đưa vào commit. Không push.

## Bridge và giới hạn

Tái sử dụng `ControlledTradesSession` và `DatabentoLiveClient`; không có integration vendor thứ hai. Option `normalFanout` đưa trade qua nhánh xử lý bình thường của MarketContext, rồi `ChartSession.send` serialize các DTO sản phẩm đến WebSocket client → App → FootprintCanvas/CVDPanel/ProfileOverlay. Nhánh isolated cũ vẫn hoạt động.

Trade được validate/deduplicate trước, xử lý engines một lần, sau đó mới gọi `onOutcome`; không replay accepted traces vào một context thứ hai. Context mới chỉ ES/1m, history NONE, không prime SQLite, không persistence, không alert/global microstructure side effects, không GEX/history/fallback. Metadata cohort, mapping, source, watermark và lifecycle chỉ nằm trong private evidence; public DTO không đổi.

Một GLBX.MDP3 / ES.c.0 / trades subscription, một TCP connection, tối đa 30.000 ms từ trước connect hoặc 50 market records, không reconnect/retry. Deadline clock injection bị cấm trong Live. Acceptance mặc định OFF. Browser chỉ nhận chart subscription; START và NQ bị từ chối, không mở vendor connection.

Controller hủy TCP đồng bộ trước final BAR_UPDATE/PROFILE_UPDATE và final private snapshot. Parent supervisor có vendor watchdog 30 giây độc lập; sau CLOSED chỉ có cleanup budget 10 giây, không kéo dài streaming. Khi worker bị treo, parent kill worker và kiểm tra/đóng browser tree.

## Offline evidence

| Check | Kết quả |
|---|---|
| 50-record cap | 50 accepted; 1 connection / 1 trades subscription; RECORD_CAP / CLOSED |
| Volume | 1275 = BUY 425 + SELL 442 + UNKNOWN 408 |
| CVD | -17; UNKNOWN không đóng góp signed volume |
| Profile | Total 1275; bins đối soát riêng; POC 7864.25; EXACT / PARTIAL |
| Candles | Hai bar, volume 3 và 1272; OHLCV/time đối soát từ event-time traces |
| Normal messages | TICK 50; BAR_UPDATE 2; BAR_CLOSE 1; PROFILE_UPDATE 2; INIT_STATE/lifecycle |
| Actual React | Footprint props, CVD, Profile và candles branch khớp snapshot; digest MATCH |
| Final status | Header UNAVAILABLE sau socket close và pending UI tick flush |
| Sparse timeout | 3 records, volume 6, UNKNOWN 3, CVD -1; TIMEOUT / CLOSED; final updates nhận đủ |
| Hard deadline logic | Offline unit clock nhận đúng 30000 ms và kích hoạt shutdown; socket destroyed trước final fanout |
| Isolation | INIT empty/history NONE; TICK source fixture; START/NQ rejected; normal ES→NQ late-ES regression PASS |
| External fetch | 0 backend external analytics/history calls; browser external requests bị chặn |
| Watchdog probes | Vendor hang và cleanup hang đều exit 124; browser ALREADY_EXITED khi kiểm tra cleanup |

App có thể yêu cầu history qua WS trong luồng thông thường; bridge từ chối, không fetch hay trả historical data. Hai yêu cầu kiểm thử START/NQ cũng bị từ chối; ERROR này không phải gateway/parser error. Không gửi ACCEPTANCE DTO cho App thường. Không dùng screenshot để kết luận numeric PASS.

Private artifacts dưới `C:\Users\Administrator\.codex\private-acceptance`:

- Cap: `deepchart-1791822594168/evidence.json`, 90,813 bytes; SHA256 `12ec00e7af75a532eebd9046526e42297821b68237397e638ed05f575a074ebc`.
- Sparse: `deepchart-1791822596724/evidence.json`, 20,048 bytes; SHA256 `37e578a3922880ae724e8684389016b65473c0de1c014fbbf7e13c3560ea2afd`.
- Vendor watchdog: `deepchart-1791822462166/watchdog.json`.
- Cleanup watchdog: `deepchart-1791822562088/watchdog.json`.
- Normal symbol routing regression: `regular-terminal-offline-1791822366277/result.json`.

Artifacts mang source OFFLINE_FIXTURE, không có JWT hoặc credential fields qua scan; runner không lưu API key/token. Không lưu raw DBN. Các kết quả này không phải Live PASS.

## Regression và staging

Typecheck all, unit (12 independent controlled offline sessions + lease), integration, build all: PASS. P0 sau sửa offline harness: 13/13 PASS. Browser E2E: 19/19 PASS, runner cleanup 0 processes. Isolated observer offline cap: PASS. Regular-terminal cap/sparse/watchdogs và normal Terminal offline regression: PASS.

Docker rebuild và triển khai bằng `docker-compose.yml` + `deploy/offline-staging.compose.yml`; app healthy, proxy running, provider=none, key rỗng. Staging sau build cuối: **42/42 PASS**. WAL, credentials/rules persistence qua restart và restored backup integrity: OK. Không reset SQLite hoặc xóa volume. Staging harness tạo test users/rules và backup; retention tự prune snapshot cũ theo hành vi sẵn có.

## Sự cố P0 ngoài phạm vi offline

Lần gọi P0 đầu tiên đã thiếu env isolation: child ordinary backend nạp `.env`, khởi động Databento và nhận dữ liệu thật ngoài phạm vi được cấp phép. Log ghi provider=databento, ES/NQ LIVE; test YM phát hiện 72 TICK / 22 book updates và suite exit 1. **Đây là lỗi thao tác, không phải một lượt controlled acceptance và không được dùng làm bằng chứng PASS.** Không có cap/deadline controlled cho lần này; số connections/subscriptions, tổng records, thời lượng chính xác và chi phí: NOT CAPTURED. Backend thông thường có persistence; không thể khẳng định lần này không ghi dữ liệu vào local SQLite. Không xóa dữ liệu để che hoặc xử lý sự cố.

P0 runner đã terminate server khi kết thúc; kiểm tra `netstat -ano` sau đó không thấy kết nối port 13000. Không mở thêm vendor để điều tra. Đã sửa chính harness để ép NODE_ENV=test, provider=none, key rỗng, memory storage và bootstrap fixture ES/NQ; external fetch bị chặn. Chạy lại offline 13/13 PASS. Operator cần xem xét usage/chi phí trên tài khoản nếu muốn xác minh tác động; không thay đổi billing/entitlement hoặc liên hệ vendor thay Operator.

## Timestamp follow-up

Read-only: W32Time Stopped; `w32tm /query /status` trả `0x80070426` (service chưa chạy). Không đổi service/registry/clock.

Theo [Databento Trades schema](https://databento.com/docs/schemas-and-data-formats/trades), `ts_event` là matching-engine-received time; `ts_recv` là capture-server-received time. Local receive là Date.now tại decoder boundary Windows, không phải packet receive. Trace giữ nguyên ns, normal chart dùng event ms theo parser hiện có. Không sửa timestamp để ép latency dương. Volume/CVD/OHLCV đối soát không phụ thuộc host clock đồng bộ; không công bố local-to-vendor feed latency. Bất thường clock ở genuine isolated run vẫn chưa giải quyết.

## Files changed và bước tiếp theo

- `server/src/acceptance/controlledTrades.ts`: bridge option, offline clock, final flush ordering.
- `server/src/marketData/marketContext.ts`: normal fanout trong isolated cohort; suppression persistence/global side effects.
- `scripts/trades_e2e_worker.mjs`: loopback normal ChartSession adapter, restricted routes, actual App, private mapping evidence.
- `scripts/regular_acceptance_ui.mjs`: mounted real component numeric/digest assertions, candles branch.
- `scripts/verify_trades_e2e.mjs`: offline env isolation và cleanup watchdog riêng.
- `server/test/unit/controlledTrades.test.ts`: cap/normal fanout/deadline/socket ordering regression.
- `server/src/verify_p0.ts`, `server/test/p0OfflineServer.ts`: khóa regression offline và fixture bootstrap sau sự cố thực tế.
- Báo cáo này. Không đổi decoder/constants hoặc UI production.

Sau khi Operator xem báo cáo/sự cố và cấp phép riêng đúng ngày ICT, lệnh dự kiến:

```powershell
node scripts/verify_trades_e2e.mjs --live --regular-terminal --approval-date 2026-10-12
```

Nếu sang ngày khác phải có phê duyệt mới và approval-date đúng ngày đó. Trước chạy: staging offline healthy, key rỗng trong container; metadata/schema/mapping/session preflight hợp lệ; chỉ trades quyền hiện có, không phát sinh quyền/phí mới. Lượt được phê duyệt sẽ đo genuine trades → normal serialized messages → real UI bins/CVD/profile/POC/candles/digest và cleanup. Không chạy observer và regular acceptance đồng thời, không MBP-10, orders, paid historical, Stripe Live, production public hoặc push. **Dừng chờ Operator; genuine Regular Terminal acceptance vẫn NOT VERIFIED.**
