# Controlled Trades E2E implementation — 12/10/2026

**IMPLEMENTATION + OFFLINE VERIFIED. Genuine Trades E2E: NOT VERIFIED.** Không chạy Databento Live hoặc paid historical trong nhiệm vụ này. MBP-10 vẫn **BLOCKED BY VENDOR ENTITLEMENT**, không retest.

Baseline: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`. Revision cuối là local commit chứa báo cáo này, xác định chính xác bằng `git log -1 --format=%H -- docs/REAL_TRADES_E2E_IMPLEMENTATION_REPORT.md`; hash cũng được trả trong handoff. Không push.

## Files thực sự thay đổi

| File | Mục đích |
|---|---|
| server/src/acceptance/controlledTrades.ts (mới) | Controller/session lease, lifecycle, hard budget, bounded metadata/trace, production-context snapshots |
| server/src/databento/liveClient.ts | Optional acceptance hooks: single trades subscription, no reconnect, ACK/framing/error callbacks, injected offline transport. Constants và decoder algorithms không thay đổi |
| server/src/marketData/marketContext.ts | Optional isolated cohort: production Footprint/Profile engines, bỏ store/history/GEX/sequence-gap inference và persistence trong acceptance; snapshots/outcomes |
| server/test/unit/controlledTrades.test.ts (mới), server/test/unit/index.ts | Safety và analytics regression, tích hợp vào unit suite |
| scripts/verify_trades_e2e.mjs (mới) | Local supervisor, OFF mặc định, explicit mode/date gate, private artifacts, independent watchdog |
| scripts/trades_e2e_worker.mjs (mới) | Loopback-only worker, metadata preflight cho future live, no HTTP start/history route, actual WS + React observer, numeric reconciliation |
| scripts/acceptance_fixtures.mjs (mới) | Binary offline fixture vendor cho loopback tests, không label LIVE |
| client/src/AcceptanceObserver.tsx (mới), client/src/main.tsx | Dedicated React observer ở query acceptance=1: cohort/instrument guard, render snapshot, SHA-256/numeric receipt; không subscribe/start/reconnect |
| deploy/offline-staging.compose.yml (mới) | Staging provider none, API key rỗng trong container, quote-board OFF; giữ volumes/.env |
| docs/REAL_TRADES_E2E_IMPLEMENTATION_REPORT.md (mới) | Handoff và giới hạn bằng chứng |

## OFF, isolation và subscription

`node scripts/verify_trades_e2e.mjs` không có flags chỉ báo Acceptance OFF rồi exit 0. Không env auto-start. Entry acceptance là process riêng, **không import server index**, nên không có default-context startup, registry auto creation, regular history/options endpoints hoặc browser-driven manager.subscribe. Existing production entry vẫn giữ hành vi bình thường ngoài acceptance.

Worker tạo một MarketContext mới ES và một DatabentoLiveClient cố định GLBX.MDP3 / ES.c.0 / trades. Client có acceptance option reject sai dataset/symbol/schema hoặc WS vendor transport. Một session lease chặn concurrency và mỗi instance không restart. TCP gửi đúng một `schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1`; không gửi MBP-1/10/TBBO. Regression kiểm tra exact command và connection count.

Trong cohort: history-provider calls, backfill, reconnect-gap fetch, store priming, GEX refresh/timer và persistence bị gate. Không dùng dữ liệu có sẵn trong SQLite. Profile/Footprint algorithms không viết lại. Browser chỉ mở observer WS; `/start` POST và `/api/v1/history` trả 404 và không tạo vendor connection. Origin phải đúng private loopback origin; chỉ một observer; incoming commands chỉ được là receipts, không có START/SUBSCRIBE.

Khi nghiệm thu Docker, sử dụng override offline để không vô tình khởi động vendor ở ordinary index. Container hiện giữ provider none/key rỗng; **không chạy plain compose up để khôi phục key trước khi có phê duyệt Live riêng**. `.env` không đổi, volumes không xóa.

## Limits, lifecycle và cleanup

- IDLE → CONNECTING → AUTHENTICATED → ACKNOWLEDGED → RECEIVING → TERMINATING → CLOSED, hoặc FAILED terminal; timestamp lifecycle được ghi. Auth không tự chứng minh ACK/market data.
- Timer mặc định 30,000ms bắt đầu trước context/vendor connect. Ngay decoder boundary đếm từng trades record trước validation/dedup; invalid/duplicate cũng tiêu budget. Generation guard dừng parse phần dư chunk sau record thứ 50. Constructor reject budget vượt giới hạn hoặc không nguyên.
- No ACK/zero records tại timeout → FAILED; ErrorMsg/transport close/schema khác/mapping mismatch/framing error → immediate teardown; no reconnect. Context không tạo reconnect/history fallback.
- Disconnect synchronous destroy TCP và invalidate generation trước final publication. Final snapshot mang cùng session/instrument/watermark được gửi qua WS sau teardown, không reopen vendor để flush. finish idempotent; private worker dispose context và đóng WS/browser/server.
- Independent supervisor deadline 30s SIGKILL worker nếu loop bị treo, đóng vendor socket ở OS; browser PID do worker báo được cleanup riêng trên Windows. Offline watchdog probe dùng deadline 20ms và loop hang 10s, **expected exit 124**, không coi probe này là session PASS. Watchdog artifact ghi lý do và trạng thái browser cleanup; browser đã tự exit thì ghi ALREADY_EXITED thay vì khẳng định taskkill thành công.
- Timer/OS scheduling không phải trace TCP FIN; genuine network timing/closure vẫn cần đo trong lượt được phê duyệt. No raw DBN capture ở giai đoạn này.

## Trace, provenance và reconciliation

Tối đa 50 traces; tối đa 100 publication/receipt summaries; file evidence cuối kiểm tra kích thước **1 MiB**, buffer TCP cũng có cap 1 MiB. Artifacts nằm riêng dưới `%USERPROFILE%\.codex\private-acceptance\deepchart-<timestamp>`; không HTTP endpoint export, không secrets/JWT/auth payload. Không tự xóa bằng chứng hoặc đặt retention deletion trước Operator duyệt.

Trace có session/ordinal ID, dataset/schema, instrument, contract, event ns, vendor receive ns (nếu framing có), local receive ms, raw/normalized side, price/size/sequence, scope NOT CAPTURED, acceptance/rejection/dedup reason, signed contribution, footprint/profile/CVD snapshot contributions. Record identity dedup hash toàn record và session, không suy loss count từ venue sequence gap. Publication statuses và rendered watermarks liên kết tới trace; receipt watermark chứng minh aggregate đã render, không khẳng định React render từng message trung gian khi batching.

Offline trace/source ghi **OFFLINE_FIXTURE** và normalized trade sourceProvider=fixture. Future real mode ghi DATABENTO_LIVE, key không lưu. EXACT ở Profile nghĩa exact observed ticks; envelope/engine coverage **PARTIAL**, không full-session COMPLETE. UNKNOWN được giữ riêng và contribution CVD=0; explicit UNKNOWN không bị infer bằng tick/quote rule.

## Offline results

| Case | Kết quả |
|---|---|
| Chunk 60 trades, budget 50 | Chỉ 50 processed/accepted, 1 connection/1 trades subscription; CLOSED RECORD_CAP |
| Volume 50 trades | Accepted/Footprint/Profile = **1275**; BUY **425**, SELL **442**, UNKNOWN **408**; CVD **-17** |
| Sparse 3 trades, timeout 200ms | Accepted/Footprint/Profile = **6**; BUY 1, SELL 2, UNKNOWN 3; CVD -1; CLOSED TIMEOUT, final React receipt |
| Per price bins / candles | Independent runner assertions against accepted trace: volume and side per bin; open/high/low/close theo event order; matched |
| React numeric digest | Render effect recompute SHA-256 snapshot, footprint/profile volume, unknown and CVD; same session/instrument and final watermark matched |
| Safety unit scenarios | Cap/chunk, invalid consumes budget, duplicate, UNKNOWN, no ACK, zero records, ErrorMsg, unexpected close, pre-ACK record, instrument mismatch, lease concurrency, no restart, history/GEX guards, idempotent cleanup |
| Browser isolation | Browser WS trước start có 0 vendor connections; start/history HTTP paths 404; no observer reconnect/subscription implementation |
| Watchdog | Worker event loop intentionally hung offline; supervisor terminated worker independently, exit 124 expected |

Private numeric evidence runs include `deepchart-1791817737009/evidence.json` (50) and `deepchart-1791817738867/evidence.json` (3). Các runs trước giữ nguyên; không gọi fixtures là LIVE PASS. Normal React Terminal charts qua ordinary BAR_UPDATE/PROFILE_UPDATE còn **NOT VERIFIED với genuine records**; observer riêng đã offline verified, không thay thế nghiệm thu giao diện production thông thường.

## Checks và staging

| Lệnh | Exit / evidence |
|---|---|
| pnpm typecheck:all | 0 |
| pnpm test:unit | 0, gồm controlled-session scenarios |
| pnpm test:integration | 0 |
| pnpm verify:p0 | 0, 13/13 |
| pnpm build:all | 0 |
| pnpm test:e2e | 0, 19/19 |
| node scripts/verify_trades_e2e.mjs --offline | 0, 50-record cap + React receipt |
| node scripts/verify_trades_e2e.mjs --offline --sparse | 0, timeout + final flush receipt |
| node scripts/verify_trades_e2e.mjs --offline --watchdog-probe | 124 expected; harness check accepted it |
| docker compose build | 0 |
| docker compose -f docker-compose.yml -f deploy/offline-staging.compose.yml up -d | 0, no vendor key/provider |
| node scratch/staging_full_verification.mjs | 0, **42/42 PASS**, feedStatus UNAVAILABLE; SQLite WAL/persistence/backup integrity ok |

Staging suite tạo test users/alert và backup theo hành vi có sẵn; retention backup script có prune snapshot cũ. Không xóa database/volumes. Dữ liệu persistence có sẵn không phải cohort acceptance. Một lần đầu observer thiếu bundled browser executable; đã dùng Chromium có sẵn tại máy qua discovery/env override, không cài dịch vụ. Tests cuối PASS.

## Handoff: cần phê duyệt Live riêng

Sau Operator cấp phép đúng ngày thực thi, giữ ordinary staging vendor-disabled, staging healthy và xác nhận không có vendor process khác; chuẩn bị Chromium/Playwright, build outputs, private storage. Lệnh đề xuất **chưa chạy**:

```powershell
node scripts/verify_trades_e2e.mjs --live --approval-date YYYY-MM-DD
```

Runner kiểm tra ICT date flag, calendar, trades schema, fresh effective ES mapping, ordinary staging env provider none/key rỗng; quyền live thực tế phải được ACK/genuine records xác nhận. Gateway denial/no ACK/no records → FAIL, không retry. Calendar alone không chứng minh absence of halt; ghi session thực tế theo records nhận được. Không dùng entitlement schema-list làm bằng chứng license.

Scope cần Operator duyệt: một connection/subscription GLBX.MDP3 / ES.c.0 / trades ≤30s/50 records, private trace lưu tới khi Operator duyệt, React observer loopback, no historical/GEX/fallback/reconnect. Ngày khác cần phê duyệt mới. **Genuine MarketContext/analytics/WS/React E2E còn NOT VERIFIED**; không chạy Live, MBP-10, paid historical, mua quyền, billing/licensing/Stripe/public deployment/trading orders hay push trong nhiệm vụ này.
