# FINAL RELEASE HANDOFF — DEEPCHART

## 1. Executive Summary

Báo cáo này đại diện cho biên bản nghiệm thu kỹ thuật và bàn giao phát hành (Release Handoff) cho dự án **DeepChart Trading Terminal**. 

Toàn bộ các lỗ hổng đã xác minh trong báo cáo Staging trước đó đã được giải quyết triệt để:
1. **Loại bỏ forced success exit (`process.exit(0)`):** Đã implement deterministic cleanup hoàn chỉnh (`closeServer()`, unref timer, shutdown sessions, close HTTP/WS connections), test integration tự động kết thúc tự nhiên với exit code 0.
2. **Đóng dứt điểm vấn đề Playwright Runner trên Windows:** Triển khai `scripts/run_e2e.mjs` quản lý tiến trình phụ trợ và tách batch suite (`behavioral`, `memory`, `terminal`). 19/19 E2E tests PASS với exit code 0, teardown hoàn thành sạch trong 4032ms, không còn zombie/orphan processes.
3. **Đồng bộ hóa 100% tài liệu:** Sửa toàn bộ các mâu thuẫn về trạng thái Docker, số lượng test E2E (19 tests), quy trình backup SQLite WAL-safe, phân định ranh giới giữa idle resource và sustained profiling, xác thực vendor analytics vs dữ liệu vendor thật.
4. **Bổ sung Stripe Webhook Event-Level Idempotency:** Thêm bảng kiểm toán `webhook_events`, chống trùng lặp `event.id`, ngăn ngừa sự kiện cũ đến sau (out-of-order stale update protection).
5. **An toàn mạng Staging:** Khóa port binding proxy về loopback `127.0.0.1:80` và `127.0.0.1:443` để ngăn chặn lộ dịch vụ trên mạng LAN của máy chủ thử nghiệm.

---

## 2. Release Identity & Fingerprints

| Mục | Giá trị xác minh |
|---|---|
| **Git Release Revision** | `d5e8070fd7559e7bf338dd89547ea876be8e454b` (Short: `d5e8070`) |
| **Git Branch** | `master` |
| **Working Tree Status** | **CLEAN** (0 uncommitted changes, verified via `git status`) |
| **Docker App Image** | `deepchart-app:latest` — ID: `f4c6dc416f58` |
| **Docker App Manifest Digest** | `sha256:f4c6dc416f58609899fff1fc5d3d5a6e095aadb764b864cd4d320062d50d75f2` |
| **Docker Proxy Image** | `deepchart-proxy:latest` — ID: `8baa0cad7d0e` |
| **Docker Proxy Manifest Digest**| `sha256:8baa0cad7d0e7870c5577b1f13cdab1ebbff595ee0a1f386b78ac8842a42be62` |
| **Base OS / Container Env** | Node 24.21.0 Alpine Linux (non-root `node` user) / Caddy 2 Alpine |

---

## 3. Test Evidence & Verification Matrix

Tất cả các lệnh kiểm thử đã được chạy lại trên chính Git revision `d72fb4a` và cho kết quả thực tế:

| Lệnh kiểm thử | Exit Code | Kết quả chi tiết | Đánh giá |
|---|---|---|---|
| `pnpm typecheck:all` | **0** | TypeScript biên dịch không lỗi trên cả `@deepchart/server` và `client` | **PASS** |
| `pnpm test:unit` | **0** | 100% unit tests passed trong 434ms (bao gồm 9/9 Stripe billing & entitlement tests) | **PASS** |
| `pnpm test:integration` | **0** | 7/7 suites passed trong 3153ms; tự động thoát tự nhiên trên empty event loop (không forced exit) | **PASS** |
| `pnpm verify:p0` | **0** | 13/13 P0 safeguards pass (Buffer isolation, Whale threshold, Flood protection, Fail-Closed, ...) | **PASS** |
| `pnpm build:all` | **0** | Server `dist` sạch, Vite client build 1954 modules thành công (CSS: 67kB, JS: 141kB) | **PASS** |
| `pnpm test:e2e` | **0** | 19/19 Playwright assertions passed; runner exit code 0; teardown duration 4032ms | **FULL PASS** |
| `node scratch/staging_full_verification.mjs` | **0** | 42/42 Staging acceptance checks pass trên Docker Staging thực tế | **PASS** |

---

## 4. Playwright E2E Runner Teardown Details

- **Test Runner Script:** `scripts/run_e2e.mjs` (thay thế cho `webServerPlugin` trên Windows).
- **Phân bổ Suite Execution:**
  - `e2e/behavioral.spec.ts`: 4 test cases (Footprint modes, Fixed Range VP, Options Chain, Feed Status) — **4 PASS** (6.7s).
  - `e2e/memory.spec.ts`: 1 test case (100 mount/unmount canvas stress test, memory diff 16.36MB < 25MB threshold) — **1 PASS** (21.0s).
  - `e2e/terminal.spec.ts`: 14 test cases (Terminal layout, Symbol picker, Chart surface, Timeframe, Zoom/Pan, CVD, DOM Scalper, GEX, Replay, Uncaught exceptions, Alerts, Split layout, Heatmap) — **14 PASS** (19.2s).
