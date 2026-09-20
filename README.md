# DeepChart — Prop Firm Edition: US Futures, Options Flow & GEX Terminal

**DeepChart Prop Firm Edition** là nền tảng Web Terminal phân tích Orderflow, Footprint, DOM Scalping, Options Flow và Gamma Exposure (GEX) chuyên biệt cho giao dịch **Quỹ cấp vốn (Prop Firm: Topstep, Apex Trader Funding, MyFundedFutures, Bulenox, FTMO)**.

> **Đọc kỹ trước khi dùng:** Toàn bộ *engine* orderflow (Footprint, Volume Profile/TPO, DOM, CVD, VWAP, absorption, Speed of Tape) được tính **thật 100% từ dòng tick** — không vẽ lại từ nến 1m. Tuy nhiên **nguồn dữ liệu** hiện tại như sau:

| Kênh dữ liệu | Nguồn | Ghi chú |
|---|---|---|
| Futures CME (ES, NQ, YM, RTY, GC, CL, NG) | ✅ **THẬT** khi cắm vendor — đặt `FUTURES_PROVIDER=tradovate` | Tradovate REST auth + `md/subscribequote` (prints, best bid/offer) + `md/subscribedom` (full ladder). **Chưa cắm vendor ⇒ `FEED: UNAVAILABLE`, tuyệt đối không mô phỏng.** Databento đã khai báo nhưng từ chối đoán wire format DBN |
| Crypto `BTCUSDT` | ✅ **LIVE** | Binance Futures `aggTrade` + `depth20`, có auto-reconnect |
| Gamma Exposure (GEX) | ✅ **THẬT (delayed)** | Tính từ chain quyền chọn **CBOE delayed** miễn phí (gamma + open interest thật, trễ ~15 phút). UI gắn badge `CBOE DELAYED`; tự fallback về mô hình mô phỏng nếu không lấy được chain |
| Options Flow (Sweep/Block) | ⚠️ **SIMULATED** | Sinh mỗi 12s; UI gắn badge `SIMULATED` |
| Prop-firm risk | ✅ Tính thật từ lệnh khớp trong app | Chưa nối broker/API quỹ thật |
| Trade Copier | ⚠️ Mô phỏng | 3 slave ảo, latency giả lập 10–35ms |

---

## 🌟 Các Tính Năng Dành Riêng Cho Trader Quỹ

### 1. Bộ Hợp Đồng Tương Lai Mỹ (US Futures CME/NYMEX/COMEX)
Hỗ trợ đầy đủ bảng thông số chuẩn (Tick size, Point value, Tick value, Micro contracts):
- **Chỉ số Mỹ**:
  - **ES** (E-mini S&P 500): 0.25 tick = $12.50 (MES = $1.25)
  - **NQ** (E-mini Nasdaq 100): 0.25 tick = $5.00 (MNQ = $0.50)
  - **YM** (E-mini Dow Jones): 1.00 tick = $5.00 (MYM = $0.50)
  - **RTY** (E-mini Russell 2000): 0.10 tick = $5.00 (M2K = $0.50)
- **Hàng hóa & Năng lượng**:
  - **GC** (Vàng - Gold Futures): 0.10 tick = $10.00 (MGC = $1.00)
  - **CL** (Dầu thô - Crude Oil): 0.01 tick = $10.00 (MCL = $1.00)
  - **NG** (Khí tự nhiên): 0.001 tick = $10.00
- **Crypto Futures**: BTCUSDT (Binance Futures Live).

### 2. Options Flow & Gamma Exposure (GEX)
- **Bản đồ Dealer Gamma Exposure (GEX)**:
  - Tính toán Net GEX theo từng Strike cho **SPX, SPY, NDX, QQQ**.
  - **Call Wall**: Strike có Call Gamma lớn nhất $\rightarrow$ Vùng cản trần (Major Resistance).
  - **Put Wall**: Strike có Put Gamma âm lớn nhất $\rightarrow$ Vùng đỡ sàn (Major Support).
  - **Zero Gamma Flip Point**: Điểm đảo trạng thái biến động.
  - Phân tách riêng **0DTE GEX** (Dòng tiền quyền chọn hết hạn trong ngày).
  - Hiển thị trực tiếp các mức Call Wall, Put Wall, Zero Gamma lên biểu đồ Footprint.
