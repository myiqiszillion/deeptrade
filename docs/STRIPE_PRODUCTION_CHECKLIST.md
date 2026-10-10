# CHECKLIST & HƯỚNG DẪN TRIỂN KHAI STRIPE PRODUCTION

## 1. Tổng quan Kiến trúc Thanh toán DeepChart

DeepChart tích hợp cổng thanh toán Stripe với triết lý thiết kế tối giản, an toàn và độc lập phụ thuộc:
- **Zero-SDK Architecture:** Không sử dụng thư viện `@stripe/stripe-node` cồng kềnh nhằm giữ cho container production siêu nhẹ (~25MB RSS), bảo mật chuỗi cung ứng (supply-chain security), và kiểm soát 100% định dạng dữ liệu truyền thông qua `node:crypto` và `fetch`.
- **Phân quyền một chiều (Server-Side Authority):** Khách hàng/Browser không bao giờ tự gán quyền (entitlements). Quyền hạn (`free`, `pro`, `elite`) được phân giải tự động từ sự kiện webhook có chữ ký mật mã từ máy chủ Stripe.
- **Tính toán Toàn vẹn (Transactional Idempotency):** Sử dụng SQLite WAL mode với cơ chế giao dịch nguyên tử (`BEGIN IMMEDIATE` / `COMMIT`), đảm bảo mọi cập nhật gói cước và ghi nhận nhật ký kiểm toán (`webhook_events`) diễn ra đồng thời hoặc rollback 100%.

---

## 2. Kết quả Nghiệm thu Kỹ thuật Chế độ Test-Mode (Technical Verification Matrix)

Tất cả 12 kịch bản kỹ thuật cốt lõi đã được kiểm chứng tự động và đạt **PASS 100%**:

| Kịch bản kiểm thử | Trạng thái | Cơ chế kỹ thuật đảm bảo |
|---|---|---|
| **1. Webhook Signature Verification** | **PASS** | Kiểm tra định dạng `t=<ts>,v1=<sig>`, cửa sổ trôi thời gian 300s, so sánh hằng thời gian `timingSafeEqual`. Chặn đứng giả mạo hoặc replay. |
| **2. Event-level Idempotency** | **PASS** | Bảng SQLite `webhook_events` với khóa chính `id TEXT PRIMARY KEY`. Sự kiện trùng lặp trả về ngay HTTP 200 `idempotent: already processed`. |
| **3. Atomic Transaction Boundaries** | **PASS** | Đóng gói toàn bộ logic trong `marketDataStore.transaction(...)`. Không có trạng thái dở dang (partial write). |
| **4. Single Connection Consistency** | **PASS** | Sử dụng duy nhất 1 database handle trong `MarketDataStore`, tránh xung đột khóa hoặc phân mảnh kết nối. |
| **5. Duplicate Event Handling** | **PASS** | Bắt lỗi `SQLITE_CONSTRAINT_PRIMARYKEY` / `UNIQUE constraint failed`, tự động rollback và trả kết quả an toàn. |
| **6. Out-of-Order Stale Protection** | **PASS** | Khi subscription đã bị hủy (`canceled`), các sự kiện cập nhật cũ đến muộn (`created <= updatedAt` và không gia hạn chu kỳ) bị loại bỏ với `ignored: stale update`. |
| **7. Failed Payment (`invoice.payment_failed`)** | **PASS** | Tự động chuyển trạng thái subscription thành `past_due`, kích hoạt xử lý cảnh báo. |
| **8. Subscription Cancellation** | **PASS** | Bắt sự kiện `customer.subscription.deleted`, ngay lập tức thu hồi mọi entitlement của gói trả phí và chuyển người dùng về gói `free`. |
| **9. Legitimate Renewal** | **PASS** | Bắt sự kiện `customer.subscription.updated` có `current_period_end` nới rộng, tự động kéo dài hạn sử dụng và kích hoạt lại gói. |
| **10. Plan Downgrade** | **PASS** | Thu hồi các quyền cấp cao (ví dụ L2 Book, MBO) khi hạ từ `elite` xuống `pro` hoặc `free`, không để sót quyền thừa. |
| **11. Entitlement Expiration Fallback** | **PASS** | Hàm `billingService.getEffectivePlan` tự động kiểm tra `currentPeriodEnd < Date.now()` và trả về `free` nếu gói đã hết hạn. |
| **12. Crash / Rollback Recovery** | **PASS** | Lỗi phát sinh giữa chừng trong transaction sẽ kích hoạt `ROLLBACK` toàn diện, giữ nguyên trạng thái dữ liệu trước đó. |

---

