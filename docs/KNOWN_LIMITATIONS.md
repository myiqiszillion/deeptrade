# KNOWN LIMITATIONS

As of Phase 6 (Staging Release), the following limitations are present in DeepChart:

1. **Docker Execution Blocked Locally:** Validation of the containerized environment relies entirely on the Release Operator due to `docker` not being installed on the local CI machine.
2. **Databento Entitlement Mocking:** Live Data vendor integrations are not fully verified against a Live API Key with active subscriptions (BLOCKED). Fail-closed mechanisms have been confirmed through integration testing, but real data throughput is unverified.
3. **Stripe Test Mode:** Billing operations are entirely verified against mocked implementations or test Stripe keys. No real transactions are validated.
4. **Single Node Deployment:** The SQLite WAL approach operates strictly as a single-node deployment. Multi-node clustering or horizontally scaling the backend server instances is NOT supported at this time and would corrupt the database or duplicate data streams.
5. **No Production Database Baseline:** There is no existing production database to migrate. All deployments will currently create fresh databases.
