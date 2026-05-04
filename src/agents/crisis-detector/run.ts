/**
 * CLI: npx ts-node src/agents/crisis-detector/run.ts <storeId> <reviewId,...>
 *
 * Example:
 *   npx ts-node src/agents/crisis-detector/run.ts store_seed_001 rv_001,rv_002
 *
 * review_ids 없이 storeId만 전달하면 해당 매장의 미처리 저평점 리뷰 전체를 처리한다.
 */
import 'dotenv/config';
import { eq, and, isNull, lte } from 'drizzle-orm';
import { db } from '../../db';
import { reviews } from '../../db/schema';
import { detectCrisis } from './index';

async function main() {
  const [, , storeId, reviewIdArg] = process.argv;

  if (!storeId) {
    console.error('Usage: run.ts <storeId> [reviewId,reviewId,...]');
    process.exit(1);
  }

  let reviewIds: string[];

  if (reviewIdArg) {
    reviewIds = reviewIdArg.split(',');
  } else {
    // 매장의 저평점(1~2) 미처리 리뷰 전체 조회
    const rows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.storeId, storeId), lte(reviews.rating, 2)));
    reviewIds = rows.map((r) => r.id);
    console.log(`⚙ 저평점 리뷰 ${reviewIds.length}건 발견\n`);
  }

  if (reviewIds.length === 0) {
    console.log('위기 리뷰 없음. 종료.');
    process.exit(0);
  }

  console.log(`\n▶ 위기 감지 시작 — store: ${storeId}, reviews: ${reviewIds.length}건\n`);

  const result = await detectCrisis({ store_id: storeId, review_ids: reviewIds });

  console.log(`\n━━ 감지 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`store_id    : ${result.store_id}`);
  console.log(`위기 리뷰   : ${result.crisis_count}건`);
  console.log(`알림 발송   : ${result.alert_sent ? '✅' : '❌'}`);
  if (result.alert_ids.length > 0) {
    console.log(`alert_ids   : ${result.alert_ids.join(', ')}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('위기 감지 오류:', err);
  process.exit(1);
});
