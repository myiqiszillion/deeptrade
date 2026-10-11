# DEEPCHART — KÍCH HOẠT VÀ TÍCH HỢP 3 GÓI SUBSCRIPTION DATABENTO HIỆN CÓ

> **Báo cáo kiểm thử Entitlement, API Metadata, Live Gateway và Khả năng vận hành Real Data End-to-End.**
> **Thời điểm xác minh**: 2026-10-11 (Giờ địa phương)
> **Git Revision**: Release Safety Snapshot (`master`) — với các bản sửa lỗi MBP-10 protocol, DBN decoder, SQLite transactional migration, temporal symbology và activation matrix.

---

## 1. TỔNG QUAN XÁC MINH 3 SUBSCRIPTIONS

Tài khoản Databento hiện đã có sẵn 3 gói Standard subscriptions hoạt động độc lập ($199/tháng/gói, tổng baseline $597/tháng):
1. **CME Globex MDP 3.0** — Dataset `GLBX.MDP3` ($199/tháng, chu kỳ 2026-09-25 đến 2026-10-24).
2. **OPRA Options** — Dataset `OPRA.PILLAR` ($199/tháng, chu kỳ 2026-09-18 đến 2026-10-17).
3. **Databento US Equities** — Dataset `EQUS.MINI` ($199/tháng, chu kỳ 2026-09-27 đến 2026-10-26).
*Next billing date hiển thị*: **2026-11-01** ($597).

### Bảng Ma Trận Kích Hoạt Độc Lập (Activation Matrix)
*Tuân thủ nghiêm ngặt nguyên tắc phân định 4 giai đoạn streaming: Handshake ≠ Subscribe ACK ≠ Records Received ≠ Browser Render.*

| Tiêu chí kiểm định | CME Globex (`GLBX.MDP3`) | OPRA Options (`OPRA.PILLAR`) | US Equities (`EQUS.MINI`) |
|---|---|---|---|
| **Subscription Trạng thái** | Standard CME ($199/mo, 2026-09-25 → 10-24) | Standard OPRA ($199/mo, 2026-09-18 → 10-17) | Standard US Equities ($199/mo, 2026-09-27 → 10-26) |
| **METADATA VERIFIED** | **VERIFIED WITH REAL VENDOR DATA** (29 datasets, 17 schemas, range 2010-06-06 → 2026-10-10) | **VERIFIED WITH REAL VENDOR DATA** (12 schemas, range 2013-04-01 → 2026-10-10) | **VERIFIED WITH REAL VENDOR DATA** (10 schemas, range 2023-03-28 → 2026-10-10) |
| **1. LIVE AUTHENTICATION (Handshake)** | **VERIFIED** (LSG CRAM-SHA256 handshake: `success=1`, session `693388461`, ngắt kết nối ngay lập tức) | **VERIFIED** (LSG CRAM-SHA256 handshake: `success=1`, session `622366803`, ngắt kết nối ngay lập tức) | **VERIFIED** (LSG CRAM-SHA256 handshake: `success=1`, session `2123832209`, ngắt kết nối ngay lập tức) |
| **2. SUBSCRIPTION ACK** | **NOT YET VERIFIED** (Chưa gửi lệnh `sub` để bảo lưu hạn mức stream khi chưa có lệnh Operator) | **NOT YET VERIFIED** (Chưa gửi lệnh `sub` để bảo lưu hạn mức stream khi chưa có lệnh Operator) | **NOT YET VERIFIED** (Chưa gửi lệnh `sub` để bảo lưu hạn mức stream khi chưa có lệnh Operator) |
| **3. REAL DATA RECORDS RECEIVED** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Historical Metadata & Bars)** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Historical Definitions & Stats)** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Historical Metadata & Bars)** |
| **DBN DECODING VERIFIED** | **VERIFIED (Synthetic Binary Fixtures)** (Đã sửa `RTYPE_MBP10 = 0x0A`, 10 levels, TCP fragmentation, Order counts) | **VERIFIED (Synthetic Binary Fixtures)** (Definitions, Statistics, MBP-1/TBBO decode pass) | **VERIFIED (Synthetic Binary Fixtures)** (MBP-1, TBBO, Trades, Bars decode pass) |
| **ANALYTICS ENGINES** | **NOT YET VERIFIED (Live Vendor Stream)** (Engines Footprint/CVD/VP đã nghiệm thu với deterministic test fixtures & historical bars) | **NOT YET VERIFIED (Live Vendor Stream)** (Mô hình GEX, IV, Greeks đã nghiệm thu với real definition & test fixtures) | **NOT YET VERIFIED (Live Vendor Stream)** (Engines đã nghiệm thu với fixtures và historical data) |
| **4. BROWSER RENDER** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Replay & E2E Terminal Tests)** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Options Matrix E2E Tests)** | **NOT YET VERIFIED (Live Stream)** / **VERIFIED (Chart E2E Tests)** |
| **Blockers / Ghi chú** | Cần Operator phê duyệt trước khi mở live stream | Cần gia hạn chu kỳ trước 2026-10-17 | Không có L2 MBP-10 theo thiết kế feed |

