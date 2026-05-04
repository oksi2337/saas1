import { eq, and, inArray, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db';
import { reviews, stores, users, toneProfiles, pendingReplies } from '../../db/schema';
import { generateReplyDraft } from '../../skills/reply-generation';
import { sendKakaoAlert } from '../../skills/kakao-alert';
import { maxSimilarityAgainst, passesDiversityCheck, MAX_ATTEMPTS } from './diversity';
import type { DraftRepliesTask, DraftRepliesResult } from './types';
import type { Review, Store, ToneProfile } from '../../db/schema';

const APP_URL = process.env.APP_URL ?? 'https://app.example.com';
const RECENT_REPLY_WINDOW = 20;

// ── Main ──────────────────────────────────────────────────

export async function draftReplies(task: DraftRepliesTask): Promise<DraftRepliesResult> {
  const { store_id, review_ids } = task;

  if (review_ids.length === 0) {
    return { store_id, drafted_count: 0, skipped_count: 0, failed_count: 0, reply_ids: [] };
  }

  // ⭐3점 이상만 처리 (⭐1~2는 crisis-detector 담당, null 별점도 여기서 처리)
  const targetReviews = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.storeId, store_id), inArray(reviews.id, review_ids)))
    .then((rows) => rows.filter((r) => r.rating === null || r.rating >= 3));

  if (targetReviews.length === 0) {
    return { store_id, drafted_count: 0, skipped_count: review_ids.length, failed_count: 0, reply_ids: [] };
  }

  // 이미 초안이 있는 리뷰 ID 집합 (중복 생성 방지)
  const existingSet = await loadExistingReplySet(store_id, targetReviews.map((r) => r.id));

  // 매장 + 소유자 정보
  const [store] = await db.select().from(stores).where(eq(stores.id, store_id));
  if (!store) throw new Error(`Store not found: ${store_id}`);
  const [owner] = await db.select().from(users).where(eq(users.id, store.ownerId));

  // 활성 톤 프로필
  const [activeTone] = await db
    .select()
    .from(toneProfiles)
    .where(and(eq(toneProfiles.storeId, store_id), eq(toneProfiles.isActive, true)));
  const toneProfileMissing = !activeTone;

  // 다양성 검증용 최근 20개 승인 답글
  const recentApproved = await db
    .select({ finalContent: pendingReplies.finalContent, draftContent: pendingReplies.draftContent })
    .from(pendingReplies)
    .where(and(eq(pendingReplies.storeId, store_id), eq(pendingReplies.status, 'approved')))
    .orderBy(desc(pendingReplies.createdAt))
    .limit(RECENT_REPLY_WINDOW);
  const recentTexts = recentApproved.map((r) => r.finalContent ?? r.draftContent);

  // 각 리뷰 순차 처리 (Claude API 연속 호출)
  const replyIds: string[] = [];
  let skippedCount = review_ids.length - targetReviews.length; // 저평점 스킵 수
  let failedCount = 0;

  for (const review of targetReviews) {
    if (existingSet.has(review.id)) {
      skippedCount++;
      continue;
    }

    const result = await draftOneReview(review, store, activeTone ?? null, recentTexts);

    if (result === null) {
      failedCount++;
      continue;
    }

    replyIds.push(result.replyId);
    // 생성된 초안을 다양성 비교 집합에 추가 (같은 배치 내 중복 방지)
    recentTexts.unshift(result.draft);
    if (recentTexts.length > RECENT_REPLY_WINDOW) recentTexts.pop();
  }

  // 초안 준비 알림
  if (replyIds.length > 0) {
    await sendKakaoAlert({
      recipient:    owner ? 'owner' : 'operator',
      owner_id:     owner?.id,
      message_type: 'draft_ready',
      content: {
        store_name:      store.name,
        new_draft_count: replyIds.length,
        dashboard_url:   `${APP_URL}/inbox/${store_id}`,
      },
    });
  }

  // 톤 프로필 미설정 안내 (초안이 하나라도 생성됐을 때만)
  if (toneProfileMissing && replyIds.length > 0) {
    await sendKakaoAlert({
      recipient:    owner ? 'owner' : 'operator',
      owner_id:     owner?.id,
      message_type: 'tone_setup_required',
      content: {
        store_name: store.name,
        message:    '답글 톤 학습이 되어 있지 않아 기본 톤으로 초안을 생성했습니다. 과거 답글 5개를 등록하시면 사장님 스타일에 맞는 초안을 만들어 드립니다.',
        setup_url:  `${APP_URL}/tone-setup/${store_id}`,
      },
    });
  }

  return {
    store_id,
    drafted_count: replyIds.length,
    skipped_count: skippedCount,
    failed_count:  failedCount,
    reply_ids:     replyIds,
  };
}

// ── Per-review processing ─────────────────────────────────

async function draftOneReview(
  review: Review,
  store: Store,
  tone: ToneProfile | null,
  recentTexts: string[],
): Promise<{ replyId: string; draft: string } | null> {
  let lastDraft: string | null = null;
  let lastSimilarity = 0;
  const previousDrafts: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateReplyDraft({
      review:   { content: review.content, rating: review.rating ?? 0, platform: review.platform },
      tone_profile: tone,
      context:  { store_name: store.name, store_category: store.category },
      generation_options: {
        mode:    'normal',
        attempt,
        diversity_instruction:
          attempt >= 2
            ? '이전 답글과 다른 시작 표현, 다른 문장 구조, 다른 어휘를 사용하세요.'
            : undefined,
        previous_drafts: previousDrafts.length > 0 ? [...previousDrafts] : undefined,
      },
    });

    if (result.status === 'failed' || !result.draft) continue;

    const draft = result.draft;
    const similarity = maxSimilarityAgainst(draft, recentTexts);

    lastDraft = draft;
    lastSimilarity = similarity;
    previousDrafts.push(draft);

    if (passesDiversityCheck(draft, recentTexts)) break;
  }

  if (!lastDraft) return null;

  // 3회 실패해도 마지막 초안으로 등록 (diversity_score 표기)
  const inserted = await db
    .insert(pendingReplies)
    .values({
      id:               uuidv4(),
      storeId:          store.id,
      reviewId:         review.id,
      draftContent:     lastDraft,
      generationAttempt: previousDrafts.length as 1 | 2 | 3,
      diversityScore:   lastSimilarity,
      toneProfileId:    tone?.id ?? null,
      isCrisisReply:    false,
      status:           'pending',
    })
    .onConflictDoNothing()
    .returning({ id: pendingReplies.id });

  if (inserted.length === 0) return null; // 이미 존재 (race condition)

  return { replyId: inserted[0].id, draft: lastDraft };
}

// ── Helpers ───────────────────────────────────────────────

async function loadExistingReplySet(storeId: string, reviewIds: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ reviewId: pendingReplies.reviewId })
    .from(pendingReplies)
    .where(and(eq(pendingReplies.storeId, storeId), inArray(pendingReplies.reviewId, reviewIds)));
  return new Set(rows.map((r) => r.reviewId));
}
