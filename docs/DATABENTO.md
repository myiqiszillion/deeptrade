# Databento: gói $199 dùng được gì, và khi nào phải xin phép "bán lại"

> Tài liệu vận hành cho người đang trả tiền cho Databento (CME Standard, **$199/tháng**) và định chạy
> DeepChart như một sản phẩm. Không phải tư vấn pháp lý — nhưng đây là những điều **phải** kiểm tra
> trước khi thu tiền của người khác.

---

## 1. Gói $199/tháng bao gồm cái gì

Theo thông báo giá của Databento (hiệu lực **22/06/2026**) và các bài công bố trước đó:

| Hạng mục | Nội dung |
|---|---|
| Tên gói | CME **Standard** — gói neo theo CME Globex (MDP 3.0) |
| Giá | $199/tháng (nâng từ $179); khách cũ giữ $179 thêm 12 tháng **nếu gói "remain continuously active"** — huỷ rồi mở lại là mất giá cũ ngay |
| Live | Quyền truy cập live data cho dataset đã đăng ký (DeepChart dùng `GLBX.MDP3`) |
| Historical | Có kèm một phần historical tuỳ schema (ohlcv/definitions/statistics/status…) |
| **Không** kèm | Các lần kéo historical lớn vẫn tính **metered per-GB** (pay-as-you-go) — đây chính là phần dễ "cháy" hoá đơn |
| Credit | $125 credit cho tài khoản mới (không áp dụng cho tài khoản đang chạy) |

→ Kết luận thực tế: **$199 là phí truy cập, không phải trần chi phí.** Phần vượt trần là các lần kéo
lịch sử tính theo GB. DeepChart có sẵn cơ chế chặn phần này (mục 4).

*Giá và nội dung gói có thể thay đổi — luôn xác nhận lại trong portal của bạn.*

---

## 2. Ranh giới pháp lý: `internal use` ≠ `redistribution`

Databento công bố rõ trong chuỗi bài "Market data licensing explained" (phần 3 — subscriber status).
Trích nguyên văn phần quan trọng nhất:

> **Internal use** refers to the subscriber's use of market data strictly within its own organization
> for its internal purposes. The data is not shared or disseminated to external parties.
>
> **Redistribution** occurs when the subscriber disseminates or shares the market data with external
> parties beyond the original licensing agreement. This can include providing the data to clients,
> customers, or other third parties. **Even if you're using a third party data provider, the exchange
> requires a redistribution fee.** Note that some exchanges require a redistribution fee for
> **historical data as well as real-time data**.

Vài định nghĩa đi kèm mà bạn sẽ bị hỏi khi xin licence:

* **Display** (hiển thị cho người dùng thấy) vs **non-display** (algo/analytics chạy nền) — phí non-display thường **cao hơn**.
* **Professional** vs **non-professional**: cùng bài viết nêu mức tham chiếu *"at least … **$2,700 for real-time CME futures data per month**"* cho một subscriber professional.
* **Device**: mỗi máy/userID truy cập dữ liệu đều có thể bị tính; nhiều sàn yêu cầu **báo cáo số device hằng tháng** (bạn tự báo hoặc Databento báo thay, tuỳ thoả thuận).

### Nghĩa là gì với DeepChart?

| Cách bạn dùng | Đúng licence chưa? |
|---|---|
| Bạn tự xem chart, phân tích, trade cho chính mình | ✅ Gói $199 đủ (internal use cá nhân/nội bộ) |
| Chạy algo/analytics nội bộ, không phát dữ liệu ra ngoài | ⚠️ Tuỳ thoả thuận — hỏi Databento về **non-display** |
| Bán tài khoản cho khách xem ES/NQ (kể cả chỉ hiển thị nến, kể cả chỉ khách trả tiền) | ❌ Cần **thoả thuận redistribution** riêng với Databento **+** điều khoản/phí redistribution của CME + phân loại professional/non-professional + báo cáo device |
| Bán lại dữ liệu lịch sử tải về | ❌ Redistribution của historical cũng bị tính phí ở nhiều sàn |

**Nếu chưa có thoả thuận redistribution: đừng thu tiền của khách.** Dùng nội bộ thì app chạy bình
thường; còn bán là chuyện hợp đồng, không phải chuyện code (xem `docs/DEPLOY.md` §8).

Câu nên gửi cho Databento (portal Support hoặc form liên hệ trên website):

> "I run a web trading terminal and want to **redistribute/display CME Globex (GLBX.MDP3) real-time and
> historical data to my paying subscribers**. Which plan and which exchange (CME) redistribution/device
> fees apply, and what subscriber (professional/non-professional) and monthly device reporting is required?"

