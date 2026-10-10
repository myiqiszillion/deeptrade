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
| **Git Release Revision** | `dc18cef` (Full: `dc18cefd0f98ec34ca7e3be967c331163ff5fa3f`) |
| **Git Branch** | `master` |
| **Working Tree Status** | **CLEAN** (sau khi commit các thay đổi safeguards) |
| **Docker App Image** | `deepchart-app:latest` — ID: `925b5a5155f0` |
| **Docker App Manifest Digest** | `sha256:925b5a5155f0e122de69144e60115a7946dea5333956be9fca33c9afaf6c6aa8` |
| **Docker Proxy Image** | `deepchart-proxy:latest` — ID: `0e403dbdd8d3` |
| **Docker Proxy Manifest Digest**| `sha256:0e403dbdd8d3c8cc67660e802dd4fc4933f83ae35b3963ff185c60f51c05a7a6` |
| **Base OS / Container Env** | Node 24.21.0 Alpine Linux (non-root `node` user) / Caddy 2 Alpine |

---

## 3. Test Evidence & Verification Matrix

Tất cả các bài kiểm tra đã được chạy lại và xác thực exit code 0:

| Lệnh kiểm thử | Exit Code | Kết quả chi tiết | Đánh giá |
|---|---|---|---|
| `pnpm typecheck:all` | **0** | TypeScript biên dịch không lỗi trên cả `@deepchart/server` và `client` | **PASS** |
| `pnpm test:unit` | **0** | 100% unit tests passed (bao gồm 12/12 transactional billing, race & idempotency tests) | **PASS** |
| `pnpm test:integration` | **0** | 7/7 suites passed trong 3540ms; tự động thoát tự nhiên trên empty event loop | **PASS** |
| `pnpm verify:p0` | **0** | 13/13 P0 safeguards pass (Buffer isolation, Whale threshold, Flood protection, Fail-Closed, ...) | **PASS** |
| `pnpm build:all` | **0** | Server `dist` sạch, Vite client build 1954 modules thành công (CSS: 67kB, JS: 141kB) | **PASS** |
| `pnpm test:e2e` | **0** | 19/19 Playwright assertions passed; runner exit code 0; teardown duration 6042ms | **FULL PASS** |
| `node scratch/test_runner_failure_semantics.mjs` | **0** | Kiểm chứng cô lập: runner bắt buộc trả exit code 1 khi test fail và teardown sạch sẽ | **PASS** |
| `node scratch/staging_full_verification.mjs` | **0** | 42/42 Staging acceptance checks pass trên Docker Staging thực tế | **PASS** |

---

## 4. Playwright E2E Runner Teardown & Failure Semantics (Safeguard 2)

- **Test Runner Script:** `scripts/run_e2e.mjs`.
- **Phân bổ Suite Execution:**
  - `e2e/behavioral.spec.ts`: 4 test cases — **4 PASS** (7.0s).
  - `e2e/memory.spec.ts`: 1 test case (100 mount/unmount canvas stress test, memory diff 18.95MB < 25MB threshold) — **1 PASS** (19.6s).
  - `e2e/terminal.spec.ts`: 14 test cases — **14 PASS** (18.8s).
- **Tổng số assertions:** 19/19 PASSED (0 FAIL, 0 SKIPPED).
- **Thời gian chạy kiểm thử:** 47.6s.
- **Thời gian dọn dẹp teardown:** 6042ms.
- **Runner Exit Code:** `0`.
- **Tiến trình sót lại (Remaining Processes):** `0` (Cây tiến trình server và client được chấm dứt dứt điểm bằng `taskkill /PID <proc.pid> /T /F`).
- **Xác minh Failure Propagation:** Đã chạy kịch bản kiểm thử cô lập `scratch/test_runner_failure_semantics.mjs`, xác nhận khi có bất kỳ assertion fail nào, top-level runner lập tức trả exit code nonzero (code 1) và thực thi teardown đầy đủ, không che giấu lỗi.
- **Timeout Guard:** Tích hợp bộ bảo vệ timeout 180s per suite, tự động thu hồi tiến trình và trả mã lỗi 124 nếu Playwright worker bị deadlock.

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

1. **Loopback Binding:**
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

## 7. Stripe Webhook Transactional Idempotency (Safeguard 1)

1. **Atomic Transaction Boundary:**
   - Sử dụng `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` thông qua `marketDataStore.transaction(...)`.
   - Cả 3 thao tác: (1) kiểm tra `webhook_events`, (2) cập nhật `subscriptions` / `entitlements`, và (3) ghi nhận `webhook_events` đều nằm trọn vẹn trong **1 atomic SQLite transaction**.
   - Bất kỳ lỗi hoặc crash nào xảy ra trước khi commit đều tự động rollback 100%, không để lại trạng thái rách nát (partial state).
