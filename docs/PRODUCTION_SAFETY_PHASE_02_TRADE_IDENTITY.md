# Production Safety Phase 02 — Stable Trade Identity & Deduplication

Ngày hoàn tất: **14/10/2026 ICT**. **P0-C OFFLINE VERIFIED trong phạm vi vendor record-equivalence**. Không chạy Databento Live hoặc historical có phí. Không tuyên bố identity là execution ID globally unique.

## 1. Release identity

- **Final Git HEAD: `767a067c599a3ef255d1569c06eccd7ebdd88da6`**.
- **Baseline / Phase 01 final HEAD: `c42edce6abc31fbdc62668038cf43e1c6880ea8d`**.
- Phase 01 implementation đã commit; baseline tracked tree sạch. Final implementation commit local sau các regression PASS; không push.
- Báo cáo này là artifact local được viết sau implementation commit để ghi full HEAD trực tiếp; chưa đưa vào Git. Tracked tree sạch, các reports/scratch untracked cũ được giữ nguyên.
- Private evidence: `C:\Users\Administrator\.codex\private-acceptance\production-safety-phase02-1791911613214`. Manifest `phase02_evidence.json` lưu baseline/final HEAD, SHA-256, reproduction và đối soát. Không lưu API key hoặc JWT.

## 2. Collision reproduction trước fix

Chạy offline trên source baseline, memory SQLite, không vendor transport. Hai DBN Trades: cùng ms, price 5000, size 2, side B; venue sequence 100 và 101.

| Metric | Expected | Actual baseline |
|---|---:|---:|
| Engine accepted records | 2 | 2 |
| Engine volume | 4 | 4 |
| Persisted rows | 2 | **1** |
| Persisted volume | 4 | **2** |

Đây là runtime failure đã tái hiện, không chỉ risk từ source. `phase02_before.log` và reproduction source được giữ trong private evidence.

Root cause: DBN trade không có ID; MarketContext sinh ID cho Tick nhưng persist **MarketTrade gốc**. Store tạo fallback `t_<ms>_<price>_<size>`; composite PK `(provider, symbol, trade_id)` và INSERT OR IGNORE làm mất trade thứ hai.

Hai lỗi bổ sung đã đo:

