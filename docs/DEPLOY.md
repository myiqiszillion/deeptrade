# DeepChart — Production Deployment Runbook

Operational counterpart to the code. It assumes a **single host** (VM or container) running one Node
process plus a TLS-terminating reverse proxy. Horizontal scaling is covered at the end.

---

## 1. Requirements

| Component | Requirement | Why |
|---|---|---|
| Node.js | **≥ 22.13 or 24 LTS** (24 recommended) | `node:sqlite` needs `--experimental-sqlite` before 22.13 |
| pnpm | 12.x (`packageManager` pin, corepack) | workspace install |
| Disk | ~1–2 GB free per active instrument-month | measured ~85 MB/day of ticks for one CME instrument |
| TLS | reverse proxy with a real certificate | tokens and `wss://` must never run over plain HTTP |

---

## 2. Environment (minimum viable production set)

```ini
NODE_ENV=production
AUTH_REQUIRED=1
AUTH_JWT_SECRET=<32+ random chars>       # boot fails without it
ADMIN_USERNAME=<operator login>           # bootstrapped on every start
ADMIN_PASSWORD=<10+ chars>
ADMIN_SECRET=<32+ random chars>           # admin API + admin login
ALLOWED_ORIGINS=https://your-domain.tld   # WebSocket/CORS allowlist
TRUST_PROXY=1                             # only behind a proxy you control
METRICS_TOKEN=<random string>             # /metrics is 401 without it
STORE_RETENTION_DAYS=30                   # 0 = keep forever (disk will fill)
STORE_BARS_RETENTION_DAYS=365             # candles outlive ticks; re-pulling them costs money
# Vendor credentials — Databento (OPRA / Equities / CME)
DATABENTO_API_KEY=<your Databento api key>
DATABENTO_OPRA_DATASET=OPRA.PILLAR        # US equity options
DATABENTO_EQUITIES_DATASET=DBEQ.BASIC     # or XNAS.ITCH
DATABENTO_CME_DATASET=GLBX.MDP3           # CME Globex
DATABENTO_SYMBOLS=ES,NQ,MES,MNQ,CL,GC,SPY,QQQ,AAPL,NVDA,MSFT,TSLA
DATABENTO_COST_CAP_USD=50                 # soft cap; /api/v1/options/chain checks vendor_usage before fetching
DATABENTO_TIMEOUT_MS=15000
HISTORY_BARS_TARGET=1500                  # 100..5000 bars per timeframe requested on subscribe
REDIS_URL=redis://localhost:6379          # optional — falls back to in-memory TTL cache
```

Notes:

* With `AUTH_REQUIRED=1` (or `NODE_ENV=production`) the server **refuses to boot** on the public dev
  secret or with `DEV_HOOKS=1`.
* `pnpm verify:p0` is a development harness (needs your local SQLite with stored ticks). The release
  gate is `pnpm test` / CI.

---

## 3. First deploy

```bash
cp .env.example .env      # fill in the block above + vendor keys
pnpm install
pnpm build
node --env-file=.env server/dist/index.js
# or: docker compose up -d --build   (app + Caddy automatic HTTPS)
```

Verify:

```bash
curl -fsS http://127.0.0.1:8080/healthz                    # {"status":"ok",...}
curl -fsS -H "x-admin-secret: $ADMIN_SECRET" \
     http://127.0.0.1:8080/healthz | jq .databento        # {configured,datasets,costCap,vendorUsage,specs}
curl -fsS -H "x-admin-secret: $ADMIN_SECRET" \
     -X POST http://127.0.0.1:8080/api/v1/admin/instruments/sync  # {synced,total,perDataset}
curl -fsS http://127.0.0.1:8080/api/v1/options/chain?underlying=SPY | jq .contracts
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" \
     http://127.0.0.1:8080/metrics | head
```

The operator account signs in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` and holds the `elite` plan, so
it can open every instrument immediately.

---

## 4. Selling access

Three moving parts: **plans** (code), **subscriptions** (SQLite), **entitlements** (checked on each
data request). The catalog lives in `server/src/billing/plans.ts` — edit names, prices, symbol
patterns, data types and session counts there, then rebuild.

### Option A — manual invoicing

```bash
curl -X POST -H "x-admin-secret: $ADMIN_SECRET" -H 'Content-Type: application/json' \
     -d '{"planId":"pro","days":31}' \
     http://127.0.0.1:8080/api/v1/admin/users/usr_customer1/plan
