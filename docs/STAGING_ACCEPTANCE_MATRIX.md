# STAGING ACCEPTANCE MATRIX

| Requirement | Local Verified | Docker Verified | Vendor Verified | Blocker / Operational Requirement |
|---|---|---|---|---|
| Frontend SPA | VERIFIED | VERIFIED | N/A (Internal) | None |
| Backend HTTP | VERIFIED | VERIFIED | N/A (Internal) | None |
| WebSocket | VERIFIED | VERIFIED | N/A (Internal) | None |
| JWT Auth | VERIFIED | VERIFIED | N/A (Internal) | None |
| User Isolation | VERIFIED | VERIFIED | N/A (Internal) | None |
| Alert Delivery | VERIFIED | VERIFIED | N/A (Internal) | None |
| SQLite WAL Persistence | VERIFIED | VERIFIED | N/A (Internal) | None |
| Depth Storage & Codec | VERIFIED | VERIFIED | PENDING_LIVE_FEED | Vendor Live Data required for full live depth test |
| Backup / WAL-Safe Restore | VERIFIED | VERIFIED | N/A (Internal) | None |
| Liquidity Heatmap | VERIFIED | VERIFIED | PENDING_LIVE_VENDOR | Mathematical/UI verified; vendor-live data unverified |
| Footprint Delta Ladder | VERIFIED | VERIFIED | PENDING_LIVE_VENDOR | Arithmetic/UI verified; live vendor tick stream unverified |
| Options Greeks & Chain | VERIFIED | VERIFIED | PENDING_LIVE_VENDOR | Black-Scholes verified; OPRA live chain unverified |
| Prometheus Metrics | VERIFIED | VERIFIED | N/A (Internal) | None |
| Caddy Reverse Proxy & TLS | VERIFIED | VERIFIED | N/A (Internal) | None |
| Docker Container Health | VERIFIED | VERIFIED | N/A (Internal) | None |
| Stripe Webhook Idempotency | VERIFIED | VERIFIED | TEST_MODE_VERIFIED | Webhook deduplication verified; Live charges unverified |
| Databento Live Market Data | NOT VERIFIED | NOT VERIFIED | BLOCKED | Operator `DATABENTO_API_KEY` required (Fail-Closed active) |
| Market Data Entitlements | VERIFIED | VERIFIED | BLOCKED | Operator Vendor Account Setup |

**Verification Notes**:
1. **Docker Staging Verified**: Docker Desktop Compose environment is verified (42/42 acceptance checks PASS, Caddy TLS/SPA, SQLite WAL hot persistence, and restart recovery).
2. **Vendor Verified Integrity**: Analytics engines (Footprint, Heatmap, Options) are mathematically and architecturally verified via unit/integration test fixtures, but marked `PENDING_LIVE_VENDOR` because live market data vendor keys are not configured.
3. **Stripe Billing**: Event signature verification, event ID deduplication (`webhook_events`), and cancellation revocation are verified in test mode; live payments are marked `TEST_MODE_VERIFIED`.
4. **Network Safety**: Proxy default port binding is loopback (`127.0.0.1:80`, `127.0.0.1:443`) for staging safety.
