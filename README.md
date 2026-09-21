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

## 🌐 Nguồn Dữ Liệu & Khả Năng Nguồn

| Thị trường | Nguồn | Trạng thái & Ghi chú |
|---|---|---|
| **BTCUSDT** (Bitcoin Perpetual) | Binance USD-M Futures | ✅ **LIVE**: WebSocket `aggTrade` & `depth20` + REST history đầy đủ |
| **CME Futures** (ES, NQ, YM, RTY, GC, CL, NG) | Tradovate Adapter | ✅ **THẬT** khi có credential (`FUTURES_PROVIDER=tradovate`). Chưa cấu hình $\rightarrow$ `FEED: UNAVAILABLE` (fail-closed) |
| **Gamma Exposure (GEX)** | CBOE Delayed Chain | ✅ **THẬT**: Tính từ chain quyền chọn SPX/SPY/NDX/QQQ trễ ~15 phút |
| **Options Flow** | Options Tape | Bảng hiển thị sweeps/blocks khi kết nối feed quyền chọn (để trống khi không có feed) |

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

### Yêu cầu môi trường
- Node.js >= 20 (khuyến nghị Node 20 hoặc 22 LTS)
- pnpm >= 9

### Cài đặt dependencies
```bash
pnpm install
```

### Chạy môi trường phát triển (Development)
```bash
pnpm dev
```
- **Web Terminal**: http://localhost:5173
- **WebSocket Server**: `ws://localhost:8080`

### Đóng gói & Chạy bản Production (1 Port duy nhất)
Server Node.js được thiết kế để phục vụ cả WebSocket và client build tĩnh trên cùng một cổng (`8080`):
```bash
pnpm build
node server/dist/index.js
```
- **Truy cập Terminal**: http://localhost:8080
- **Health check API**: http://localhost:8080/healthz

---

## 🧪 Bộ Kiểm Thử (Verification Suites)

DeepChart có hệ thống test toàn diện để bảo vệ tính đúng đắn của dữ liệu và engine:

| Lệnh kiểm thử | Mục đích |
|---|---|
| `pnpm typecheck` | Kiểm tra TypeScript cho cả server và client (0 lỗi) |
| `pnpm verify:types` | Chống protocol drift giữa server và client WebSocket messages |
| `pnpm verify:footprint` | Kiểm chứng footprint: open candle, ask imbalance, stacked imbalance, unfinished auction |
| `pnpm verify:replay` | Kiểm chứng isolated market replay: buffer, step, seek index, seek timestamp, consistency |
| `pnpm verify:lifecycle` | 24 test kiểm tra chu kỳ sống feed, chuyển tab/mã, chống lẫn bar/depth |
| `pnpm verify:feed` | Kiểm tra tính đúng đắn dữ liệu: fail-closed, validator, không chấp nhận feed rác |
| `pnpm verify:tradovate` | 150 test offline adapter Tradovate (mapping, deduplication, fail-closed) |
| `pnpm verify:p0` | 13 test bảo vệ tính toàn vẹn server (rate limit, protocol rejection) |
| `pnpm verify:chart-smoke` | Smoke test kiểm tra HTTP server, WebSocket handshake và static assets |

Chạy toàn bộ kiểm thử:
```bash
pnpm typecheck && pnpm verify:types && pnpm verify:footprint && pnpm verify:replay && pnpm verify:lifecycle
```

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát hành dưới giấy phép mã nguồn mở MIT.
Mọi phân tích order flow hoàn toàn miễn phí, độc lập và bảo vệ dữ liệu người dùng.