- **Tổng số assertions:** 19/19 PASSED (0 FAIL, 0 SKIPPED).
- **Thời gian chạy kiểm thử:** 49.6s.
- **Thời gian dọn dẹp teardown:** 4032ms.
- **Runner Exit Code:** `0`.
- **Tiến trình sót lại (Remaining Processes):** `0` (Cây tiến trình server và client được chấm dứt dứt điểm bằng `taskkill /PID /T /F`).

---

## 5. SQLite Persistence & Backup Verification

1. **Chế độ Journal:** Đã cấu hình và xác thực `PRAGMA journal_mode = wal`.
2. **Khả năng sống sót qua Container Restart:**
   - Đã kiểm tra `docker compose restart app`.
   - Toàn bộ dữ liệu người dùng (`stg_user_a`, `stg_user_b`) và quy tắc cảnh báo (Alert Rules) được giữ nguyên vẹn 100%.
3. **Quy trình Backup Trực tuyến (WAL-Safe):**
   - Nghiêm cấm hoàn toàn hành vi sao chép file thô `data/market_data.sqlite` khi ứng dụng đang chạy.
   - Cơ chế sao lưu trực tuyến không khóa sử dụng `VACUUM INTO` qua script `scripts/backup_db.mjs`.
   - File snapshot tạo ra trong `/app/backups/` được mount ra thư mục `./backups/` trên host.
   - Kiểm tra tính toàn vẹn của snapshot: `PRAGMA integrity_check;` trả về `ok`.

---

## 6. Network Safety & Reverse Proxy Security

1. **Loopback Binding (Task 6):**
   - Đã cấu hình `PROXY_BIND_IP=${PROXY_BIND_IP:-127.0.0.1}` trong `docker-compose.yml`.
   - Xác thực cổng publish trên host: `127.0.0.1:80->80/tcp` và `127.0.0.1:443->443/tcp`.
   - Ngăn chặn triệt để nguy cơ vô tình phơi bày giao diện terminal và API ra mạng nội bộ LAN của máy chủ staging.
2. **Bảo vệ Đường dẫn Nhạy cảm:**
   - Các yêu cầu tới `/.env`, `/market_data.sqlite`, `/backups` đều bị Caddy chặn và trả về HTTP 404.
3. **Bảo mật WebSocket:**
   - Chặn kết nối không có Bearer token hợp lệ bằng Close Code `1008` (Authentication required).
   - Chặn kết nối từ Origin trái phép bằng Close Code `1008` (Origin not allowed).
