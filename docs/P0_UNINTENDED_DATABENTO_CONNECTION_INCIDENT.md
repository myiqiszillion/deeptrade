# P0 unintended Databento connection — incident closure, 13/10/2026 ICT

**Containment kỹ thuật: VERIFIED. Impact/usage closure: chưa hoàn tất.** Sự cố không được phê duyệt và không phải authorized Live E2E PASS. Không mở Databento mới trong nhiệm vụ đóng sự cố này.

Freeze HEAD: `261b0fec0d1b2e7f8f05a63790e05d0e9851f8c6`, `feat: bridge controlled trades to regular terminal acceptance`. Tracked tree sạch lúc bắt đầu; các docs/scratch untracked có sẵn giữ nguyên, không stage. HEAD release cuối được ghi sau commit trong private `p0-incident-20261013/release_identity.json` và câu trả lời handoff.

## Bằng chứng quan sát

Nguồn log: Codex session `rollout-2026-10-12T17-25-17-01a12fa5-3037-7343-b6cd-e98c1c230e11.jsonl`. Event hoàn tất chứa output P0 có timestamp **2026-10-12 16:22:55.755 UTC / 23:22:55.755 ICT**. Đây là timestamp của event log, không phải thời điểm mở socket. Startup/close timestamps chính xác của vendor không được capture.

Private excerpt mới: `C:\Users\Administrator\.codex\private-acceptance\p0-incident-20261013\p0_execution_excerpt.log`; SHA256 `ccdab2aea409b33c99421e46ae22238d26dc0c1caf46223072ca159bd7204285`. Log gốc không sửa/xóa; không copy toàn bộ session chứa nội dung ngoài incident.

| Quan sát trong log | Ý nghĩa / giới hạn |
|---|---|
| P0 child backend, port 8089, DEV_HOOKS=1, provider=databento | Ordinary backend được khởi động bởi runner |
| ES LIVE `(GLBX.MDP3:ES)`; NQ LIVE và trade sequence-gap messages | Vendor data path đã hoạt động, ngoài controlled scope |
| TEST 13 thất bại: 72 TICK / 22 book updates khi đo feedless YM | Counts của cửa sổ kiểm tra, không phải tổng records của toàn phiên hoặc bằng chứng YM subscription |
| `[verify_p0] Terminating test server...`; suite exit 1 | Cleanup branch đã được gọi; không có PID/OS termination ACK gốc để chứng minh close time chính xác |
| Kiểm tra sau sự cố và hôm nay không có TCP connection port 13000 | Không quan sát thấy vendor TCP còn mở tại các thời điểm kiểm tra; không thay thế gateway billing/session log |

Dataset GLBX.MDP3 và ES/NQ được log xác nhận. Exact schemas/subscription ACK/raw DBN/subscription count: **NOT CAPTURED**. Từ source tại thời điểm sự cố, factory không truyền schema và client mặc định mbp-1, ordinary TCP path gửi trades + mbp-1; đây là **suy luận từ code**, không phải gateway capture. Không quy các 72 TICK cho 72 DBN records, không suy diễn toàn bộ phiên đã nhận đủ.

## Nguyên nhân

P0 cũ spawn `node <tsx-cli> server/src/index.ts` và spread `process.env`, không pin NODE_ENV/provider/key/storage. `index.ts` hydrate `../.env` và `.env` khi NODE_ENV khác test, rồi startup subscription manager. Workspace configs đặt provider=databento; thông tin credential không đưa vào báo cáo. Parent env có thể ưu tiên hơn env files, nên nguồn chính xác của credential được dùng là UNKNOWN.

Child cwd là `server`; default/relative `./data/market_data.sqlite` trỏ đến `server/data`, không phải Docker named volume. Ordinary startup còn có backfill/history path: có phát sinh HTTP historical hoặc GEX/options trong incident hay không **NOT VERIFIED**. Không mở vendor để tái hiện.

## Read-only impact assessment

Window đánh giá rộng: **2026-10-12 16:20–16:25 UTC / 23:20–23:25 ICT**. Host files được mở SQLite URI `mode=ro`, connection query_only, backup WAL-aware vào **RAM**, rồi chỉ SELECT/hash. Docker DB được kiểm tra readOnly/query_only trong read transaction. Không sửa/xóa trades, bars, databases, volumes hoặc backups.

