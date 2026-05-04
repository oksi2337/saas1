import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { stores } from '../../db/schema';
import { collectReviews } from '../review-collector';
import { draftReplies } from '../reply-drafter';
import { detectCrisis } from '../crisis-detector';
import { sendKakaoAlert } from '../../skills/kakao-alert';
import type { CollectionCompletedEvent, ManualTriggerEvent, OrganizerEvent } from './events';
import type { Platform } from '../../types/review';

// ── In-memory state ───────────────────────────────────────
// 단일 프로세스 모델. 다중 인스턴스 환경에서는 Redis 등으로 교체 필요.

/** 현재 수집 진행 중인 매장 ID 집합 (중복 실행 방지) */
const runningCollections = new Set<string>();

/** agent 실패 재시도 카운터: job_key → 실패 횟수 */
const retryCounters = new Map<string, number>();

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000]; // 5분, 15분

// ── Public API ────────────────────────────────────────────

export async function handleEvent(event: OrganizerEvent): Promise<void> {
  switch (event.event) {
    case 'store.registered':
      await triggerStoreCollection(event.store_id, event.platforms, 'high');
      break;

    case 'collection.completed':
      await onCollectionCompleted(event);
      break;

    case 'agent.failed':
      await onAgentFailed(event);
      break;

    case 'manual.trigger':
      await onManualTrigger(event);
      break;
  }
}

/**
 * 모든 활성 매장 수집 실행. 스케줄러가 1시간마다 호출.
 */
export async function triggerAllCollections(): Promise<void> {
  const activeStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.status, 'active'));

  await Promise.allSettled(
    activeStores.map((s) => triggerStoreCollection(s.id, null, 'normal')),
  );
}

// ── Event handlers ────────────────────────────────────────

async function onCollectionCompleted(event: CollectionCompletedEvent): Promise<void> {
  runningCollections.delete(event.store_id);

  // 신규 리뷰가 없으면 하위 agent 호출 불필요
  if (event.new_review_count === 0) return;

  // reply-drafter + crisis-detector 동시 실행
  const [draftResult, crisisResult] = await Promise.allSettled([
    draftReplies({ store_id: event.store_id, review_ids: event.new_review_ids }),
    detectCrisis({ store_id: event.store_id, review_ids: event.new_review_ids }),
  ]);

  if (draftResult.status === 'rejected') {
    console.error(`[organizer] reply-drafter 실패 (store=${event.store_id}):`, draftResult.reason);
  }
  if (crisisResult.status === 'rejected') {
    console.error(`[organizer] crisis-detector 실패 (store=${event.store_id}):`, crisisResult.reason);
  }

  // auth_expired / blocked → 사장님 재인증 안내
  for (const ps of event.platform_statuses) {
    if (ps.status === 'auth_expired') {
      await sendKakaoAlert({
        recipient:    'owner',
        message_type: 'auth_required',
        content: {
          store_id: event.store_id,
          platform: ps.platform,
          message:  `${ps.platform} 리뷰 수집이 중단됐습니다. 다시 로그인해 주세요.`,
          auth_url: `${process.env.APP_URL ?? 'https://app.example.com'}/auth/${event.store_id}/${ps.platform}`,
        },
      });
    } else if (ps.status === 'blocked') {
      await sendKakaoAlert({
        recipient:    'operator',
        message_type: 'collection_blocked',
        content: {
          store_id:      event.store_id,
          platform:      ps.platform,
          error_message: ps.error_message ?? '봇 감지',
        },
      });
    }
  }
}

async function onAgentFailed(event: { agent: string; store_id: string; attempt: number; error: string; failed_at: string }): Promise<void> {
  const jobKey = `${event.agent}:${event.store_id}`;
  const count = retryCounters.get(jobKey) ?? 0;

  if (count >= MAX_RETRIES) {
    retryCounters.delete(jobKey);
    await sendKakaoAlert({
      recipient:    'operator',
      message_type: 'system_error',
      content: {
        agent:         event.agent,
        store_id:      event.store_id,
        error_summary: event.error,
        failed_at:     event.failed_at,
      },
    });
    return;
  }

  retryCounters.set(jobKey, count + 1);
  const delayMs = RETRY_DELAYS_MS[count] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

  console.log(`[organizer] ${event.agent} 재시도 예정 (${delayMs / 60_000}분 후, ${count + 1}/${MAX_RETRIES}회)`);

  setTimeout(async () => {
    if (event.agent === 'review-collector-agent') {
      await triggerStoreCollection(event.store_id, null, 'normal');
    }
  }, delayMs);
}

async function onManualTrigger(event: ManualTriggerEvent): Promise<void> {
  if (event.command === 'collect_now') {
    if (event.store_id) {
      await triggerStoreCollection(event.store_id, null, 'high');
    } else {
      await triggerAllCollections();
    }
  }
}

// ── Collection trigger ────────────────────────────────────

async function triggerStoreCollection(
  storeId: string,
  platforms: Platform[] | null,
  priority: 'normal' | 'high',
): Promise<void> {
  if (runningCollections.has(storeId)) {
    console.log(`[organizer] 수집 스킵 (이미 진행 중): ${storeId}`);
    return;
  }

  // 매장 상태 확인
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store || store.status !== 'active') return;

  runningCollections.add(storeId);

  try {
    const result = await collectReviews({
      store_id:  storeId,
      platforms: platforms ?? (['naver', 'baemin', 'coupangeats', 'kakaomap', 'google'] as Platform[]),
      priority,
    });

    await handleEvent({
      event:             'collection.completed',
      store_id:          storeId,
      new_review_count:  result.total_new,
      new_review_ids:    result.results.flatMap((r) => r.new_review_ids),
      platform_statuses: result.results.map((r) => ({
        platform:      r.platform,
        status:        r.status,
        error_message: r.error_message,
      })),
      collected_at:      new Date().toISOString(),
    });
  } catch (err) {
    runningCollections.delete(storeId);
    await handleEvent({
      event:      'agent.failed',
      agent:      'review-collector-agent',
      store_id:   storeId,
      attempt:    1,
      error:      err instanceof Error ? err.message : String(err),
      failed_at:  new Date().toISOString(),
    });
  }
}