---

## 2. CHI TIẾT PHASE A — VERIFY EXISTING SUBSCRIPTIONS

### A1. Kết quả kiểm tra API Key & Discovery (Read-only Preflight)
- **API Key**: Đã cấu hình và kiểm chứng hợp lệ (32 ký tự, mã hóa an toàn, không rò rỉ vào log hay client bundle).
- **Endpoint kiểm tra**: `/v0/metadata.list_datasets`, `/v0/metadata.list_schemas`, `/v0/metadata.get_dataset_range`, `/v0/metadata.get_dataset_condition`, `/v0/metadata.list_unit_prices`, `/v0/symbology.resolve`, `/v0/metadata.get_billable_size`.
- **Toàn bộ 3 dataset đều trả về trạng thái hợp lệ**:
  - `GLBX.MDP3`: Trả về 17 schemas, dải dữ liệu 2010-06-06 đến 2026-10-10T19:40:00Z. Symbology `ES.c.0` (continuous) resolve thành công sang `instrument_id: 10252`.
  - `OPRA.PILLAR`: Trả về 12 schemas, dải dữ liệu 2013-04-01 đến 2026-10-10T00:00:00Z. Symbology `SPY` resolve thành công sang `instrument_id: 379`.
  - `EQUS.MINI`: Trả về 10 schemas, dải dữ liệu 2023-03-28 đến 2026-10-10T00:00:00Z. Symbology `SPY` (15144), `QQQ` (13340), `AAPL` (38) resolve thành công sang `instrument_id`.

### A2. Live Gateway Authentication Kiểm chứng độc lập
Đã kiểm tra kết nối CRAM-SHA256 handshake tới cổng 13000 của Live Streaming Gateways (LSG):
- `glbx-mdp3.lsg.databento.com:13000`: Nhận CRAM challenge -> Gửi SHA256 auth response -> **Nhận `success=1|session_id=693388461`**. Ngắt kết nối ngay lập tức, không phát sinh streaming.
- `opra-pillar.lsg.databento.com:13000`: Nhận CRAM challenge -> Gửi SHA256 auth response -> **Nhận `success=1|session_id=622366803`**. Ngắt kết nối ngay lập tức.
- `equs-mini.lsg.databento.com:13000`: Nhận CRAM challenge -> Gửi SHA256 auth response -> **Nhận `success=1|session_id=2123832209`**. Ngắt kết nối ngay lập tức.
**Kết luận**: Toàn bộ 3 dataset đều có **LIVE AUTHENTICATION VERIFIED** tại tầng vendor gateway. Trạng thái live streaming thực sự được ghi nhận là **NOT YET VERIFIED** cho đến khi Operator ra lệnh kích hoạt phiên stream.

### A3. Cảnh báo Chu kỳ Ngày Gia hạn (Subscription Dates Notice)
- `OPRA.PILLAR`: Chu kỳ hiện tại kết thúc ngày **2026-10-17** (còn 6 ngày).
- `GLBX.MDP3`: Chu kỳ kết thúc ngày **2026-10-24** (còn 13 ngày).
- `EQUS.MINI`: Chu kỳ kết thúc ngày **2026-10-26** (còn 15 ngày).
- `Next payment`: Hiển thị ngày **2026-11-01** trên giao diện tổng.
> **Lưu ý quan trọng cho Operator**: Do ngày bắt đầu cycle của 3 gói lệch nhau (18, 25, 27 của tháng), ngày 2026-10-17 gói OPRA sẽ đến hạn chu kỳ. Cần đảm bảo Databento tự động renew theo billing consolidation mà không làm gián đoạn entitlement của OPRA trước ngày 2026-11-01.

---

## 3. SỬA LỖI GIAO THỨC MBP-10 & BẢO ĐẢM DỮ LIỆU ĐẾN DOM / HEATMAP (TASK 1)

