import '../../../scripts/offline_guard.cjs';
import { runChartSmokeTests } from './chartSmoke.test.js';
import { runHistoryApiTests } from './historyApi.test.js';
import { runWebSocketIntegrationTests } from './websocket.test.js';
import { runAuthFlowTests } from './authFlow.test.js';
import { runBehavioralContractTests } from './behavioral_contracts.test.js';
import { runDepthPersistenceTests } from './depthPersistence.test.js';
import { runAlertDeliveryTests } from './alertDelivery.test.js';

async function main() {
  console.log('======================================================');
  console.log('🧪 RUNNING DEEPCHART INTEGRATION TEST SUITE');
  console.log('======================================================\n');

  const start = Date.now();
  await runChartSmokeTests();
  await runHistoryApiTests();
  await runWebSocketIntegrationTests();
  await runAuthFlowTests();
  await runBehavioralContractTests();
  await runDepthPersistenceTests();
  await runAlertDeliveryTests();

  const elapsed = Date.now() - start;
  console.log('\n======================================================');
  console.log(`🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY IN ${elapsed}ms`);
  console.log('======================================================\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
