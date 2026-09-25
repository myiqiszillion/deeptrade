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
- **Định dạng giá chuẩn theo từng Instrument**: ES (0.25), NQ (0.25), YM (1.0), CL (0.01), NG (0.001), BTCUSDT (0.1). Không còn lỗi cắt cụt số thập phân.
- **Lưu cài đặt tự động trên trình duyệt (`localStorage`)**: Ghi nhớ mã giao dịch, timeframe, chế độ chart, và trạng thái bật/tắt các panel.

---

## 🌐 Nguồn Dữ Liệu & Bảng Khả Năng (Capability Matrix)

| Instrument | Provider | History | Realtime | Footprint | DOM |
|---|---|---|---|---|---|
| **BTCUSDT** | Binance | ticks | aggTrade | có giới hạn | depth20 |
| **ES/MES/NQ/MNQ** | none (mặc định) | none | unavailable | unavailable | unavailable |
| **CME qua Tradovate** | Tradovate | bars/quote-based | tùy credential | partial | vendor-dependent |
| **CME qua Databento** | chưa triển khai (scaffold) | unavailable | unavailable | unavailable | unavailable |

> **Chính sách Fail-Closed:** Khi chưa có license/credential cho nhà cung cấp futures, toàn bộ feed và lịch sử CME mặc định là `UNAVAILABLE`. Hệ thống tuyệt đối không sinh dữ liệu giả hay nến giả.

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
- `AUTH_JWT_SECRET`: Khóa ký JWT tối thiểu 32 ký tự, bắt buộc phải thiết lập khi chạy production (hệ thống sẽ fail-fast và dừng ngay nếu thiếu).
- `DEV_HOOKS=1`: Chỉ được phép bật ở môi trường phát triển (development), bị vô hiệu hóa hoàn toàn trong production.

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
| `pnpm test` | Chạy toàn bộ test suite: protocol drift, unit tests và integration tests |
| `pnpm test:unit` | Chạy unit tests: auth, entitlement, marketDataStore, sessionCalendar, footprintEngine, replaySession, validate |
| `pnpm test:integration` | Chạy integration tests: chartSmoke, historyApi, websocket, tradovateAdapter, lifecycle |
| `pnpm test:protocol` | Chống protocol drift giữa server và client WebSocket messages (`scripts/check-protocol-drift.mjs`) |
| `pnpm verify:p0` | 13 test kiểm tra tính toàn vẹn server và rate limiting |
| `pnpm test:offline` | Alias của `pnpm test` |

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát hành dưới giấy phép mã nguồn mở MIT.
Mọi phân tích order flow hoàn toàn miễn phí, độc lập và bảo vệ dữ liệu người dùng.