- **Options Flow Whale Scanner**:
  - Quét tự động các lệnh càn (Sweeps) và lệnh khối (Blocks) giá trị $> \$100,000$.
  - Phân loại trực quan: Bullish Sweeps vs Bearish Sweeps.

### 3. Bộ Giáp Quản Trị Rủi Ro Quỹ (Prop Firm Safeguards HUD)
- **Trailing Drawdown Tracker**:
  - Chuyển đổi linh hoạt giữa 2 chế độ:
    - **Intraday Peak Trailing (Apex / Bulenox)**: Trailing theo đỉnh lợi nhuận chưa chốt trong phiên.
    - **End-of-Day Trailing (Topstep / MyFundedFutures)**: Trailing chốt theo số dư cuối phiên.
  - Cảnh báo khoảng cách tới ngưỡng vi phạm (Buffer remaining).
- **Daily Loss Limit (DLL) Hard Stop**:
  - Tự động đóng toàn bộ vị thế (**Auto-Flatten**) và khóa nút đặt lệnh (**Lockout**) khi chạm mức lỗ tối đa trong ngày.
- **Contract Size Enforcer**: Chặn đặt lệnh nếu vượt quá số hợp đồng tối đa cho phép (ví dụ: tối đa 5 Minis hoặc 50 Micros).
- **Consistency Rule (30% / 40%)**: Theo dõi tỷ lệ lợi nhuận ngày cao nhất so với tổng lợi nhuận, đảm bảo điều kiện nhận Payout.
- **Profit Target Progress Bar**: Thanh tiến độ đạt mục tiêu lợi nhuận giai đoạn thi (Challenge Phase 1 / Phase 2).

### 4. Real Footprint, DOM Scalping & Delta Suite
- **Real Footprint (Bid x Ask Clusters)**: Khối lượng mua/bán chủ động thực tế, không fake từ nến 1m.
- **Diagonal Imbalance Tracker (300%)**: Tự động phát hiện mất cân đối chéo, Stacked Imbalances $\ge 3$ mức giá.
- **Advanced DOM Ladder**: Sổ lệnh L2 với **Pulling & Stacking** ($+$ nạp thêm, $-$ hủy lệnh), đặt lệnh 1-Click (`[A]`, `[S]`, `[D]`, `[W]`).
- **Every Flavour of Delta**: Bar Delta, Min/Max Delta, Cumulative Volume Delta (CVD) soi phân kỳ.
- **Real Volume Profile & Market Profile (TPO)**: POC, VAH, VAL (70% Volume Area), Initial Balance (IB: 1h đầu phiên).
- **Speed of Tape & Absorption**: Đo tốc độ khớp lệnh (TPS), phát hiện cá mập hấp thụ (Limit Absorption / Iceberg).
- **Multi-Account Trade Copier**: Copy lệnh tức thì sang các tài khoản phụ với hệ số rủi ro tùy chỉnh.
- **Automated Journal**: Nhật ký giao dịch tự động thống kê PnL, MAE, MFE.

---

## 🚀 Hướng Dẫn Khởi Chạy

Cài dependencies (đã cấu hình pnpm workspace):
```bash
pnpm install
```

Khởi chạy cả Server và Client:
```bash
pnpm dev
```
- **Frontend Web Terminal**: http://localhost:5173
- **Backend WebSocket Server**: `ws://localhost:8080`

### Scripts
| Lệnh | Tác dụng |
|---|---|
| `pnpm dev` | Chạy song song server (`tsx watch`) + client (`vite`) |
| `pnpm build` | Build server (`tsc` → `dist/`) và client (`vite build`) |
| `pnpm typecheck` | `tsc --noEmit` cho cả hai package |
| `pnpm lint` | `oxlint` cho client (đang ở mức 0 warning) |
| `pnpm verify` | Smoke test E2E protocol (cần server đang chạy ở `:8080`) |
| `pnpm verify:p0` | **Bộ 13 test P0 tự dựng server riêng ở `:8089`** (replay, lệnh chờ, huỷ lệnh, cap, notional, STEP/SET_SPEED, breach/reset) |
| `pnpm verify:feed` | Test tầng market-data (validator, fail-closed, vendor refusal) |
| `pnpm verify:tradovate` | Test offline adapter và chart history Tradovate: protocol, tick/DOM, OHLC, timeout/hủy yêu cầu, dữ liệu sai, fail-closed |
| `pnpm verify:chart-smoke` | Sau `pnpm build`: boot bản build và kiểm tra HTTP/WS, đổi mã/khung, history rỗng khi thiếu credential |
| `pnpm verify:lifecycle` | 24 test vòng đời feed (chuyển symbol, chống dữ liệu cũ lọt vào phiên mới) |
| `pnpm verify:types` | Chống drift giao thức WebSocket giữa server và client |

