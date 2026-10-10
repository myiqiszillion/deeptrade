# RUNBOOK: DATABENTO LIVE FEED VALIDATION

## 1. Giới thiệu & Mục đích

Tài liệu này là quy trình chuẩn (Standard Operating Procedure - SOP) dành cho Operator để thực hiện kiểm chứng và nghiệm thu kỹ thuật kết nối dữ liệu trực tiếp (**Live Feed Validation**) từ nhà cung cấp **Databento** cho hệ thống DeepChart.

> [!IMPORTANT]
> **Nguyên tắc An toàn Tuyệt đối:**
> 1. **Không chạy kiểm thử Live khi chưa có API Key hợp lệ và Quyền dữ liệu (Entitlements) được cấp phép.**
> 2. **Chính sách Zero-Mock & Fail-Closed:** Khi vendor offline, chưa cấu hình, hoặc gặp lỗi xác thực, hệ thống phải trả trạng thái `UNAVAILABLE` hoặc `503 VENDOR_NOT_CONFIGURED`. Tuyệt đối không sinh dữ liệu giả (no synthetic ticks/bars).
> 3. **Bảo vệ Secret:** Không bao giờ in, log hoặc hiển thị `DATABENTO_API_KEY` ra console, file log, hoặc màn hình chat.

---

## 2. Điều kiện Tiên quyết Môi trường (Environment Requirements)

| Tiêu chí | Yêu cầu kỹ thuật | Phương thức kiểm tra |
|---|---|---|
| **Runtime** | Node.js `>= 22.13.0` (Node 24 LTS khuyến nghị), OpenSSL 3.0+ | `node -v` |
| **Network Egress (TCP)** | Port `13000` outbound tới `*.lsg.databento.com` (Live Streaming Gateway - LSG) | `nc -zv glbx-mdp3.lsg.databento.com 13000` |
| **Network Egress (HTTPS)** | Port `443` outbound tới `hist.databento.com` (REST API) | `curl -sI https://hist.databento.com/v0/metadata.list_datasets` |
| **DNS Resolution** | Phân giải nhanh tên miền nội bộ Databento (`*.databento.com`) | `nslookup hist.databento.com` |
| **Hệ thống OS** | Linux x86_64 / Alpine Container / Windows Server (WSL2) | `uname -a` |

---

## 3. Quy trình Nạp Khóa An Toàn Không Ghi Log (Credential Injection Without Logging)

Tuyệt đối không sử dụng `docker compose exec app printenv` hoặc `console.log(process.env)` vì sẽ làm rò rỉ API key vào lịch sử shell và nhật ký container.

### Bước 3.1: Nạp qua file môi trường bảo mật trên máy chủ
```bash
# Đảm bảo tắt echo lệnh trong bash/sh trước khi export secret
set +o history
export DATABENTO_API_KEY="db-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
set -o history

# Hoặc ghi trực tiếp vào file .env với phân quyền nghiêm ngặt:
chmod 600 .env
```

### Bước 3.2: Cấu hình Container Docker Staging/Production
Trong `docker-compose.yml`, chuyển biến môi trường vào container mà không hard-code:
```yaml
services:
  app:
    environment:
      - DATABENTO_API_KEY=${DATABENTO_API_KEY}
      - DATABENTO_COST_CAP_USD=50
      - DATABENTO_CME_DATASET=GLBX.MDP3
      - DATABENTO_OPRA_DATASET=OPRA.PILLAR
```

---

## 4. Kiểm chứng Quyền Dataset (Dataset Entitlement Checks)

Trước khi kích hoạt streaming hoặc kéo lịch sử diện rộng, phải xác minh tài khoản đã được cấp quyền trên các dataset mục tiêu:

### Lệnh kiểm tra danh sách Datasets khả dụng:
```bash
curl -s -u "$DATABENTO_API_KEY:" "https://hist.databento.com/v0/metadata.list_datasets"
```
**Kết quả mong đợi:** JSON array chứa ít nhất:
- `"GLBX.MDP3"` (CME Globex MDP 3.0)
- `"OPRA.PILLAR"` (OPRA Options)

### Lệnh kiểm tra dải thời gian khả dụng (Dataset Range):
```bash
curl -s -u "$DATABENTO_API_KEY:" "https://hist.databento.com/v0/metadata.get_dataset_range?dataset=GLBX.MDP3"
```
**Kết quả mong đợi:** Trả về `{ "start": "2018-...", "end": "..." }`.

---

## 5. Xác minh Metadata Công cụ & Ký hiệu Phái sinh (Instrument Metadata & Symbology)

