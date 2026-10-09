# Trạng thái hoàn thiện (đọc cái này để biết còn thiếu gì)

> Mục đích: thay cảm giác "hình như còn thiếu gì đó" bằng **danh sách cụ thể**, kèm cách tự kiểm tra.
> Cập nhật: 2026-10-09. Mọi mục dưới đây đều nói rõ **ai làm** (code hay bạn).
> Frontend client (`client/`) đã được khôi phục và tích hợp vào pnpm monorepo workspace (Vite 5 + React 19 + TypeScript + Tailwind CSS), hỗ trợ typecheck và build độc lập hoặc toàn bộ repo.

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
| 1 | **Databento Phase 1 Suite** | Cần cấp `DATABENTO_API_KEY` trong `.env` để kích hoạt toàn bộ realtime CME Futures, OPRA Options, Equities | Đang hoạt động chuẩn Zero-Mock / Fail-Closed |
| 2 | **Watchlist** | Cột giá chỉ có mã đang xem cho tới khi bạn bật `ENABLE_QUOTE_BOARD=1` | Có cache TTL + tuổi dữ liệu + nút ⏸ |
| 3 | **`pnpm verify` (verify_e2e.ts)** | Là harness dev cũ: cần server đang chạy + feed thật, không hermetic | Đừng dùng làm test; cổng phát hành là `pnpm test` |
| 4 | **E2E Browser Test Suite (Playwright)** | **HOÀN THÀNH**: Đã tích hợp Playwright 1.64.0 với 15/15 test cases pass (`terminal.spec.ts` + `behavioral.spec.ts`) | Chạy qua `pnpm test:e2e` |
| 5 | **Range Volume Profile & Footprint Engine** | **HOÀN THÀNH**: Fixed Range VP tương tác kéo thả trên Canvas, 3 chế độ Footprint (Bid×Ask, Delta, Volume), Unfinished Auction, POC/VAH/VAL | Không suy diễn OHLCV giả, truy vấn trade-level SQLite hoặc Databento |
| 6 | **Liquidity Heatmap MBP-10 & Feed Observability** | **HOÀN THÀNH**: Widget Heatmap tương tác (Time × Price, Bid/Ask intensity, Walls highlight), giám sát Feed Health (stale threshold >15s, reconnect count, last message/trade ts) | Phân biệt rõ connected vs subscribed vs active vs stale |

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

