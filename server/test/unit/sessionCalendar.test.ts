import assert from 'node:assert/strict';
import { SessionCalendar } from '../../src/calendar/sessionCalendar.js';

export async function runSessionCalendarTests(): Promise<void> {
  console.log('[unit/sessionCalendar.test] Running session calendar unit tests...');

  // 1. CME Session Hours
  // 2026-01-07 (Wednesday) 19:00 UTC = 13:00 CT (Market Open)
  const wedOpenTs = Date.UTC(2026, 0, 7, 19, 0, 0);
  assert.equal(SessionCalendar.getSessionInfo(wedOpenTs, 'CME_EQUITY_INDEX').isOpen, true, 'Wednesday 13:00 CT should be open');

  // 2026-01-07 (Wednesday) 22:30 UTC = 16:30 CT (Daily maintenance halt)
  const wedHaltTs = Date.UTC(2026, 0, 7, 22, 30, 0);
  assert.equal(SessionCalendar.getSessionInfo(wedHaltTs, 'CME_EQUITY_INDEX').isOpen, false, 'Wednesday 16:30 CT should be closed for maintenance');

  // 2026-01-10 (Saturday) 18:00 UTC = 12:00 CT (Weekend closed)
  const satClosedTs = Date.UTC(2026, 0, 10, 18, 0, 0);
  assert.equal(SessionCalendar.getSessionInfo(satClosedTs, 'CME_EQUITY_INDEX').isOpen, false, 'Saturday should be closed');

  // 2. Crypto 24/7 (BTCUSDT is always open)
  assert.equal(SessionCalendar.getSessionInfo(satClosedTs, 'BINANCE_24_7').isOpen, true, 'Crypto should be open on weekends');
  assert.equal(SessionCalendar.getSessionInfo(wedHaltTs, 'BINANCE_24_7').isOpen, true, 'Crypto should be open during CME halts');

  // 3. New Session Rollover
  // Wednesday 15:00 CT vs Wednesday 18:00 CT (after 17:00 CT rollover)
  const wedAfternoonTs = Date.UTC(2026, 0, 7, 21, 0, 0); // 15:00 CT
  const wedEveningTs = Date.UTC(2026, 0, 8, 0, 0, 0);     // 18:00 CT
  assert.equal(SessionCalendar.isNewSession(wedAfternoonTs, wedEveningTs, 'CME_EQUITY_INDEX'), true, 'Should detect new session after 17:00 CT rollover');

  console.log('  [PASS] All session calendar unit tests passed.');
}

if (process.argv[1]?.endsWith('sessionCalendar.test.ts') || process.argv[1]?.endsWith('sessionCalendar.test.js')) {
  runSessionCalendarTests().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