### 5.1. Futures Symbol Resolution
Databento hỗ trợ 3 dạng symbology chính cho CME Futures:
1. **Continuous Front Month (`continuous`):** Ví dụ `ES.c.0`, `NQ.c.0` (Hợp đồng gần nhất tự động cuộn).
2. **Parent Contract (`parent`):** Ví dụ `ES.FUT`, `NQ.FUT` (Tất cả kỳ hạn futures thuộc root).
3. **Outright Contract (`raw_symbol`):** Ví dụ `ESM4`, `NQZ4` (Hợp đồng cụ thể theo tháng và năm).

**Kiểm tra Symbology Resolution Endpoint:**
```bash
curl -s -u "$DATABENTO_API_KEY:" \
  "https://hist.databento.com/v0/symbology.resolve?dataset=GLBX.MDP3&symbols=ES.c.0&stype_in=continuous&stype_out=instrument_id&start_date=$(date +%Y-%m-%d)"
```
**Kết quả mong đợi:** Ánh xạ thành công `ES.c.0` sang một `instrument_id` nguyên dương (uint32).

### 5.2. Khớp Metadata với `server/src/futuresConfig.ts`
Xác minh bảng thông số nội bộ của DeepChart khớp hoàn toàn với thông số sàn:
- `ES`: `tickSize = 0.25`, `pointValue = 50`, `multiplier = 50`.
- `NQ`: `tickSize = 0.25`, `pointValue = 20`, `multiplier = 20`.
- `CL`: `tickSize = 0.01`, `pointValue = 1000`, `multiplier = 1000`.
- `GC`: `tickSize = 0.10`, `pointValue = 100`, `multiplier = 100`.

---

## 6. Kiểm chứng Luồng Realtime Trades & MBP-10

### 6.1. Giao thức Kết nối TCP LSG (Live Streaming Gateway)
`DatabentoLiveClient` trong DeepChart kết nối trực tiếp qua socket TCP tới:
- Host: `<dataset-subdomain>.lsg.databento.com` (Ví dụ: `glbx-mdp3.lsg.databento.com`)
- Port: `13000`

### 6.2. Quy trình Bắt tay CRAM-SHA256
1. LSG gửi chuỗi thách thức: `cram=<challenge_string>\n`
2. DeepChart tính HMAC-SHA256 và gửi phản hồi:
   ```text
   auth=<sha256(challenge|apiKey)>-<bucketId>|dataset=GLBX.MDP3|encoding=dbn|ts_out=0|compression=none|client=DeepChart/1.0.0\n
   ```
3. LSG phản hồi `success=1`.
4. DeepChart gửi lệnh đăng ký luồng:
   ```text
   schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=0\n
   schema=mbp-1|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1\n
   start_session=1\n
   ```

### 6.3. Giải mã Nhị phân DBN Record & Độ chính xác Số học
- **Độ dài Header:** 16 bytes (`MAGIC: DBN`).
- **Trades (`rtype = 0x00`, length = 48 bytes):**
  - Giá: `int64` fixed-point chia cho `1e9` (ví dụ `5850250000000n` -> `5850.25`).
  - Khối lượng: `uint32` size.
  - Bên chủ động (Aggressor side): `B` -> `BUY`, `A` -> `SELL` (nguyên bản sàn `EXCHANGE_NATIVE`).
- **MBP-10 Depth (`rtype = 0x02`, length = 368 bytes):**
  - Đủ 10 bậc giá bid và ask.
  - Quy tắc tính toàn vẹn: Bids giảm dần đơn điệu (`bid[0] > bid[1] > ... > bid[9]`), Asks tăng dần đơn điệu (`ask[0] < ask[1] < ... < ask[9]`).

---

## 7. Tính Nhất quán Giữa Dữ liệu Lịch sử & Dữ liệu Trực tiếp (Historical/Live Consistency)

Khi DeepChart khởi động hoặc người dùng đổi symbol:
1. Hệ thống gọi `getHistoricalBars('GLBX.MDP3', symbol, 'ohlcv-1m', ...)` để nạp nến quá khứ.
2. Song song đó, `DatabentoLiveClient` mở kết nối nhận luồng ticks.
3. **Tiêu chí Nghiệm thu:**
   - Mốc thời gian của nến lịch sử cuối cùng (`bar.time`) phải nhỏ hơn hoặc bằng mốc thời gian của tick live đầu tiên (`tick.ts`).
   - Mức giá đóng cửa của nến lịch sử gần nhất (`lastBar.close`) phải tương thích với giá của tick live đầu tiên trong ngưỡng biên độ nến (`lastBar.low <= tick.price <= lastBar.high`).
   - Không xuất hiện bước nhảy giá phi lý (price dislocation) do sai lệch đơn vị thập phân (ví dụ sai số 1e9).

