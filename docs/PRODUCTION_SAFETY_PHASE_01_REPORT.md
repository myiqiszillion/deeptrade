# Production Safety Phase 01 — Ordinary Backend Activation Gate

Ngày: 13/10/2026 ICT. Phạm vi: **P0-A OFFLINE IMPLEMENTED / VERIFIED**. Không chạy Databento Live; không thay DBN constants, decoder algorithms hoặc analytics engines. Genuine Regular Terminal E2E trước đó vẫn là acceptance riêng, không được dùng để tuyên bố ordinary runtime đã nghiệm thu Live.

## Release identity

- Baseline Git HEAD: `4f6f462cc3d4158a199985182880f41652e43c6d`.
- Baseline tracked tree clean; các reports/scratch untracked có sẵn được giữ nguyên và không stage trong commit này.
- Final Git HEAD sau commit local được ghi nguyên vẹn trong `release_identity.json` tại private evidence directory dưới đây. Báo cáo và implementation được commit cùng nhau; manifest được ghi sau commit để tránh tự tham chiếu SHA của chính commit chứa báo cáo.
- Private evidence directory: `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase01-1791909436299`.
- `offline_evidence.json`: command ledger, counters, SQLite before/after, staging checks và SHA-256 của test logs. `release_identity.json`: baseline/final HEAD và hashes của báo cáo/evidence. Không lưu API key, JWT hoặc CRAM auth command trong các manifest.
- Không push. Không xóa private acceptance/incident artifacts hoặc thay đổi các báo cáo lịch sử.

## Runtime activation policy

Chỉ kích hoạt ordinary vendor khi đồng thời có `FUTURES_PROVIDER=databento`, `DATABENTO_RUNTIME_START=1`, API key và JSON `DATABENTO_RUNTIME_PROFILE` hợp lệ. Key đơn lẻ, missing/OFF profile, unknown provider, unknown/unsupported schema hoặc profile hết hạn đều trả feed UNAVAILABLE cùng lý do; không fallback sang Databento.

Profile version 1 chỉ chấp nhận đúng các trường:

```json
{
  "version": 1,
  "approved": true,
  "approvalId": "OPERATOR_APPROVAL_ID",
  "expiresAt": "UTC_EXPIRY_ASSIGNED_BY_OPERATOR",
  "dataset": "GLBX.MDP3",
  "symbol": "ES",
  "vendorSymbol": "ES.c.0",
  "schema": "trades",
  "history": false,
  "gex": false,
  "quoteBoard": false,
  "reconnect": false
}
```

Đây là mô tả schema, **không phải profile đã được cấp phép/chạy**. `expiresAt` phải là UTC có hậu tố Z, ở tương lai và không quá 24 giờ khi boot; approvalId phải là identifier hợp lệ. Extra fields, scope khác hoặc flags true bị từ chối. Việc triển khai offline không cấp quyền activation; Operator phải phê duyệt riêng và chủ động cung cấp config/key trước một lần chạy vendor thực tế.

Profile/key được snapshot sau boot env hydration và không được hot-activate bởi `.env` reload. Chỉ backend restart mới có thể đọc capability mới. Hết hạn approval, socket được destroy trước status UNAVAILABLE; không tự xin/cấp lại quyền.

## Topology, command và browser controls

- Một connection attempt và một subscription command mỗi backend boot; failed attempt cũng tiêu hết budget. Không retry/reconnect/resubscribe. Budget này không phải persistent approval ledger: restart tạo budget mới nếu config vẫn còn hợp lệ; vận hành/restart policy cần nghiệm thu riêng ở P1.
- Factory truyền dataset, vendor symbol và schema tường minh vào **DatabentoLiveClient hiện có**. Không tạo integration thứ hai.
- Auth thành công chưa phải LIVE/ACK trong ordinary client. Chỉ SystemMsg subscription ACK mới tăng `subscriptionAcks` và chuyển LIVE; pre-ACK trades không được dispatch.
- Exact ordinary command, đã quan sát trên loopback TCP:

```text
schema=trades|stype_in=continuous|symbols=ES.c.0|snapshot=0|is_last=1
start_session=1
```

Không thêm mbp-1, mbp-10, TBBO hoặc subscription thứ hai. ACK counter đếm các ACK đã nhận, không suy ra từ authentication.

- Context discovery không còn construct client. Default context warming giữ hành vi local/offline, nhưng registry không thể mở vendor nếu thiếu capability.
- Approved warm context là ES bất kể DEFAULT_SYMBOL khác; browser attach ES dùng chung context/pending init. Browser SUBSCRIBE NQ/alias ngoài scope trả RUNTIME_SCOPE_DENIED trước subscribe. Secondary contexts ngoài ES chỉ nhận noop UNAVAILABLE, không thể mở feed.
- Không thêm public activation endpoint hoặc API cập nhật runtime profile. HTTP status chỉ đọc policy/counters.
- Offline staging override luôn provider none, key rỗng, start 0, profile rỗng, quote-board 0. Browser/offline fixtures vẫn có thể dùng ES/NQ local mà không gọi vendor.

## History/GEX/options gates

Ordinary server HTTP client có `requestsEnabled=false`; mọi vendor REST requests, gồm history, definitions, symbology fallback và options requests, đều bị chặn trước fetch. History provider của ordinary server là noop; context không chạy vendor backfill/GEX timer. Quote-board enable flag không thể vượt runtime gate.