### 3.1. Đối chiếu Chuẩn Databento Binary Encoding (DBN)
- **Lỗi nghiêm trọng trước sửa**: Bản mô tả và code cũ gán `RTYPE_MBP10 = 0x02`.
- **Theo Databento Official Specification**:
  - `0x00` (0): `MBP-0` (Trades schema, 48 bytes).
  - `0x01` (1): `MBP-1` (Top of book schema, 80 bytes).
  - `0x02` (2): `TBBO` (Trade with best bid and offer, 80 bytes, cấu trúc `Mbp1Msg`).
  - `0x0A` (10 decimal): `MBP-10` (Market-by-price 10 levels depth, 368 bytes, cấu trúc `Mbp10Msg`).
- **Hệ quả của lỗi cũ**: Do định nghĩa `RTYPE_MBP10 = 0x02`, decoder khi nhận packet DBN live MBP-10 thực từ sàn (mang `rtype = 0x0A`) đã bỏ qua toàn bộ gói tin L2, khiến độ sâu sổ lệnh không bao giờ được cập nhật!
- **Đã khắc phục hoàn toàn trong `server/src/databento/liveClient.ts`**:
  - Định nghĩa chính xác `RTYPE_MBP10 = 0x0A` (10 decimal) và `RTYPE_TBBO = 0x02`.
  - Cập nhật nhánh dispatch nhận diện đầy đủ `rtype = 0x0A` cho `MBP-10`, `0x01` cho `MBP-1`, `0x02` cho `TBBO`, và `0x00` cho `Trades`.

### 3.2. Cấu trúc Nhị phân & Offsets của MBP-10 Record (368 Bytes)
1. **Record Header (16 bytes, Little-Endian)**:
   - Offset 0: `length` (uint8) = 92 (92 words × 4 = 368 bytes).
   - Offset 1: `rtype` (uint8) = `0x0A` (10 decimal).
   - Offset 2–3: `publisher_id` (uint16 LE).
   - Offset 4–7: `instrument_id` (uint32 LE).
   - Offset 8–15: `ts_event` (uint64 LE nanoseconds) -> chuyển đổi sang epoch ms (`tsMs`).
2. **Event Payload (32 bytes)**:
   - Offset 16–23: `price` (int64 LE, signed, nanodollars 1e-9). Giá trị `UNDEF_PRICE = 9223372036854775807n` (`0x7fffffffffffffffn`).
   - Offset 24–27: `size` (uint32 LE). Giá trị `UNDEF_ORDER_SIZE = 4294967295`.
   - Offset 28: `action` (uint8 ascii: 'T', 'A', 'C', 'M', 'F').
   - Offset 29: `side` (uint8 ascii: 'B', 'A', 'N').
   - Offset 30: `depth` (uint8).
   - Offset 31: `flags` (uint8).
   - Offset 32–39: `ts_recv` (uint64 LE nanoseconds).
   - Offset 40–43: `ts_in_delta` (int32 LE).
   - Offset 44–47: `sequence` (uint32 LE).
3. **Mảng 10 Mức Giá `levels: [BidAskPair; 10]` (320 bytes, từ offset 48 đến 367)**:
   - Mỗi mức giá gồm 32 bytes (offset cơ sở `48 + i * 32` với `i` từ 0 đến 9):
     - `+0`: `bid_px` (int64 LE, giá chia cho $10^9$).
     - `+8`: `ask_px` (int64 LE, giá chia cho $10^9$).
     - `+16`: `bid_sz` (uint32 LE).
     - `+20`: `ask_sz` (uint32 LE).
     - `+24`: `bid_ct` (uint32 LE, order count).
     - `+28`: `ask_ct` (uint32 LE, order count).
   - Decoder tự động loại bỏ các mức giá mang sentinel `UNDEF_PRICE` hoặc kích thước `UNDEF_ORDER_SIZE`.

### 3.3. Xử lý TCP Fragmentation & Multiple Records Chunk
- **TCP Fragmentation**: Một record 368 byte có thể bị chia cắt qua nhiều network packets (ví dụ nhận 100 bytes, sau đó 150 bytes, sau đó 118 bytes).
  - Bộ đệm tích lũy `buffer = Buffer.concat([buffer, chunk])`.
  - Hàm `parseDbnRecord` kiểm tra: nếu `buffer.length < recLen (368)`, hàm trả về `{ parsed: null, recLen: 368 }`.
  - Vòng lặp TCP kiểm tra `if (buffer.length < recLen) break;`, giữ nguyên dữ liệu trong buffer và chờ network chunk tiếp theo, không làm mất frame hoặc crash.