---

## 8. Phát hiện Mất Gói & Đứt đoạn Dữ liệu (Data Gap Detection & Reconnect)

1. **Sequence ID Gap:** Mỗi bản tin trade từ DBN mang `sequence` (uint32). Nếu `seq_current != seq_prev + 1`, ghi log cảnh báo packet drop.
2. **Heartbeat / Socket Silence:** Nếu không nhận được dữ liệu quá 30 giây trong phiên giao dịch chính (RTH), client kích hoạt thăm dò.
3. **Tự động Phục hồi (Exponential Backoff):**
   - Lần 1: 1.000 ms.
   - Lần 2: 2.000 ms.
   - Lần 3: 4.000 ms.
   - Giới hạn tối đa: 30.000 ms.
   - Trong suốt thời gian mất kết nối, server phát sóng trạng thái `FeedStatusEvent { state: 'UNAVAILABLE' }` tới client giao diện.

---

## 9. Kiểm soát Chi phí Khai thác (Cost Limits & Quota Guard)

1. **Biến môi trường `DATABENTO_COST_CAP_USD`:** Cấu hình giới hạn chi phí hàng tháng (mặc định `$50.00`).
2. **Pre-flight Estimation:**
   Trước khi thực hiện các truy vấn lịch sử lớn, DeepChart tự động gọi:
   ```bash
   GET /metadata.get_cost?dataset=GLBX.MDP3&schema=trades&symbols=ES.c.0&start=...&end=...
   ```
3. **Ngắt Khẩn cấp (Hard Cutoff):**
   - Khi tổng chi phí tích lũy trong tháng vượt quá `DATABENTO_COST_CAP_USD`, các truy vấn mới bị từ chối với cảnh báo log `cost cap hit, serving store only`.

---

## 10. Kịch bản Xử lý Lỗi Fail-Closed (Fail-Closed Scenarios)

| Tình huống lỗi | Hành vi hệ thống kỳ vọng | Dấu hiệu nhận biết |
|---|---|---|
| **Chưa cấu hình API Key** | Trả về HTTP 503 `VENDOR_NOT_CONFIGURED`, WebSocket thông báo `UNAVAILABLE`. Không gọi network. | Log: `Feed provider 'databento' starting for ES`, trạng thái `UNAVAILABLE` |
| **API Key sai / Thu hồi** | Bắt lỗi 401 trên REST, TCP LSG nhận `success=0` -> Ngắt kết nối ngay lập tức, không retry dồn dập. | Log: `Databento auth failed: Authentication failed` |
| **Dataset chưa mua quyền** | REST trả HTTP 422 hoặc 403 `dataset not entitled`. Server không crash. | Log: `Databento API error 422/403` |
| **Mất kết nối Internet** | TCP socket trigger event `error` / `close` -> Đưa feed về `UNAVAILABLE`, kích hoạt backoff timer. | Log: `TCP error: ... reconnect in 1000ms` |
| **Dữ liệu trả về rỗng (Hết giờ giao dịch)** | Trả mảng rỗng `[]`, không tự vẽ nến giả lập. Giao diện hiển thị trạng thái chờ thị trường mở cửa. | HTTP 200 `[]`, `recordCount: 0` |

---

## 11. Quy trình Smoke Test Đọc An Toàn Phạm vi Tối thiểu (Minimum CME Smoke Test)

Để giảm thiểu tối đa rủi ro phát sinh chi phí ngoài ý muốn và đảm bảo kiểm chứng từng bước vững chắc:
1. **Phạm vi kiểm thử tối thiểu:** Chỉ thực hiện trên **01 hợp đồng CME Futures duy nhất (`ES.c.0` hoặc outright `ESZ4`/`ESH5`)** thuộc dataset `GLBX.MDP3`.
2. **Tạm hoãn OPRA:** **Tuyệt đối không mở rộng sang OPRA.PILLAR** trong đợt thử nghiệm này. Chỉ xem xét OPRA sau khi luồng CME Futures đã chứng minh hoạt động hoàn hảo và có nhu cầu thương mại thực tế.
3. **Ước tính chi phí trước khi gọi API (Pre-flight Estimation):** Bắt buộc kiểm tra `/metadata.get_cost` trước khi thực hiện bất kỳ truy vấn nào. Nếu chi phí ước tính vượt quá `$0.50 USD`, hủy lệnh ngay lập tức.
4. **Lệnh thực thi Smoke Test an toàn:**
   ```bash
   # Chạy chế độ Dry-Run (nếu chưa nạp key) hoặc kiểm chứng read-only (khi đã nạp key):
   node scripts/smoke_test_cme_databento.mjs
   ```
