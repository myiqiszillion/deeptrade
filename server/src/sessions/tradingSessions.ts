import { SessionCalendar } from '../calendar/sessionCalendar.js';
export function getTradingHours(instrumentId: number, date: string): { open: string; close: string; isOpen: boolean } {
  const info = SessionCalendar.getSessionInfo(new Date(date).getTime(), 'CME_EQUITY_INDEX');
  return { open: '09:30', close: '16:00', isOpen: info.isOpen };
}
export function isMarketOpen(timestamp: number, scheduleId = 'CME_EQUITY_INDEX'): boolean {
  return SessionCalendar.getSessionInfo(timestamp, scheduleId).isOpen;
}