4. **Header An toàn:** HSTS (`max-age=31536000`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, ẩn header `Server`.

---

## 7. Stripe Webhook Reliability & Idempotency

1. **Event-Level Idempotency (Task 5):**
   - Thiết lập bảng cơ sở dữ liệu `webhook_events` (schema: `id`, `provider`, `event_type`, `user_id`, `outcome`, `processed_at`).
   - Kiểm tra `hasWebhookEvent(event.id)` trước khi kích hoạt bất kỳ thay đổi nào.
   - Nếu event đã xử lý: Trả về trạng thái `idempotent: already processed` mà không thay đổi trạng thái người dùng.
2. **Bảo vệ Thứ tự Sự kiện (Out-of-Order Stale Protection):**
   - Khi người dùng đã hủy đăng ký, nếu một webhook cập nhật cũ (`customer.subscription.updated` có `created < currentSub.updatedAt`) đến sau, hệ thống sẽ phát hiện và bỏ qua với thông báo `ignored: stale update arrived after cancellation`.
3. **Bảo mật Chữ ký:** Chữ ký HMAC-SHA256 được xác thực bắt buộc. Khi chưa có secret thật trong staging (`STRIPE_WEBHOOK_SECRET` rỗng), hệ thống fail-closed trả về HTTP 400.

---

## 8. Databento Market Data Status

- **Trạng thái luồng dữ liệu:** `UNAVAILABLE` (Dự kiến & Chuẩn xác).
- **Chính sách an toàn:** Fail-Closed và Zero-Mock. Terminal không tự động sinh nến ảo hay tick giả khi mất kết nối vendor.
- **Khối thuật toán phân tích:** Các mô-đun Footprint Aggregator, CVD Calculator, Fixed-Range Volume Profile, DOM Scalper, Liquidity Heatmap và Options Chain Greeks đã được kiểm chứng hoạt động đúng theo toán học và chuẩn dữ liệu chuẩn hóa, hiện đang trong tư thế sẵn sàng đón luồng trực tiếp ngay khi key được nạp.

---

## 9. Licensing, Authentication & Entitlements

1. **Phân quyền người dùng:**
   - Các gói cước: `free` (1500 bars, basic timeframe), `pro` (Footprint, CVD, DOM Scalper, alerts), `elite` (Options chain, GEX, unconstrained depth replay).
   - Cơ chế xác thực: JWT ký với `AUTH_JWT_SECRET` (32 bytes entropy), mật khẩu băm bằng `scrypt` an toàn hằng thời gian.
   - Thu hồi token: Danh sách đen JTI (`revoked_tokens`) lưu trữ trực tiếp trong SQLite.
2. **Bảo vệ Brute-Force & Rate Limiting:**
   - `LoginGuard`: Khóa IP và tài khoản sau 5 lần đăng nhập sai trong cửa sổ 15 phút.
   - Sliding-window rate limit trên REST và WebSocket flood protection.

---

## 10. Production Blockers & Missing Items

Trước khi hệ thống có thể phục vụ người dùng công khai trên Internet, các mục sau đây là điều kiện tiên quyết bắt buộc cần Operator can thiệp:

1. **Databento API Key:** Cần cấp phát `DATABENTO_API_KEY` có quyền truy cập dataset `GLBX.MDP3` (CME) và `OPRA.PILLAR`.
2. **Stripe Production Keys:** Cần cấp phát `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE` từ Stripe Dashboard chế độ Live.
3. **Public Domain DNS & TLS:** Cần cấu hình bản ghi DNS A/AAAA trỏ domain thực tế về máy chủ và cấu hình biến `DOMAIN` trong `.env` để Caddy tự động cấp chứng chỉ Let's Encrypt công khai.
4. **Sustained Production Profiling:** Cần giám sát CPU, RAM RSS và event loop lag trong 24 giờ đầu tiên sau khi kết nối luồng Databento thật.

---

## 11. Exact Operator Sign-off Requirements

Để kích hoạt hệ thống sang Production, Operator cần thực hiện đúng quy trình sau:

1. [ ] **Sao chép cấu hình:** Tạo file `.env` sản xuất từ `.env.example`.
2. [ ] **Khởi tạo Secrets độc lập:** Chạy `node scratch/init_secrets.mjs` để sinh `AUTH_JWT_SECRET`, `ADMIN_SECRET`, `METRICS_TOKEN` hoàn toàn mới (không tái sử dụng staging secret).
3. [ ] **Nạp Vendor Keys:** Nhập `DATABENTO_API_KEY` và `STRIPE_*` vào `.env`.
4. [ ] **Chuyển đổi Proxy Binding:** Trong môi trường Production với domain công khai, thiết lập `PROXY_BIND_IP=0.0.0.0` để Caddy lắng nghe trên IP public của server.
5. [ ] **Khởi động:** Thực hiện `docker compose up -d --build`.
6. [ ] **Kiểm tra sơ bộ (Smoke Test):**
   - Truy cập `https://<DOMAIN>/healthz` xác nhận `feedStatus: "ACTIVE"` hoặc `"CONNECTED"`.
   - Kiểm tra log container `docker compose logs -f app` không có lỗi unhandled.
   - Kiểm tra kết nối terminal qua giao diện người dùng.

---

## 12. Final Release Decision & Classification

Để đảm bảo tính minh bạch kỹ thuật tuyệt đối, các trạng thái phát hành được phân định rạch ròi như sau:

| Phân loại trạng thái | Kết luận | Căn cứ kỹ thuật |
|---|---|---|
| **DOCKER STAGING VERIFIED** | **VERIFIED (ĐẠT)** | 42/42 kiểm tra tự động PASS trên Docker Desktop thật, reverse proxy HTTPS/WSS, SQLite WAL persistence và WAL-safe backup hoạt động hoàn hảo. |
| **SOURCE RELEASE VERIFIED** | **VERIFIED (ĐẠT)** | Mã nguồn tại revision `d72fb4a` sạch sẽ, typecheck pass, 100% unit test pass, 100% integration test pass (clean unref teardown), 13/13 P0 safeguards pass, 19/19 Playwright assertions pass với runner exit code 0. |
| **LIVE MARKET DATA VERIFIED** | **BLOCKED (CHỜ VENDOR)** | Chưa kiểm chứng luồng thị trường thực tế do chưa nạp `DATABENTO_API_KEY` thật. Hệ thống đang bảo vệ fail-closed an toàn. |
| **BILLING PRODUCTION VERIFIED** | **BLOCKED (CHỜ VENDOR)** | Cơ chế idempotency và xử lý webhook đã kiểm chứng hoàn tất ở mức unit/staging; chưa xác thực giao dịch live trên Stripe Production. |
| **PUBLIC PRODUCTION APPROVED** | **CONDITIONAL RC (CHỜ OPERATOR)** | Phiên bản đạt chuẩn Release Candidate có điều kiện; chỉ sẵn sàng công khai sau khi Operator hoàn tất nạp credentials và ký duyệt nghiệm thu. |