---

## 3. App này khai thác gói $199 tới đâu

| Việc | Cách bật |
|---|---|
| Live CME Globex (DBN, MBO/MBP-1) | `FUTURES_PROVIDER=databento`, `DATABENTO_API_KEY=...`, `DATABENTO_TRANSPORT_READY=1` |
| History sâu hơn (mặc định **1500 nến** mỗi khung, kẹp 100–5000) | `HISTORY_BARS_TARGET` |
| Nến giữ **365 ngày** để khỏi tải lại (đã trả tiền một lần) | `STORE_BARS_RETENTION_DAYS=365` |
| Ticks giữ 30 ngày (phần chiếm đĩa) | `STORE_RETENTION_DAYS=30` |

Nến đã tải về nằm trong SQLite (`bars`), các lần phân trang sau **không** gọi lại vendor — nên chi phí
thực tế giảm dần theo thời gian chứ không tăng tuyến tính.

### 3.1. Độ phủ hợp đồng: 43 mã CME Group có sẵn, thêm bao nhiêu cũng được

`GLBX.MDP3` chứa **toàn bộ** sản phẩm CME Group (CME, CBOT, NYMEX, COMEX). DeepChart ship sẵn 43 mã
thanh khoản nhất, chia nhóm trong picker (`Ctrl+K`):

| Nhóm | Mã |
|---|---|
| Indices | ES, MES, NQ, MNQ, YM, MYM, RTY, M2K |
| Metals | GC, MGC, SI, SIL, HG, MHG |
| Energy | CL, MCL, NG, MNG, RB, HO |
| Rates | ZT, ZF, ZN, ZB |
| FX | 6E, M6E, 6J, 6B, M6B, 6A, M6A, 6C, MSF |
| Ags | ZC, ZS, ZW, ZL, LE, HE, GF |
| Crypto | BTC, MBT, MET |

Muốn thêm **bất kỳ** root nào khác của CME Group (QM, QG, BZ, PL, PA, ZM, ZR, UB, TN, SR3, ZQ, ETH…):
khai báo spec của hợp đồng đó trong `EXTRA_INSTRUMENTS` — **không cần sửa code**:

```ini
EXTRA_INSTRUMENTS="QM:500:0.025:E-mini Crude Oil:ENERGY:NYMEX:CL;PL:50:0.1:Platinum:METALS:COMEX"
# SYMBOL:POINT_VALUE:TICK_SIZE[:NAME[:CATEGORY[:EXCHANGE[:UNDERLYING_INDEX]]]]  (';'-separated)
```

* `POINT_VALUE` = USD khi giá đi 1.00 điểm (CL = 1.000 USD; ZC = 50 USD vì niêm yết theo cent/bushel).
* `TICK_SIZE` = bước giá nhỏ nhất; `tickValue` được **tự tính** = `POINT_VALUE × TICK_SIZE`.
* Dòng sai (thiếu số, category/exchange lạ) bị **từ chối kèm lý do** và log
  `[Instruments] EXTRA_INSTRUMENTS rejected -> …`. App **không bao giờ đoán** thông số: sai
  multiplier/tick là sai P&L, sai ngưỡng cá voi, sai nhóm footprint. Test
  `server/test/unit/instruments.test.ts` kiểm tra lại toàn bộ bảng mỗi lần chạy `pnpm test`.
* Symbology Databento suy ra tự động: `<ROOT>.c.0` (continuous front month); ngoại lệ duy nhất là
  `GC.v.0` (volume-based) trong `CONTINUOUS_SYMBOL_OVERRIDES`.
* Nến/tick của mã thêm sau được lấy **y như mã có sẵn** (history, footprint, replay, DOM, whale notches).

**Vì sao không có NIY / MJY (và mọi hợp đồng định giá bằng JPY):** app quy đổi tiền theo USD ở mọi nơi
(notional, ngưỡng whale, P&L) và **không có bảng tỷ giá**. Thêm hợp đồng JPY-quoted sẽ lệch ~150 lần.
Muốn dùng: gắn nguồn tỷ giá trước, hoặc dùng bản USD của nó (`NKD` = Nikkei 225 USD).

### 3.2. Phủ **toàn bộ** `GLBX.MDP3` bằng definition của vendor (không cần gõ spec)

Cách "thêm tất cả mã": kéo **định nghĩa hợp đồng** từ chính Databento — `schema=definition` chứa
`contract_multiplier`, `min_price_increment`, `unit_of_measure`, `exchange`, `currency` cho từng instrument
(GLBX có ~800k instrument, gồm cả spread/option/user-defined — số sau khi lọc còn vài trăm root).

