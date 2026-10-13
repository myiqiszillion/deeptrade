# Regular Terminal Live GO / NO-GO — 13/10/2026 ICT

**CONDITIONAL GO — chưa cho phép thực thi Live.** Offline paths đã cách ly và regression PASS. Vendor usage/cost của sự cố P0 chưa được kiểm tra trên portal; attribution của 154 local rows vẫn UNKNOWN. Cần Operator xem và xác nhận các giới hạn này rồi cấp phép mới đúng ngày thực thi.

Baseline HEAD `261b0fec0d1b2e7f8f05a63790e05d0e9851f8c6`. Final release HEAD được ghi sau commit tại `C:\Users\Administrator\.codex\private-acceptance\p0-incident-20261013\release_identity.json` (không tự tham chiếu commit hash trong file thuộc commit), và trong handoff. Không push; các untracked docs/scratch cũ không đưa vào release.

## Incident status và tác động

Containment: VERIFIED. Impact closure: OPEN FOR OPERATOR CHECK. [Incident report](P0_UNINTENDED_DATABENTO_CONNECTION_INCIDENT.md) ghi startup ordinary backend, `.env` cause, observed ES/NQ GLBX.MDP3, TEST13 72 TICK/22 book updates, exit/cleanup evidence và những điều chưa biết.

Local `server/data` có 154 timestamp-matching trades; không có run ID nên attribution UNKNOWN. Hai Docker backup trades/bars giống canonical hashes; current Docker DB integrity OK và không có receive-window trades. Không suy diễn 0 vendor_usage rows thành phí bằng 0. **VENDOR USAGE/COST NOT VERIFIED — OPERATOR PORTAL CHECK REQUIRED.** Không liên hệ vendor hoặc chỉnh billing/licensing.

## Offline entrypoints đã kiểm tra

| Entrypoint | Isolation áp dụng trước side effects |
|---|---|
| Unit suite | First import guard; singleton memory; credentials scrub; real DB regression đổi sang fixture; migration backups temp |
| Integration suite / standalone test modules | First import guard; child env none/key empty/memory; child app đi qua guarded bootstrap |
| Auth integration production-shaped | Guard vẫn chạy trước imports; production auth assertions giữ; không hydrate env; chỉ synthetic local webhook secret |
| Alert delivery dynamic index import | Env pin + guard trước backend import |
| P0 runner / p0OfflineServer | Guard trước bootstrap; exactly fixture ES/NQ; no vendor/history; memory |
| Browser E2E | Guard, pinned child key/storage/provider; từ chối backend đang chạy sẵn |
| Normal Terminal offline harness | Guard trước index import; memory, blocked external fetch, fixture provenance |
| Controlled Trades offline supervisor / worker | Offline branch installs guard; guarded worker bootstrap trước application imports; mock transport explicit |
| Docker offline staging | Existing offline override none/key empty/quote board off; no env files/options credentials inside container; designated persistent named volume retained |

Search các scripts/test modules import hoặc spawn index đã bao phủ các backend entrypoints ở trên. `pnpm dev/start`, legacy `pnpm verify` (real-only smoke) và untracked scratch vendor utilities là operator/manual runtime tools, **không phải offline test commands**, không chạy trong nhiệm vụ này. Guard không phải sandbox hệ thống cho mọi chương trình/công cụ thủ công.

Trong các offline entrypoints đã kiểm tra, không còn đường hydrate real credentials hoặc auto-start vendor ngoài mock được xác định. Backend flag không được dùng riêng lẻ để bypass: thiếu preload guard sẽ fail. Node/tsx local IPC được phép; non-loopback transport bị chặn. Child bootstrap tường minh được dùng, tránh preload phá loader/IPC. Không có guard trong approved Live branch; Live vẫn cần separate date/scope approval.

## Fail-closed evidence

`pnpm test:isolation`: **17/17 PASS**. Sentinel không phải API key thật. Probes xác minh scrub trước imports; child key/provider/storage drift; `.env` read/hydration; TCP và HTTP/HTTPS tới `.invalid`; persistent DB/backup destination; vendor factory/schema ngoài mock; credentialed HTTP/history factory ngoài mock; backend runtime provider drift; explicit mock allowed; expired approval rejected trước worker startup. Không dùng endpoint vendor thật. Violation counter làm process exit nonzero dù lỗi bị catch.

