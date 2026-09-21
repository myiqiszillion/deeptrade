/**
 * SessionCalendar provides official exchange session schedules, trading hours,
 * and session rollover detection for CME, CBOT, NYMEX, COMEX, and Binance.
 */

export interface SessionInfo {
  scheduleId: string;
  sessionDate: string; // YYYY-MM-DD representing the trading session date
  isOpen: boolean;
  isRth: boolean; // Regular Trading Hours
  isEth: boolean; // Extended Trading Hours
  sessionStartTs: number; // Epoch ms of current session start
  sessionEndTs: number;   // Epoch ms of current session end
}

export class SessionCalendar {
  /**
   * Get session information for a given timestamp and schedule ID.
   */
  public static getSessionInfo(timestamp: number, scheduleId = 'CME_EQUITY_INDEX'): SessionInfo {
    const date = new Date(timestamp);

    if (scheduleId === 'BINANCE_24_7') {
      // 24/7 continuous trading; session boundary at 00:00 UTC
      const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const endOfDay = new Date(startOfDay.getTime() + 86400000);
      const dateStr = startOfDay.toISOString().slice(0, 10);

      return {
        scheduleId,
        sessionDate: dateStr,
        isOpen: true,
        isRth: true,
        isEth: false,
        sessionStartTs: startOfDay.getTime(),
        sessionEndTs: endOfDay.getTime(),
      };
    }

    // For CME / CBOT: Central Time (CT)
    // For NYMEX / COMEX: Eastern Time (ET)
    const isCentral = scheduleId.startsWith('CME') || scheduleId.startsWith('CBOT');
    const timeZone = isCentral ? 'America/Chicago' : 'America/New_York';

    // Format local time parts using Intl for reliable DST handling
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'short',
    });

    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const weekday = partMap.weekday; // 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
    const hour = parseInt(partMap.hour || '0', 10);
    const minute = parseInt(partMap.minute || '0', 10);
    const timeNum = hour * 100 + minute;

    // Daily trading schedule:
    // CME/CBOT:
    //   Sunday open: 17:00 CT
    //   Mon-Thu: 17:00 CT (previous day) to 16:00 CT. Daily halt 16:00 - 17:00 CT.
    //   Friday close: 16:00 CT. Weekend halt until Sunday 17:00 CT.
    //   RTH: 08:30 CT - 15:15 CT.
    let isOpen = false;
    let isRth = false;
    let isEth = false;

    if (isCentral) {
      if (weekday === 'Sun') {
        if (timeNum >= 1700) {
          isOpen = true;
          isEth = true;
        }
      } else if (weekday === 'Fri') {
        if (timeNum < 1600) {
          isOpen = true;
          if (timeNum >= 830 && timeNum < 1515) {
            isRth = true;
          } else {
            isEth = true;
          }
        }
      } else if (weekday === 'Sat') {
        isOpen = false;
      } else {
        // Mon - Thu
        if (timeNum < 1600 || timeNum >= 1700) {
          isOpen = true;
          if (timeNum >= 830 && timeNum < 1515) {
            isRth = true;
          } else {
            isEth = true;
          }
        }
      }
    } else {
      // NYMEX / COMEX (ET)
      // Sunday open: 18:00 ET
      // Mon-Thu: 18:00 ET (previous day) to 17:00 ET. Daily halt 17:00 - 18:00 ET.
      // Friday close: 17:00 ET.
      // RTH: 09:00 - 14:30 ET
      if (weekday === 'Sun') {
        if (timeNum >= 1800) {
          isOpen = true;
          isEth = true;
        }
      } else if (weekday === 'Fri') {
        if (timeNum < 1700) {
          isOpen = true;
          if (timeNum >= 900 && timeNum < 1430) {
            isRth = true;
          } else {
            isEth = true;
          }
        }
      } else if (weekday === 'Sat') {
        isOpen = false;
      } else {
        if (timeNum < 1700 || timeNum >= 1800) {
          isOpen = true;
          if (timeNum >= 900 && timeNum < 1430) {
            isRth = true;
          } else {
            isEth = true;
          }
        }
      }
    }

    // Trading session date attribution:
    // Trades after 17:00 CT (or 18:00 ET) belong to the NEXT business day's session!
    const rolloverHour = isCentral ? 17 : 18;
    const year = parseInt(partMap.year || '2026', 10);
    const month = parseInt(partMap.month || '1', 10);
    const day = parseInt(partMap.day || '1', 10);

    let sessionDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (hour >= rolloverHour) {
      // Belongs to tomorrow
      const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
      sessionDate = nextDay.toISOString().slice(0, 10);
    }

    // Approximate session start/end in epoch ms for anchoring
    const sessionStartTs = hour >= rolloverHour
      ? timestamp - ((hour - rolloverHour) * 3600 + minute * 60) * 1000
      : timestamp - ((hour + (24 - rolloverHour)) * 3600 + minute * 60) * 1000;
    const sessionEndTs = sessionStartTs + 23 * 3600 * 1000;

    return {
      scheduleId,
      sessionDate,
      isOpen,
      isRth,
      isEth,
      sessionStartTs,
      sessionEndTs,
    };
  }

  /**
   * Determine whether two consecutive timestamps belong to different trading sessions.
   */
  public static isNewSession(
    prevTimestamp: number,
    currentTimestamp: number,
    scheduleId = 'CME_EQUITY_INDEX'
  ): boolean {
    if (prevTimestamp <= 0 || currentTimestamp <= 0) return false;
    if (currentTimestamp <= prevTimestamp) return false;

    const prevInfo = this.getSessionInfo(prevTimestamp, scheduleId);
    const currInfo = this.getSessionInfo(currentTimestamp, scheduleId);

    return prevInfo.sessionDate !== currInfo.sessionDate;
  }
}
