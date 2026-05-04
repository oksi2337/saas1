/**
 * 단독 실행 스크립트.
 * 사용법: npx ts-node src/skills/naver-place-scraper/run.ts <placeId> [cookie]
 *
 * 예시:
 *   npx ts-node src/skills/naver-place-scraper/run.ts 1234567890
 *   npx ts-node src/skills/naver-place-scraper/run.ts 1234567890 "NID=xxx; NNB=yyy"
 */
import 'dotenv/config';
import { scrapeNaverPlace } from './index';

async function main() {
  const placeId = process.argv[2];
  if (!placeId) {
    console.error('사용법: ts-node run.ts <naver_place_id> [cookie_string]');
    process.exit(1);
  }

  const cookie = process.argv[3] || process.env.NAVER_PLACE_COOKIE || '';

  console.log(`\n[네이버 스크래퍼] 플레이스 ID: ${placeId}`);
  console.log(`인증 방식: ${cookie ? 'cookie' : '비로그인'}`);
  console.log('수집 시작...\n');

  const result = await scrapeNaverPlace({
    store_id: 'test_store',
    naver_place_id: placeId,
    last_collected_at: null,          // 전량 수집
    auth: {
      method: 'cookie',
      cookie: cookie || undefined,
    },
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
        console.log(`  내용: ${r.content.slice(0, 60)}...`);
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