2. **Strict Concurrency & Unique Constraint:**
   - Bảng `webhook_events` có `id TEXT PRIMARY KEY`.
   - Sử dụng `INSERT INTO webhook_events` (không dùng `OR REPLACE`).
   - Hai request cùng `event.id` đến đồng thời: Request đến sau lập tức kích hoạt lỗi `UNIQUE constraint failed`, transaction tự động rollback, và catch block trả về kết quả an toàn `idempotent: already processed` (HTTP 200) mà không ghi đè subscription 2 lần.
3. **Out-of-Order Stale Protection & Legitimate Renewal:**
   - Khi subscription đã bị canceled: Các sự kiện cập nhật cũ có timestamp `eventCreatedMs <= currentSub.updatedAt` bị bỏ qua với `ignored: stale update for canceled subscription`.
   - Sự kiện thanh toán mua mới (`checkout.session.completed`) hoặc sự kiện gia hạn hợp lệ (`customer.subscription.updated` có `current_period_end > currentSub.currentPeriodEnd`) được xử lý bình thường, gia hạn subscription chính xác.

---

## 8. Secret & Release Artifact Hygiene (Safeguard 3)

1. **Build Context & Docker Layers:**
   - Đã kiểm tra `.dockerignore`: Các file `.env`, `*.sqlite`, `data/`, `backups/`, `test-results/`, `scratch/` bị loại bỏ 100% khỏi build context.
   - Không có file nhạy cảm nào lọt vào image layers của `deepchart-app` hay `deepchart-proxy`.
2. **Client Bundle Inspection:**
   - Kiểm tra mã nguồn `client/src`: Chỉ duy nhất biến `VITE_WS_URL` được tham chiếu.
   - Bundle Vite production hoàn toàn sạch, không chứa bất kỳ secret, API key hay private tokens nào.
3. **Đánh dấu ROTATION REQUIRED cho Staging Secrets:**
   - Trong quá trình kiểm tra trước đó, lệnh chẩn đoán `docker compose exec app printenv` đã hiển thị danh sách biến môi trường nội bộ của container ra console log.
   - **Các loại credentials bị ảnh hưởng trong console log:**
     - `AUTH_JWT_SECRET` (JWT signing secret tạm của staging)
     - `ADMIN_SECRET` (Admin provisioning secret tạm của staging)
     - `METRICS_TOKEN` (Prometheus metrics scrape token tạm của staging)
   - **Các credentials KHÔNG bị ảnh hưởng:**
     - `DATABENTO_API_KEY`: Đang rỗng (chưa từng được cấu hình).
     - `STRIPE_SECRET_KEY`: Đang rỗng (chưa từng được cấu hình).
     - `STRIPE_WEBHOOK_SECRET`: Đang rỗng (chưa từng được cấu hình).
   - **Chỉ thị bắt buộc dành cho Operator:**
     - Đánh dấu **ROTATION REQUIRED** đối với 3 khóa `AUTH_JWT_SECRET`, `ADMIN_SECRET`, `METRICS_TOKEN`.
     - Tuyệt đối không tái sử dụng file `.env` staging trên Production.
     - Khi triển khai Production, Operator phải chạy `node scratch/init_secrets.mjs` trên máy chủ độc lập để tạo bộ khóa mới 100% với độ dài ngẫu nhiên 32 bytes (256-bit entropy).

---

## 9. Databento Market Data Status & Volume Profile Provenance Contract

- **Trạng thái luồng dữ liệu:** `UNAVAILABLE` (Dự kiến & Chuẩn xác khi chưa cấp key live; fail-closed an toàn).
- **Chính sách an toàn:** Fail-Closed và Zero-Mock. Terminal không tự động sinh nến ảo hay tick giả khi mất kết nối vendor.
- **Hợp đồng Phân định Exact vs Complete:**
  1. **Provenance (`EXACT` | `ESTIMATED` | `UNAVAILABLE`):** Xác định độ chính xác trong thuật toán tính toán volume-at-price. `EXACT` khi toàn bộ volume/delta đến từ raw trades có phân loại aggressor bên mua/bên bán. `ESTIMATED` khi phân bổ từ nến OHLCV qua heuristic. `UNAVAILABLE` khi không có dữ liệu.
  2. **Coverage (`COMPLETE` | `PARTIAL` | `UNKNOWN`):** Xác định tính đầy đủ của dữ liệu trong toàn bộ khoảng thời gian requested `[startTime, endTime]`. Sự hiện diện của ít nhất 1 trade trong database **KHÔNG ĐƯỢC COI LÀ COMPLETE**. Nếu thiếu checkpoint metadata xác thực quá trình ingestion hoàn tất, hệ thống bắt buộc fail-closed trả về `coverage: 'UNKNOWN'`.
  3. **Quy tắc suy giảm:** Chạm giới hạn truy vấn (25,000 trades limit hit), tồn tại feed reconnect gap (`gaps` table), hoặc requested range vượt ra ngoài khoảng checkpoint đều bị đánh dấu `PARTIAL` kèm `coverageReason`.
  4. **Bảo toàn khoảng lặng 0 trades (Zero-Trade Interval):** Khoảng thời gian không có giao dịch trong phiên được xác thực hoàn tất và không có feed gap vẫn được xác nhận `available: true`, `status: 'no_data'`, `provenance: 'EXACT'`, `coverage: 'COMPLETE'`, `totalVolume: 0` (không ngộ nhận là PARTIAL).
  5. **Hiển thị giao diện người dùng:** Badge hiển thị rõ rệt `EXACT · COMPLETE`, `EXACT · PARTIAL`, `EXACT · UNVERIFIED`, `ESTIMATED`, và `UNAVAILABLE`. Không cho phép dữ liệu Estimated hoặc Incomplete được ngụy tạo thành Exact + Complete.
