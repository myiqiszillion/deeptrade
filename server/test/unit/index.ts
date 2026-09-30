/**
 * Unit suite entry point.
 *
 * The environment is pinned BEFORE any module is imported: suites must never touch a developer's
 * real SQLite file, and MarketDataStore reads STORAGE_PATH when its singleton is constructed at
 * import time. Hence the dynamic imports below.
 */
process.env.NODE_ENV = 'test';
process.env.STORAGE_PATH = ':memory:';

const { runAuthTests } = await import('./auth.test.js');
const { runEntitlementTests } = await import('./entitlement.test.js');
const { runMarketDataStoreTests } = await import('./marketDataStore.test.js');
const { runSessionCalendarTests } = await import('./sessionCalendar.test.js');
const { runFootprintEngineTests } = await import('./footprintEngine.test.js');
const { runReplaySessionTests } = await import('./replaySession.test.js');
const { runValidateTests } = await import('./validate.test.js');
const { runRegressionAuditTests } = await import('./regression_audit.test.js');
const { runPasswordTests } = await import('./passwords.test.js');
const { runLoginGuardTests } = await import('./loginGuard.test.js');
const { runBillingTests } = await import('./billing.test.js');
const { runRetentionTests } = await import('./retention.test.js');
const { runDatabentoUsageTests } = await import('./databentoUsage.test.js');
const { runInstrumentCatalogTests } = await import('./instruments.test.js');
const { runInstrumentDefinitionTests } = await import('./instrumentDefinitions.test.js');
const { runQuoteBoardTests } = await import('./quoteBoard.test.js');

async function main() {
  console.log('======================================================');
  console.log('🧪 RUNNING DEEPCHART UNIT TEST SUITE');
  console.log('======================================================\n');

  const start = Date.now();
  await runAuthTests();
  await runEntitlementTests();
  await runMarketDataStoreTests();
  await runSessionCalendarTests();
  await runFootprintEngineTests();
  await runReplaySessionTests();
  await runValidateTests();
  await runRegressionAuditTests();
  await runPasswordTests();
  await runLoginGuardTests();
  await runBillingTests();
  await runRetentionTests();
  await runDatabentoUsageTests();
  await runInstrumentCatalogTests();
  await runInstrumentDefinitionTests();
  await runQuoteBoardTests();

  const elapsed = Date.now() - start;
  console.log('\n======================================================');
  console.log(`🎉 ALL UNIT TESTS PASSED SUCCESSFULLY IN ${elapsed}ms`);
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ UNIT TEST SUITE FAILED:', err);
  process.exit(1);
});
