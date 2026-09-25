import { runChartSmokeTests } from './chartSmoke.test.js';
import { runHistoryApiTests } from './historyApi.test.js';
import { runWebSocketIntegrationTests } from './websocket.test.js';

async function main() {
  console.log('======================================================');
  console.log('🧪 RUNNING DEEPCHART INTEGRATION TEST SUITE');
  console.log('======================================================\n');

  const start = Date.now();
  await runChartSmokeTests();
  await runHistoryApiTests();
  await runWebSocketIntegrationTests();

  const elapsed = Date.now() - start;
  console.log('\n======================================================');
  console.log(`🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY IN ${elapsed}ms`);
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ INTEGRATION TEST SUITE FAILED:', err);
  process.exit(1);
});