Cấu hình qua biến môi trường (xem `.env.example`): `PORT`, `HOST` (mặc định `127.0.0.1` — chỉ mở ra LAN khi bạn đặt `0.0.0.0` và hiểu rằng **hiện chưa có auth**), `VITE_WS_URL`, `DEMO` (seed dữ liệu mẫu), `DEV_HOOKS` (cho phép `SET_PROP_CONFIG` khi test), `TEST_PORT`.

Dữ liệu futures (server-side, không bao giờ lộ ra log/browser): `FUTURES_PROVIDER=none|tradovate|databento`, `TRADOVATE_ENV=demo|live`, `TRADOVATE_USERNAME`, `TRADOVATE_PASSWORD`, `TRADOVATE_APP_ID`, `TRADOVATE_APP_VERSION`, `TRADOVATE_CID`, `TRADOVATE_SEC`, `TRADOVATE_SYMBOL` (ghim tháng cụ thể, ví dụ `ESZ6`), `TRADOVATE_USE_MICRO=1` (stream MES/MNQ/M2K/MGC/MCL).

> **Lưu ý về `side` của Tradovate:** vendor **không** phát cờ aggressor. DeepChart **không đoán 50/50**: side được suy ra bằng quote rule (Lee–Ready) từ chính `Bid`/`Offer` của vendor, fallback sang tick rule; nếu vẫn không xác định được thì **in ra bị loại bỏ** và số lượng được ghi rõ trong lý do trạng thái (`N print(s) dropped: aggressor undecidable`).

### Dữ liệu chart futures
- Chọn khung **1m hoặc 5m**: server yêu cầu tối đa **300 nến OHLC thật** qua Tradovate `md/getchart`, trước thời điểm bắt đầu phiên live. Số nến thực nhận tùy quyền dữ liệu và phản hồi vendor.
- Nến lịch sử được vẽ riêng, không có ô footprint. Không tái tạo tick, POC, CVD, VWAP hoặc volume profile từ OHLC; các chỉ số orderflow chỉ dùng tick thu được.
- Khung **1s/5s/15s** hiện tích lũy tick live, chưa có backfill futures theo giây.
- Đổi mã/khung sẽ hủy yêu cầu history cũ; response sai subscription không được nhập vào chart. Thiếu quyền, throttle hoặc lỗi kết nối có thể để history trống; không sinh dữ liệu thay thế.
- Badge **HISTORY: REAL BARS** cho biết có nến lịch sử; không đồng nghĩa **FEED: REALTIME**. Khi mất live, chart vẫn xem được history nhưng lệnh bị chặn theo trạng thái feed.
- Cần tài khoản có API access và quyền market data Tradovate. Chỉ thêm code hoặc đặt `FUTURES_PROVIDER=tradovate` không cấp quyền dữ liệu. Chưa xác nhận đường dữ liệu với tài khoản vendor thật; test tự động dùng socket giả lập.

Server đọc **biến môi trường của process**, không tự nạp file `.env`. Với Node hỗ trợ `--env-file`, sau khi điền file `.env` ở thư mục gốc:
```powershell
pnpm build
node --env-file=.env server/dist/index.js
```
Chạy lệnh trong thư mục gốc dự án. Không commit `.env` hoặc chia sẻ credential; không phân phối lại dữ liệu licensed nếu chưa được vendor cho phép.

