# Privacy Policy (template)

> **Template — not legal advice.** Fill the placeholders and check it against GDPR/local law.

**Operator:** `<LEGAL ENTITY>` — contact `<EMAIL / ADDRESS>`.

## 1. What we store

| Data | Purpose | Where |
|---|---|---|
| Username, account id, role, status | Login, entitlement checks | SQLite (`users`) |
| Password **hash** (scrypt + per-user salt, never the plaintext) | Authentication | SQLite (`users.password_hash`) |
| Subscription/plan state, provider reference | Billing, access control | SQLite (`subscriptions`, `entitlements`) |
| JWT id (`jti`) + expiry of revoked tokens | Session revocation | SQLite (`revoked_tokens`) |
| Server logs: IP address, timestamps, event names | Abuse protection, rate limiting, incident response | Log output / log store |
| Browser `localStorage`: chart settings, `deepchart_jwt_token` | Remember layout and keep you signed in | Your browser only |

Market data itself (ticks, bars, gaps) is technical data about instruments — it contains no personal
information.

## 2. What we do **not** do
* No third-party analytics, ad networks or tracking pixels.
* No profiling or automated decision-making beyond entitlement checks.
* We never sell or rent personal data.

## 3. Legal bases (GDPR)
Performance of a contract (providing the Service), legitimate interest (abuse prevention, security
logging), legal obligation (invoices/tax records if you are a paying customer).

## 4. Retention
* Account and subscription data: while the account exists.
* Security logs: `<N>` days.
* Stored market data and gap records: `STORE_RETENTION_DAYS` (default 30 days; `0` disables
  automatic deletion) for ticks/gaps, and `STORE_BARS_RETENTION_DAYS` (default: same value) for
  aggregated candles only.
* Backups: the newest `BACKUP_KEEP` snapshots (default 7) — old snapshots are pruned automatically.

## 5. Your rights
Access, rectification, deletion, restriction, portability and objection. Deletion is enforced by
`DELETE /api/v1/admin/users/:id` (removes user, entitlements and subscription rows immediately) or by
asking the operator. You can also sign out at any time, which revokes your token.

## 6. Processors
* Payment provider: `Stripe` (if billing is enabled) — receives the checkout identifiers and email
  you provide there.
* Market data vendors: `Databento` / `CBOE` / `Binance` — they receive our API credentials and the
  symbology of the instruments we subscribe to, **not** your personal data.
* Hosting provider: `<PROVIDER / REGION>`.

## 7. Cookies
We set no marketing or analytics cookies. The service worker-free frontend keeps its session token
and UI preferences in `localStorage`, which you can clear in your browser at any time (this signs you
out).

## 8. Changes
We publish the version date at the top of this page and announce material changes in the app.
