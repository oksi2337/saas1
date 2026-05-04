import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { triggerAllCollections } from './index';

dayjs.extend(utc);
dayjs.extend(timezone);

const KST = 'Asia/Seoul';
const COLLECT_INTERVAL_MS = 60 * 60_000; // 1시간

// ── Public ────────────────────────────────────────────────

export function startScheduler(onWeeklyReport: () => void, onMonthlyReport: () => void): void {
  // 1시간마다 전체 수집
  setInterval(() => {
    console.log(`[scheduler] 정기 수집 tick — ${new Date().toISOString()}`);
    triggerAllCollections().catch((err) =>
      console.error('[scheduler] 수집 tick 오류:', err),
    );
  }, COLLECT_INTERVAL_MS);

  console.log(`[scheduler] 정기 수집 시작 (1시간 주기)`);

  // 주간 리포트: 매주 월요일 09:00 KST
  scheduleRecurring(
    () => nextWeekday(1, 9, 0), // 1 = 월요일
    () => {
      console.log('[scheduler] 주간 리포트 트리거');
      onWeeklyReport();
    },
    '주간 리포트',
  );

  // 월간 리포트: 매월 1일 09:00 KST
  scheduleRecurring(
    nextMonthStart,
    () => {
      console.log('[scheduler] 월간 리포트 트리거');
      onMonthlyReport();
    },
    '월간 리포트',
  );
}

// ── Helpers ───────────────────────────────────────────────

/**
 * 다음 트리거 시각을 계산하는 함수를 받아 반복 예약한다.
 * 트리거 후 다음 시각을 재계산하여 setTimeout을 재등록한다.
 */
function scheduleRecurring(
  nextFn: () => Date,
  handler: () => void,
  label: string,
): void {
  function schedule() {
    const next = nextFn();
    const delayMs = next.getTime() - Date.now();
    console.log(`[scheduler] ${label} 예약: ${dayjs(next).tz(KST).format('YYYY-MM-DD HH:mm')} KST`);

    setTimeout(() => {
      handler();
      schedule(); // 다음 회차 재등록
    }, delayMs);
  }

  schedule();
}

/** 다음 요일(dayOfWeek: 0=일, 1=월~6=토)의 지정 시각(KST) */
function nextWeekday(dayOfWeek: number, hour: number, minute: number): Date {
  const now = dayjs().tz(KST);
  let next = now.day(dayOfWeek).hour(hour).minute(minute).second(0).millisecond(0);
  if (next.isBefore(now) || next.isSame(now)) {
    next = next.add(7, 'day');
  }
  return next.toDate();
}

/** 다음 달 1일 09:00 KST */
function nextMonthStart(): Date {
  const now = dayjs().tz(KST);
  const candidate = now.date(1).hour(9).minute(0).second(0).millisecond(0);
  const next = candidate.isBefore(now) || candidate.isSame(now)
    ? candidate.add(1, 'month')
    : candidate;
  return next.toDate();
}
