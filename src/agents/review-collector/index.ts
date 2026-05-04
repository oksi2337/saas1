import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { storePlatforms, reviews, collectionLogs } from '../../db/schema';
import { scrapeNaverPlace } from '../../skills/naver-place-scraper';
import { scrapeBaemin } from '../../skills/baemin-scraper';
import { normalizeReview } from './normalizer';
import type { CollectTask, CollectionResult, PlatformResult } from './types';
import type { Platform, ScrapedReview } from '../../types/review';
import type { BaeminScraperOutput, NaverScraperOutput } from '../../types/review';
import { v4 as uuidv4 } from 'uuid';

/**
 * 단일 매장에 대해 지정 플랫폼의 리뷰를 수집하고 DB에 저장한다.
 * 중복 리뷰는 (store_id, platform, platform_review_id) unique 제약으로 자동 무시된다.
 */
export async function collectReviews(task: CollectTask): Promise<CollectionResult> {
  const { store_id, platforms } = task;

  // 병렬 수집
  const platformResults = await Promise.allSettled(
    platforms.map((platform) => collectPlatform(store_id, platform)),
  );

  const results: PlatformResult[] = platformResults.map((settled, i) => {
    if (settled.status === 'fulfilled') return settled.value;
    return {
      platform: platforms[i],
      status: 'failed',
      new_review_count: 0,
      new_review_ids: [],
      error_message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
    };
  });

  return {
    store_id,
    results,
    total_new: results.reduce((sum, r) => sum + r.new_review_count, 0),
  };
}

// ── Per-platform ──────────────────────────────────────────

async function collectPlatform(storeId: string, platform: Platform): Promise<PlatformResult> {
  const startedAt = new Date();

  // store_platforms에서 인증 정보 및 마지막 수집 시각 조회
  const [sp] = await db
    .select()
    .from(storePlatforms)
    .where(and(eq(storePlatforms.storeId, storeId), eq(storePlatforms.platform, platform)));

  if (!sp) {
    return notImplementedResult(platform, `store_platform 미등록: ${platform}`);
  }

  if (!sp.isActive) {
    return skippedResult(platform, '비활성 플랫폼');
  }

  const lastCollectedAt = sp.lastCollectedAt?.toISOString() ?? null;
  const credential = sp.authCredential ?? '';

  let scraperOutput: NaverScraperOutput | BaeminScraperOutput | null = null;
  let scrapedReviews: ScrapedReview[] = [];
  let scraperStatus: PlatformResult['status'] = 'failed';
  let errorMessage: string | undefined;

  try {
    if (platform === 'naver') {
      const output = await scrapeNaverPlace({
        store_id: storeId,
        naver_place_id: sp.platformStoreId,
        last_collected_at: lastCollectedAt,
        auth: buildNaverAuth(sp.authMethod, credential),
      });
      scraperOutput = output;
      if (output.status === 'success') {
        scrapedReviews = output.reviews;
        scraperStatus = 'success';
      } else {
        scraperStatus = output.status as PlatformResult['status'];
        errorMessage = output.error_message;
      }
    } else if (platform === 'baemin') {
      const output = await scrapeBaemin({
        store_id: storeId,
        baemin_store_id: sp.platformStoreId,
        last_collected_at: lastCollectedAt,
        auth: buildBaeminAuth(sp.authMethod, credential),
      });
      scraperOutput = output;
      if (output.status === 'success') {
        scrapedReviews = output.reviews;
        scraperStatus = 'success';
      } else {
        scraperStatus = output.status as PlatformResult['status'];
        errorMessage = output.error_message;
      }
    } else {
      // coupangeats, kakaomap, google — 미구현
      return await writeCollectionLog(
        storeId,
        platform,
        'not_implemented',
        0,
        `${platform} 수집 미구현`,
        startedAt,
        { platform, status: 'skipped', new_review_count: 0, new_review_ids: [], error_message: `${platform} 수집 미구현` },
      );
    }
  } catch (err) {
    scraperStatus = 'failed';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // 성공 시: 정규화 → DB 저장
  let newReviewIds: string[] = [];

  if (scraperStatus === 'success' && scrapedReviews.length > 0) {
    newReviewIds = await saveReviews(storeId, platform, scrapedReviews);

    // last_collected_at 갱신
    await db
      .update(storePlatforms)
      .set({ lastCollectedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(storePlatforms.storeId, storeId), eq(storePlatforms.platform, platform)));
  }

  const dbStatus = scraperStatus === 'success' ? 'success'
    : scraperStatus === 'blocked'      ? 'blocked'
    : scraperStatus === 'auth_expired' ? 'auth_expired'
    : 'failed';

  return await writeCollectionLog(
    storeId,
    platform,
    dbStatus,
    newReviewIds.length,
    errorMessage,
    startedAt,
    {
      platform,
      status: scraperStatus,
      new_review_count: newReviewIds.length,
      new_review_ids: newReviewIds,
      error_message: errorMessage,
    },
  );
}

// ── DB helpers ────────────────────────────────────────────

async function saveReviews(
  storeId: string,
  platform: Platform,
  scraped: ScrapedReview[],
): Promise<string[]> {
  const normalized = scraped.map((r) => normalizeReview(r, storeId, platform));

  // onConflictDoNothing: (store_id, platform, platform_review_id) 중복 무시
  const inserted = await db
    .insert(reviews)
    .values(normalized)
    .onConflictDoNothing()
    .returning({ id: reviews.id });

  return inserted.map((r) => r.id);
}

async function writeCollectionLog<T extends PlatformResult>(
  storeId: string,
  platform: Platform,
  status: 'success' | 'failed' | 'blocked' | 'auth_expired' | 'not_implemented',
  newReviewCount: number,
  errorMessage: string | undefined,
  startedAt: Date,
  result: T,
): Promise<T> {
  await db.insert(collectionLogs).values({
    id: uuidv4(),
    storeId,
    platform,
    status,
    newReviewCount,
    errorMessage: errorMessage ?? null,
    startedAt,
    finishedAt: new Date(),
  });
  return result;
}

// ── Auth builders ─────────────────────────────────────────

function buildNaverAuth(
  method: string,
  credential: string,
): { method: 'cookie' | 'oauth'; cookie?: string; oauth_token?: string } {
  if (method === 'oauth') return { method: 'oauth', oauth_token: credential };
  return { method: 'cookie', cookie: credential };
}

function buildBaeminAuth(
  method: string,
  credential: string,
): { method: 'cookie' | 'ceo_api'; cookie?: string; ceo_api_token?: string } {
  if (method === 'ceo_api') return { method: 'ceo_api', ceo_api_token: credential };
  return { method: 'cookie', cookie: credential };
}

// ── Stub result helpers ───────────────────────────────────

function notImplementedResult(platform: Platform, msg: string): PlatformResult {
  return { platform, status: 'skipped', new_review_count: 0, new_review_ids: [], error_message: msg };
}

function skippedResult(platform: Platform, msg: string): PlatformResult {
  return { platform, status: 'skipped', new_review_count: 0, new_review_ids: [], error_message: msg };
}