```bash
# Một lần kéo, có guard chi phí + ghi ledger như mọi request trả tiền khác:
curl -X POST -H "x-admin-secret: $ADMIN_SECRET" http://127.0.0.1:8080/api/v1/admin/instruments/sync | jq
# { "fetched": 412, "stored": 412, "added": ["QM","QG","BZ", ...], "skippedNonUsd": ["MJY"], "conflicts": [], "estimatedUsd": 0.4 }

# Xem thông số đã lưu (đối chiếu với CME spec sheet khi cần):
curl -H "x-admin-secret: $ADMIN_SECRET" http://127.0.0.1:8080/api/v1/admin/instruments/specs | jq '.total, .storedSpecs'

# Hoặc tự động mỗi lần boot:
SYNC_INSTRUMENTS_ON_BOOT=1

# Kéo một tập con cho nhanh (không cần tải cả dataset):
curl -X POST -H "x-admin-secret: $ADMIN_SECRET" \
  'http://127.0.0.1:8080/api/v1/admin/instruments/sync?symbols=ES.FUT,NQ.FUT,CL.FUT&stype_in=parent' | jq '.fetched, .added'
```

> **Lưu ý về kích thước/chi phí:** `ALL_SYMBOLS` trên `GLBX.MDP3` là **request lớn** (hàng trăm nghìn
> instrument: futures + spread + option + user-defined). App log rõ lúc bắt đầu
> (`[Definitions] pulling GLBX.MDP3 definitions … metered request, capped at 300s`) và **tự huỷ sau
> `DEFINITIONS_TIMEOUT_MS`** (mặc định 300000 = 5 phút) để không treo vô hạn. Nếu bị timeout: tăng biến đó,
> hoặc sync từng nhóm bằng `?symbols=…&stype_in=parent`. Kết quả được lưu vào SQLite nên **chỉ trả tiền một lần**.

**Công thức Databento dùng (đúng như tutorial của họ):**

```
point_value = contract_multiplier            [× 0.01 nếu exchange = XCBT vì CBOT niêm yết theo cent]
tick_size   = min_price_increment
tick_value  = min_price_increment × unit_of_measure_qty   [× 0.01 nếu XCBT]
```

**Quy tắc an toàn đã cài (đừng gỡ, đây là chỗ dễ sai tiền nhất):**

| Quy tắc | Vì sao |
|---|---|
| **Catalog có sẵn luôn thắng**; vendor khác thì chỉ **báo** (`conflicts` + log) | 43 mã curated đã verify & có tên/nhóm/underlying cho GEX; tự động ghi đè có thể đổi nghĩa con số đang chạy |
| Bỏ mọi instrument `currency != USD` (`skippedNonUsd`) | App không có bảng tỷ giá → MJY/NIY tự bị loại, không cần danh sách tay |
| Chỉ nhận `instrument_class = 'F'` và `raw_symbol` dạng outright (`ESM6`, `M6EU6`) | Spread (`ESM6-ESU6`), TAS, option, user-defined (`DIF 89 …`) bị lọc — chúng không có 1 tick/1 root duy nhất |
| Mỗi root giữ 1 dòng (hợp đồng còn xa nhất) | Các tháng của cùng root chia sẻ tick/multiplier; giữ bản còn niêm yết |
| Bỏ hợp đồng đã hết hạn > 30 ngày / chưa niêm yết | Không để mã chết trong picker |
| **Kiểm tra biên**: `0 < tick ≤ 100`, `0 < tick_value ≤ 1e6`, multiplier > 0 | Bắt lỗi scale (ví dụ payload fixed-point chưa được decode) thay vì nhận số vô lý |
| Spec lưu vào SQLite `instrument_specs` và **áp lại lúc boot** | Restart không tốn thêm request; `SYNC_INSTRUMENTS_ON_BOOT=1` mới refresh |

Mã phát hiện thêm vào nhóm theo `unit_of_measure` (Bushels → Ags, Troy Ounces → Metals, Barrels/MMBtu/Gallons
→ Energy, Index → Indices, Bitcoin/Ether → Crypto, Currency → FX); đơn vị mơ hồ (ví dụ `Pounds`) vào tab
**Other** — cố tình không đoán bừa. Tên hiển thị dạng `QM · 500 Barrels`.


---

## 4. Chặn hoá đơn: 4 lớp đã có trong code

### 4.1. Hỏi giá trước khi kéo (`metadata.get_cost`)

