/**
 * organizer 프로세스 진입점.
 *
 * Usage:
 *   npx ts-node src/agents/organizer/run.ts
 *
 * 환경 변수:
 *   COLLECT_ON_START=true  기동 즉시 전체 수집 1회 실행 (기본: false)
 */
import 'dotenv/config';
import dayjs from 'dayjs';
import { startScheduler } from './scheduler';
import { triggerAllCollections, handleEvent } from './index';
import { generateReport } from '../insight-reporter';

async function main() {
  console.log('🚀 organizer 시작');

  // 기동 즉시 수집 (옵션)
  if (process.env.COLLECT_ON_START === 'true') {
    console.log('[organizer] 기동 즉시 수집 실행');
    await triggerAllCollections();
  }

  // 스케줄러 시작
  startScheduler(
    // 주간 리포트 핸들러
    () => {
      const today      = dayjs();
      const periodEnd  = today.subtract(1, 'day').format('YYYY-MM-DD');
      const periodStart = today.subtract(7, 'day').format('YYYY-MM-DD');
      generateReport({ store_id: null, report_type: 'weekly', period_start: periodStart, period_end: periodEnd })
        .catch((err) => console.error('[organizer] 주간 리포트 오류:', err));
    },
    // 월간 리포트 핸들러
    () => {
      const lastMonth  = dayjs().subtract(1, 'month');
      const periodStart = lastMonth.startOf('month').format('YYYY-MM-DD');
      const periodEnd   = lastMonth.endOf('month').format('YYYY-MM-DD');
      generateReport({ store_id: null, report_type: 'monthly', period_start: periodStart, period_end: periodEnd })
        .catch((err) => console.error('[organizer] 월간 리포트 오류:', err));
    },
  );

  console.log('✅ 스케줄러 활성. Ctrl+C로 종료.\n');

  // 프로세스 유지
  process.on('SIGINT', () => {
    console.log('\n[organizer] 종료');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[organizer] SIGTERM 수신. 종료');
    process.exit(0);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[organizer] unhandledRejection:', reason);
  });
}

main().catch((err) => {
  console.error('organizer 기동 실패:', err);
  process.exit(1);
});
