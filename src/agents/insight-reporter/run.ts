/**
 * CLI: npx ts-node src/agents/insight-reporter/run.ts <storeId|all> <weekly|monthly> [period_start] [period_end]
 *
 * Examples:
 *   npx ts-node src/agents/insight-reporter/run.ts store_seed_001 weekly 2026-04-28 2026-05-04
 *   npx ts-node src/agents/insight-reporter/run.ts all monthly 2026-04-01 2026-04-30
 *   npx ts-node src/agents/insight-reporter/run.ts store_seed_001 weekly  # 이번 주 자동 계산
 */
import 'dotenv/config';
import dayjs from 'dayjs';
import { generateReport } from './index';

async function main() {
  const [, , storeArg, typeArg, startArg, endArg] = process.argv;

  if (!storeArg || !typeArg) {
    console.error('Usage: run.ts <storeId|all> <weekly|monthly> [period_start] [period_end]');
    process.exit(1);
  }

  const reportType = typeArg as 'weekly' | 'monthly';
  const storeId    = storeArg === 'all' ? null : storeArg;

  let periodStart: string;
  let periodEnd: string;

  if (startArg && endArg) {
    periodStart = startArg;
    periodEnd   = endArg;
  } else if (reportType === 'weekly') {
    const today   = dayjs();
    periodEnd     = today.subtract(1, 'day').format('YYYY-MM-DD');
    periodStart   = today.subtract(7, 'day').format('YYYY-MM-DD');
  } else {
    const lastMonth = dayjs().subtract(1, 'month');
    periodStart     = lastMonth.startOf('month').format('YYYY-MM-DD');
    periodEnd       = lastMonth.endOf('month').format('YYYY-MM-DD');
  }

  console.log(`\n▶ 리포트 생성 — type=${reportType}, store=${storeId ?? 'all'}, ${periodStart} ~ ${periodEnd}\n`);

  const result = await generateReport({ store_id: storeId, report_type: reportType, period_start: periodStart, period_end: periodEnd });

  console.log(`\n━━ 리포트 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  for (const r of result.results) {
    const icon = r.status === 'sent' ? '✅' : r.status === 'skipped' ? '⏭' : '❌';
    console.log(`${icon} ${r.store_id}  report_id=${r.report_id ?? '-'}  excel=${r.excel_file_url ? 'O' : 'X'}`);
    if (r.error) console.log(`   error: ${r.error}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('리포트 생성 오류:', err);
  process.exit(1);
});