Trước **mỗi** lần gọi trả tiền (`timeseries.get_range` cho bars hoặc trades), server gọi:

```
POST https://hist.databento.com/v0/metadata.get_cost
Authorization: Basic base64("<DATABENTO_API_KEY>:")     # API key làm username, password rỗng
Content-Type: application/json

{ "dataset": "GLBX.MDP3", "schema": "ohlcv-1m",
  "start": "...", "end": "...", "symbols": "ES.c.0",
  "stype_in": "continuous", "mode": "historical-streaming" }
```

`mode` = `historical-streaming` là mặc định của `timeseries.get_range` khi không truyền mode — tức giá
ước tính đúng bằng loại dữ liệu app thực sự kéo.

Điều kiện chạy: **chỉ khi** `DATABENTO_MONTHLY_USD_BUDGET > 0` **hoặc** `DATABENTO_COST_LOG=1`.
Không bật gì thì **không** phát sinh request thừa (mặc định tắt để không làm chậm vòng lặp history).

### 4.2. Ngân sách tháng (chốt cứng)

```ini
DATABENTO_MONTHLY_USD_BUDGET=150   # 0 = chỉ ghi nhận, không chặn
DATABENTO_COST_LOG=0               # 1 = ghi log ước tính nhưng không chặn
```

Khi ước tính mới làm tổng tháng vượt ngân sách, yêu cầu bị **từ chối trước khi gửi**:

```
[DatabentoUsage] BLOCKED ES.c.0 ohlcv-1m … : estimate $0.4000 would make 2026-09 $1.2000
                 > DATABENTO_MONTHLY_USD_BUDGET $1.00 …
```

Client vẫn nhận được nến **đã cache** — không có màn hình trắng, chỉ có ít lịch sử hơn.
Chọn `150` (dưới $199) là cách an toàn để phần metered không bao giờ vượt quá giá trị gói.

### 4.3. Ledger sống qua restart

Tổng chi tiêu lưu trong SQLite, bảng `vendor_usage (provider, month, usd, requests, updated_at)`:
một dòng cho mỗi cặp provider+tháng (UTC). Restart, deploy lại, hay chạy nhiều lần trong tháng đều
không "quên" số đã tiêu → không thể vượt ngân sách do reset bộ nhớ.

Xem ngay trong app:

```bash
curl -H "x-admin-secret: $ADMIN_SECRET" http://127.0.0.1:8080/api/v1/admin/metrics | jq .vendorUsage
# { "month": "2026-09", "usd": 12.4312, "requests": 88, "budget": 150,
#   "history": [ { "month": "2026-09", "usd": 12.4312, "requests": 88 }, … ] }
```

### 4.4. Các lớp bảo vệ cũ vẫn giữ

* **Cache-first**: chỉ kéo phần còn thiếu (`queryBars` → chỉ khi `bars.length < limit`).
* `MAX_VENDOR_FETCHES_PER_HOUR` (mặc định 120/giờ/tài khoản) chặn một client lạm dụng phân trang.
* **Fail-open có kiểm soát**: nếu endpoint ước tính lỗi (500/503/timeout), lần kéo vẫn được phép nhưng
  tăng counter `deepchart_vendor_cost_estimate_total{result="unavailable"}` — terminal không chết vì
  một lỗi phụ trợ, còn bạn thì thấy được là đang mù giá.
* **Không bịa dữ liệu**: thiếu feed ⇒ trạng thái `UNAVAILABLE`, không có nến giả.

### 4.5. Metrics để cảnh báo

| Metric | Ý nghĩa |
|---|---|
| `deepchart_vendor_estimated_spend_usd{provider,month}` | Số ước tính đã tiêu trong tháng (gauge) |
| `deepchart_vendor_cost_estimate_total{provider,result}` | Số lần hỏi giá: `ok` / `unavailable` |
| `deepchart_vendor_budget_blocked_total{provider}` | Số lần bị chặn vì vượt ngân sách (>0 = cần xem lại ngân sách) |
| `deepchart_vendor_fetch_total{result}` | `ok` / `empty` / `quota_blocked` / `error` |

Gợi ý alert: `increase(deepchart_vendor_budget_blocked_total[1h]) > 0`, và
`deepchart_vendor_estimated_spend_usd > 0.8 × DATABENTO_MONTHLY_USD_BUDGET`.

### 4.6. Giới hạn — nói thẳng

* Số trong ledger là **ước tính của vendor tại thời điểm hỏi**, không phải hoá đơn thật. Databento tính
  theo dữ liệu thực trả về; nếu response rỗng/lỗi (HTTP 422, 429…) thì gần như không phát sinh phí và
  app cũng không ghi thêm.
