import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db';
import { reviews, stores, users, storePlatforms, toneProfiles, crisisAlerts, pendingReplies } from '../../db/schema';
import { classifyCrisis } from '../../skills/sentiment-classification';
import { generateReplyDraft } from '../../skills/reply-generation';
import { sendKakaoAlert } from '../../skills/kakao-alert';
import type { DetectCrisisTask, CrisisDetectResult } from './types';
import type { Review, Store, ToneProfile } from '../../db/schema';

const MAX_ALERTS_PER_MESSAGE = 5;
const APP_URL = process.env.APP_URL ?? 'https://app.example.com';

// ── Main ──────────────────────────────────────────────────

export async function detectCrisis(task: DetectCrisisTask): Promise<CrisisDetectResult> {
  const { store_id, review_ids } = task;

  if (review_ids.length === 0) {
    return { store_id, crisis_count: 0, alert_ids: [], alert_sent: false };
  }

  // ⭐1~2점 리뷰만 추출
  const crisisReviews = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.storeId, store_id), inArray(reviews.id, review_ids)))
    .then((rows) => rows.filter((r) => r.rating !== null && r.rating <= 2));

  if (crisisReviews.length === 0) {
    return { store_id, crisis_count: 0, alert_ids: [], alert_sent: false };
  }

  // 매장 + 소유자 + 톤 프로필 한번에 조회
  const [store] = await db.select().from(stores).where(eq(stores.id, store_id));
  if (!store) throw new Error(`Store not found: ${store_id}`);

  const [owner] = await db.select().from(users).where(eq(users.id, store.ownerId));

  const [activeTone] = await db
    .select()
    .from(toneProfiles)
    .where(and(eq(toneProfiles.storeId, store_id), eq(toneProfiles.isActive, true)));

  // 플랫폼별 platform_store_id 조회 (분류 입력용)
  const platformRows = await db
    .select({ platform: storePlatforms.platform, platformStoreId: storePlatforms.platformStoreId })
    .from(storePlatforms)
    .where(eq(storePlatforms.storeId, store_id));
  const platformStoreIdMap = Object.fromEntries(platformRows.map((r) => [r.platform, r.platformStoreId]));

  // 각 위기 리뷰 처리 (순차 — Claude API 호출 포함)
  const alertIds: string[] = [];
  const alertSummaries: AlertSummary[] = [];

  for (const review of crisisReviews) {
    const result = await processOneCrisisReview(
      review,
      store,
      activeTone ?? null,
      platformStoreIdMap[review.platform] ?? '',
    );
    if (result) {
      alertIds.push(result.alertId);
      alertSummaries.push(result.summary);
    }
  }

  if (alertIds.length === 0) {
    return { store_id, crisis_count: 0, alert_ids: [], alert_sent: false };
  }

  // 알림 묶음 발송 (최대 5개, 초과 시 "+N개 더" 표시)
  const alertSent = await sendBatchedAlert(store.name, owner?.id ?? null, alertSummaries);

  // alert_sent_at 업데이트
  if (alertSent) {
    const now = new Date();
    for (const alertId of alertIds) {
      await db
        .update(crisisAlerts)
        .set({ alertSentAt: now })
        .where(eq(crisisAlerts.id, alertId));
    }
  }

  return { store_id, crisis_count: alertIds.length, alert_ids: alertIds, alert_sent: alertSent };
}

// ── Per-review processing ─────────────────────────────────

interface AlertSummary {
  alert_id: string;
  platform: string;
  rating: number;
  review_snippet: string;
  crisis_type: string;
  crisis_label: string;
  response_guide: string;
  deletion_eligible: boolean;
  deletion_reason: string | null;
  deletion_guide: string | null;
  draft_ready: boolean;
}

