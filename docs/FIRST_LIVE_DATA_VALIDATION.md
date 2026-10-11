# DEEPCHART — FIRST LIVE DATA VALIDATION RUNBOOK & HANDOFF

**Git Revision:** `ab45af746f2fe127ce0d4d3d5927bf4da40f1d32`  
**Date:** 2026-10-11  
**Status:** DRY-RUN PRE-FLIGHT COMPLETE — PENDING OPERATOR AUTHORIZATION FOR LIVE STREAM  

---

## 1. MỤC TIÊU & PHẠM VI NGHIỆM THU

Tài liệu này thiết lập quy trình kiểm thử, nghiệm thu và bàn giao luồng dữ liệu thời gian thực (Live Market Data) từ Databento Live Streaming Gateway (LSG) cho DeepChart, tập trung vào hợp đồng tương lai CME Globex (`GLBX.MDP3`).

### Ma Trận Phân Biệt 8 Tầng Kiểm Chứng (8-Tier Verification Matrix)

Harness `scripts/verify_databento_live.mjs` là công cụ smoke test độc lập, được thiết kế để đo lường chính xác từ tầng mạng đến decoder nhị phân. **Tuyệt đối không báo PASS cho các tầng chưa được script đo lường trực tiếp.**

| Tầng Kiểm Chứng | Khả Năng Đo Lường Của Live Harness | Trạng Thái Đo Lường Hiện Tại | Phương Thức Nghiệm Thu Chuẩn Xác |
| :--- | :---: | :---: | :--- |
| **1. Metadata Preflight** | **Đo lường trực tiếp** | ✅ **PASS (Dry-Run)** | Gọi REST API: `listDatasets`, `listSchemas`, `resolveSymbology` (ES.c.0 -> ID 10252 -> ESZ6). |
| **2. LSG Authentication** | **Đo lường trực tiếp** | ✅ **PASS (Sẵn sàng cho Live)** | Bắt tay CRAM-SHA256 trên TCP 13000, nhận `success=1` & session ID hợp lệ. |
| **3. Subscription Accepted** | **Đo lường trực tiếp** | ⚠️ **PENDING OPERATOR** | Gửi `schema=...|symbols=...|start_session=1`, nhận `SystemMsg` (`code = 1`: `SUBSCRIPTION_ACK`). DBN Metadata Header chỉ là stream framing, không phải Subscription ACK. |
| **4. Actual DBN Records Received** | **Đo lường trực tiếp** | ⚠️ **PENDING OPERATOR** | Nhận các binary records thô từ sàn CME Globex qua kết nối TCP. |
| **5. Decoder Receives Genuine Records** | **Đo lường trực tiếp** | ⚠️ **PENDING OPERATOR** | Chạy production `parseDbnRecord`, xác thực cấu trúc trade (price > 0, size > 0, side, ts) hoặc MBP-10 depth. |
| **6. MarketContext Analytics Updated** | ⚙️ **Ngoài phạm vi Harness** | ⏸️ **Test Suite Verified** | Đưa trade/depth vào `MarketContext` tính Footprint, CVD, VWAP, DOM. Đo lường qua unit/integration test suite. |
| **7. Backend WebSocket Publishes Updates** | ⚙️ **Ngoài phạm vi Harness** | ⏸️ **Integration Verified** | Phát broadcast frame qua WebSocket server cho client. Đo lường qua integration test suite. |
| **8. React Browser Renders Genuine Updates** | ⚙️ **Ngoài phạm vi Harness** | ⏸️ **Browser E2E Required** | React terminal hiển thị nến, DOM, và footprint thực tế. Phải nghiệm thu qua trình duyệt DeepChart UI. |

> **Quy chuẩn 6 Giai Đoạn Giao Thức (6 Protocol Stages):**
> 1. `AUTHENTICATED`: CRAM-SHA256 handshake thành công (`success=1`).
> 2. `DBN METADATA RECEIVED`: Đã nhận và bóc tách DBN Metadata Header framing (8 + metaLen bytes).
> 3. `SUBSCRIPTION ACK RECEIVED`: Đã nhận `SystemMsg` record với `code = 1` (`SUBSCRIPTION_ACK`).
> 4. `ERROR RECORD RECEIVED`: Bắt và phân lập bản tin lỗi `ErrorMsg` (rtype `0x19` / `0x15`).
> 5. `REAL MARKET RECORDS RECEIVED`: Bản tin dữ liệu thị trường thực tế (trade/depth) loại trừ heartbeat và system.
> 6. `DECODER VERIFIED`: Production `parseDbnRecord` giải mã thành công cấu trúc bản tin chuẩn xác.

---

## 2. PHÂN TÍCH CHI PHÍ, ENTITLEMENT VÀ NGHĨA VỤ PHÁP LÝ