* Chỉ ghi ledger khi lần kéo **có dữ liệu** trả về (nến/tick thật) — nghĩa là con số có thể **thấp hơn**
  hoá đơn một chút, không bao giờ cao hơn.
* Nếu Databento đổi bảng giá, con số ước tính sẽ lệch cho tới khi bạn cập nhật kỳ vọng.
  **Đối chiếu portal mỗi tháng một lần** là đủ.

---

## 5. Quy trình kiểm tra hằng tháng (5 phút)

1. `curl -H "x-admin-secret: $ADMIN_SECRET" .../api/v1/admin/metrics | jq .vendorUsage` → so `usd` với hoá đơn.
2. Prometheus: `deepchart_vendor_estimated_spend_usd` vs ngân sách; `deepchart_vendor_budget_blocked_total` có tăng không.
3. Portal Databento → Usage/billing: xác nhận phần metered + subscription $199.
4. Nếu bị chặn nhiều (`budget_blocked_total` tăng liên tục): tăng `DATABENTO_MONTHLY_USD_BUDGET`, hoặc giảm
   `HISTORY_BARS_TARGET`, hoặc để nến đã cache phục vụ (rẻ nhất).
5. Kiểm tra log `[DatabentoUsage] BLOCKED …` (JSON log: `level:"warn"`).

---

## 6. Checklist trước khi mở bán (chặn cứng)

- [ ] Có **thoả thuận redistribution bằng văn bản** với Databento cho dataset CME (`GLBX.MDP3`) — không chỉ gói $199.
- [ ] Nắm được **phí redistribution/device của CME** và ai báo cáo (bạn hay Databento), tần suất (thường theo tháng).
- [ ] Phân loại khách hàng **professional / non-professional** và phản ánh vào giá gói của bạn (tham chiếu: professional CME real-time ≈ $2,700/tháng/user).
- [ ] Nếu bán cả dữ liệu lịch sử: kiểm tra phí redistribution cho **historical** ở sàn tương ứng.
- [ ] Đặt `DATABENTO_MONTHLY_USD_BUDGET` (< $199) và alert cho `deepchart_vendor_budget_blocked_total`.
- [ ] Ghi rõ trong `TERMS.md` rằng **dữ liệu thị trường thuộc bản quyền của sàn/vendor**, người dùng chỉ được xem trong dịch vụ.
- [ ] Nếu **chưa** xong các mục trên: chỉ chạy nội bộ, **không** thu tiền của khách.

---

## 7. Biến môi trường liên quan

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABENTO_API_KEY` | — | API key (server-side, không bao giờ gửi xuống browser) |
| `DATABENTO_DATASET` | `GLBX.MDP3` | Dataset CME Globex |
| `DATABENTO_STYPE_IN` | `continuous` | Symbology (`continuous` → `ES.c.0`) |
| `DATABENTO_SYMBOLS` | — | Override symbol cụ thể |
| `DATABENTO_TRANSPORT_READY` | `1` | `0` = tắt phần transport nến/tick (dùng khi chỉ muốn feed live) |
| `HISTORY_BARS_TARGET` | `1500` | Số nến xin mỗi khung (100–5000) — tăng = sâu hơn nhưng tốn hơn |
| `DATABENTO_MONTHLY_USD_BUDGET` | `0` | Trần chi tiêu tháng (USD); `0` = không chặn |
| `DATABENTO_COST_LOG` | `0` | `1` = ghi log ước tính dù không đặt trần |
| `MAX_VENDOR_FETCHES_PER_HOUR` | `120` | Trần số lần kéo/tài khoản/giờ |
| `STORE_BARS_RETENTION_DAYS` | = `STORE_RETENTION_DAYS` | Vòng đời nến (Docker image: 365) |
| `STORE_RETENTION_DAYS` | `30` | Vòng đời tick/gap |

---

## 8. Nguồn

* Bảng giá & gói: <https://databento.com/pricing>
* Thay đổi gói (Standard ra đời, mô tả gói): <https://databento.com/blog/upcoming-changes-to-pricing-plans-in-january-2025>
* Điều khoản licensing: internal use vs redistribution, display/non-display, professional/non-professional, device reporting: <https://databento.com/blog/subscriber-status>
* API ước tính chi phí: `POST https://hist.databento.com/v0/metadata.get_cost` (Databento Historical API reference; tham số `dataset`, `schema`, `start`, `end`, `symbols`, `stype_in`, `mode`).


