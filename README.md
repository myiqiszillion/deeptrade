# DeepChart Free — Order Flow Charts

**DeepChart Free** là công cụ xem và phân tích biểu đồ **Order Flow & Market Microstructure miễn phí**, chuyên biệt cho phân tích dòng tiền và hành vi khớp lệnh tổ chức (Footprint Bid × Ask, Candlesticks with Delta, CVD, POC, Imbalances, Volume Profile, TPO Market Profile, VWAP Bands, View-Only DOM Ladder, Time & Sales, Speed of Tape, và Market Replay).

> **Nguyên tắc cốt lõi:**
> **Dữ liệu đúng → Tính toán đúng → Cập nhật ổn định → Thao tác thuận tiện → Hoàn toàn Chart-Only.**
> Toàn bộ engine order flow được tính toán thật từ dòng tick. Hệ thống tuân thủ nghiêm ngặt nguyên tắc **Fail-Closed**: không bao giờ sinh dữ liệu giả, nến giả hoặc book giả đối với các thị trường thiếu feed (`FEED: UNAVAILABLE`).

---

## 📊 Tính Năng Chính (Free v1)

### 1. Biểu đồ Footprint & Candlestick Chuyên Sâu
- **Footprint Bid × Ask Clusters**: Khối lượng mua/bán chủ động theo từng mức giá (delta và volume cell).
- **Chế độ hiển thị linh hoạt**:
  - `Footprint`: Xem chi tiết từng cụm giá bid/ask và imbalance.
  - `Candles`: Nến chuẩn kết hợp thanh delta và POC cho cái nhìn tổng quan.
- **Diagonal & Stacked Imbalance**:
  - Tự động phát hiện mất cân đối chéo theo tỷ lệ (mặc định 300%).
  - Đánh dấu **Stacked Imbalances** ($\ge 3$ mức giá liên tiếp).
- **Point of Control (POC)**: Đánh dấu viền vàng mức giá tập trung thanh khoản lớn nhất trong nến.
- **Unfinished Auction**: Phát hiện và đánh dấu các phiên đấu giá chưa hoàn tất ở đỉnh/đáy nến.
- **Delta Suite**: Bar Delta, Min/Max Delta, và Cumulative Volume Delta (CVD) đồng bộ crosshair với biểu đồ chính.

### 2. Volume Profile, TPO & VWAP
- **Volume Profile (VP)**: VAH (Value Area High), VAL (Value Area Low), POC theo vùng giá trị 70%.
- **Market Profile (TPO)**: Phân bố thời gian-giá theo ký tự bảng chữ cái và Initial Balance (IB).
- **Session VWAP & Standard Deviation Bands**: Đường VWAP chuẩn và các dải độ lệch chuẩn $\pm 1\sigma, \pm 2\sigma$.
- **Cập nhật Live**: Profile và VWAP cập nhật theo chu kỳ mà không cần tải lại trang.

### 3. DOM Quan Sát (View-Only), Tape & Whale Tracker
- **DOMLadder (View-Only)**: Bảng quan sát sổ lệnh L2 với độ sâu và Pulling & Stacking (P&S: nạp thêm/rút lệnh). Không hỗ trợ đặt lệnh, an toàn tuyệt đối.
- **Speed of Tape (Time & Sales)**:
  - Tốc độ khớp lệnh thực tế (TPS - Ticks Per Second) kèm gia tốc $\blacktriangle / \blacktriangledown$.
  - Tỷ lệ lực mua/bán (Buy/Sell Pressure Ratio).
  - Time & Sales stream với độ chính xác đến mili-giây.
- **Whale & Absorption Tracker**: Tự động phát hiện các lệnh lớn (Deep Trades) và hiện tượng hấp thụ (Buy/Sell Absorption).

### 4. Lịch Sử & Market Replay Độc Lập
- **Phân tách rành mạch giữa History và Live**:
  - Real Historical Bars: Hiển thị nến lịch sử trước phiên live; không tạo footprint giả khi nguồn chỉ có nến OHLC.
  - Real Ticks: Xây dựng footprint đầy đủ khi có dữ liệu tick.
