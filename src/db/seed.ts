/**
 * 개발/검증용 시드 데이터.
 * .env에 DATABASE_URL 설정 후 실행:
 *   npx ts-node src/db/seed.ts
 *
 * 멱등성 보장: 같은 ID로 중복 실행해도 에러 없이 upsert 처리됨.
 */
import 'dotenv/config';
import { db } from './index';
import { users, stores, storePlatforms } from './schema';

// ── 시드 상수 ─────────────────────────────────────────────
// 실제 테스트에 사용할 값을 여기서 교체한다

const SEED_USER_ID    = 'user_seed_001';
const SEED_STORE_ID   = 'store_seed_001';

// 네이버 플레이스 ID (URL의 숫자 부분)
// 예: https://place.naver.com/restaurant/12345678 → '12345678'
const NAVER_PLACE_ID  = process.env.SEED_NAVER_PLACE_ID ?? '1234567890';

// 배민 사장님 스토어 ID (ceo.baemin.com URL에서 추출)
const BAEMIN_STORE_ID = process.env.SEED_BAEMIN_STORE_ID ?? 'bm_store_001';

// 쿠키는 .env에서 주입 (소스에 평문 저장 금지)
const NAVER_COOKIE    = process.env.SEED_NAVER_COOKIE  ?? '';
const BAEMIN_COOKIE   = process.env.SEED_BAEMIN_COOKIE ?? '';

// ─────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 시드 데이터 삽입 시작...\n');

  // 1. 사용자
  await db
    .insert(users)
    .values({
      id:                  SEED_USER_ID,
      email:               'seed@example.com',
      name:                '테스트 사장님',
      phone:               '01012345678',
      kakaoChannelConsent: false,
      plan:                'pro',
    })
    .onConflictDoNothing();

  console.log(`✅ users: ${SEED_USER_ID}`);

  // 2. 매장
  await db
    .insert(stores)
    .values({
      id:       SEED_STORE_ID,
      ownerId:  SEED_USER_ID,
      name:     '테스트 식당',
      category: '한식',
      address:  '서울시 강남구 테스트로 1',
      status:   'active',
    })
    .onConflictDoNothing();

  console.log(`✅ stores: ${SEED_STORE_ID}`);

  // 3. 플랫폼 연결 — 네이버
  const naverSpId = `sp_${SEED_STORE_ID}_naver`;
  await db
    .insert(storePlatforms)
    .values({
      id:              naverSpId,
      storeId:         SEED_STORE_ID,
      platform:        'naver',
      platformStoreId: NAVER_PLACE_ID,
      authMethod:      'cookie',
      authCredential:  NAVER_COOKIE || null,
      isActive:        Boolean(NAVER_COOKIE),
    })
    .onConflictDoNothing();

  console.log(`✅ store_platforms: naver  place_id=${NAVER_PLACE_ID}  active=${Boolean(NAVER_COOKIE)}`);

  // 4. 플랫폼 연결 — 배민
  const baeminSpId = `sp_${SEED_STORE_ID}_baemin`;
  await db
    .insert(storePlatforms)
    .values({
      id:              baeminSpId,
      storeId:         SEED_STORE_ID,
      platform:        'baemin',
      platformStoreId: BAEMIN_STORE_ID,
      authMethod:      'cookie',
      authCredential:  BAEMIN_COOKIE || null,
      isActive:        Boolean(BAEMIN_COOKIE),
    })
    .onConflictDoNothing();

  console.log(`✅ store_platforms: baemin store_id=${BAEMIN_STORE_ID}  active=${Boolean(BAEMIN_COOKIE)}`);

  console.log(`\n🌱 완료.`);
  console.log(`\n다음 명령어로 수집 테스트:`);
  console.log(`  npm run collect -- ${SEED_STORE_ID} naver,baemin\n`);

  process.exit(0);
}

seed().catch((err) => {
  console.error('시드 오류:', err);
  process.exit(1);
});