Local SQLite history/read-only APIs vẫn được giữ; disabled history trong phase này nghĩa là không tự tải vendor historical. Profile version 1 không hỗ trợ bật history/GEX/options bằng cách đổi một flag; scope mới cần phê duyệt và implementation riêng. Controlled acceptance hooks được giữ riêng.

## Offline evidence và regression

| Check | Kết quả thực tế |
|---|---|
| Default OFF/key alone/missing/malformed/invalid profile | 18 negative cases, 0 transport calls |
| Additional unknown/mbp-10/tbbo schemas | Denied |
| Approved ordinary loopback TCP | 1 attempt / 1 command / 1 actual fixture SystemMsg ACK |
| Authentication trước ACK | UNAVAILABLE, connected=false, ACK=0 |
| Normal MarketContext + ChartSession/WebSocket | Warm ES + 3 authenticated fixture sessions; disconnect/reload không tạo thêm connection |
| Scope/safety | ES allowed; NQ denied; historyCalls=0; HTTP/options/quote calls=0; no MBP subscription |
| Remote close / context restart | Không reconnect; restart feed bị budget từ chối trước transport |
| Approval expiry | Socket destroyed trước UNAVAILABLE; expired connect denied |
| Environment/storage isolation | Guard preloaded; provider none/key rỗng; memory DB; 0 violations |
| Typecheck all | PASS |
| Unit suite | PASS |
| Integration suite | PASS |
| P0 | 13/13 PASS |
| Offline isolation | 17/17 PASS |
| Browser E2E | 19/19 PASS; 0 remaining processes |
| Regular Terminal offline | PASS — actual App/normal components và normal WS messages |
| Controlled Trades regular terminal offline | PASS — fixture 50 records; final React digest MATCH |
| Production build all / Docker app build | PASS |
| Docker staging | 42/42 PASS |

Mock TCP test dùng sentinel key trong object riêng, không đưa key vào process.env; auth bytes không được ghi log. Multiple-session test sử dụng ChartSession.setUser với fixture user và WebSocket loopback, không phải genuine user/vendor acceptance. Browser E2E hiện kiểm tra app với activation OFF; **approved ordinary entrypoint + genuine vendor + browser chưa được nghiệm thu**.

Trong quá trình sửa, integration lần đầu dùng dist chưa rebuild và phát hiện thay đổi local default warming. Đã khôi phục warming local, rebuild dist và toàn bộ integration PASS. TypeScript phát hiện một biến không còn dùng và đã được loại bỏ. Không giữ failure như một PASS.

## Staging và persistence

Rebuild app, chạy compose với `deploy/offline-staging.compose.yml`, không down/reset/unregister hoặc xóa volume. App healthy; proxy running qua loopback; 42/42 verification gồm restart, users/rules persistence và online backup integrity.

Before/after SQLite: `PRAGMA integrity_check=ok`, **66.238 trades / 1.236 bars**, không giảm/mất rows. Staging giữ provider none/key rỗng/start 0/profile rỗng. Status sau verification: connectionAttempts=0, subscriptionCommands=0, subscriptionAcks=0; ES UNAVAILABLE.

Verification tạo test users/rules và backup theo hành vi hiện có. Backup job retention đã rotate một regular snapshot cũ `market_data-2026-10-12T11-15-42-784Z.sqlite`; SQLite volume và private acceptance/incident artifacts vẫn nguyên vẹn. Không tuyên bố database file hash bất biến vì tests có ghi metadata/users/rules.

## Files thay đổi

- `server/src/marketData/ordinaryRuntime.ts`: strict immutable approval capability, expiry và per-boot budgets/counters.
- `server/src/marketData/registry.ts`: default OFF, factory ES/trades explicit; test injection guard.
- `server/src/databento/liveClient.ts`: ordinary one-shot policy, ACK gating, trades-only command, expiry cleanup; không đổi parser/constants.
- `server/src/databento/client.ts`: requestsEnabled gate.
- `server/src/marketData/marketContext.ts`: provider discovery không tạo client; ordinary external gates; injectable existing feed factory cho fixture.
- `server/src/marketData/quoteBoard.ts`: ordinary external gate.
- `server/src/index.ts`: boot capability, disabled vendor REST/history, approved-symbol browser routing và status counters.
- `deploy/offline-staging.compose.yml`: explicit start OFF/profile empty.
- `server/test/ordinaryRuntime.test.ts`, `package.json`: dedicated offline safety command/test.
- Báo cáo này.

## Giới hạn và P0-C handoff

P0-A đã đủ bằng chứng offline để **đề xuất chuyển sang P0-C stable trade identity**, sau Operator phê duyệt riêng. Chưa sửa stable IDs, sequence/dedup/gap handling hoặc SQLite ingestion reconciliation. Không triển khai toàn bộ P0/P1/P2.

Ordinary genuine authentication/ACK/subscription/session, restart approval reuse, long-running context, reconnect/recovery, multi-symbol và production licensing vẫn NOT VERIFIED. First profile chủ ý không reconnect và không hỗ trợ NQ. Existing controlled 50-record genuine PASS không chứng minh các hạng mục này.

GLBX.MDP3 mbp-10 — NOT AUTHORIZED. DOM / Liquidity Heatmap — BLOCKED BY VENDOR ENTITLEMENT. Không retry depth, mua entitlement, historical có phí, sửa billing/clock, bật Stripe Live hoặc public deploy. Kết thúc phase offline; không tự chạy Live.