# DeepChart — Prop Firm Edition: US Futures, Options Flow & GEX Terminal

**DeepChart Prop Firm Edition** là nền tảng Web Terminal phân tích Orderflow, Footprint, DOM Scalping, Options Flow và Gamma Exposure (GEX) chuyên biệt cho giao dịch **Quỹ cấp vốn (Prop Firm: Topstep, Apex Trader Funding, MyFundedFutures, Bulenox, FTMO)**.

Hệ thống được thiết kế với tiêu chuẩn:
> **100% Real Tick & Level 2 Data.** Nói KHÔNG với Fake Footprint / Fake Volume Profile / Fake DOM.

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

Khởi chạy cả Server và Client:
```bash
pnpm dev
```
- **Frontend Web Terminal**: [http://localhost:5173](http://localhost:5173)
- **Backend WebSocket Server**: `ws://localhost:8080`