- **Khối thuật toán phân tích:** Các mô-đun Footprint Aggregator, CVD Calculator, Fixed-Range Volume Profile, DOM Scalper, Liquidity Heatmap và Options Chain Greeks đã được kiểm chứng hoạt động đúng theo toán học và chuẩn dữ liệu chuẩn hóa, hiện đang trong tư thế sẵn sàng đón luồng trực tiếp ngay khi key được nạp.

---

## 10. Licensing, Authentication & Entitlements

1. **Phân quyền người dùng:**
   - Các gói cước: `free` (1500 bars, basic timeframe), `pro` (Footprint, CVD, DOM Scalper, alerts), `elite` (Options chain, GEX, unconstrained depth replay).
   - Cơ chế xác thực: JWT ký với `AUTH_JWT_SECRET` (32 bytes entropy), mật khẩu băm bằng `scrypt` an toàn hằng thời gian.
   - Thu hồi token: Danh sách đen JTI (`revoked_tokens`) lưu trữ trực tiếp trong SQLite.
2. **Bảo vệ Brute-Force & Rate Limiting:**
   - `LoginGuard`: Khóa IP và tài khoản sau 5 lần đăng nhập sai trong cửa sổ 15 phút.
   - Sliding-window rate limit trên REST và WebSocket flood protection.

---

## 11. Production Blockers & Missing Items

Trước khi hệ thống có thể phục vụ người dùng công khai trên Internet, các mục sau đây là điều kiện tiên quyết bắt buộc cần Operator can thiệp:

1. **Databento API Key:** Cần cấp phát `DATABENTO_API_KEY` có quyền truy cập dataset `GLBX.MDP3` (CME) và `OPRA.PILLAR`.
2. **Stripe Production Keys:** Cần cấp phát `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE` từ Stripe Dashboard chế độ Live.
3. **Public Domain DNS & TLS:** Cần cấu hình bản ghi DNS A/AAAA trỏ domain thực tế về máy chủ và cấu hình biến `DOMAIN` trong `.env` để Caddy tự động cấp chứng chỉ Let's Encrypt công khai.
4. **Sustained Production Profiling:** Cần giám sát CPU, RAM RSS và event loop lag trong 24 giờ đầu tiên sau khi kết nối luồng Databento thật.

---

## 12. Final Release Decision & Classification

Để đảm bảo tính minh bạch kỹ thuật tuyệt đối, các trạng thái phát hành được phân định rạch ròi như sau:

| Phân loại trạng thái | Kết luận | Căn cứ kỹ thuật |
|---|---|---|
| **DOCKER STAGING VERIFIED** | **VERIFIED (ĐẠT)** | 42/42 kiểm tra tự động PASS trên Docker Desktop thật, reverse proxy HTTPS/WSS, SQLite WAL persistence và WAL-safe backup hoạt động hoàn hảo. |
| **SOURCE RELEASE VERIFIED** | **VERIFIED (ĐẠT)** | Toàn bộ các kiểm thử unit, integration, P0 và E2E pass 100%. Transactional idempotency, failure propagation test và secret hygiene đã được xác thực hoàn tất. |
| **LIVE MARKET DATA VERIFIED** | **BLOCKED (CHỜ VENDOR)** | Chưa kiểm chứng luồng thị trường thực tế do chưa nạp `DATABENTO_API_KEY` thật. Hệ thống đang bảo vệ fail-closed an toàn. |
| **BILLING PRODUCTION VERIFIED** | **BLOCKED (CHỜ VENDOR)** | Cơ chế transactional idempotency và xử lý webhook đã kiểm chứng hoàn tất ở mức unit/staging; chưa xác thực giao dịch live trên Stripe Production. |
| **PUBLIC PRODUCTION APPROVED** | **CONDITIONAL RC (CHỜ OPERATOR)** | Phiên bản đạt chuẩn Release Candidate có điều kiện; sẵn sàng chuyển giao sang Vendor Validation và Operator Approval. |

