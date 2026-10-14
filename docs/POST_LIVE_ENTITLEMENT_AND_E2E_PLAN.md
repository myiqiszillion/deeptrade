# Post-live: entitlement và kế hoạch Trades E2E — 12/10/2026

Git HEAD: `60ee55426063893c3b4f7afbc4a7d8bc055e2cfc`.

## Kết quả và entitlement

- Trades live: **PASS — 24 received / 24 decoded theo báo cáo harness**, ACK 1, DBN v3, parser errors 0, gateway errors 0, exit 0.
- MBP-10: **ENTITLEMENT DENIED**, ACK 0, depth 0, gateway báo `Not authorized for mbp-10 schema`, exit 2. Counter Parse Errors/Corrupt=1 gồm gateway ErrorMsg; không phải bằng chứng decoder hỏng.
- Docker staging: **42/42 PASS**, SQLite integrity ok theo lần nghiệm thu sau reboot. Không chạy lại staging trong tác vụ chỉ đọc này.
- Operator đã cung cấp thông tin GLBX.MDP3 Standard có subscription. Trạng thái Active, thời hạn plan, hợp đồng và phạm vi schema trong portal: **NOT INDEPENDENTLY VERIFIED**; không có bản xác nhận account/portal trong bằng chứng được cung cấp. Trades ACK và records xác nhận quyền live trades của API key tại thời điểm chạy, không chứng minh tên/trạng thái toàn bộ plan hoặc quyền depth.
- [Tài liệu MBP-10](https://databento.com/docs/schemas-and-data-formats/mbp-10) xếp schema này vào L2, gồm top 10 levels, aggregate size và order count. Không suy ra quyền L2 từ việc trades chạy được hoặc schema xuất hiện trong metadata.
- [Portal docs](https://databento.com/docs/portal) chỉ dẫn Plans and live data để quản lý plan và licensing; activation phụ thuộc subscriber status và use case. Quyền lịch sử L2/L3 không tự chứng minh quyền live L2. [Pricing chính thức](https://databento.com/pricing/) cần được đối chiếu đúng dataset và cột Live, không chỉ dòng historical inclusion.
- Nguyên nhân quan sát được: gateway chặn schema mbp-10 cho key/session này. Các khả năng cần vendor xác minh, không phải kết luận: phạm vi live của plan không gồm L2; giấy phép/subscriber status chưa cấp depth cho use case; hoặc provisioning/key thuộc team/account khác hay quyền chưa đồng bộ. Không có bằng chứng để chọn một khả năng hoặc định giá thay đổi.
- **VENDOR CONFIRMATION REQUIRED.** Operator kiểm tra GLBX.MDP3 trong Plans and live data: Active/effective date, included LIVE schemas, approved license/use case, đúng team sở hữu key. Không sửa key, plan hoặc hợp đồng trong bước kiểm tra.
- Cần Databento Support xác nhận: plan hiện tại có live mbp-10 không; cần bổ sung quyền L2, giấy phép hay chỉ sửa provisioning; mọi chi phí/điều kiện cụ thể nếu có. Chưa có cơ sở mặc định cần mua thêm gói. Operator quyết định mọi thay đổi quyền/chi phí.
- Nội dung để Operator gửi Support (chưa gửi): ngày 2026-10-12; GLBX.MDP3 / ES.c.0; trades session 3013795247 thành công; mbp-10 session 3013796194 bị `Not authorized for mbp-10 schema` lúc khoảng 11:29:51 UTC; hỏi entitlement/provisioning của team/key đang sử dụng. Không gửi API key hoặc payload auth.

## Bằng chứng được bảo toàn

Hai log chỉ được đọc, không sửa; SHA-256:

| Log | SHA-256 |
|---|---|
| scratch/live_trades_20261012.log | 61B5B5FE0FBC614498190E3F2AEEE70F9F1D55030141CB69F12FF8068CCD3FA4 |
| scratch/live_mbp10_20261012.log | 695E8D70DAA4D28DF16263591CF8D20133DAB5A52BDCF349ADE1AABA743EDFDF |

- Rtype được ghi rõ bằng hex trong log trades: **0x16**, instrument **10252**. Trade rtype histogram/hex từng record: **NOT CAPTURED**. SystemMsg code 1 và ErrorMsg được nhận diện bằng log, không có raw header/hex để tái kiểm tra. MBP-10 rtype 0x0A: **NOT CAPTURED**, vì không nhận depth.
- Mapping: ES.c.0 → ESZ6 / 10252, effective `[2026-10-12, 2026-10-13)`. Ba trade samples đều instrument 10252; instrument distribution đủ 24 records: **NOT CAPTURED**.

| Sample | Price | Size | Side theo decoder | tsMs | UTC event time | Sequence |
|---|---:|---:|---|---:|---|---:|
| 1 | 7864.75 | 2 | BUY | 1791804548556 | 2026-10-12 11:29:08.556Z | 2267152 |
| 2 | 7864.5 | 10 | SELL | 1791804550254 | 2026-10-12 11:29:10.254Z | 2267180 |
| 3 | 7864.5 | 1 | BUY | 1791804550255 | 2026-10-12 11:29:10.255Z | 2267215 |

- Chỉ ba mẫu: BUY 2, SELL 1, UNKNOWN 0 trong mẫu. Side distribution của toàn bộ 24: **NOT CAPTURED**; không ngoại suy.
- First/last event toàn lượt, first/last vendor receive timestamps, raw side bytes, tất cả sequences, đầy đủ feed coverage/gaps: **NOT CAPTURED**. Sample timestamps không phải first/last toàn lượt.
- Trades: 30.0s, TIMEOUT_30S, heartbeats 0; depth: 1.1s, GATEWAY_ERROR, heartbeats 0. Exit codes 0/2 được ghi ở kết quả thực thi trước; không nằm trong nội dung hai log Tee-Object.
- Không lưu raw DBN, chỉ aggregate counters và ba decoded samples. Không thể tái giải mã độc lập toàn bộ 24 records hay khẳng định đã nhận đủ mọi trade của thị trường trong cửa sổ. Socket teardown/process exit đã được báo cáo; packet-level close trace **NOT CAPTURED**.

## Kế hoạch nghiệm thu Trades E2E — chưa thực hiện

1. Operator cấp phép riêng một lượt trades đi qua backend staging, với ngày, dataset GLBX.MDP3, symbol ES.c.0, schema trades, hard duration/record cap và chính sách không retry. Không chạy harness và backend subscription song song; tắt/gate mọi auto-subscribe/history fallback ngoài phạm vi trước khi chạy. Nếu backend chưa hỗ trợ giới hạn và instrumentation này, trình bày thay đổi cụ thể để Operator duyệt trước; không sửa source trong tác vụ này.
2. Pre-flight staging healthy, mapping ngày chạy, actual session và live entitlement. Dùng một kết nối vendor, production decoder thực tế; capture có giới hạn từng record hoặc raw DBN nếu phù hợp quyền sử dụng, không lưu secrets. Ghi event/receive/local timestamps, instrument, sequence, raw side, normalized side, counts/errors và mapping/ACK.
3. Gắn provenance `Databento/GLBX.MDP3/trades`, contract và cửa sổ coverage cho MarketContext/analytics; đánh dấu partial nếu mất record, có gap hoặc thiếu lịch sử. Không điền synthetic trades hoặc ngầm đổi nguồn. Coverage chỉ là cửa sổ quan sát, không tuyên bố toàn phiên/ngày.
4. Đối soát số trades/volume từ decoder → MarketContext → Footprint/Volume Profile trong cùng cửa sổ. Volume Profile tổng volume phải khớp tổng accepted trade sizes theo price bins; Footprint giữ BUY/SELL/UNKNOWN riêng. CVD chỉ cộng BUY và trừ SELL có side thực tế; UNKNOWN không được ép vào bên mua/bán, volume UNKNOWN và side coverage phải được công bố. Đối soát từng increment với trace thay vì chỉ nhìn biểu đồ.
5. Theo dõi cùng instrument/sequence hoặc trace id qua WebSocket; kiểm tra message counts, batching, timestamps, provenance và coverage. Trình duyệt staging đăng nhập, xác minh candles/Footprint/CVD/Volume Profile cập nhật từ chính messages đó; INIT_STATE/ping-pong riêng không đủ E2E PASS.
6. Đạt cap/timeout phải đóng socket, dọn timer và không reconnect; xác minh feed chuyển DISCONNECTED rồi STALE theo policy thực tế, analytics giữ provenance và thời điểm cập nhật cuối. Capture close reason/exit. Dừng nếu cần phiên bổ sung; xin phê duyệt riêng.

Điều kiện PASS: trace genuine records xuyên suốt, mapping đúng, counters/volume/side đối soát, không parser critical error, không fallback giả, coverage trung thực, WebSocket/browser hiển thị cùng dữ liệu, lifecycle đóng đúng giới hạn. Hiện tất cả tầng MarketContext/Footprint/CVD/Volume Profile/WebSocket/React với trades thật vẫn **NOT VERIFIED**.

**DOM/Heatmap: BLOCKED BY DEPTH ENTITLEMENT.** Chưa nghiệm thu depth, không dùng trades hoặc snapshot giả để tuyên bố PASS.

Các bước cần Operator quyết định: cung cấp/xác nhận trạng thái portal; tự gửi Support hoặc cấp quyền gửi yêu cầu cụ thể; chấp thuận mọi thay đổi licensing/cost sau phản hồi; cấp phép riêng cho Trades E2E và cho depth retest nếu entitlement được giải quyết. Hai lượt cũ đã dùng hết, không tự chạy thêm hoặc chuyển quyền sang ngày khác.

Tác vụ này không mở live, tải historical, mua dịch vụ, sửa billing/source, bật Stripe Live, mở public production hay push Git. Dừng sau báo cáo.