async function processOneCrisisReview(
  review: Review,
  store: Store,
  tone: ToneProfile | null,
  platformStoreId: string,
): Promise<{ alertId: string; summary: AlertSummary } | null> {
  const rating = review.rating ?? 1;

  // 1. 위기 분류
  const classification = await classifyCrisis({
    review: {
      content:     review.content,
      rating,
      platform:    review.platform,
      reviewed_at: review.reviewedAt.toISOString(),
    },
    store: {
      store_id:         store.id,
      store_name:       store.name,
      store_category:   store.category,
      platform_store_id: platformStoreId,
    },
  });

  // 2. 위기 전용 답글 초안 생성
  const replyResult = await generateReplyDraft({
    review: { content: review.content, rating, platform: review.platform },
    tone_profile: tone,
    context: { store_name: store.name, store_category: store.category },
    generation_options: { mode: 'crisis', attempt: 1 },
  });
  const draftReady = replyResult.status === 'success';

  // 3. crisis_alerts INSERT (중복 시 무시)
  const alertId = uuidv4();
  const inserted = await db
    .insert(crisisAlerts)
    .values({
      id:               alertId,
      storeId:          store.id,
      reviewId:         review.id,
      platform:         review.platform,
      rating:           rating as 1 | 2,
      crisisType:       classification.crisis_type,
      crisisLabel:      classification.crisis_label,
      confidence:       classification.confidence,
      summary:          classification.summary,
      responseGuide:    classification.response_guide,
      deletionEligible: classification.deletion_eligible,
      deletionReason:   classification.deletion_reason,
      deletionGuide:    classification.deletion_guide,
      keywords:         classification.keywords,
      status:           'alerted',
    })
    .onConflictDoNothing()
    .returning({ id: crisisAlerts.id });

  // 이미 처리된 위기 리뷰면 스킵 (중복 알림 방지)
  if (inserted.length === 0) return null;

  const realAlertId = inserted[0].id;

  // 4. pending_replies INSERT (crisis 플래그 포함)
  if (draftReady && replyResult.draft) {
    await db
      .insert(pendingReplies)
      .values({
        id:              uuidv4(),
        storeId:         store.id,
        reviewId:        review.id,
        draftContent:    replyResult.draft,
        isCrisisReply:   true,
        crisisAlertId:   realAlertId,
        toneProfileId:   tone?.id ?? null,
        status:          'pending',
      })
      .onConflictDoNothing();
  }

  return {
    alertId: realAlertId,
    summary: {
      alert_id:          realAlertId,
      platform:          review.platform,
      rating,
      review_snippet:    review.content.slice(0, 60),
      crisis_type:       classification.crisis_type,
      crisis_label:      classification.crisis_label,
      response_guide:    classification.response_guide,
      deletion_eligible: classification.deletion_eligible,
      deletion_reason:   classification.deletion_reason,
      deletion_guide:    classification.deletion_guide,
      draft_ready:       draftReady,
    },
  };
}

// ── Kakao batched alert ───────────────────────────────────

async function sendBatchedAlert(
  storeName: string,
  ownerId: string | null,
  summaries: AlertSummary[],
): Promise<boolean> {
  const visible = summaries.slice(0, MAX_ALERTS_PER_MESSAGE);
  const overflow = summaries.length - visible.length;

  const result = await sendKakaoAlert({
    recipient:    ownerId ? 'owner' : 'operator',
    owner_id:     ownerId ?? undefined,
    message_type: 'crisis_alert',
    content: {
      store_name:   storeName,
      total_count:  summaries.length,
      overflow:     overflow > 0 ? `+${overflow}개 더` : null,
      alerts:       visible.map((s) => ({
        platform:          s.platform,
        rating:            s.rating,
        review_snippet:    s.review_snippet,
        crisis_label:      s.crisis_label,
        response_guide:    s.response_guide,
        deletion_eligible: s.deletion_eligible,
        deletion_reason:   s.deletion_reason,
        deletion_guide:    s.deletion_guide,
        draft_ready:       s.draft_ready,
        action_url:        `${APP_URL}/crisis/${s.alert_id}`,
      })),
    },
    options: { retry_on_fail: true, priority: 'urgent' },
  });

  return result.status === 'success';
}
