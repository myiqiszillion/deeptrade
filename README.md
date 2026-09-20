# DeepChart — Prop Firm Edition: US Futures, Options Flow & GEX Terminal

**DeepChart Prop Firm Edition** là nền tảng Web Terminal phân tích Orderflow, Footprint, DOM Scalping, Options Flow và Gamma Exposure (GEX) chuyên biệt cho giao dịch **Quỹ cấp vốn (Prop Firm: Topstep, Apex Trader Funding, MyFundedFutures, Bulenox, FTMO)**.

> **Đọc kỹ trước khi dùng:** Toàn bộ *engine* orderflow (Footprint, Volume Profile/TPO, DOM, CVD, VWAP, absorption, Speed of Tape) được tính **thật 100% từ dòng tick** — không vẽ lại từ nến 1m. Tuy nhiên **nguồn dữ liệu** hiện tại như sau:

| Kênh dữ liệu | Nguồn | Ghi chú |
|---|---|---|
| Futures CME (ES, NQ, YM, RTY, GC, CL, NG) | ⚠️ **SIMULATED** (`cmeFuturesFeed.ts`) | Random-walk + depth 30 mức mô phỏng Globex. Cắm Databento/Rithmic/Tradovate/IBKR để thành dữ liệu thật |
| Crypto `BTCUSDT` | ✅ **LIVE** | Binance Futures `aggTrade` + `depth20`, có auto-reconnect |
| Gamma Exposure (GEX) | ⚠️ **SIMULATED** (`gexEngine.ts`) | Mô hình Gaussian + random, refresh mỗi 30s; UI gắn badge `SIMULATED` |
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
| `pnpm verify:p0` | **Bộ 8 test P0 tự dựng server riêng ở `:8089`** (replay, lệnh chờ, huỷ lệnh, cap, notional, STEP/SET_SPEED, breach/reset) |

Cấu hình qua biến môi trường (xem `.env.example`): `PORT`, `VITE_WS_URL`, `DEMO` (seed dữ liệu mẫu), `DEV_HOOKS` (cho phép `SET_PROP_CONFIG` khi test), `TEST_PORT`.

### Giao thức WebSocket (tóm tắt)
- **Client → Server**: `SUBSCRIBE` (symbol + timeframe), `DOM_ORDER` (MARKET/LIMIT/CANCEL/FLATTEN, kèm `orderId` khi huỷ từng lệnh), `REPLAY_CONTROL` (START/PAUSE/SEEK/SET_SPEED/STEP), `UPDATE_COPIER`, `SET_PROP_TRAILING_MODE`, `RESET_PROP_ACCOUNT`, `SET_PROP_CONFIG` (chỉ khi `DEV_HOOKS=1`).
- **Server → Client**: `INIT_STATE` (gửi lại mỗi khi đổi symbol/timeframe), `TICK`, `BAR_UPDATE`, `BAR_CLOSE`, `ORDERBOOK_UPDATE`, `SPEED_OF_TAPE`, `DEEP_TRADE`, `ABSORPTION`, `OPEN_ORDERS`, `ORDER_ACK`, `ORDER_REJECT`, `JOURNAL_UPDATE`, `TRADE_COPIED`, `GEX_UPDATE`, `OPTIONS_FLOW`, `PROP_STATE_UPDATE`, `PROP_BREACH_ALERT`, `REPLAY_STATE`.
- Băng thông được throttle: `ORDERBOOK_UPDATE`/`BAR_UPDATE` 100ms, `SPEED_OF_TAPE`/`PROP_STATE_UPDATE` 250ms, tick phía client được buffer 120ms trước khi render.

### Roadmap dữ liệu thật
1. `DataFeedCallbacks` đã sẵn sàng: thêm `databentoFeed.ts` / `rithmicFeed.ts` / `tradovateFeed.ts` và fallback về simulator khi thiếu key.
2. GEX/Options Flow: nối CBOE OI / ORATS / dxFeed / Tradier rồi đổi `dataSource` sang `'LIVE'` (UI tự bỏ badge `SIMULATED`).
3. Trade Copier: thay engine mô phỏng bằng API broker thật (cần auth + quản lý rủi ro theo account).