| Database / snapshot | Trades / bars | Bằng chứng trong window |
|---|---|---|
| Root `data/market_data.sqlite` | 748 / 1556 | Không có event/receive-window rows |
| Local `server/data/market_data.sqlite` | 1618 / 7635 | 122 ES + 32 NQ, provider/source databento, event và receive timestamps phù hợp window |
| Docker backup 16:00:24.665 UTC | 66238 / 1236 | Không có window rows |
| Docker backup 16:31:47.606 UTC | 66238 / 1236 | Không có window rows; canonical trades/bar hashes giống backup trước |
| Docker named volume `deepchart_app-data`, read-only hôm nay | 66238 / 1236 | Không có receive-window rows; integrity_check OK |

154 local rows có receive timestamps ES `1791822163192..1791822175614`, NQ `1791822172685..1791822175623`. Chúng phù hợp với incident, nhưng schema không có ingestion run ID, không có paired local pre/post incident snapshot; **attribution/provenance to P0: UNKNOWN**. Record span không phải vendor connection duration. Không coi toàn bộ 1618 local trades, hoặc 66238 Docker trades tồn tại trước sự cố, là P0 tạo ra. Không có bar rows trong window được chọn; không loại trừ bars ở bucket khác hoặc tác động trước đó.

Docker `/app/data` là named volume; `/app/backups` bind đến workspace backups. `staging_data/market_data.sqlite` trên host là fixture khác, không phải mounted Docker app database. Current container logs không còn window sự cố (container đã recreate); không suy ra rằng incident không xảy ra từ log rỗng. Các migration snapshots `server/backups` gồm fixtures rỗng, không dùng làm pre-P0 baseline của database ứng dụng.

Metadata/hash evidence: private `p0-incident-20261013/sqlite_impact.json`. Docker backup canonical trades SHA256 `65a3d50d44b0abab6ef929bc61767865f5fe6e1ebd7c1168310525011fc55dd1`; bars SHA256 `96cc525713aa6667554f43d9127c639e2c32313f60ff61807217736e1ab5d25f`, giống trước/sau. Equality này chỉ chứng minh trades/bars của hai snapshots, không tất cả tables hoặc toàn hệ thống.

`vendor_usage` có 0 rows trong các DB đọc; đó không phải vendor invoice/meter. Tổng subscriptions, stream duration, vendor usage/cost, historical usage và mức độ persistence attribution vẫn UNKNOWN.

**VENDOR USAGE/COST NOT VERIFIED — OPERATOR PORTAL CHECK REQUIRED.** Không thay billing/licensing, không liên hệ vendor thay Operator.

## Containment và regression

P0 đã được pin test/none/key empty/memory và fixture bootstrap trước đó. Closure bổ sung guard trước application imports/child bootstrap: scrub credentials, chặn env hydration, non-loopback TCP/HTTP, unmocked vendor/history factories và app DB/backup destinations. Vi phạm bị ghi và làm process fail kể cả caller catch lỗi.

Các gaps khác đã sửa: inherited env ở WebSocket/alert integration; production-mode auth test env hydration; E2E inherited key/storage và reuse existing backend; unit regression mở real DB; unit migration backup mặc định sang directory ứng dụng. Unit persistence tests chỉ dùng `test_*.sqlite` đã xác định và temp backup directory. Production behavior khi không có offline guard giữ nguyên; không đổi protocol constants/decoder.

17 sentinel/negative/mock probes PASS; typecheck/unit/integration/build PASS; P0 13/13 PASS; browser E2E 19/19 PASS; normal Terminal offline PASS; controlled cap/sparse và vendor/cleanup watchdogs PASS. `LIVE` status strings trong fixture logs không được gọi là genuine Live evidence.

Containment kỹ thuật có đủ bằng chứng; incident impact chưa đóng hoàn toàn cho đến khi Operator kiểm tra portal và quyết định xử lý attribution UNKNOWN. Xem `REGULAR_TERMINAL_LIVE_GO_NO_GO.md`. Không có Live permission mới được suy ra từ kết quả closure.
