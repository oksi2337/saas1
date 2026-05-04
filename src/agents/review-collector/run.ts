/**
 * CLI: npx ts-node src/agents/review-collector/run.ts <storeId> [platform,platform,...]
 *
 * Example:
 *   npx ts-node src/agents/review-collector/run.ts store_abc123 naver,baemin
 *   npx ts-node src/agents/review-collector/run.ts store_abc123          # 모든 플랫폼
 */
import 'dotenv/config';
import { collectReviews } from './index';
import type { Platform } from '../../types/review';

const ALL_PLATFORMS: Platform[] = ['naver', 'baemin', 'coupangeats', 'kakaomap', 'google'];

async function main() {
  const [, , storeId, platformArg] = process.argv;

  if (!storeId) {
    console.error('Usage: run.ts <storeId> [platform,platform,...]');
    process.exit(1);
  }

  const platforms: Platform[] = platformArg
    ? (platformArg.split(',') as Platform[])
    : ALL_PLATFORMS;

  console.log(`\n▶ 수집 시작 — store: ${storeId}, platforms: ${platforms.join(', ')}\n`);

  const result = await collectReviews({ store_id: storeId, platforms, priority: 'normal' });

  console.log(`\n━━ 수집 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`store_id : ${result.store_id}`);
  console.log(`total_new: ${result.total_new}`);

  for (const r of result.results) {
    const icon =
      r.status === 'success'       ? '✅' :
      r.status === 'skipped'       ? '⏭' :
      r.status === 'not_implemented' ? '🚧' :
      r.status === 'auth_expired'  ? '🔑' :
      r.status === 'blocked'       ? '🚫' : '❌';

    console.log(`\n${icon} ${r.platform.padEnd(12)} status=${r.status}  new=${r.new_review_count}`);
    if (r.error_message) console.log(`   error: ${r.error_message}`);
    if (r.new_review_ids.length > 0) {
      console.log(`   ids  : ${r.new_review_ids.slice(0, 3).join(', ')}${r.new_review_ids.length > 3 ? ' ...' : ''}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error('수집 오류:', err);
  process.exit(1);
});
