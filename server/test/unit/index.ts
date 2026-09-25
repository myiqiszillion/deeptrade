import { runAuthTests } from './auth.test.js';
import { runEntitlementTests } from './entitlement.test.js';
import { runMarketDataStoreTests } from './marketDataStore.test.js';
import { runSessionCalendarTests } from './sessionCalendar.test.js';
import { runFootprintEngineTests } from './footprintEngine.test.js';
import { runReplaySessionTests } from './replaySession.test.js';
import { runValidateTests } from './validate.test.js';

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

  const elapsed = Date.now() - start;
  console.log('\n======================================================');
  console.log(`🎉 ALL UNIT TESTS PASSED SUCCESSFULLY IN ${elapsed}ms`);
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ UNIT TEST SUITE FAILED:', err);
  process.exit(1);
});
