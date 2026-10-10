/**
 * Unit suite entry point.
 *
 * The environment is pinned BEFORE any module is imported: suites must never touch a developer's
 * real SQLite file, and MarketDataStore reads STORAGE_PATH when its singleton is constructed at
 * import time. Hence the dynamic imports below.
 */
process.env.NODE_ENV = 'test';
process.env.STORAGE_PATH = ':memory:';

export {};

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
const runInstrumentCatalogTests = (await import('./instruments.test.js')).runInstrumentCatalogTests;
const runQuoteBoardTests = (await import('./quoteBoard.test.js')).runQuoteBoardTests;
const { runDatabentoNormalizerTests } = await import('./databentoNormalizer.test.js');
const { runDatabentoClientTests } = await import('./databentoClient.test.js');
const { runDatabentoLiveTests } = await import('./databentoLive.test.js');
const { runDatabentoStorageTests } = await import('./databentoStorage.test.js');
const { runOptionsRoutesTests } = await import('./optionsRoutes.test.js');
const { runDatabentoConfigTests } = await import('./databentoConfig.test.js');
const { runInstrumentSyncTests } = await import('./instrumentSync.test.js');
const { runOptionsMathTests } = await import('./optionsMath.test.js');
const { runDatabentoRoutesTests } = await import('./databentoRoutes.test.js');
const { runChartRoutesTests } = await import('./chartRoutes.test.js');
const { runDepthStorageTests } = await import('./depthStorage.test.js');
const { runAlertEngineTests } = await import('./alertEngine.test.js');
const { runAlertsApiTests } = await import('./alertsApi.test.js');
const { runProfileEngineTests } = await import('./profileEngine.test.js');

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
  await runInstrumentCatalogTests();
  await runQuoteBoardTests();
  await runDatabentoNormalizerTests();
  await runDatabentoClientTests();
  await runDatabentoLiveTests();
  await runDatabentoStorageTests();
  await runOptionsRoutesTests();
  await runDatabentoRoutesTests();
  await runChartRoutesTests();
  await runDatabentoConfigTests();
  await runInstrumentSyncTests();
  await runOptionsMathTests();
  await runDepthStorageTests();
  await runAlertEngineTests();
  await runAlertsApiTests();
  await runProfileEngineTests();

  const elapsed = Date.now() - start;
  console.log('\n======================================================');
  console.log(`🎉 ALL UNIT TESTS PASSED SUCCESSFULLY IN ${elapsed}ms`);
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ UNIT TEST SUITE FAILED:', err);
  process.exit(1);
});