Guard chỉ cho phép memory hoặc SQLite fixture paths đã xác định (`test_*.sqlite` tại repo/server và OS temp); không mở app/staging DB trong tests. Test Stripe webhook chỉ tác động fixture memory, không external billing. Credential/sentinel values và child probe stack/source không ghi vào public logs/artifacts.

## Controlled Terminal readiness và regression

| Check | Result |
|---|---|
| Typecheck / unit / integration / build | PASS |
| P0 | 13/13 OFFLINE PASS |
| Browser E2E | 19/19 PASS; runner reports 0 remaining processes |
| Normal Terminal fixture regression | PASS, including ES→NQ late-ES routing |
| Controlled normal Terminal cap | 50 accepted; volume 1275; BUY425/SELL442/UNKNOWN408; CVD-17; actual React digest MATCH |
| Sparse timeout | 3 accepted; volume6; UNKNOWN3; CVD-1; final updates MATCH |
| Mock subscription | One connection, one exact `schema=trades\|stype_in=continuous\|symbols=ES.c.0\|snapshot=0\|is_last=1` |
| Deadline/cap/no reconnect | 30000-ms unit clock; 50-record cap; existing controller retry/reconnect guards PASS |
| Final flush / normal DTO | TICK/BAR_UPDATE/BAR_CLOSE/PROFILE_UPDATE; TCP destroyed before final fanout; actual candles/footprint/CVD/Profile reconciled |
| Vendor / cleanup watchdog probes | Both expected exit124; browser cleanup ALREADY_EXITED |
| History/GEX/contamination | History NONE, fresh cohort; external fetch0; provenance OFFLINE_FIXTURE/PARTIAL; no production SQLite reads/writes |

Latest cap artifact `C:\Users\Administrator\.codex\private-acceptance\deepchart-1791866427190\evidence.json`, SHA256 `e6e8f6278c4bbe8d3134b25679f5985553376c529f1fe846d88cc63a406b2dd5`; sparse `deepchart-1791866429491/evidence.json`, SHA256 `94c511293703f2b60cc2428c587a8cdb404ebad884bd63f7650463d8f87848a2`. Both record guard preloaded, violations0, provider none, credentialPresent false, storageMemory true and actual mock command. Watchdogs: `deepchart-1791866120419/watchdog.json`, `deepchart-1791866122041/watchdog.json`. Normal fixture regression: `regular-terminal-offline-1791866363673/result.json`.

No new vendor integration, UI rewrite, decoder/constants changes or subscription expansion. Existing ControlledTradesSession bridge retained. Genuine vendor → Regular Terminal remains **NOT VERIFIED**; prior genuine isolated acceptance is not re-tested. MBP-10/DOM/Heatmap remain BLOCKED BY VENDOR ENTITLEMENT.

## Docker và safety limitations

Docker app healthy; proxy running; provider none, key empty, quote board off. `/app/.env` và `/app/server/.env` absent; options credentials absent. SQLite read-only integrity/persistence evidence retained. Last full staging verification **42/42 PASS on 12/10/2026**; not re-run today because changes are test isolation only, with ordinary runtime guard branches inactive. No container rebuild/restart, volumes/SQLite reset or public deployment in this task.

30-second vendor deadline and supervisor watchdog apply to streaming; cleanup watchdog is a separate 10 seconds after CLOSED and cannot extend vendor time. Clock synchronization/feed latency remains unverified; numeric volume/CVD reconciliation does not claim latency correctness. Guard does not prevent a human intentionally running manual production/vendor tools; no statement of global machine-wide isolation is made.

## Operator gate — command NOT EXECUTED

After portal usage/cost review and explicit new approval, proposed command **for 13/10/2026 ICT only**:

```powershell
node scripts/verify_trades_e2e.mjs --live --regular-terminal --approval-date 2026-10-13
```

If execution date changes, new approval and matching ICT date are mandatory. Permission from 12/10 has expired. Approval scope: GLBX.MDP3, ES.c.0, trades only, one connection/subscription, 30 seconds or 50 market records, one loopback normal Terminal observer, private DATABENTO_LIVE trace, no retry/history/GEX/fallback/depth/orders. Staging must remain offline; preflight mapping/schema/session must be valid and entitlement/cost conditions unchanged. Any new licensing/fee requirement requires Operator decision before streaming.

No live stream, paid historical, purchase, licensing/billing change, Stripe Live, public production or push performed during closure. **Stop for Operator review and separate Live approval.**