- **Multiple Records**: Nhiều records (hoặc record + fragment) nằm trong một TCP chunk.
  - Vòng lặp `while (buffer.length >= DBN_CONSTANTS.HEADER_SIZE)` giải mã từng record, gọi handler, rồi dịch chuyển `buffer = buffer.subarray(recLen)`.

### 3.4. Dữ liệu Decode chuyển giao chính xác đến DOM và Liquidity Heatmap
- Dữ liệu `parsed.depth` (`MarketDepthEvent` kind `snapshot`) được chuyển qua `handlers.onDepth(event)` -> `MarketContext.handleDepth(event)`.
- `MarketContext` gọi `OrderbookManager.applySnapshot(...)`.
- `OrderbookManager`:
  1. Cập nhật sổ lệnh nội tại `bids` và `asks`.
  2. Ghi nhận snapshot 10 levels vào `depthHistory` (`recordTop10Snapshot`) cho **Liquidity Heatmap** (phục vụ endpoint `/api/v1/chart/:symbol/depth-heatmap`).
  3. Bắn event WebSocket `ORDERBOOK_UPDATE` tới các active subscribers cho **DOM Scalper Widget**.
- Unit test đã kiểm chứng từ binary buffer thật qua `OrderbookManager`, xác nhận `bids[0..9]` và `asks[0..9]` đạt độ chính xác 100%.

---

## 4. BẢO ĐẢM TÍNH TOÀN VẸN LỊCH SỬ (TASK 3)

Phân định rạch ròi giữa các tầng dữ liệu:
1. **Metadata / Schema Discovery**:
   - Truy vấn danh mục (`list_datasets`, `list_schemas`, `get_dataset_range`, `get_dataset_condition`, `list_unit_prices`).
   - Đây là các lệnh tra cứu read-only miễn phí được hỗ trợ bởi subscription.
2. **Actual Historical Timeseries Download**:
   - Truy vấn `/v0/timeseries.get_range` tải trades, quotes, depth.
   - Luôn kiểm tra `getBillableSize` và `getCost` preflight trước khi tải.
   - Không tự động mặc định mọi dữ liệu lịch sử đều miễn phí; việc tải tick-by-tick dung lượng lớn cần Operator phê duyệt ngân sách.
3. **SQLite Persistence & Analytics Engines**:
   - Bảng `trades`, `bars`, `depth_snapshots` được lưu trữ an toàn trong SQLite WAL.
   - Các engine phân tích (Footprint, CVD, Volume Profile, VWAP) đã được kiểm chứng hoạt động đúng quy tắc với deterministic data fixtures và historical bars.
   - Không tuyên bố Footprint/CVD đã nghiệm thu bằng live vendor stream khi chưa có session streaming thực tế.

---

## 5. VÒNG ĐỜI, BẢO TOÀN VÀ MIGRATION INSTRUMENT ID AN TOÀN

- **Nguyên tắc cốt lõi**: `instrument_id` của Databento là số định danh nội bộ theo từng dataset, **không phải là ID toàn cục (globally unique)** và **không cố định vĩnh viễn** (thay đổi theo kỳ hạn hợp đồng futures rollover, option expiry và chu kỳ cấp phát).
  - Ví dụ: `instrument_id: 379` trong CME (`GLBX.MDP3`) là một hợp đồng hoàn toàn khác với `instrument_id: 379` trong OPRA (`OPRA.PILLAR`).
- **Triển khai Migration SQLite An toàn & Có Transaction**:
  - `CREATE TABLE IF NOT EXISTS` trong SQLite **không thể** cập nhật Primary Key của bảng đã tạo trước đó. Do đó, `MarketDataStore.runMigrations()` đã triển khai cơ chế migration tự động, an toàn và có transaction:
    1. Kiểm tra cấu trúc thực tế qua `PRAGMA table_info(instrument_master)`.
    2. Nếu `dataset` chưa nằm trong Primary Key (`pk = 0`), tự động tạo snapshot an toàn qua `VACUUM INTO` trước khi chạm vào schema.
    3. Mở transaction `BEGIN IMMEDIATE TRANSACTION;` với `PRAGMA foreign_keys = OFF;`.
    4. Tạo bảng tạm `instrument_master_migrated` với `PRIMARY KEY (dataset, instrument_id)`.
    5. Di chuyển 100% dữ liệu nguyên vẹn (`INSERT INTO ... SELECT * FROM instrument_master`).
    6. Tráo đổi bảng: `DROP TABLE instrument_master; ALTER TABLE instrument_master_migrated RENAME TO instrument_master;`.
    7. Tái lập các chỉ mục cần thiết: `idx_master_dataset`, `idx_master_raw`.
    8. Ghi nhận phiên bản migration vào bảng `schema_migrations` (`version: 1`, `instrument_master_composite_pk`) và cập nhật `PRAGMA user_version = 1`.
    9. `COMMIT;` và bật lại `PRAGMA foreign_keys = ON;`.
  - Toàn bộ 4,951 bản ghi hiện có trên staging database được bảo toàn tuyệt đối 100%. Quá trình kiểm thử xác nhận migration là **idempotent** (chạy lại nhiều lần mà không gây lỗi).