Để đảm bảo tính minh bạch tài chính và tuân thủ pháp lý, DeepChart bãi bỏ mọi khẳng định chưa có căn cứ chính thức (chẳng hạn nhận định "50 records chắc chắn tốn dưới $0.001"). Chi phí và quyền sử dụng được phân định rõ ràng như sau:

### 2.1. Phân Biệt Các Cấu Phần Chi Phí & Quyền Dữ Liệu

1. **Subscription Phí Cố Định Đã Có (Base/Platform Subscription):**
   - Phí duy trì tài khoản định kỳ với nhà cung cấp Databento (nếu có theo gói dịch vụ). Cung cấp quyền truy cập cổng thông tin và các tính năng nền tảng cơ bản.
2. **Historical Metered Charges (Phí Đo Lường Lịch Sử Theo Dung Lượng):**
   - Áp dụng khi gọi các endpoint REST truy vấn dữ liệu quá khứ như `/timeseries.get_range`.
   - Được tính cước dựa trên số gigabyte giải nén (uncompressed GB) hoặc đơn giá mỗi triệu bản ghi theo bảng giá niêm yết của vendor.
3. **Live Entitlement (Quyền Truy Cập Cổng Live Streaming):**
   - Quyền kết nối vào cổng TCP Databento Live Streaming Gateway (LSG) của từng dataset cụ thể (ví dụ: `GLBX.MDP3.lsg`).
   - Yêu cầu dataset phải nằm trong danh mục tài khoản được cấp phép (đã xác thực có mặt trong danh sách 29 datasets khả dụng).
4. **CME Exchange Licensing & Non-Display Obligations (Nghĩa Vụ Bản Quyền Sàn CME):**
   - **Không có quyền phân phối lại (Redistribution):** Gói Standard subscription từ Databento **KHÔNG** tự động cấp quyền phân phối lại dữ liệu ra bên ngoài cho bên thứ ba. Dữ liệu chỉ phục vụ nội bộ hệ thống.
   - **Nghĩa vụ Non-Display:** Việc sử dụng dữ liệu cho giao dịch tự động hóa/thuật toán (Automated Trading Systems) có thể phải chịu quy chế cấp phép Non-Display (Category 1, 2, 3) trực tiếp với sàn CME Group.
5. **Các Phí Bổ Sung Chưa Được Vendor Xác Nhận:**
   - Mọi khoản phí truyền dẫn live bổ sung, phí người dùng cuối (subscriber reporting fees) hoặc cam kết sản lượng tối thiểu cần được xác nhận từ hóa đơn và hợp đồng vendor chính thức, không tự suy đoán.

### 2.2. Xác Nhận Chi Phí Thực Thi Của Dry-Run

- **Các endpoint được gọi trong Dry-run:**
  - `GET /metadata.list_datasets` (Truy vấn danh mục dataset)
  - `GET /metadata.list_schemas` (Truy vấn danh mục schema)
  - `GET /symbology.resolve` (Ánh xạ symbol động)
- **Kết luận chi phí:**  
  Các endpoint trên thuộc nhóm **Metadata & Symbology**, theo chính sách của Databento là các truy vấn cấu hình không tính phí dung lượng timeseries. Script tuyệt đối **KHÔNG** gọi endpoint `/timeseries.get_range`.  
  **Phí phát sinh từ dry-run: $0.00 (Hoàn toàn miễn phí).**

---

## 3. HARNESS LIVE SMOKE TEST (`scripts/verify_databento_live.mjs`)

Harness chính thức được duy trì tại: `scripts/verify_databento_live.mjs`.

### 3.1. Cơ Chế Bảo Vệ & Vận Hành An Toàn
- **Mặc định Dry-Run:** Mọi lần gọi thông thường không có cờ `--live` đều chỉ thực hiện pre-flight, không mở socket stream, không gửi lệnh subscribe.
- **Enforcement 1 Subscription:** Mỗi lần chạy chỉ cho phép subscribe duy nhất 1 schema (`trades` hoặc `mbp-10`) cho 1 symbol (`ES.c.0`), ngăn ngừa phát sinh băng thông ngoài ý muốn.
- **Teardown & Timeout Toàn Diện:**
  - Timeout tổng thời gian: Mặc định 30 giây (`--duration 30`).
  - Timeout hoạt động ngay cả khi nhận được 0 records, gặp sự cố mạng hoặc gateway treo.
  - Bộ lắng nghe tín hiệu `SIGINT` / `SIGTERM` đảm bảo hủy kết nối TCP ngay lập tức nếu tiến trình bị ngắt.
  - Tuyệt đối không để lại socket mở, bộ hẹn giờ ngầm hay subscription treo sau khi script kết thúc.
- **Bảo Vệ Bí Mật Tuyệt Đối:** API key được che chắn (`****D4B9`), không ghi log chuỗi CRAM challenge, chuỗi phản hồi auth, hoặc bí mật hệ thống.