- Cùng native side B: binary decoder = BUY, JSON normalizer = sell (`phase02_side_before.log`). Đã sửa JSON A→sell / B→buy, giữ UNKNOWN; sửa expectations sai trong unit tests, không đổi CVD/Footprint/Profile formulas. Đối chiếu [Databento Trades schema](https://databento.com/docs/schemas-and-data-formats/trades).
- Chạy context source baseline trong fixture cô lập: 2 records có sequence 100→104 bị ghi `Trade sequence gap (3 missing)`. Không có bằng chứng sequence là trade-local; đã loại suy luận số trades mất. `phase02_gap_before.log` ghi baseline revision và kết quả thực tế.

## 3. Normalized identity policy

Một tuple cố định từ các fields TradeMsg và dataset do client cung cấp:

```text
dataset, publisher_id, instrument_id, ts_event_ns,
raw_price, size, action, native_side, flags, depth,
ts_recv_ns, ts_in_delta, venue_sequence
```

Các field và ý nghĩa được đối chiếu [schema chính thức](https://databento.com/docs/schemas-and-data-formats/trades) và [TradeMsg của DBN](https://github.com/databento/dbn/blob/main/rust/dbn/src/record.rs). Publisher thể hiện dataset/venue; sequence là message sequence của venue. TradeMsg không cung cấp channel_id hay execution ID ở cấu trúc này; không tự tạo các trường đó.

ID:

```text
dbn-trades-v1:<20-digit original event-ns>:<base64url canonical tuple>
```

Tuple được lưu losslessly trong TEXT primary key hiện có, không dùng digest hoặc price/size/side-only fingerprint. Khác bất kỳ trường tuple nào → ID khác. Hai raw records cùng ms/price/size nhưng khác sequence, native side, ns, publisher, instrument hoặc dataset không bị gộp.

ID không chứa local receive timestamp, connection/session ID hoặc encoding version. Exact tuple redelivery giữ ID qua reconnect simulation, history overlap, restart và replay. SessionId của acceptance vẫn là cohort provenance, không override trade ID.

**Scope/guarantee:** injective đối với tuple hợp lệ; dedup ở cấp normalized vendor record-equivalence, không ở cấp exchange execution. Một logical event được vendor sửa/recapture với tuple khác có thể có ID khác. Nếu hai distinct events có toàn bộ tuple giống nhau, metadata hiện có không thể phân biệt; cần VENDOR CONFIRMATION, không khẳng định globally unique hay exactly-once executions. Chưa quan sát contradiction này bằng genuine records trong phase offline.

Full epoch ns và instrument scope phân biệt các ngày/reset/rollover; không suy trading date CME từ UTC date và không gán contract name giả. Channel scope, effective exchange trading date và genuine mapping lifecycle vẫn UNKNOWN ngoài evidence đã có.

## 4. Timestamp và sequence precision

DBN đọc original uint64 ns trước khi chia ra milliseconds; giữ event/capture ns dưới dạng decimal strings. Raw price integer, flags, depth, delta và sequence gốc cũng được giữ trong tuple. Chart buckets tiếp tục dùng milliseconds; không thay engine arithmetic hoặc DBN constants.

JSON chỉ được cấp VENDOR_RECORD_V1 khi đủ fields và precision đáng tin. Decimal ns string / ISO timestamp có đến 9 fractional digits được canonicalize; unsafe JS number không được coi là exact ns. Numeric precision đã mất được ghi NOT CAPTURED, không tái dựng ns từ ms. Partial known event ns có thể đi cùng local delivery ID, không được gán vendor scope giả.

Sequence uint32 giữ nguyên, gồm 0 và max uint32. Reset/wrap/jump không tự gán missing-trade count hoặc completeness. Fixture có scope dataset/publisher/instrument/ns rõ; không chứng minh actual CME channel/reset semantics. Không sửa Windows clock hoặc ép latency dương.

## 5. SQLite và legacy compatibility

**Schema/migration changes: NONE.** Existing TEXT PK chứa ID + metadata encoded; không thêm cột, re-key, UPDATE hoặc backfill trades/bars cũ. Không cần data migration hay migration rollback; rollback acceptance là N/A, không báo PASS giả cho một migration không có.

- VENDOR_RECORD_V1: decode metadata từ ID khi query/restore.
- LEGACY: giữ nguyên ID, ts, price, size, side và metadata đã có. Không bịa instrument, original ns hoặc sequence. Không sửa side đã lưu trong lịch sử khi thiếu raw provenance.
- LOCAL_DELIVERY_V1: dữ liệu mới không đủ metadata/ID nhận UUID cho từng delivery; không tự gộp theo giá/size. Known ns nếu có được giữ, không cấp global vendor uniqueness.
- Legacy↔vendor equivalence và anonymous duplicate attribution **UNKNOWN**. Không tự merge aliases hoặc sửa PK lịch sử. Những rows trước đây bị collision bỏ qua không thể khôi phục từ log thiếu raw records; không tải vendor data để sửa trong phase này.

Store/context kiểm tra key + normalized payload. Exact duplicate không vào engines lần nữa; ID có payload mâu thuẫn không overwrite. Regular context chuyển **BLOCKED / UNAVAILABLE**, disconnect feed và chặn tiếp tục ingestion cho đến Operator reconciliation. Replay/history loader cũng từ chối conflicting payloads. Negative fixture đã chứng minh hành vi này; không phải một incident mới trên staging.

Đây chưa phải durable ingestion: SQLite write failure receipts, atomic accepted/persisted transitions, crash/WAL recovery và contention thuộc P0-D, chưa triển khai.

## 6. Dedup / replay reconciliation

Main ES cohort là **OFFLINE FIXTURE ONLY**, provider namespace `none/ES`; metadata instruments 10252 và 10253 là fixture values, không claim mapping vendor mới.

| Measurement | Actual |
|---|---:|
| Accepted / persisted / restored / replay-emitted | **8 / 8 / 8 / 8** |
| Volume | **14** |
| BUY volume / SELL volume / UNKNOWN volume | **7 / 3 / 4** |
| Final CVD | **+4** |
| Replay profile / footprint volume | **14 / 14** |
| New inferred sequence gaps | **0** |
| Isolated disk fixture incl. legacy row | **9 rows / volume 19** |
| Legacy row | **1 / volume 5**, original ID unchanged, unknown side, ns NOT CAPTURED |
| Separate NQ fixture | **1 / volume 3**, no mixing into ES |

Persisted rows được đọc lại sau close/reopen disk fixture; set vendor IDs và metadata vẫn đúng. Integrity_check=ok; foreign_key_check=0. No schema column migration. Conflict negative case dùng namespace riêng `fixture-conflict/ES`, giữ 1 accepted row và chặn conflicting/follow-up inputs, không cộng vào main ES cohort.

| Required case | Result |
|---|---|
| Same-ms/price/size, different sequence | PASS — distinct IDs/rows |
| BUY/SELL differences | PASS — distinct native metadata; normalized JSON matches DBN |
| Exact replay duplicate | PASS — no double-count |
| History/live overlap | PASS — production history adapter với explicit mock HTTP + DBN fixture có cùng IDs; 2+2 overlap → 2 |
| Out-of-order timestamps | PASS trong cùng session fixture; original ns retained |
| Sequence jumps | PASS — no inferred missing count |
| Reset/wrap | PASS về identity preservation; real channel semantics UNKNOWN |
| Instrument rollover/mapping-change fixture | PASS về distinct identity; genuine routing lifecycle NOT VERIFIED |
| Duplicate redelivery with changed local receive time / fresh context | PASS — ID stable, persisted lookup prevents re-ingestion |
| Legacy missing metadata | PASS về preservation; historical equivalence UNKNOWN |
| Disk restart/replay | PASS — IDs/count/volume retained |
| Two-symbol isolation | PASS — ES/NQ fixture namespaces |
| Cohort count/volume/CVD/UNKNOWN reconciliation | PASS |

No fixture được gắn nhãn genuine Live. Profile calculation confidence không được diễn giải là full-session capture/completeness.

## 7. Regression exit codes

| Check | Result | Exit |
|---|---|---:|
| pnpm test:identity:offline | PASS | 0 |
| pnpm test:ordinary:offline | Phase 01 safety PASS: 18 negative profiles, one mock attempt/command/ACK, no history/options/quote calls, expiry cleanup | 0 |
| pnpm typecheck:all | PASS | 0 |
| pnpm test:unit | PASS | 0 |
| pnpm test:integration | PASS | 0 |
| pnpm verify:p0 | 13/13 PASS | 0 |
| pnpm test:isolation | 17/17 PASS | 0 |
| pnpm test:e2e | 19/19 PASS, 0 remaining processes | 0 |
| pnpm test:terminal:offline | Actual normal App/components/messages PASS | 0 |
| verify_trades_e2e --offline --regular-terminal | 50 fixture records; final React digest MATCH | 0 |
| pnpm build:all / final server build / Docker app build | PASS | 0 |
| Staging verification | 42/42 PASS | 0 |

Initial regression caught acceptance controller overriding the production ID with a session hash; controller now preserves normalized ID. Initial unit expectations for incorrect JSON side were corrected against native DBN + official schema. Identity test initially used future fixture timestamps and a null-prototype assertion mismatch; test setup was corrected, not production timestamp behavior. All final required checks PASS before local source commit.

## 8. Docker staging / persistence

Rebuilt app, composed with `deploy/offline-staging.compose.yml`. Ran actual 42-check staging verifier with a one-command preload override: backup command `BACKUP_KEEP=100000`, preventing pruning for that invocation only. No persistent backup/runtime config change, no reset/down -v/volume deletion.

- App healthy; proxy running on loopback.
- Provider none, key empty, runtime start 0, profile empty.
- Runtime connection attempts / subscription commands / ACK = **0 / 0 / 0**.
- Before/after **66.238 trades / 1.236 bars**; integrity_check=ok, foreign_key_check=0.
- Trade schema hash unchanged: `d51ca89ff37363edc183962536713ffa219a6823789d4817f1a42495d010ef5c`.
- All **8 existing backup snapshots retained**; new backup integrity PASS.
- Local/container tradeIdentity.js hashes match: `3262e58f96468602bc84b88823484b9093ef86f7aaaec62620afc601b08f5a83`.

Staging verifier writes its ordinary test accounts/rules and backup metadata; this is not a trade identity migration. No historical PK or trade/bar data rewrite. Existing private acceptance/incident evidence remains untouched.

## 9. Changed files và boundaries

New `marketData/tradeIdentity.ts`, dedicated offline test and npm command. Metadata carried through MarketTrade/Tick, DBN trades parser, JSON normalizer/history adapter, MarketContext, SQLite query/restore, BacktestReplayEngine loader and ReplaySession count. Acceptance controller keeps ID instead of session override. Four unit files update incorrect side expectations.

`ordinaryRuntime.ts`, approval capability, registry subscription policy, runtime start/expiry budgets, DBN constants and Footprint/CVD/Profile engine calculations remain unchanged. No second vendor integration, no reconnect, extra vendor symbols, public activation endpoint, historical/GEX/options fetch or licensing/billing changes.

## 10. UNKNOWN / next gate

Genuine verification of new identity is **NOT VERIFIED**. Globally unique executions, identical-tuple vendor semantics, recapture/correction behavior, channel scope, genuine trading-date/rollover mapping and legacy↔new-record equivalence remain UNKNOWN. Contradictory legacy IDs require Operator reconciliation; no automatic decision or re-key.

**Ready to propose P0-D OFFLINE** on complete vendor-record identity, after separate Operator approval. P0-D must address persistence acknowledgement, transactions/failure recovery/backup restore and accepted-vs-persisted reconciliation; no such implementation in this phase. Vendor semantics confirmation remains a separate condition before broader genuine/production claims.

No Live authorization carried forward from 13/10. GLBX.MDP3 mbp-10 — NOT AUTHORIZED; DOM / Liquidity Heatmap — BLOCKED BY VENDOR ENTITLEMENT. No Live, MBP-10 retry, paid historical, entitlement purchase, Stripe Live, public deploy, billing/clock changes or push. Stop after offline handoff.