### Giao thức WebSocket (tóm tắt)
- **Client → Server**: `SUBSCRIBE` (symbol + timeframe), `DOM_ORDER` (MARKET/LIMIT/CANCEL/FLATTEN, kèm `orderId` khi huỷ từng lệnh), `REPLAY_CONTROL` (START/PAUSE/SEEK/SET_SPEED/STEP), `UPDATE_COPIER`, `SET_PROP_TRAILING_MODE`, `RESET_PROP_ACCOUNT`, `SET_PROP_CONFIG` (chỉ khi `DEV_HOOKS=1`).
- **Server → Client**: `INIT_STATE` (gửi lại mỗi khi đổi symbol/timeframe), `TICK`, `BAR_UPDATE`, `BAR_CLOSE`, `ORDERBOOK_UPDATE`, `SPEED_OF_TAPE`, `DEEP_TRADE`, `ABSORPTION`, `OPEN_ORDERS`, `ORDER_ACK`, `ORDER_REJECT`, `JOURNAL_UPDATE`, `TRADE_COPIED`, `GEX_UPDATE`, `OPTIONS_FLOW`, `PROP_STATE_UPDATE`, `PROP_BREACH_ALERT`, `REPLAY_STATE`.
- Băng thông được throttle: `ORDERBOOK_UPDATE`/`BAR_UPDATE` 100ms, `SPEED_OF_TAPE`/`PROP_STATE_UPDATE` 250ms, tick phía client được buffer 120ms trước khi render.

### 🌍 Chạy public / free cho mọi người

Thiết kế để tự host miễn phí (Render, Fly.io, Railway, VPS nhỏ, Docker…):

| Đặc điểm | Chi tiết |
|---|---|
| **1 port duy nhất** | Server serve luôn client build (`client/dist`) và WebSocket trên cùng cổng ⇒ chỉ cần expose `8080` |
| **Tài khoản riêng cho mỗi người** | Mỗi kết nối có `TradingSession` riêng (journal, prop-risk, lệnh chờ, copier). Dữ liệu thị trường thì chia sẻ chung ⇒ không ai thấy lệnh của ai |
| **Chống lạm dụng** | `MAX_SESSIONS` (mặc định 500), `MAX_MESSAGES_PER_SEC` (40/giây/client), `MAX_PAYLOAD_BYTES` (64 KB/frame), validate payload runtime (size/price/symbol) |
| **Health check** | `GET /healthz` → `{status, uptimeSec, sessions, symbol, feed, gexSource}` |
| **Không cần cấu hình** | Client production tự trỏ WebSocket về `window.location.host` — deploy ở đâu cũng chạy |

**Cách chạy nhanh (1 port):**
```bash
pnpm install
pnpm build                 # build server (tsc) + client (vite)
HOST=0.0.0.0 node server/dist/index.js
# → http://<host>:8080          (web terminal)
# → http://<host>:8080/healthz  (health)
```

**Docker:**
```bash
docker build -t deepchart .
docker run -p 8080:8080 deepchart
```

**Ví dụ Render/Fly:** build command `pnpm install && pnpm build`, start command `node server/dist/index.js`, env `HOST=0.0.0.0`, health check path `/healthz`.

> ⚠️ **Chưa có authentication.** Mặc định server bind `127.0.0.1`. Nếu mở `HOST=0.0.0.0` cho công chúng, hãy đặt sau reverse proxy có rate-limit/TLS (Cloudflare, Caddy, nginx) — hoặc thêm lớp auth trước khi phát hành rộng rãi.

### ⚖️ Miễn trừ trách nhiệm
- DeepChart là công cụ **giáo dục/nghiên cứu**, **không phải lời khuyên đầu tư**.
- Mọi lệnh trong app là **mô phỏng nội bộ** (không gửi tới broker/sàn thật).
- Dữ liệu crypto (Binance) là thời gian thực; **dữ liệu quyền chọn CBOE là delayed ~15 phút**; futures cần feed có license, mặc định **UNAVAILABLE** (không mô phỏng).
- Tôn trọng điều khoản của nhà cung cấp dữ liệu khi triển khai công khai.

### Roadmap dữ liệu thật
1. Hoàn thiện các vendor còn lại qua `MarketDataFeed`; Tradovate đã có quote/DOM và nến lịch sử. Không fallback sang simulator khi thiếu key.
2. GEX/Options Flow: nối CBOE OI / ORATS / dxFeed / Tradier rồi đổi `dataSource` sang `'LIVE'` (UI tự bỏ badge `SIMULATED`).
3. Trade Copier: thay engine mô phỏng bằng API broker thật (cần auth + quản lý rủi ro theo account).