### 3.2. Lệnh Chạy Dry-Run (Mặc Định — An Toàn)
```bash
# Lệnh mặc định:
node scripts/verify_databento_live.mjs

# Lệnh với tham số rõ ràng:
node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema trades --duration 30 --max-records 50 --dry-run
```

### 3.3. Lệnh Chạy Live Stream (Chỉ Chạy Khi Được Operator Phê Duyệt)
> ⚠️ **YÊU CẦU PHÊ DUYỆT CỦA OPERATOR:**  
> Không chạy các lệnh dưới đây khi chưa có sự đồng ý bằng văn bản của Operator.

```bash
# Nghiệm thu Trade Stream (MBP-0 Trades):
node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema trades --duration 30 --max-records 50 --live

# Nghiệm thu Depth Stream (MBP-10 Orderbook):
node scripts/verify_databento_live.mjs --dataset GLBX.MDP3 --symbol ES.c.0 --schema mbp-10 --duration 30 --max-records 50 --live
```

---

## 4. QUY CHUẨN XỬ LÝ TRƯỜNG HỢP 0 RECORDS & PHIÊN GIAO DỊCH

Khi harness chạy trong thời gian sàn CME đóng cửa (cuối tuần từ 16:00 CT Thứ Sáu đến 17:00 CT Chủ Nhật, hoặc thời gian bảo trì 16:00 - 17:00 CT từ Thứ Hai đến Thứ Năm):

- Socket kết nối và bắt tay CRAM-SHA256 thành công.
- Lệnh subscribe được gateway tiếp nhận.
- Tuy nhiên sàn không có khớp lệnh nên số record nhận được là 0.

**Quy tắc xử lý:**
- Script ghi nhận rõ ràng: `⚠️ NO RECORDS RECEIVED (MARKET CLOSED / INACTIVE)`.
- **Tuyệt đối không báo PASS cho Tầng 4 (Actual Records) hay Tầng 5 (Decoder).**
- Thời điểm phù hợp nhất để nghiệm thu Live Records: **Sau 17:00 giờ Chicago Chủ Nhật (tương đương 05:00 sáng Thứ Hai giờ Việt Nam)** khi phiên CME Globex mở cửa trở lại.

---

## 5. TRẠNG THÁI DOCKER STAGING ENGINE (ĐÃ XÁC THỰC PASS)

### 5.1. Hiện Trạng Kỹ Thuật
- **Lệnh kiểm tra:** `docker info`
- **Kết quả:** `PASS` (Docker Desktop Linux daemon hoạt động bình thường, Server Version: `29.8.2`).
- **Container Staging:**
  - `docker compose build`: PASS (Build `deepchart-app` và `deepchart-proxy` hoàn tất sạch sẽ).
  - `docker compose up -d`: PASS (Cả 2 containers `deepchart-app-1` và `deepchart-proxy-1` hoạt động và healthy).
  - `node scratch/staging_full_verification.mjs`: PASS (42/42 tests passed 100%: Caddy TLS/headers, reverse proxy, unauthenticated/authenticated REST/WS, SQLite WAL persistence & online backup snapshot).
- **Quy tắc bảo toàn:** SQLite volume và thư mục `data/` được giữ nguyên vẹn tuyệt đối.

---

## 6. MÃ THOÁT CHUẨN CỦA SCRIPT (EXIT CODES)

| Mã Thoát | Ý Nghĩa Kỹ Thuật |
| :---: | :--- |
| **0** | Thành công hợp lệ (Dry-run hoàn tất; hoặc Live run thu thập và giải mã records thành công; hoặc Live run hoàn tất bình thường nhưng nhận 0 records do phiên CME Globex đóng cửa / thị trường đứng im). |
| **1** | Lỗi cấu hình, thiếu API Key (`DATABENTO_API_KEY`), hoặc Dataset/Schema không được cấp phép. |
| **2** | Lỗi mạng TCP socket, lỗi xác thực CRAM-SHA256 bị từ chối (`success=0`), hoặc nhận bản tin lỗi từ gateway (`ErrorMsg` / `GATEWAY_ERROR`). |
| **130** | Tiến trình bị hủy bởi người dùng hoặc hệ thống qua tín hiệu `SIGINT` (Ctrl+C) / `SIGTERM` (được thu hồi tài nguyên sạch sẽ). |

---

## 7. BẢO TOÀN DỮ LIỆU & KIỂM SOÁT BẢN QUYỀN

- **Không tự ý gọi Timeseries:** Tránh gọi các hàm REST historical không cần thiết để không làm phát sinh cước phí đo lường.
- **Không bật Stripe Live:** Hệ thống thanh toán chỉ giữ ở chế độ kiểm thử hoặc manual, tuyệt đối không kích hoạt khóa thanh toán live.
- **Không mua thêm dịch vụ:** Không tự ý nâng cấp gói dịch vụ Databento khi chưa có chỉ đạo từ Operator.
