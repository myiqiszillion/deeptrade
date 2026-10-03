# Trạng thái hoàn thiện (đọc cái này để biết còn thiếu gì)

> Mục đích: thay cảm giác "hình như còn thiếu gì đó" bằng **danh sách cụ thể**, kèm cách tự kiểm tra.
> Cập nhật: 2026-09-30. Mọi mục dưới đây đều nói rõ **ai làm** (code hay bạn).

## A. Hoàn thiện — dùng được ngay

| Hạng mục | Bằng chứng tự kiểm tra |
|---|---|
| Auth thật (scrypt, khoá brute-force, thu hồi token, admin bootstrap) | `pnpm test:unit` → passwords/loginGuard; `pnpm test:integration` → authFlow |
| Gói & quyền (free/pro/elite, entitlement do server cấp) | `GET /api/v1/auth/config`, `POST /api/v1/admin/users/:id/plan` |
| Thanh toán Stripe (Checkout + webhook có xác thực chữ ký) | `pnpm test:unit` → billing; `GET /api/v1/billing/plans` |
| Bảo vệ chi phí vendor (giới hạn tần suất kéo dữ liệu) | `MAX_VENDOR_FETCHES_PER_HOUR`, `GET /api/v1/admin/metrics` |
| 43 mã CME Group + thêm mã bất kỳ (env) | `pnpm test:unit` → instruments |
| API instruments trả trạng thái feed **trung thực** (IDLE/NO VENDOR…) | `pnpm test:integration` → historyApi (mục 4b) |
| History/aggregation/replay/rate limit/CORS/CSP/metrics/maintenance | `pnpm test`, `pnpm verify:p0` (13 case) |
| UI: palette Ctrl+K, phím tắt, tool rail, legend, watchlist, dock kéo-thả, code-split | `pnpm test:client` (29 marker), `pnpm build` |
| Deploy: Docker, compose + Caddy TLS, backup, CI | `docker compose up -d --build`, `pnpm db:backup`, `.github/workflows/ci.yml` |

## B. Đã code xong nhưng **phải do bạn bật/cấp** (không phải lỗi)

| Hạng mục | Cần gì | Kiểm tra |
|---|---|---|
| Dữ liệu realtime & Full Suite | `DATABENTO_API_KEY` (Databento) hoặc Binance cho crypto | `/healthz` (admin) → `feedStatus`, tab `Options`, `Flow`, `Darkpool`, `GEX` |
| Bán được hàng | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO/ELITE`, `STRIPE_WEBHOOK_SECRET` | `GET /api/v1/auth/config` → `billingConfigured` |
| Giá cho watchlist | `ENABLE_QUOTE_BOARD=1` (dữ liệu vendor, mặc định tắt) | `GET /api/v1/quotes?symbols=ES` → `enabled:true` |
| Pháp lý (TERMS/PRIVACY/DEPLOY) | Điền `<LEGAL ENTITY>`, email, quốc gia; hoàn tất điều khoản vendor | `grep -r "<LEGAL ENTITY>" TERMS.md PRIVACY.md docs/DEPLOY.md` |

## C. Dở dang — có code/nút nhưng **thiếu phần cuối**

| # | Hạng mục | Thiếu chính xác cái gì | Ghi chú |
|---|---|---|---|
| 1 | **Databento Phase 1 Suite** | Cần cấp `DATABENTO_API_KEY` trong `.env` để kích hoạt toàn bộ realtime CME Futures, OPRA Options, Equities | Đang triển khai Phase 1: normalization, historical, live WebSocket, TimescaleDB, Redis |
| 2 | **Watchlist** | Cột giá chỉ có mã đang xem cho tới khi bạn bật `ENABLE_QUOTE_BOARD=1` | Có cache TTL + tuổi dữ liệu + nút ⏸ |
| 3 | **Ngôn ngữ UI** | Đang **trộn Việt–Anh** (header/legend tiếng Anh, watchlist/auth tiếng Việt) ⇒ dễ tạo cảm giác "chưa xong" | Cần bạn chọn: chuẩn hoá tiếng Việt, chuẩn hoá tiếng Anh, hay i18n có switch |
| 4 | **`pnpm verify` (verify_e2e.ts)** | Là harness dev cũ: cần server đang chạy + feed thật, không hermetic | Đừng dùng làm test; cổng phát hành là `pnpm test` |
| 5 | **`scratch/*.ts`** | Đã dọn dẹp các script kiểm tra thừa | Giữ codebase gọn gàng, chuẩn production |
| 6 | **GEX / Profile / DOM / Tape** | Hoạt động với dữ liệu thật nhưng **chưa có test UI** (chỉ test logic server) | Muốn chắc: cần E2E browser (mục D2) |
| 7 | **Trạng thái "delayed"** | Chỉ hiển thị realtime/unavailable; chưa phân biệt độ trễ của dataset | Cần metadata `condition` của vendor |

## D. Chưa bắt đầu (có kế hoạch, cần quyết định trước khi làm)

| # | Hạng mục | Vì sao chưa làm | Ước lượng |
|---|---|---|---|
| 1 | **Chia 2–4 chart pane** (kiểu TradingView) | Phải refactor state client theo pane + mỗi pane một feed (**mỗi mã là một khoản phí vendor**) | Lớn |
| 2 | **E2E browser (Playwright)** cho luồng palette/đăng nhập/panel | Hiện chỉ có bundle smoke test (`pnpm test:client`) | Vừa |
| 3 | **Công cụ vẽ** (trendline/fib/measure) | Cần lớp annotation khớp đúng scale giá↔pixel của canvas (làm ẩu sẽ lệch trục giá) | Lớn |
| 4 | **Alert** | Cần kênh thông báo + lưu luật + nên làm sau multi-subscription | Vừa |
| 5 | **i18n** | Phụ thuộc lựa chọn ở C3 | Vừa |
| 6 | **Đa node / scale ngang** | SQLite + context trong 1 process; cần Postgres/ClickHouse + sticky session | Rất lớn |

## E. Việc của bạn (checklist ngắn)

- [ ] Điền `TERMS.md`, `PRIVACY.md`, `docs/DEPLOY.md` (thực thể pháp lý, liên hệ).
- [ ] Điền key: `DATABENTO_API_KEY`, `STRIPE_*`, `ADMIN_*`, `METRICS_TOKEN`, `AUTH_JWT_SECRET`.
- [ ] Quyết định: bật `ENABLE_QUOTE_BOARD`? chọn ngôn ngữ UI?
- [ ] Chọn mục D nào làm tiếp (tôi cần bạn chọn thứ tự vì chúng đổi kiến trúc).