## 3. Checklist Kích hoạt Stripe Production Dành cho Operator

> [!WARNING]
> Tuyệt đối không kích hoạt khóa Live hoặc thu tiền thật trước khi hoàn thành đầy đủ tất cả các bước dưới đây.

### Giai đoạn 1: Chuẩn bị trên Stripe Dashboard (Chế độ Live)

- [ ] **1. Hoàn tất xác minh pháp nhân (Business Verification):**
  - Đã nộp thông tin doanh nghiệp, tài khoản ngân hàng nhận tiền, và đại diện pháp luật trên Stripe Dashboard.
  - Tài khoản chuyển sang trạng thái `Activated` (Được phép nhận thanh toán thực).
- [ ] **2. Thiết lập Sản phẩm & Giá (Products & Pricing):**
  - Tạo Sản phẩm `DeepChart Pro` (Subscription hàng tháng, recurring USD).
  - Copy Price ID dạng `price_xxxxxxxxxxxxxxxx` vào biến môi trường: `STRIPE_PRICE_PRO`.
  - Tạo Sản phẩm `DeepChart Elite` (Subscription hàng tháng, recurring USD).
  - Copy Price ID dạng `price_xxxxxxxxxxxxxxxx` vào biến môi trường: `STRIPE_PRICE_ELITE`.
- [ ] **3. Cấu hình Cổng Khách hàng (Stripe Customer Portal):**
  - Kích hoạt Customer Portal trong Settings -> Billing -> Customer Portal.
  - Cho phép khách hàng tự cập nhật thẻ thanh toán và xem lịch sử hóa đơn.
- [ ] **4. Tạo Webhook Endpoint trên Stripe:**
  - URL nhận webhook: `https://<DOMAIN>/api/v1/billing/webhook` (Bắt buộc dùng HTTPS công khai với chứng chỉ hợp lệ).
  - Chọn phiên bản API Stripe mới nhất.
  - Đăng ký chính xác các sự kiện sau (không đăng ký thừa):
    1. `checkout.session.completed`
    2. `customer.subscription.created`
    3. `customer.subscription.updated`
    4. `customer.subscription.deleted`
    5. `invoice.payment_failed`
- [ ] **5. Trích xuất Khóa Bí mật Live (Live Credentials):**
  - Lấy `STRIPE_SECRET_KEY` (dạng `sk_live_...`).
  - Lấy Signing Secret của Webhook: `STRIPE_WEBHOOK_SECRET` (dạng `whsec_...`).

---

### Giai đoạn 2: Cấu hình Máy chủ Production

- [ ] **6. Nạp Khóa Bảo mật An toàn:**
  - Cập nhật file `.env` trên máy chủ production với phân quyền nghiêm ngặt (`chmod 600 .env`):
    ```env
    STRIPE_SECRET_KEY=sk_live_...
    STRIPE_WEBHOOK_SECRET=whsec_...
    STRIPE_PRICE_PRO=price_...
    STRIPE_PRICE_ELITE=price_...
    ```
  - Tuyệt đối không commit file này vào Git.
- [ ] **7. Kiểm tra Tên miền & Chứng chỉ SSL/TLS:**
  - Đảm bảo Caddy Proxy đã cấp phát chứng chỉ HTTPS hợp lệ từ Let's Encrypt / ZeroSSL cho domain công khai.
  - Stripe từ chối gửi webhook tới các endpoint có chứng chỉ tự ký (self-signed certificate) trong chế độ Live.

---

### Giai đoạn 3: Kiểm thử Smoke Test Trên Môi trường Production

- [ ] **8. Giao dịch Thử nghiệm Giá trị Nhỏ (Live Smoke Test):**
  - Dùng thẻ tín dụng thật thực hiện 1 giao dịch đăng ký gói `pro` (hoặc tạo mã giảm giá 100% trên Stripe Live để test không mất phí).
  - Kiểm tra log container:
    - Nhận webhook `checkout.session.completed`.
    - Trả lời HTTP 200.
    - Cột `outcome` trong bảng `webhook_events` ghi nhận `plan pro -> active`.
  - Kiểm tra giao diện người dùng: Tài khoản được nâng cấp ngay lập tức sang gói `pro`.
- [ ] **9. Kiểm tra Hủy Gói (Cancellation Smoke Test):**
  - Hủy gói từ Stripe Dashboard hoặc Customer Portal.
  - Xác nhận webhook `customer.subscription.deleted` được tiếp nhận và xử lý, quyền truy cập của tài khoản chuyển về `free`.
- [ ] **10. Ký Biên bản Nghiệm thu Vận hành Thanh toán Thương mại.**
