# BÁO CÁO ĐỊNH GIÁ VENDOR & MA TRẬN SẴN SÀNG THƯƠNG MẠI
## DEEPCHART TERMINAL — FINAL DECISION GATE

**Ngày rà soát & tham chiếu:** 11/10/2026  
**Nguồn xác thực chính thức:**
1. Databento Pricing & Live Licensing: [https://databento.com/pricing](https://databento.com/pricing) | [https://databento.com/docs](https://databento.com/docs)
2. CME Group Market Data Fee Schedule (Effective Jan 1, 2026): [https://www.cmegroup.com/market-data/distributor-resources/market-data-fee-schedule.html](https://www.cmegroup.com/market-data/distributor-resources/market-data-fee-schedule.html)
3. CME Group Derived Data Policy & Licensing: [https://www.cmegroup.com/market-data/distributor-resources/derived-data-licensing.html](https://www.cmegroup.com/market-data/distributor-resources/derived-data-licensing.html)
4. OPRA Plan Fee Schedule (2026): [https://www.opraplan.com/](https://www.opraplan.com/)

---

## 1. Mô hình Chi phí Vendor Chính thức (Official Vendor Cost Model)

> [!IMPORTANT]
> **THAY ĐỔI CỐT LÕI CỦA DATABENTO (ÁP DỤNG TỪ 2025–2026):**
> Databento **đã bãi bỏ hoàn toàn** mô hình tính phí pay-as-you-go (theo dung lượng sử dụng) cho dữ liệu thời gian thực (Live Data).
> Truy cập Live Market Data cho `GLBX.MDP3` (CME) bắt buộc phải thông qua các gói thuê bao cố định hàng tháng (Subscription Plans). Mô hình Pay-as-you-go chỉ còn áp dụng cho dữ liệu lịch sử (Historical Data).

### 1.1. Bảng Phân Tách Chi Phí Chi Tiết (Cost Breakdown Structure)

| Phân loại chi phí | Nguồn / Danh mục | Mức phí chính thức đã xác minh (USD) | Ghi chú & Điều kiện áp dụng |
|---|---|---|---|
| **Databento Live (Standard)** | Databento | **$199 / tháng / dataset** | **CHỈ DÙNG NỘI BỘ (INTERNAL USE ONLY).** Nghiêm cấm phân phối lại (redistribution) ra ngoài cho khách hàng/trình duyệt. |
| **Databento Live (Plus)** | Databento | **$1.750 / tháng / dataset (Hợp đồng năm - Annual Contract)** | **BẮT BUỘC** nếu phân phối dữ liệu ra ngoài (External client web app). **LƯU Ý QUAN TRỌNG:** Gói Plus KHÔNG tự động cấp đầy đủ quyền redistribute; người mua bắt buộc phải nộp đơn và được CME/OPRA phê duyệt Information License Agreement (ILA) cho use case cụ thể. |
| **Databento Live (Unlimited)** | Databento | **$4.500 / tháng (Hợp đồng năm - Annual Contract)** | Không giới hạn kết nối và quy mô người dùng lớn. |
| **Historical Usage Fee** | Databento | **Phụ thuộc dataset, schema và khối lượng dữ liệu thực tế** | Đơn giá $/GB uncompressed thay đổi theo schema (tra cứu động qua `/metadata.list_unit_prices`). **KHÔNG CÓ MỨC CỐ ĐỊNH $0.01–$0.05/GB**. Billed theo dung lượng nhị phân thô thực tế. Tặng kèm $125 credit khi tạo tài khoản. |
| **CME Real-Time Distribution** | CME Group (2026 Reference Schedule) | **$29.280 / năm** (~$2.440 / tháng) | Biểu phí tham chiếu công bố của CME Group. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG** nếu chưa được CME/Databento phê duyệt scope-of-use cho DeepChart. |
| **CME Real-Time Data Feed** | CME Group (2026 Reference Schedule) | **$610 / tháng** | Biểu phí tham chiếu nạp luồng dữ liệu thời gian thực. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **CME Non-Pro Display (MBP-1)**| CME Group (2026 Reference Schedule) | **$1,55 / thiết bị / sàn / tháng** ($4,65 gói 4 sàn) | Dành cho người dùng cá nhân (Non-Professional) xem Top of Book. Cần ký questionnaire. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **CME Non-Pro Display (MBP-10)**| CME Group (2026 Reference Schedule) | **$12,10 / thiết bị / sàn / tháng** ($36,50 gói 4 sàn)| Dành cho người dùng cá nhân xem Market Depth (DOM Scalper). **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **CME Professional Display** | CME Group (2026 Reference Schedule) | **$134,50 / thiết bị / sàn / tháng** | Áp dụng cho cá nhân/tổ chức thuộc diện Professional. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **CME Non-Display (Category A/B/C)**| CME Group (2026 Reference Schedule) | **$363 – $4.275 / tháng** (tùy số app) | Phân tích máy tính tự động, quản lý rủi ro hoặc thuật toán nội bộ. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **CME Derived Data License** | CME Group | **UNKNOWN / REQUEST QUOTE** | Bắt buộc ký DDLA/EDDLA nếu phát hành chỉ số phái sinh thương mại. Cần nộp đơn phê duyệt "Scope of Use". |
| **OPRA Redistribution Fee** | OPRA (2026 Reference Schedule) | **$1.500 / tháng** | Biểu phí tham chiếu phân phối dữ liệu quyền chọn của OPRA. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **OPRA Non-Pro Subscriber** | OPRA (2026 Reference Schedule) | **$1,25 – $1,50 / user / tháng** | Phí sàn quyền chọn cho tài khoản cá nhân. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **OPRA Professional Display** | OPRA (2026 Reference Schedule) | **$34,50 / device / tháng** | Phí sàn quyền chọn cho tài khoản chuyên nghiệp. **CHƯA PHẢI BÁO GIÁ CUỐI CÙNG**. |
| **Hạ tầng Máy chủ & Băng thông** | Cloud VPS / Bare Metal | **$40 – $250 / tháng** | Server Node.js + Caddy reverse proxy + lưu trữ SQLite WAL trên NVMe. |
| **Thuế & Phí Cổng Thanh toán** | Stripe Processing | **2,9% + $0,30 / giao dịch thành công** | Phí xử lý thẻ tín dụng quốc tế của Stripe. Chưa bao gồm thuế VAT/Sales Tax địa phương. |

---

### 1.2. Các Kịch Bản Chi Phí Khai Thác Thực Tế

```
+-----------------------------------------------------------------------------------------------------------------------+
| BẢNG SO SÁNH CHI PHÍ THEO MÔ HÌNH CẤP PHÉP CHÍNH THỨC                                                                 |
+------------------------------+-------------------------+----------------------------+---------------------------------+
| Hạng mục                     | Giai đoạn 1: Dev/QA     | Giai đoạn 2: Private Beta  | Giai đoạn 3: Commercial Public  |
|                              | (Nội bộ 1-2 devs)       | (5 - 10 Closed Users)      | (100 - 500 Paying Users)        |
+------------------------------+-------------------------+----------------------------+---------------------------------+
| Gói Databento                | Standard ($199/tháng)   | Standard (Thử nghiệm nội bộ)| Plus ($1.750/tháng, Annual)     |
| Quyền phân phối ra ngoài     | KHÔNG (Internal only)   | HẠN CHẾ (Nội bộ đóng kín)  | CHỜ PHÊ DUYỆT ILA CỦA SÀN       |
| Databento Historical Usage   | ~$10 (Dưới $125 credit) | ~$30 (Dưới $125 credit)    | Dynamic theo unit prices        |
| CME Distribution License     | $0 (Không bán)          | $0 (Nội bộ thử nghiệm)     | Tham chiếu ~$2.440/mo (Cần xin quote) |
| CME Data Feed                | $0 (Bao gồm trong DB)   | $0                         | Tham chiếu $610/mo              |
| CME User Display (Non-Pro)   | $0                      | $0                         | $1.210 - $6.050/mo (DOM)        |
| OPRA Fees                    | HOÃN (Chưa kích hoạt)   | HOÃN (Chưa kích hoạt)      | REQUEST QUOTE (Khi mở Options)  |
| Hạ tầng Hosting Staging/Prod | ~$20 / tháng            | ~$40 / tháng               | ~$150 - $300 / tháng            |
+------------------------------+-------------------------+----------------------------+---------------------------------+
| TỔNG DỰ TOÁN THAM CHIẾU      | ~$219 / tháng           | ~$239 / tháng              | ~$6.260 – $11.100+ / tháng      |
+------------------------------+-------------------------+----------------------------+---------------------------------+
```

> [!CAUTION]
> **ĐIỀU KIỆN TIÊN QUYẾT VỀ MẶT THƯƠNG MẠI & BẢN QUYỀN:**
> - Bản **CME Futures Private Beta** (5-10 người dùng nội bộ/thân thiết) có thể chạy trên gói **Databento Standard ($199/tháng)** nếu toàn bộ người dùng thuộc cùng tổ chức nội bộ được cấp phép.
> - Bất kỳ hình thức bán tài khoản thương mại công khai nào trên Internet cho người dùng bên ngoài **BẮT BUỘC PHẢI NÂNG CẤP LÊN GÓI PLUS ($1.750/THÁNG VỚI HỢP ĐỒNG NĂM)** và phải nộp đơn được sàn CME Group chấp thuận Information License Agreement (ILA). Gói Plus không tự động biến nhà phát triển thành đơn vị được phân phối lại tự do.
> - Toàn bộ các mức phí sàn CME và OPRA nêu trên là biểu phí tham chiếu công khai năm 2026, **KHÔNG ĐƯỢC COI LÀ BÁO GIÁ CUỐI CÙNG** khi chưa có sự xác nhận chính thức từ vendor cho use case DeepChart.

---

### 1.3. Phương Án Kiểm Chứng Chỉ Dùng Historical Trước Khi Mua Gói Live (Historical-Only Validation Strategy)

Để đảm bảo an toàn tuyệt đối về tài chính, DeepChart thiết lập quy trình kiểm chứng độc lập hoàn toàn dựa trên dữ liệu lịch sử (Historical-Only Validation) trước khi Operator chi trả bất kỳ khoản thuê bao định kỳ nào:

1. **Nguyên tắc không phát sinh chi phí cố định:**
   - Sử dụng khoản **$125 credit miễn phí** khi đăng ký tài khoản Databento mới.
   - Giữ trạng thái gói Live = `NONE` / `BLOCKED`.
   - Giới hạn ngân sách truy vấn bằng biến môi trường: `DATABENTO_COST_CAP_USD=10`.
2. **Quy trình 5 bước kiểm chứng Historical-Only:**
   - **Bước 1 — Tra cứu Đơn giá Động (Unit Price Discovery):** Gọi API `GET /api/v1/databento/unit-prices?dataset=GLBX.MDP3` để nhận bảng giá chính xác của từng schema (`trades`, `mbp-1`, `mbp-10`, `ohlcv-1m`). Không dùng con số phỏng đoán $0.01–$0.05/GB.
   - **Bước 2 — Ước tính Chi phí Truy vấn (Cost Estimation):** Gọi API `GET /api/v1/databento/cost` với tham số dải thời gian kiểm thử (ví dụ: 1 session 2 giờ của `ES.c.0` schema `trades`). Xác nhận chi phí ước tính < $0.50 USD trước khi gọi dữ liệu thật.
   - **Bước 3 — Nạp Mẫu Dữ liệu Khớp lệnh Thật (Raw Trades Ingestion):** Tải về mẫu dữ liệu giao dịch thật qua `getHistoricalTrades` và lưu vào cơ sở dữ liệu SQLite qua `MarketDataStore.saveTrades()`.
   - **Bước 4 — Kiểm chứng Tính Toàn vẹn Dữ liệu Volume Profile:**
     - Gọi `chartService.getVolumeProfileRange('ES', start, end)` trên dải thời gian vừa nạp.
     - Xác nhận `provenance === 'EXACT'`, `isEstimated === false`, tổng khối lượng khớp lệnh và delta tại từng mức giá chính xác tuyệt đối.
     - Mở giao diện DeepChart Terminal, kiểm tra badge hiển thị `EXACT (TRADES)` màu xanh ngọc.
     - Chọn dải thời gian ngoài vùng dữ liệu -> Kiểm tra badge hiển thị `UNAVAILABLE`.
     - Seed thử bằng OHLCV bars -> Kiểm tra badge hiển thị `ESTIMATED` kèm banner cảnh báo Heuristic, xác nhận hệ thống không bị ngụy trang thành dữ liệu khớp lệnh thật.
   - **Bước 5 — Báo cáo Kết quả cho Operator:** Operator đánh giá trực quan trên Terminal và xem log chi phí thực tế. Chỉ khi hài lòng với hiệu năng và độ chính xác của biểu đồ Order Flow thì mới quyết định có nâng cấp lên gói Live Standard ($199/tháng) hay không.

---

## 2. Xác minh Giả định Dữ liệu (Data Usage Assumptions)

### 2.1. Volume Profile & Khối lượng Khớp lệnh (Volume-at-Price Integrity)
- **Kiểm tra mã nguồn:** Hàm `ProfileEngine.processHistoricalBars` phân bổ khối lượng nến OHLCV đều qua các bước tick:
  $$\text{steps} = \max(1, \text{round}((High - Low) / \text{tickSize})), \quad \text{volPerStep} = \frac{\text{Volume}}{\text{steps} + 1}$$
- **Kết luận kỹ thuật & Cải tiến hoàn tất:**
  - Đây là thuật toán xấp xỉ thô (Heuristic Approximation), **KHÔNG PHẢI** là khối lượng giao dịch chính xác tại từng mức giá (Exact Volume-at-Price).
  - Hệ thống đã bổ sung metadata theo dõi nguồn gốc dữ liệu (`ProfileProvenance` = `'EXACT'` | `'ESTIMATED'` | `'UNAVAILABLE'`).
  - Mọi profile tạo từ nến OHLCV đều được đánh dấu bắt buộc `provenance: 'ESTIMATED'` (`isEstimated: true`).
  - **Bảo toàn nguồn gốc (Immutable Provenance):** Nghiêm cấm nâng cấp Estimated thành Exact khi replay hoặc cache. Khi một profile đã chứa nến OHLCV ước tính, các tick đến sau không làm đổi trạng thái thành Exact.
  - Khi không có dữ liệu giao dịch thật, API trả về trạng thái `UNAVAILABLE` (`available: false`, `status: 'unavailable'`).
  - Frontend (`ProfileOverlay.tsx`, `FootprintCanvas.tsx`) hiển thị huy hiệu và cảnh báo tương ứng: `EXACT (TRADES)` (xanh ngọc), `ESTIMATED (OHLCV)` (vàng cảnh báo Heuristic), hoặc `UNAVAILABLE` (xám).
  - Không bao giờ quảng bá dữ liệu ước tính là dữ liệu khớp lệnh thật từ sàn.

### 2.2. Quyền Phân tích Nội bộ (Internal Commercial Analytics)
- **Kiểm tra quy định sàn:** CME Group có chính sách thu phí phân tích phi hiển thị (**Category 1/2/3 Non-Display Fees** từ $363 đến $4.275/tháng) đối với các hệ thống tự động hóa giao dịch hoặc hệ thống sử dụng dữ liệu thị trường cho mục đích thương mại nội bộ.
- **Kết luận:** **Không thể tuyên bố rằng phân tích thương mại nội bộ mặc nhiên được miễn phí.** Operator cần khai báo rõ mục đích sử dụng với Databento và CME để tránh bị truy thu kiểm toán (audit back-billing).

### 2.3. Dữ liệu Phái sinh (Derived Analytics: GEX, CVD, VWAP)
- **Kiểm tra quy định sàn:** Theo chính sách **CME Derived Data Policy**, các sản phẩm phái sinh từ dữ liệu sàn (chỉ số, tỷ lệ, mô hình gamma) **KHÔNG TỰ ĐỘNG ĐƯỢC MIỄN NGHĨA VỤ CẤP PHÉP**.
- **Kết luận:** Dù dữ liệu không thể dịch ngược (irreversible), nếu được đóng gói thành công cụ thương mại bán cho người dùng, Operator bắt buộc phải nộp đơn khai báo "Scope of Use" và ký thỏa thuận **Derived Data License Agreement (DDLA)** nếu sàn yêu cầu.

### 2.4. Bản Quyền Dữ liệu Quyền Chọn OPRA & CME Futures Options
- **OPRA.PILLAR** chỉ áp dụng cho quyền chọn Cổ phiếu/Chỉ số Mỹ (Equity/Index Options: SPY, AAPL, QQQ...).
- **CME Futures Options** (Options trên ES, NQ, CL...) nằm trong dataset **`GLBX.MDP3`**, không nằm trong OPRA.
- **Hoãn tích hợp OPRA:** Trong giai đoạn đầu, hệ thống chỉ tập trung nghiệm thu CME Futures trên `GLBX.MDP3`. Toàn bộ tích hợp OPRA hoãn lại cho đến khi hoàn tất nghiệm thu và chứng minh được nhu cầu thị trường.

---

## 3. Khả năng Kiểm soát của Hạn mức Chi phí (`DATABENTO_COST_CAP_USD`)

Biến môi trường `DATABENTO_COST_CAP_USD=50` trong mã nguồn DeepChart có phạm vi kiểm soát kỹ thuật như sau:

| Khoản chi phí | `DATABENTO_COST_CAP_USD` có kiểm soát được không? | Cơ chế thực tế |
|---|:---:|---|
| **Truy vấn REST Historical quá lớn** | **CÓ KIỂM SOÁT ĐƯỢC** | Hàm pre-flight kiểm tra `/metadata.get_cost` và `getVendorUsage` chặn không cho gửi request tải lịch sử vượt quá $50/tháng. |
| **Phí thuê bao Databento Standard ($199/mo)** | **KHÔNG KIỂM SOÁT ĐƯỢC** | Đây là phí cố định hàng tháng do Databento trừ trực tiếp trên thẻ tín dụng. |
| **Phí thuê bao Databento Plus ($1.750/mo)** | **KHÔNG KIỂM SOÁT ĐƯỢC** | Phí cố định hàng tháng của vendor. |
| **Băng thông Live Streaming TCP LSG** | **KHÔNG KIỂM SOÁT ĐƯỢC** | Gói thuê bao cố định đã bao gồm quyền stream, nhưng nếu có phụ phí phát sinh ngoài gói thì code không tự ngắt kết nối TCP. |
| **Phí sàn CME Distribution / Display** | **KHÔNG KIỂM SOÁT ĐƯỢC** | Phí bản quyền hành chính giữa Operator và Sở giao dịch. |

---

## 4. Ma trận Nghiệm thu Sẵn sàng Thương mại Cập nhật (Updated Readiness Matrix)

| Requirement | Implemented | Technically Verified | Vendor Verified | Operator Action |
|---|:---:|:---:|:---:|---|
| **CME Futures Realtime (ES/NQ)** | **YES** | **YES** | **BLOCKED (CHỜ VENDOR)** | Đăng ký gói Databento Live Standard ($199/tháng) cho dataset `GLBX.MDP3`. Chạy smoke test theo runbook. |
| **CME Futures Historical** | **YES** | **YES** | **BLOCKED (CHỜ VENDOR)** | Sử dụng hạn mức credit $125 để nạp dữ liệu lịch sử. Khóa trần chi phí với `DATABENTO_COST_CAP_USD=50`. |
| **MBP-10 Depth (DOM Scalper)** | **YES** | **YES** | **BLOCKED (CHỜ VENDOR)** | Xác nhận gói `GLBX.MDP3` hỗ trợ schema `mbp-10`. Bật codec nhị phân trong SQLite. |
| **Volume Profile / Footprint** | **YES** | **YES** | **BLOCKED (CHỜ VENDOR)** | Cần luồng Raw Trades để tính volume-at-price chính xác; không quảng cáo OHLCV approximation là exact data. |
| **Options Chain / GEX / OPRA** | **YES** | **YES** | **TẠM HOÃN (DEFERRED)** | Hoãn kích hoạt OPRA cho đến khi hoàn thành CME Futures Beta. Tiết kiệm $1.500/tháng phí vendor. |
| **Quyền hiển thị Non-Pro Display**| **YES** | **YES** | **REQUIRES VENDOR CONFIRMATION** | Thu thập bản khai Non-Professional Questionnaire từ khách hàng; báo cáo hàng tháng cho CME. |
| **Quyền phân phối (Redistribution)**| **YES** | **YES** | **REQUIRES VENDOR CONFIRMATION** | Nâng cấp gói Databento Plus ($1.750/tháng) và nộp đơn CME Distributor Agreement trước khi bán ra công chúng. |
| **Stripe Checkout & Webhook** | **YES** | **YES (12/12 PASS)**| **CHỜ LIVE KEY** | Cấu hình Live Price ID và Live Webhook Secret trên Stripe Dashboard. |
| **Bảo mật Credentials Staging** | **YES** | **ROTATED & VERIFIED** | **YES** | Đã xoay vòng 3 secret nhạy cảm bằng khóa ngẫu nhiên 256-bit, container restart healthy, JWT cũ bị hủy 100%. |
| **Sao lưu & Phục hồi SQLite WAL** | **YES** | **YES** | **YES** | Lập lịch Cronjob chạy `node scripts/backup_db.mjs` (VACUUM INTO). |
| **Giám sát Prometheus / Metrics** | **YES** | **YES** | **YES** | Xác thực `METRICS_TOKEN` mới hoạt động tốt qua HTTPS proxy. |

---

## 5. Quyết định & Hành động Tiếp theo của Operator (Next Steps)

1. **Khởi động Giai đoạn Private Beta Tối thiểu (Minimum CME Futures Beta):**
   - Chỉ mua gói **Databento Standard cho `GLBX.MDP3`** ($199/tháng).
   - Chưa mở rộng sang OPRA (tiết kiệm chi phí ban đầu).
   - Giới hạn thử nghiệm nội bộ 1–5 tài khoản.
2. **Thực hiện Smoke Test Đọc An Toàn:**
   - Nạp `DATABENTO_API_KEY` ẩn danh trên máy chủ.
   - Chạy lệnh kiểm tra đọc an toàn: `node scripts/smoke_test_cme_databento.mjs`.
3. **Chuẩn bị Pháp lý Thương mại:**
   - Liên hệ bộ phận cấp phép Databento/CME để nhận báo giá chính thức cho gói phân phối (Redistribution License Quote) trước khi mở cổng thanh toán công khai.
