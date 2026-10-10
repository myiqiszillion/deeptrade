# Trạng thái hoàn thiện (đọc cái này để biết còn thiếu gì)

> Mục đích: thay cảm giác "hình như còn thiếu gì đó" bằng **danh sách cụ thể**, kèm cách tự kiểm tra.
> Cập nhật: 2026-10-11 (Staging Release Finalization). Mọi mục dưới đây đều nói rõ **ai làm** (code hay Release Operator).
> Frontend client (`client/`) hoạt động đầy đủ trên pnpm monorepo workspace (Vite 5 + React 19 + TypeScript + Tailwind CSS), hỗ trợ typecheck và build độc lập hoặc toàn bộ repo.

## A. Hoàn thiện — đã kiểm chứng (VERIFIED)

| Hạng mục | Bằng chứng tự kiểm tra |
|---|---|
| Auth thật (scrypt, khoá brute-force, thu hồi token, admin bootstrap) | `pnpm test:unit` → passwords/loginGuard; `pnpm test:integration` → authFlow |
| Gói & quyền (free/pro/elite, entitlement do server cấp) | `GET /api/v1/auth/config`, `POST /api/v1/admin/users/:id/plan` |
| Thanh toán Stripe (Checkout + webhook signature + event idempotency deduplication) | `pnpm test:unit` → billing (`evt_dedupe_test_001`, out-of-order stale check); `GET /api/v1/billing/plans` |
| Bảo vệ chi phí vendor (ngân sách chi tiêu theo tháng) | `DATABENTO_COST_CAP_USD`, `GET /api/v1/monitoring/vendor` |
| 43+ mã CME Group + thêm mã bất kỳ (env) | `pnpm test:unit` → instruments |
| API instruments trả trạng thái feed **trung thực** (IDLE/UNAVAILABLE/LIVE) | `pnpm test:integration` → historyApi (mục 4b) |
| History/aggregation/replay/rate limit/CORS/CSP/metrics/maintenance | `pnpm test`, `pnpm verify:p0` (13/13 assertions PASS) |
| Order Flow Alert Engine & Delivery Isolation | `pnpm test:unit` → alertEngine/alertsApi; `pnpm test:integration` → alertDelivery (private WS isolation) |
| E2E Browser Test Suite (Playwright 1.64.0) | **19/19 PASS** (`behavioral.spec.ts`: 4, `memory.spec.ts`: 1, `terminal.spec.ts`: 14), runner exit code 0, deterministic teardown |
| Deploy Staging: Docker Compose + Caddy TLS + SQLite WAL | `docker compose up -d`, 42/42 Staging Acceptance checks PASS, WAL persistence, hot backup verified |

## B. Đã code xong nhưng **phải do Operator bật/cấp** (không phải lỗi)

| Hạng mục | Cần gì | Kiểm tra |
|---|---|---|
| Dữ liệu realtime Live Market Data | `DATABENTO_API_KEY` (Databento live license) | `/healthz` (admin) → `feedStatus`, tab `Options`, `Flow`, `Darkpool`, `GEX` |
| Bán hàng thật Production | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO/ELITE`, `STRIPE_WEBHOOK_SECRET` | `GET /api/v1/auth/config` → `billingConfigured:true` |
| Giá cho watchlist | `ENABLE_QUOTE_BOARD=1` (dữ liệu vendor, mặc định tắt) | `GET /api/v1/quotes?symbols=ES` → `enabled:true` |
| Public production networking | `PROXY_BIND_IP=0.0.0.0`, `DOMAIN=yourdomain.com` | Caddy tự động cấp Let's Encrypt TLS public |
| Pháp lý (TERMS/PRIVACY/DEPLOY) | Điền `<LEGAL ENTITY>`, email, quốc gia; hoàn tất điều khoản vendor | `grep -r "<LEGAL ENTITY>" TERMS.md PRIVACY.md docs/DEPLOY.md` |

## C. Giới hạn & ranh giới kỹ thuật đã xác định

| # | Hạng mục | Hiện trạng chính xác | Ghi chú vận hành |
|---|---|---|---|
| 1 | **Databento Vendor Verification** | Các thuật toán (Footprint, GEX, VP) đã kiểm chứng qua test fixtures; kết nối dữ liệu vendor thật đang ở trạng thái FAIL-CLOSED | Cần cấp `DATABENTO_API_KEY` của gói trả phí để thông luồng |
| 2 | **Stripe Webhook Idempotency** | Đã triển khai bảng `webhook_events` và kiểm tra trùng lặp `event.id` + chặn stale update out-of-order | Hoạt động ở test mode; cần operator production secret để live |
| 3 | **Client Memory Lifecycle** | Đã đo đạc qua Playwright memory test (50 chu kỳ mount/unmount CVD canvas, delta heap 16-23 MB < 50 MB threshold) | Chưa thực hiện sustained 24h profiling dưới tải thực |
| 4 | **SQLite WAL Hot Backup** | Đã kiểm chứng qua SQLite Online Backup API (`sqlite3 ... ".backup ..."` / `scripts/backup_db.mjs`) | Không được copy file thô (`cp`) khi chưa checkpoint WAL |
| 5 | **Đơn node (Single-host)** | 1 process backend + SQLite WAL trên local volume | Chưa hỗ trợ scale ngang đa node (cần PG/ClickHouse nếu scale) |

## D. Việc của Operator trước khi Go-Live

- [ ] Điền `TERMS.md`, `PRIVACY.md`, `docs/DEPLOY.md` (thực thể pháp lý, liên hệ).
- [ ] Cấu hình secrets sản xuất: `DATABENTO_API_KEY`, `STRIPE_*`, `ADMIN_*`, `METRICS_TOKEN`, `AUTH_JWT_SECRET`.
- [ ] Đặt `DOMAIN` thành domain production và `PROXY_BIND_IP=0.0.0.0` nếu muốn mở public.
- [ ] Kiểm tra sao lưu tự động định kỳ với `pnpm db:backup` / cronjob WAL-safe.