- **Isolated Market Replay Engine**:
  - Chạy trên context riêng biệt, không làm sai lệch hay sửa đổi dữ liệu live của các tab khác.
  - Hỗ trợ Play, Pause, Step forward, Seek theo index hoặc Seek theo mốc thời gian (epoch timestamp).
  - Tự động chặn việc ghi đè tick replay vào buffer live.

### 5. Giao Diện & Trải Nghiệm Người Dùng (UX)
- **Đồng bộ Crosshair & Viewport**: Di chuyển chuột trên biểu đồ chính hoặc CVD Panel đều hiển thị đường ngắm đồng bộ.
- **Định dạng giá chuẩn theo từng Instrument**: ES (0.25), NQ (0.25), YM (1.0), CL (0.01), NG (0.001), GC (0.10). Không còn lỗi cắt cụt số thập phân.
- **Lưu cài đặt tự động trên trình duyệt (`localStorage`)**: Ghi nhớ mã giao dịch, timeframe, chế độ chart, và trạng thái bật/tắt các panel.

---

## 🌐 Nguồn Dữ Liệu & Bảng Khả Năng (Capability Matrix)

| Instrument | Provider | History | Realtime | Footprint | DOM |
|---|---|---|---|---|---|
| **ES/MES/NQ/MNQ (Default)** | none | none | unavailable | unavailable | unavailable |
| **Futures & Options** | Databento | historical trades & bars | live feed (WebSocket) | tick footprint | orderflow & quotes |
| **Crypto (BTC/ETH)** | Binance | klines | live trades | tick footprint | 20-level DOM |

> **Chính sách Fail-Closed:** Khi chưa có license/credential cho nhà cung cấp futures (`DATABENTO_API_KEY`), toàn bộ feed và lịch sử mặc định là `UNAVAILABLE`. Hệ thống tuyệt đối không sinh dữ liệu giả hay nến giả.

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

### Yêu cầu môi trường
- **Node.js >= 22.5** (bắt buộc cho `node:sqlite` DatabaseSync built-in)
- **pnpm >= 9**

### Cài đặt dependencies
```bash
pnpm install
```

### Biến môi trường & Bảo mật (Security)
- `AUTH_REQUIRED=1`: Bắt buộc kích hoạt trong production để bảo vệ dữ liệu và endpoint.
- `AUTH_JWT_SECRET`: Khóa ký JWT tối thiểu 32 ký tự. **Bắt buộc** khi `NODE_ENV=production` **hoặc** `AUTH_REQUIRED=1` — server fail-fast và dừng ngay nếu thiếu/yếu.
- `DEV_HOOKS=1`: Chỉ được phép bật khi chưa bật authentication; server từ chối khởi động nếu `AUTH_REQUIRED=1` + `DEV_HOOKS=1`.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: tài khoản vận hành được tạo/cập nhật mỗi lần khởi động (role `admin`, gói `elite`).
- `ADMIN_SECRET`: bảo vệ toàn bộ `/api/v1/admin/*` và dùng để mint token admin qua `POST /api/v1/auth/login`.
- `METRICS_TOKEN`: token bảo vệ `/metrics` (ở production, không có token ⇒ 401).
- `STRIPE_*`: bật bán gói tự động (Checkout + webhook có xác thực chữ ký).
- `STORE_RETENTION_DAYS` (mặc định 30): vòng đời dữ liệu tick/bar/gap — đặt `0` để giữ mãi (đĩa sẽ đầy).
- `STORE_BARS_RETENTION_DAYS` (mặc định = `STORE_RETENTION_DAYS`, Docker image đặt 365): vòng đời riêng cho nến — nến rất nhỏ nhưng tốn thời gian tải lại, nên giữ lâu hơn tick.
- `HISTORY_BARS_TARGET` (mặc định 1500, kẹp 100–5000): độ sâu lịch sử xin từ vendor mỗi khung thời gian khi client subscribe.
- `DATABENTO_API_KEY`: API key cho Databento để lấy lịch sử nến, trades, options chain và streaming realtime.
- `EXTRA_INSTRUMENTS`: 43 mã CME Group (CME/CBOT/NYMEX/COMEX) đã có sẵn; muốn thêm mã bất kỳ thì khai spec — không cần sửa code.
- CORS/WebSocket chỉ echo origin được tin cậy; `ALLOWED_ORIGINS` là allowlist chính thức, mặc định chỉ same-host + localhost.