- **Đảm bảo Tính Đúng đắn Theo Thời Gian (Temporal Correctness)**:
  - Phương thức `instrumentMaster.getByInstrumentId(id, dataset, asOf)` và `getByRawSymbol(dataset, rawSymbol, asOf)` hỗ trợ tham số `asOf` (thời điểm giao dịch/tra cứu).
  - So khớp điều kiện hiệu lực theo ngày: `(!activation || activation <= asOf) && (!expiration || expiration >= asOf)`.
  - Hỗ trợ giải quyết Rollover hợp đồng tương lai (`FuturesSymbolResolver.frontMonth(root, asOf)` và `secondMonth(root, asOf)`) tự động chuyển kỳ hạn đáo hạn gần nhất dựa theo ngày hiệu lực.
  - Các bảng lưu trữ `trades`, `bars`, `depth_snapshots`, `gaps`, `ingestion_checkpoints` đều được đánh chỉ mục và lưu trữ theo `(provider, symbol)`.

---

## 6. KIỂM KÊ VÀ KẾT QUẢ TEST SUITE TOÀN DIỆN

### 6.1. Xác minh Số lượng Test Suite (28 Suites)
- Thư mục `server/test/unit/` chứa chính xác **28 test suites** (`*.test.ts`) và 1 runner `index.ts`.
- Runner `index.ts` thực thi tuần tự toàn bộ **28 test suites**, đạt 100% PASS.

### 6.2. Bảng Kết quả Kiểm thử Toàn bộ Hệ thống

| Bộ kiểm thử | Lệnh thực thi | Chi tiết kết quả | Mã thoát (Exit Code) |
|---|---|---|---|
| **Typecheck (Server)** | `pnpm --filter @deepchart/server exec tsc -p tsconfig.test.json --noEmit` | Passed with 0 errors | **0** |
| **Typecheck (Client)** | `pnpm --filter client exec tsc -b` | Passed with 0 errors | **0** |
| **Unit Tests** | `pnpm test:unit` | 28/28 suites (DBN MBP-10 binary decoding, SQLite migration safety, temporal mapping, Orderbook routing) | **0** |
| **Integration Tests** | `pnpm test:integration` | 7/7 suites (Chart Smoke, History API, WebSocket, Auth/Billing, Behavioral Contracts, Depth Persistence, Alert Delivery) | **0** |
| **P0 Verification** | `pnpm verify:p0` | 13/13 P0 Critical Integrity & Fail-Closed Test Cases | **0** |
| **Production Build** | `pnpm build:all` | Server dist + Vite client bundle hoàn thành không lỗi | **0** |
| **Playwright E2E** | `pnpm test:e2e` | 3 test suites, 19/19 browser tests (Chart Terminal, Memory Leak, User Behavior) | **0** |
| **Docker Staging Full** | `node scratch/staging_full_verification.mjs` | 42/42 verification tests (Caddy, Auth, WebSocket, WAL persistence, Container restart, Backup/Restore) | **0** |

---

## 7. TRẠNG THÁI GIT & CÁC BƯỚC CẦN OPERATOR PHÊ DUYỆT

- **Git Revision**: Release Safety Snapshot (`master`) đã nghiệm thu toàn diện các test suites.
- **Git Diff & Whitespace check**: `git diff --check` đạt chuẩn, không có secret, không có push Git, không deploy production.
- **Các bước còn lại phụ thuộc vào sự phê duyệt của Operator**:
  1. **Kích hoạt Live Streaming thực**: Để nhận stream trực tiếp từ CME, OPRA, hoặc EQUS trên tài khoản có trả phí, Operator cần phê duyệt chạy live session cụ thể.
  2. **Gia hạn OPRA (`OPRA.PILLAR`)**: Hạn chu kỳ ngày 2026-10-17 cần được xác nhận trên portal Databento.
  3. **Tải Historical Timeseries mở rộng**: Cần sự xác nhận của Operator nếu khối lượng vượt hạn mức định sẵn.
