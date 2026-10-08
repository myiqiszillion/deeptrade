# Trạng thái hoàn thiện (đọc cái này để biết còn thiếu gì)

> Mục đích: thay cảm giác "hình như còn thiếu gì đó" bằng **danh sách cụ thể**, kèm cách tự kiểm tra.
> Cập nhật: 2026-10-04. Mọi mục dưới đây đều nói rõ **ai làm** (code hay bạn).
> Lưu ý: repo hiện **chỉ còn backend** — gói web client cũ đã gỡ khỏi repo, nên các mục liên quan
> giao diện (palette, watchlist UI, tool vẽ, i18n) không còn áp dụng ở nhánh này.

## A. Hoàn thiện — dùng được ngay

| Hạng mục | Bằng chứng tự kiểm tra |
|---|---|
| Auth thật (scrypt, khoá brute-force, thu hồi token, admin bootstrap) | `pnpm test:unit` → passwords/loginGuard; `pnpm test:integration` → authFlow |
| Gói & quyền (free/pro/elite, entitlement do server cấp) | `GET /api/v1/auth/config`, `POST /api/v1/admin/users/:id/plan` |
| Thanh toán Stripe (Checkout + webhook có xác thực chữ ký) | `pnpm test:unit` → billing; `GET /api/v1/billing/plans` |
| Bảo vệ chi phí vendor (ngân sách chi tiêu theo tháng) | `DATABENTO_COST_CAP_USD`, `GET /api/v1/monitoring/vendor` |
| 43 mã CME Group + thêm mã bất kỳ (env) | `pnpm test:unit` → instruments |
| API instruments trả trạng thái feed **trung thực** (IDLE/NO VENDOR…) | `pnpm test:integration` → historyApi (mục 4b) |
| History/aggregation/replay/rate limit/CORS/CSP/metrics/maintenance | `pnpm test`, `pnpm verify:p0` (13 case) |
| Deploy: Docker, compose + Caddy TLS, backup, CI | `docker compose up -d --build`, `pnpm db:backup`, `.github/workflows/ci.yml` |

## B. Đã code xong nhưng **phải do bạn bật/cấp** (không phải lỗi)

| Hạng mục | Cần gì | Kiểm tra |
|---|---|---|
| Dữ liệu realtime & Full Suite | `DATABENTO_API_KEY` (Databento) | `/healthz` (admin) → `feedStatus`, tab `Options`, `Flow`, `Darkpool`, `GEX` |
| Bán được hàng | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO/ELITE`, `STRIPE_WEBHOOK_SECRET` | `GET /api/v1/auth/config` → `billingConfigured` |
| Giá cho watchlist | `ENABLE_QUOTE_BOARD=1` (dữ liệu vendor, mặc định tắt) | `GET /api/v1/quotes?symbols=ES` → `enabled:true` |
| Pháp lý (TERMS/PRIVACY/DEPLOY) | Điền `<LEGAL ENTITY>`, email, quốc gia; hoàn tất điều khoản vendor | `grep -r "<LEGAL ENTITY>" TERMS.md PRIVACY.md docs/DEPLOY.md` |

## C. Dở dang — có code/nút nhưng **thiếu phần cuối**

| # | Hạng mục | Thiếu chính xác cái gì | Ghi chú |
|---|---|---|---|
| 1 | **Databento Phase 1 Suite** | Cần cấp `DATABENTO_API_KEY` trong `.env` để kích hoạt toàn bộ realtime CME Futures, OPRA Options, Equities | Đang triển khai Phase 1: normalization, historical, live WebSocket, Redis cache |
| 2 | **Watchlist** | Cột giá chỉ có mã đang xem cho tới khi bạn bật `ENABLE_QUOTE_BOARD=1` | Có cache TTL + tuổi dữ liệu + nút ⏸ |
| 3 | **`pnpm verify` (verify_e2e.ts)** | Là harness dev cũ: cần server đang chạy + feed thật, không hermetic | Đừng dùng làm test; cổng phát hành là `pnpm test` |
| 4 | **GEX / Profile / DOM / Tape** | Hoạt động với dữ liệu thật nhưng **chưa có E2E browser test** (chỉ test logic server) | Muốn chắc: cần Playwright — nhưng trước hết phải dựng lại web client |
| 5 | **Trạng thái "delayed"** | Chỉ hiển thị realtime/unavailable; chưa phân biệt độ trễ của dataset | Cần metadata `condition` của vendor |

## D. Chưa bắt đầu (có kế hoạch, cần quyết định trước khi làm)

| # | Hạng mục | Vì sao chưa làm | Ước lượng |
|---|---|---|---|
| 1 | **Alert** | Cần kênh thông báo + lưu luật + nên làm sau multi-subscription | Vừa |
| 2 | **Đa node / scale ngang** | SQLite + context trong 1 process; cần Postgres/ClickHouse + sticky session | Rất lớn |

## E. Việc của bạn (checklist ngắn)

- [ ] Điền `TERMS.md`, `PRIVACY.md`, `docs/DEPLOY.md` (thực thể pháp lý, liên hệ).
- [ ] Điền key: `DATABENTO_API_KEY`, `STRIPE_*`, `ADMIN_*`, `METRICS_TOKEN`, `AUTH_JWT_SECRET`.
- [ ] Quyết định: bật `ENABLE_QUOTE_BOARD`?
- [ ] Chọn mục D nào làm tiếp (tôi cần bạn chọn thứ tự vì chúng đổi kiến trúc).