```

### Option B — Stripe self-service

1. Create two recurring monthly prices → `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE`.
2. Set `STRIPE_SECRET_KEY` and add a webhook endpoint
   `https://your-domain.tld/api/v1/billing/webhook` subscribed to `checkout.session.completed`,
   `customer.subscription.created|updated|deleted`, `invoice.payment_failed`.
3. Put the signing secret in `STRIPE_WEBHOOK_SECRET`. Signatures are verified by HMAC over the raw
   body (300 s tolerance); unsigned events get 400.
4. The in-app **Plans** panel then offers `Subscribe`, calling `POST /api/v1/billing/checkout` and
   redirecting to Stripe Checkout.

Entitlements are derived from the catalog only: the browser may request a plan but can never widen
its own access.

---

## 5. Data, retention, backup

| Concern | Setting | Notes |
|---|---|---|
| Retention | `STORE_RETENTION_DAYS` (30) | Trades/bars/gaps older than the cutoff are deleted every pass |
| Cadence | `STORE_MAINTENANCE_INTERVAL_MS` (15 min) | Also purges expired JWT revocations and checkpoints the WAL |
| Space reclaim | `STORE_VACUUM=1` | One `VACUUM` per day (brief write pause — schedule off-peak) |
| Backup | `node scripts/backup_db.mjs` | `VACUUM INTO` snapshot + `integrity_check`, keeps the newest 7 |

```cron
15 3 * * * cd /srv/deepchart && STORAGE_PATH=/app/data/market_data.sqlite \
  BACKUP_DIR=/srv/backups BACKUP_KEEP=14 node scripts/backup_db.mjs >> /var/log/deepchart-backup.log 2>&1
```

Keep `historyDays` in the plan catalog consistent with `STORE_RETENTION_DAYS`: the UI advertises the
former, the database enforces the latter.

---

## 6. Monitoring & alerts

`GET /metrics` (Prometheus text; requires `METRICS_TOKEN` or admin credentials) exposes:

| Metric | Alert when |
|---|---|
| `deepchart_sessions` | approaching `MAX_SESSIONS` (capacity lockout risk) |
| `deepchart_ws_rejected_total{reason="capacity"}` | sustained > 0 |
| `deepchart_auth_events_total{event="login_failed"}` | sudden spike (credential stuffing) |
| `deepchart_rate_limited_total{bucket="auth"}` | spike |
| `deepchart_vendor_fetch_total{result="error"}` | growing (upstream quota/licence trouble) |
| `deepchart_store_rows{table="trades"}` | slope above your retention plan |
| `deepchart_process_resident_memory_bytes` | sustained growth (leak triage) |

`LOG_FORMAT=json` emits one object per line (`ts`, `level`, `msg`, `pid`) — ship it to your log store
and alert on `level:"error"`. Public `/healthz` returns only
`{status, uptimeSec, sessions, feedStatus}`; full diagnostics need `x-admin-secret`.

---

## 7. Scaling (what breaks first)

1. **Disk** — tick storage grows linearly: retention + downsampling first.
2. **Single process** — market contexts and the SQLite file live in-process; 500 sessions is the
   default ceiling. Scaling out needs sticky sessions plus a shared store (Postgres/ClickHouse),
   which is not implemented.
3. **Vendor budget** — history pagination calls an API; `MAX_VENDOR_FETCHES_PER_HOUR` caps the
   damage per account.
4. **Node upgrade** — `node:sqlite` is still experimental upstream: pin the version, re-run
   `pnpm test` before bumping.

---

## 8. Legal pre-flight (blocking for a paid launch)

* **Exchange data redistribution**: serving market data to third parties needs appropriate licences
  from your data vendor (Databento) and exchange redistribution terms. The code cannot grant
  this — get it in writing before charging money.
* Fill `TERMS.md` / `PRIVACY.md` with your legal entity, jurisdiction and contact address.
* `LICENSE` (MIT) covers the source code only — **not** the market data flowing through it.
* *Market Profile* / *TPO* are third-party trademarks; avoid implying exchange endorsement.

