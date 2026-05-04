/**
 * 단독 실행 스크립트.
 * 사용법: npx ts-node src/skills/baemin-scraper/run.ts <storeId> [cookie]
 *
 * 예시:
 *   npx ts-node src/skills/baemin-scraper/run.ts shop_12345678
 *   npx ts-node src/skills/baemin-scraper/run.ts shop_12345678 "SESSION=xxx; BSID=yyy"
 */
import 'dotenv/config';
import { scrapeBaemin } from './index';

async function main() {
  const storeId = process.argv[2];
  if (!storeId) {
    console.error('사용법: ts-node run.ts <baemin_store_id> [cookie_string]');
    process.exit(1);
  }

  const cookie = process.argv[3] || process.env.BAEMIN_CEO_COOKIE || '';

  console.log(`\n[배민 스크래퍼] 매장 ID: ${storeId}`);
  console.log(`인증 방식: ${cookie ? 'cookie' : '쿠키 없음 (로그인 실패 예상)'}`);
  console.log('수집 시작...\n');

  const result = await scrapeBaemin({
    store_id: 'test_store',
    baemin_store_id: storeId,
    last_collected_at: null,
    auth: { method: 'cookie', cookie: cookie || undefined },
  });

  if (result.status === 'success') {
    console.log(`✅ 수집 성공: ${result.reviews.length}개`);
    console.log(`다음 페이지 있음: ${result.next_page_available}`);
    if (result.reviews.length > 0) {
      console.log('\n--- 최신 리뷰 3개 ---');
      result.reviews.slice(0, 3).forEach((r, i) => {
        console.log(`\n[${i + 1}]`);
        console.log(`  ID: ${r.platform_review_id}`);
        console.log(`  작성자: ${r.author_name}`);
        console.log(`  별점: ${r.rating}점`);
        if (r.menu_ratings) {
          const { taste, quantity, delivery } = r.menu_ratings;
          console.log(`  세부: 맛 ${taste ?? '-'} / 양 ${quantity ?? '-'} / 배달 ${delivery ?? '-'}`);
        }
        console.log(`  내용: ${r.content.slice(0, 60)}${r.content.length > 60 ? '...' : ''}`);
        console.log(`  날짜: ${r.reviewed_at}`);
        console.log(`  답글: ${r.replied ? '있음' : '없음'}`);
      });
    }
  } else {
    console.error(`❌ 수집 실패 [${result.status}]: ${result.error_message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('예상치 못한 오류:', err);
  process.exit(1);
});
