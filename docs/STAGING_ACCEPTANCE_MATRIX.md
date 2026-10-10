# STAGING ACCEPTANCE MATRIX

| Requirement | Local Verified | Docker Verified | Vendor Verified | Blocker |
|---|---|---|---|---|
| Frontend SPA | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Backend HTTP | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| WebSocket | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| JWT Auth | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| User Isolation | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Alert Delivery | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| SQLite Persistence | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Depth Storage | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Backup/Restore | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Liquidity Heatmap | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Footprint | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Options | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Prometheus Metrics | VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Caddy HTTPS | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | None |
| Docker Health | NOT VERIFIED | BLOCKED | NOT VERIFIED | Environment (Local Docker unavailable) |
| Databento Live | NOT VERIFIED | NOT VERIFIED | BLOCKED | Vendor API Key missing / Account setup |
| Market Data Entitlements | VERIFIED | NOT VERIFIED | BLOCKED | Vendor Setup |

**Note**: Docker Verified is marked as BLOCKED or NOT VERIFIED because the local development environment does not have Docker Engine installed to execute the Staging Boot. The Release Operator must perform these verifications in the isolated staging environment.
