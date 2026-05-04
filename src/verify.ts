/**
 * Week 1 end-to-end 파이프라인 검증 스크립트.
 * 실제 스크래퍼 없이 테스트 리뷰를 직접 삽입하여 하위 파이프라인 전체를 검증한다.
 *
 * Usage:
 *   npx ts-node src/verify.ts
 *
 * 필수:
 *   - .env에 DATABASE_URL 설정 + db:migrate 완료
 *   - ANTHROPIC_API_KEY: Step 5~6(AI 생성) 검증 시 필요 (없으면 해당 단계 skip)
 */
import 'dotenv/config';
import { and, eq, inArray, count } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { db } from './db';
import { users, stores, storePlatforms, reviews, pendingReplies, crisisAlerts, healthScores, reports } from './db/schema';
import { draftReplies } from './agents/reply-drafter';
import { detectCrisis } from './agents/crisis-detector';
import { generateReport } from './agents/insight-reporter';

// ── 검증용 고정 ID ────────────────────────────────────────
const V_USER_ID  = 'user_verify_001';
const V_STORE_ID = 'store_verify_001';
const V_REVIEW_PREFIX = 'verify_rv_';

let passCount = 0;
let failCount = 0;
let skipCount = 0;

// ── Helpers ───────────────────────────────────────────────

function ok(msg: string)   { console.log(`  ✅ ${msg}`); passCount++; }
function fail(msg: string) { console.log(`  ❌ ${msg}`); failCount++; }
function skip(msg: string) { console.log(`  ⏭  ${msg}`); skipCount++; }
function step(n: number, title: string) { console.log(`\n[Step ${n}] ${title}`); }

