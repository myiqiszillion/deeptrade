# Terms of Service (template)

> **Template — not legal advice.** Replace the placeholders, have a lawyer review it for your
> jurisdiction, and keep it consistent with the plan catalog in `server/src/billing/plans.ts`.

**Operator:** `<LEGAL ENTITY>` ("we"). **Service:** DeepChart ("the Service"). **Version:** `<DATE>`.

## 1. The Service
The Service is a **chart-only market analysis terminal**. It displays market data, order-flow
analytics and historical replay. It does **not** place, route, hold or advise on orders, does not
manage money, and is **not** investment advice. You are solely responsible for your trading
decisions.

## 2. Accounts
1. You must provide a username and a password of at least 10 characters and keep it confidential.
2. Sessions are limited per plan (`maxConcurrentSessions` in the plan catalog).
3. We may suspend or delete accounts used for abuse, intrusion attempts, scraping, unlicensed
   redistribution, or non-payment.
4. You can request deletion of your account and personal data at any time (see `PRIVACY.md`).

## 3. Plans, billing and refunds
1. Current plans, prices and entitlement scopes are published in the app and may change with notice.
2. Subscriptions renew automatically until cancelled. Cancellation takes effect at the end of the
   paid period; access is revoked immediately if you request immediate termination.
3. Failed payments may lead to `past_due` status and suspension of data access.
4. Refunds: `<REFUND POLICY — e.g. pro-rata within 7 days of first purchase>`.

## 4. Market data and third parties
1. Market data is provided by third-party vendors (e.g. `Databento`, `Tradovate`, `CBOE`). Their
   terms and exchange rules apply to you as an end user.
2. Data may be delayed, incomplete or unavailable; the Service never fabricates data and marks
   unavailable feeds as `UNAVAILABLE` rather than guessing.
3. **Redistribution is prohibited.** You may not resell, sublicense, redistribute, or systematically
   extract the data or derived analytics (including screen-scraping or bulk API harvesting) without
   a separate written agreement with the operator and the relevant market data licences.

## 5. Acceptable use
Do not: attempt to bypass authentication/entitlements, exceed documented rate limits, share accounts
across users, probe the service for vulnerabilities without permission, or use it to break exchange
rules (including spoofing or layering analysis intended to facilitate market manipulation).

## 6. Availability and support
The Service is provided "as is" without warranty. `<SLA / SUPPORT CHANNEL — e.g. email support on business days>`.
We may perform maintenance that interrupts service; planned maintenance affects history pagination
and live feeds.

## 7. Liability
To the maximum extent permitted by law, our aggregate liability is limited to the fees you paid in
the `<N>` months preceding the claim. We are not liable for trading losses, lost profits, or data
inaccuracy arising from vendor outages.

## 8. Termination and governing law
We may terminate for material breach. These terms are governed by the laws of
`<JURISDICTION>`, and disputes are resolved in `<COURT/ARBITRATION FORUM>`.

## 9. Contact
`<EMAIL / ADDRESS>`