5. **Tiêu chuẩn đạt (Exit Criteria):**
   - Phân giải thành công `ES.c.0` sang `instrument_id`.
   - Lấy tối đa 5 bản tin trades với giá là bội số của 0.25 tick size.
   - Trạng thái chuyển `LIVE` và ngắt kết nối sạch trong vòng 5 giây.
   - Chi phí thực tế tiêu tốn dưới `$0.05 USD`.

---

## 11b. Quy trình Kiểm chứng Historical-Only Trước Khi Kích Hoạt Gói Live

Để tránh mua gói thuê bao cố định $199 hay $1.750/tháng khi chưa kiểm chứng được hiệu năng thực tế:
1. **Sử dụng credit khởi động:** Databento tặng $125 credit khi mở tài khoản. Khoản này chỉ áp dụng cho Historical Data, không áp dụng cho Live Subscription.
2. **Kiểm tra đơn giá động của schema:**
   ```bash
   curl -s -u "$DATABENTO_API_KEY:" "https://hist.databento.com/v0/metadata.list_unit_prices?dataset=GLBX.MDP3"
   ```
   Xác nhận đơn giá uncompressed $/GB cho `trades`, `mbp-1`, `mbp-10`. Không giả định đơn giá cố định.
3. **Ước tính chi phí dải thời gian:**
   ```bash
   curl -s -u "$DATABENTO_API_KEY:" "https://hist.databento.com/v0/metadata.get_cost?dataset=GLBX.MDP3&symbols=ES.c.0&schema=trades&start=2026-03-01T14:30:00&end=2026-03-01T16:30:00"
   ```
4. **Nạp raw trades vào SQLite:** Dữ liệu khớp lệnh thật được lưu vào bảng `trades`.
5. **Kiểm tra Volume Profile Provenance trên DeepChart Terminal:**
   - Dải thời gian có raw trades: Badge hiển thị `EXACT (TRADES)` màu xanh ngọc. POC, VAH, VAL tính từ giao dịch thật.
   - Dải thời gian không có dữ liệu: Badge hiển thị `UNAVAILABLE`.
   - Seed từ nến OHLCV: Badge hiển thị `ESTIMATED` màu vàng kèm nhãn Heuristic; không bị nhầm lẫn với dữ liệu khớp lệnh thật.

---

## 12. Quy trình Dọn dẹp & Đóng Kết Nối (Cleanup Procedure)

Khi server tắt hoặc client chuyển symbol:
1. Gọi `databentoLiveClient.disconnect()`.
2. Hủy toàn bộ timer `reconnectTimer.unref()`.
3. Xóa các listener trên socket TCP (`socket.removeAllListeners()`).
4. Hủy socket ngay lập tức (`socket.destroy()`).
5. Đặt cờ `intentionallyClosed = true` để ngăn chặn tái kích hoạt vòng lặp reconnect.
6. Xác nhận không còn socket rò rỉ (leak) trên hệ điều hành.

---

## 13. Checklist Nghiệm thu Thực địa Dành cho Operator (Operator Acceptance Sign-off)

- [ ] 1. Kiểm tra biến môi trường: `DATABENTO_API_KEY` được nạp ẩn danh, không lộ trong log hay shell history.
- [ ] 2. Kiểm tra quyền dataset: `GLBX.MDP3` khả dụng trong danh sách trả về của `list_datasets`.
- [ ] 3. Kiểm tra symbol resolve: `ES.c.0` ánh xạ thành công sang `instrument_id`.
- [ ] 4. Chạy smoke test tối thiểu: `node scripts/smoke_test_cme_databento.mjs` thành công với chi phí < $0.05.
- [ ] 5. Kiểm tra nến lịch sử: `getHistoricalBars` trả về đúng định dạng OHLCV, volume > 0.
- [ ] 6. Kiểm tra kết nối TCP LSG: Handshake CRAM thành công, chuyển trạng thái sang `LIVE`.
- [ ] 7. Kiểm tra luồng Trades: Nhận tick thật, giá đúng điểm tick size (.25/.50/.75/.00), side là BUY/SELL.
- [ ] 8. Kiểm tra sổ lệnh MBP-10: 10 level bids/asks hợp lệ, không rỗng, độ sâu đúng thứ tự đơn điệu.
- [ ] 9. Kiểm tra ngắt kết nối an toàn: Tắt mạng, xác nhận server báo `UNAVAILABLE`, không sinh tick giả.
- [ ] 10. Khôi phục mạng: Xác nhận hệ thống tự động tái kết nối và khôi phục `LIVE`.
- [ ] 11. Ký biên bản nghiệm thu trước khi chuyển sang giai đoạn vận hành thương mại.