async function assert(condition: boolean, passMsg: string, failMsg: string) {
  condition ? ok(passMsg) : fail(failMsg);
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Review SaaS — Week 1 End-to-End 파이프라인 검증');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Step 1: DB 연결 ────────────────────────────────────
  step(1, 'DB 연결 확인');
  try {
    await db.select().from(users).limit(1);
    ok('DATABASE_URL 연결 성공');
  } catch (err) {
    fail(`DB 연결 실패: ${err}`);
    console.error('\n.env에 DATABASE_URL을 설정하고 npm run db:migrate를 실행하세요.');
    process.exit(1);
  }

  // ── Step 2: 테이블 존재 확인 ──────────────────────────
  step(2, '테이블 존재 확인');
  const tables = [users, stores, storePlatforms, reviews, pendingReplies, crisisAlerts, healthScores, reports];
  const tableNames = ['users', 'stores', 'store_platforms', 'reviews', 'pending_replies', 'crisis_alerts', 'health_scores', 'reports'];
  for (let i = 0; i < tables.length; i++) {
    try {
      await db.select().from(tables[i]).limit(1);
      ok(tableNames[i]);
    } catch {
      fail(`${tableNames[i]} — 테이블 없음. npm run db:migrate 실행 필요`);
    }
  }

  // ── Step 3: 시드 데이터 준비 ──────────────────────────
  step(3, '검증용 시드 데이터 준비');

  await db.insert(users).values({
    id: V_USER_ID, email: 'verify@example.com', name: '검증 사장님',
    phone: '01099990000', plan: 'pro',
  }).onConflictDoNothing();

  await db.insert(stores).values({
    id: V_STORE_ID, ownerId: V_USER_ID, name: '검증 식당',
    category: '한식', address: '서울시 강남구', status: 'active',
  }).onConflictDoNothing();

  await db.insert(storePlatforms).values({
    id: `sp_${V_STORE_ID}_naver`, storeId: V_STORE_ID,
    platform: 'naver', platformStoreId: 'verify_place_001',
    authMethod: 'cookie', isActive: false,
  }).onConflictDoNothing();

  ok(`user(${V_USER_ID}), store(${V_STORE_ID}), store_platform(naver) upsert 완료`);

  // ── Step 4: 테스트 리뷰 삽입 ──────────────────────────
  step(4, '테스트 리뷰 삽입 (⭐1, ⭐4, ⭐5)');

  const testReviews = [
    { id: `${V_REVIEW_PREFIX}star1`, rating: 1, content: '음식에 이물질이 나왔어요. 너무 화가 납니다. 위생 관리 좀 해주세요.' },
    { id: `${V_REVIEW_PREFIX}star4`, rating: 4, content: '음식이 맛있어요. 친절하게 응대해 주셨습니다. 또 방문할게요.' },
    { id: `${V_REVIEW_PREFIX}star5`, rating: 5, content: '진짜 최고예요! 김치찌개가 정말 맛있었고 서비스도 훌륭해요.' },
  ];

  for (const r of testReviews) {
    await db.insert(reviews).values({
      id: r.id, storeId: V_STORE_ID, platform: 'naver',
      platformReviewId: r.id, authorName: '검증테스터',
      rating: r.rating, content: r.content,
      imageUrls: [], replied: false, reviewedAt: new Date(),
    }).onConflictDoNothing();
  }

  const insertedCount = await db
    .select({ c: count() }).from(reviews)
    .where(and(eq(reviews.storeId, V_STORE_ID), inArray(reviews.id, testReviews.map((r) => r.id))))
    .then((rows) => Number(rows[0].c));

  await assert(insertedCount === 3, `리뷰 3건 삽입 확인 (count=${insertedCount})`, `리뷰 삽입 실패 (count=${insertedCount})`);

  const reviewIds = testReviews.map((r) => r.id);

  // ── Step 5: reply-drafter (⭐3~5 초안 생성) ───────────
  step(5, 'reply-drafter-agent 실행 (⭐4, ⭐5 리뷰 → 초안 생성)');

  if (!process.env.ANTHROPIC_API_KEY) {
    skip('ANTHROPIC_API_KEY 없음 — AI 생성 단계 건너뜀');
  } else {
    try {
      const draftResult = await draftReplies({ store_id: V_STORE_ID, review_ids: reviewIds });
      await assert(draftResult.drafted_count > 0, `초안 ${draftResult.drafted_count}건 생성 (skip=${draftResult.skipped_count}, fail=${draftResult.failed_count})`, `초안 생성 0건 — 로그 확인 필요`);

      const replyRows = await db
        .select().from(pendingReplies)
        .where(eq(pendingReplies.storeId, V_STORE_ID));
      await assert(replyRows.length > 0, `pending_replies 테이블에 ${replyRows.length}건 기록됨`, 'pending_replies 비어 있음');

      if (replyRows.length > 0) {
        console.log(`     draft[0]: "${replyRows[0].draftContent.slice(0, 60)}..."`);
        console.log(`     diversity_score: ${replyRows[0].diversityScore?.toFixed(3) ?? 'N/A'}`);
        console.log(`     status: ${replyRows[0].status}`);
      }
    } catch (err) {
      fail(`reply-drafter 오류: ${err}`);
    }
  }

  // ── Step 6: crisis-detector (⭐1 위기 감지) ───────────
  step(6, 'crisis-detector-agent 실행 (⭐1 리뷰 → 위기 감지 + 알림)');

  if (!process.env.ANTHROPIC_API_KEY) {
    skip('ANTHROPIC_API_KEY 없음 — AI 분류 단계 건너뜀');
  } else {
    try {
      const crisisResult = await detectCrisis({ store_id: V_STORE_ID, review_ids: reviewIds });
      await assert(crisisResult.crisis_count === 1, `위기 리뷰 1건 감지 (alert_ids=${crisisResult.alert_ids.join(',')})`, `위기 감지 실패 (crisis_count=${crisisResult.crisis_count})`);

      const alertRows = await db.select().from(crisisAlerts).where(eq(crisisAlerts.storeId, V_STORE_ID));
      await assert(alertRows.length > 0, `crisis_alerts 테이블에 ${alertRows.length}건 기록됨`, 'crisis_alerts 비어 있음');

      if (alertRows.length > 0) {
        console.log(`     crisis_type: ${alertRows[0].crisisType}`);
        console.log(`     deletion_eligible: ${alertRows[0].deletionEligible}`);
        console.log(`     summary: "${alertRows[0].summary?.slice(0, 60)}"`);
      }
    } catch (err) {
      fail(`crisis-detector 오류: ${err}`);
    }
  }

  // ── Step 7: 중복 수집 시뮬레이션 ─────────────────────
  step(7, '중복 수집 시뮬레이션 (같은 platform_review_id 재삽입 → 0건 추가)');

  const beforeCount = await db
    .select({ c: count() }).from(reviews).where(eq(reviews.storeId, V_STORE_ID))
    .then((r) => Number(r[0].c));

  for (const r of testReviews) {
    await db.insert(reviews).values({
      id: uuidv4(),  // 다른 UUID지만
      storeId: V_STORE_ID, platform: 'naver',
      platformReviewId: r.id,  // 같은 platform_review_id → unique 제약 충돌
      authorName: '검증테스터', rating: r.rating, content: r.content,
      imageUrls: [], replied: false, reviewedAt: new Date(),
    }).onConflictDoNothing();
  }

  const afterCount = await db
    .select({ c: count() }).from(reviews).where(eq(reviews.storeId, V_STORE_ID))
    .then((r) => Number(r[0].c));

  await assert(beforeCount === afterCount, `중복 차단 확인 (재삽입 후 리뷰 수 동일: ${afterCount}건)`, `중복 삽입 발생! before=${beforeCount} after=${afterCount}`);

  // ── Step 8: insight-reporter (주간 리포트) ────────────
  step(8, 'insight-reporter-agent 실행 (주간 리포트 생성)');

  try {
    const periodEnd   = dayjs().format('YYYY-MM-DD');
    const periodStart = dayjs().subtract(7, 'day').format('YYYY-MM-DD');

    const reportResult = await generateReport({
      store_id: V_STORE_ID, report_type: 'weekly',
      period_start: periodStart, period_end: periodEnd,
    });

    const r = reportResult.results[0];
    await assert(r && r.status !== 'failed', `리포트 생성 완료 (status=${r?.status}, report_id=${r?.report_id})`, `리포트 생성 실패: ${r?.error}`);

    const reportRow = await db.select().from(reports).where(eq(reports.storeId, V_STORE_ID)).then((rows) => rows[0]);
    await assert(!!reportRow, `reports 테이블에 기록됨 (id=${reportRow?.id})`, 'reports 테이블에 기록 없음');

    const scoreRow = await db.select().from(healthScores).where(eq(healthScores.storeId, V_STORE_ID)).then((rows) => rows[0]);
    await assert(!!scoreRow, `health_scores 기록됨 (score=${scoreRow?.score}, label=${scoreRow?.scoreLabel})`, 'health_scores 기록 없음');
  } catch (err) {
    fail(`insight-reporter 오류: ${err}`);
  }

  // ── 최종 결과 ─────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` 검증 완료  ✅ ${passCount}  ❌ ${failCount}  ⏭ ${skipCount}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failCount > 0) {
    console.log('실패한 항목을 확인하고 수정 후 재실행하세요.\n');
    process.exit(1);
  }

  console.log('다음 단계 (실제 매장 연결):');
  console.log('  1. .env에 SEED_NAVER_PLACE_ID, SEED_NAVER_COOKIE 설정');
  console.log('  2. npm run db:seed     — 실제 매장 등록');
  console.log('  3. npm run collect -- store_seed_001 naver  — 실제 수집 테스트');
  console.log('  4. npm run organizer   — 1시간 스케줄러 시작\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('검증 스크립트 오류:', err);
  process.exit(1);
});
