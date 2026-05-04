/**
 * CLI: npx ts-node src/agents/reply-drafter/run.ts <storeId> [reviewId,...]
 *
 * Example:
 *   npx ts-node src/agents/reply-drafter/run.ts store_seed_001 rv_001,rv_002
 *
 * review_ids 없이 storeId만 전달하면 해당 매장의 답글 없는 ⭐3~5 리뷰 전체를 처리한다.
 */
import 'dotenv/config';
import { eq, and, gte, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { reviews, pendingReplies } from '../../db/schema';
import { draftReplies } from './index';

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
    // 답글 없는 ⭐3~5 리뷰 전체 조회
    const existingReplyIds = await db
      .select({ reviewId: pendingReplies.reviewId })
      .from(pendingReplies)
      .where(eq(pendingReplies.storeId, storeId))
      .then((rows) => rows.map((r) => r.reviewId));

    const rows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.storeId, storeId),
          gte(reviews.rating, 3),
        ),
      )
      .then((rows) => rows.filter((r) => !existingReplyIds.includes(r.id)));

    reviewIds = rows.map((r) => r.id);
    console.log(`⚙ 미처리 ⭐3~5 리뷰 ${reviewIds.length}건 발견\n`);
  }

  if (reviewIds.length === 0) {
    console.log('처리할 리뷰 없음. 종료.');
    process.exit(0);
  }

  console.log(`\n▶ 초안 생성 시작 — store: ${storeId}, reviews: ${reviewIds.length}건\n`);

  const result = await draftReplies({ store_id: storeId, review_ids: reviewIds });

  console.log(`\n━━ 초안 생성 결과 ━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`store_id  : ${result.store_id}`);
  console.log(`생성 완료 : ${result.drafted_count}건`);
  console.log(`스킵      : ${result.skipped_count}건`);
  console.log(`실패      : ${result.failed_count}건`);
  if (result.reply_ids.length > 0) {
    console.log(`reply_ids : ${result.reply_ids.slice(0, 3).join(', ')}${result.reply_ids.length > 3 ? ' ...' : ''}`);
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('초안 생성 오류:', err);
  process.exit(1);
});