### Tài khoản, gói & thanh toán
- `POST /api/v1/auth/register` tạo tài khoản (mật khẩu hash scrypt, tối thiểu 10 ký tự) và cấp gói `free`.
- `POST /api/v1/auth/login` xác thực bằng mật khẩu; có khoá tạm theo tài khoản **và** theo IP (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_SECONDS`).
- Client **không bao giờ** tự khai `userId`/`role` — id suy ra từ username ở server, role chỉ do server quyết định.
- Gói & quyền nằm trong `server/src/billing/plans.ts`; cấp gói thủ công qua API admin, hoặc tự động qua Stripe.
- WebSocket nhận token qua subprotocol `deepchart-token` (không đặt token trong query string).

### Chạy môi trường phát triển (Development)
```bash
pnpm dev
```
- **Web Terminal**: http://localhost:5173
- **WebSocket Server**: `ws://localhost:8080`

### Đóng gói & Chạy bản Production (1 Port duy nhất)
Server Node.js được thiết kế để phục vụ cả WebSocket, REST API và client build tĩnh trên cùng một cổng (`8080`):
```bash
pnpm build
node server/dist/index.js
```
- **Truy cập Terminal**: http://localhost:8080
- **Health check API**: http://localhost:8080/healthz
- **Metrics API**: http://localhost:8080/metrics

---

## 🧪 Bộ Kiểm Thử (Unified Test Suites)

DeepChart có hệ thống test phân tầng rõ ràng (Unit, Integration, Protocol) để bảo vệ tính toàn vẹn:

| Lệnh kiểm thử | Mục đích |
|---|---|
| `pnpm typecheck` | Kiểm tra TypeScript cho cả server và client (0 lỗi) |
| `pnpm test` | Chạy toàn bộ test suite: protocol drift, unit, integration và **client bundle smoke test** |
| `pnpm test:unit` | Unit: auth/entitlement/store/sessionCalendar/footprint/replay/validate/**passwords**/**loginGuard (lockout, rate limit)**/**billing (plans, entitlements, chữ ký Stripe)**/**retention (purge, WAL, stats)**/**instruments (43 mã CME)** |
| `pnpm test:integration` | Integration: chartSmoke, historyApi, websocket, **authFlow (đăng ký → lockout → mạo danh bị chặn → admin cấp gói → webhook → WS bằng token)** |
| `pnpm test:protocol` | Chống protocol drift giữa server và client WebSocket messages (`scripts/check-protocol-drift.mjs`) |
| `pnpm test:client` | Kiểm tra bundle đã build: có đủ surface của sản phẩm (palette, favourites, empty-state actions, phím tắt, design tokens) và **đã code-split**, entry chunk < 480 KB (`scripts/check-client-bundle.mjs`) |
| `pnpm verify:p0` | 13 test kiểm tra tính toàn vẹn server và rate limiting (harness dev, cần DB local có tick) |

### Giao diện & thao tác (UI/UX — phong cách TradingView)
- **Thanh công cụ dọc bên trái (tool rail)**: tìm mã, auto-fit/manual, zoom ±, reset view, watchlist, chuyển dock trái/phải, replay, diagnostics, **lưu ảnh chart (PNG)** và **fullscreen** — chỉ hiện hành động app thật sự làm được.
- **Legend nổi trên chart (góc trên-trái)**: `SYMBOL · timeframe · Footprint · sàn`, **O/H/L/C + Volume + %thay đổi** của nến cuối, cùng các **chip bật/tắt nhanh** VWAP · CVD · Imbalance · Delta (bấm là đổi ngay, không phải mở menu).
- **Watchlist bên phải**: lọc mã, gắn sao, bấm để chuyển mã, hiển thị thật trạng thái feed (`live / connecting / idle / no data / no vendor`). Giá: mã đang xem luôn realtime; các mã khác lấy từ **quote board** (opt-in, có cache + hiện *tuổi dữ liệu* `12s`/`stale`) — bật bằng `ENABLE_QUOTE_BOARD=1`, tạm dừng bằng nút ⏸ trong panel. Không bao giờ hiển thị giá giả.
- **Skin tối kiểu TradingView**: nền `#131722`, panel `#1E222D`, vạch `#2A2E39`, chữ `#D1D4DC`, giá lên `#089981` / xuống `#F23645`, bo góc 5–12px (giữ accent cyan làm bản sắc chart).
- **Phím tắt**: **`/` hoặc `Ctrl+K`** mở palette (kiểu tìm mã của TradingView) · `F` footprint↔candles · `V/I/D/C` overlay · `1–5` panel · `P` dock · `R` replay · `S` diagnostics · `?` hướng dẫn.
- **Khung thời gian** đúng bằng tập server phục vụ được: `1s 5s 15s 30s 1m 5m 15m 1h` (palette trước đây có `30m` không được hỗ trợ — đã bỏ).
- **Kéo-thả mượt thật**: vạch chia dùng *pointer capture + requestAnimationFrame* nên panel bám con trỏ (không giật/nhảy), có grip 3 chấm hiện khi hover, khóa chọn chữ toàn trang khi đang kéo; kéo ra ngoài cửa sổ vẫn không mất trạng thái. Dock đổi được trái/phải, CVD kéo được chiều cao.
- **Trạng thái trống có hành động**: khi feed không có dữ liệu, màn hình nói rõ nguyên nhân và cho bấm *Open diagnostics · How to read this chart · Switch instrument*.
- **Hiệu năng**: bundle đã **code-split** (entry ~184 KB, các panel nặng tải lazy) + `prefers-reduced-motion`, focus ring đầy đủ cho bàn phím.



CI (`.github/workflows/ci.yml`) chạy: typecheck → lint → protocol → unit → build → **client bundle check** → integration.

---

## 🚀 Chạy thương mại (Production)

Xem runbook đầy đủ: **[docs/DEPLOY.md](docs/DEPLOY.md)** (TLS, biến môi trường bắt buộc, Stripe,
retention/backup, monitoring, cảnh báo pháp lý về licence phân phối dữ liệu).
**Còn thiếu gì / dở dang chỗ nào: [docs/STATUS.md](docs/STATUS.md)** — bảng hoàn thiện theo từng hạng mục, kèm cách tự kiểm tra.
`scratch/*.ts` là script kiểm tra tay của dev (không thuộc test suite); cổng phát hành là `pnpm test`.

```bash
cp .env.example .env      # điền AUTH_JWT_SECRET, ADMIN_*, provider keys
pnpm install && pnpm build
node --env-file=.env server/dist/index.js
# hoặc: docker compose up -d --build   (app + Caddy HTTPS tự động)
```

| Hạng mục vận hành | Cách dùng |
|---|---|
| Sức khoẻ | `GET /healthz` (công khai, tối giản) — bản chi tiết cần `x-admin-secret` |
| Metrics | `GET /metrics` (Prometheus text) — cần `METRICS_TOKEN` hoặc admin |
| Nhật ký | `LOG_FORMAT=json` → mỗi dòng một JSON object |
| Dọn dữ liệu | `STORE_RETENTION_DAYS`, `STORE_BARS_RETENTION_DAYS` (bars giữ lâu hơn tick), maintenance 15 phút/lần, VACUUM mỗi ngày |
| Sao lưu | `node scripts/backup_db.mjs` (`VACUUM INTO` + `integrity_check`, giữ 7 bản) |
| Cấp gói | `POST /api/v1/admin/users/:id/plan` (admin) hoặc Stripe Checkout + webhook |

---

## 📄 Bản Quyền & Giấy Phép
Mã nguồn phát hành dưới giấy phép MIT (xem `LICENSE`).
Điều khoản sử dụng & quyền riêng tư: `TERMS.md`, `PRIVACY.md` (bản mẫu — điền thông tin pháp lý của bạn).
**Lưu ý:** giấy phép MIT chỉ áp dụng cho mã nguồn, **không** bao gồm dữ liệu thị trường — muốn bán dịch vụ phải có licence phân phối dữ liệu từ vendor/sàn.
