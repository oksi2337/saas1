import dayjs from 'dayjs';
import { and, eq, gte, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db';
import { stores, users, reviews, healthScores, reports } from '../../db/schema';
import { calcHealthScore } from '../../skills/place-health-score';
import { generateExcelReport } from '../../skills/excel-report';
import { sendKakaoAlert } from '../../skills/kakao-alert';
import type { GenerateReportTask, GenerateReportResult, ReportResult } from './types';
import type { KeywordCount, MenuInsight, PlatformSummary, RatingSummary } from '../../skills/excel-report';

const APP_URL = process.env.APP_URL ?? 'https://app.example.com';

// ── Main ──────────────────────────────────────────────────

export async function generateReport(task: GenerateReportTask): Promise<GenerateReportResult> {
  // 대상 매장 목록
  const targetStores = task.store_id
    ? [{ id: task.store_id }]
    : await db.select({ id: stores.id }).from(stores).where(eq(stores.status, 'active'));

  const results = await Promise.allSettled(
    targetStores.map((s) =>
      generateOneReport(s.id, task.report_type, task.period_start, task.period_end),
    ),
  );

  return {
    report_type:  task.report_type,
    period_start: task.period_start,
    period_end:   task.period_end,
    results: results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return { store_id: targetStores[i].id, report_id: null, status: 'failed', excel_file_url: null, error: String(r.reason) };
    }),
  };
}

// ── Per-store ─────────────────────────────────────────────

async function generateOneReport(
  storeId: string,
  reportType: 'weekly' | 'monthly',
  periodStart: string,
  periodEnd: string,
): Promise<ReportResult> {
  // 매장 + 소유자 정보
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store) return { store_id: storeId, report_id: null, status: 'failed', excel_file_url: null, error: 'Store not found' };

  const [owner] = await db.select().from(users).where(eq(users.id, store.ownerId));

  // 리뷰 데이터 집계
  const start = dayjs(periodStart).startOf('day').toDate();
  const end   = dayjs(periodEnd).endOf('day').toDate();

  const periodReviews = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.storeId, storeId), gte(reviews.reviewedAt, start), lte(reviews.reviewedAt, end)));

  if (periodReviews.length === 0 && reportType === 'monthly') {
    await sendKakaoAlert({
      recipient:    owner ? 'owner' : 'operator',
      owner_id:     owner?.id,
      message_type: 'weekly_report',
      content: { store_name: store.name, message: '이번 기간 수집된 데이터가 부족합니다.' },
    });
    return { store_id: storeId, report_id: null, status: 'skipped', excel_file_url: null };
  }

  // 이전 기간 헬스 스코어 조회 (delta용)
  const prevScore = await loadPrevScore(storeId, reportType, periodStart);

  // 헬스 스코어 계산
  const healthResult = await calcHealthScore({ store_id: storeId, period_start: periodStart, period_end: periodEnd, prev_score: prevScore });

  const healthScore = healthResult.status !== 'failed' ? healthResult.health_score : null;
  const metrics     = healthResult.metrics;
  const warnings    = healthResult.warning_items ?? [];
  const scoreLabel  = healthResult.status !== 'failed' ? healthResult.score_label : '보통';
  const scoreDelta  = healthResult.status !== 'failed' ? healthResult.health_score_delta : null;

  // 리뷰 통계 집계
  const reviewStats = aggregateReviewStats(periodReviews);

  // 플랜 확인 (Pro 이상 = Excel 생성)
  const plan = owner?.plan ?? 'lite';
  const excelEnabled = plan === 'pro' || plan === 'agency';
  const isMonthly    = reportType === 'monthly';

  // health_scores INSERT
  const healthScoreId = uuidv4();
  await db.insert(healthScores).values({
    id:                      healthScoreId,
    storeId,
    periodType:              reportType,
    periodStart,
    periodEnd,
    score:                   healthScore,
    scoreDelta:              scoreDelta ?? undefined,
    scoreLabel,
    impressionCount:         metrics.impression_count ?? undefined,
    reviewCountThisPeriod:   metrics.review_count_this_period,
    avgRatingThisPeriod:     metrics.avg_rating_this_period ?? undefined,
    avgRatingDelta:          metrics.avg_rating_delta ?? undefined,
    negativeReviewCount:     metrics.negative_review_count,
    unansweredReviewCount:   metrics.unanswered_review_count,
    warningItems:            warnings,
    naverStatCollected:      false,
    daysSinceLastPhoto:      metrics.days_since_last_photo,
  }).onConflictDoNothing();

  // Excel 생성 (Pro/Agency + monthly, 또는 Pro + weekly)
  let excelFileUrl: string | null = null;
  if (excelEnabled && isMonthly) {
    const excelResult = await generateExcelReport({
      store_id: storeId, store_name: store.name,
      report_type: reportType, period_start: periodStart, period_end: periodEnd,
      health: { score: healthScore, score_delta: scoreDelta, score_label: scoreLabel, metrics, warning_items: warnings },
      reviews: {
        ...reviewStats,
        all_reviews: isMonthly ? periodReviews.map((r) => ({
          reviewed_at: r.reviewedAt, platform: r.platform,
          rating: r.rating, content: r.content, replied: r.replied,
        })) : undefined,
      },
    });
    if (excelResult.status === 'success') excelFileUrl = excelResult.file_url;
  }

  // reports INSERT
  const reportId = uuidv4();
  await db.insert(reports).values({
    id: reportId, storeId, reportType, periodStart, periodEnd,
    healthScoreId, excelFileUrl, status: 'generating',
  }).onConflictDoNothing();

  // Kakao 알림 발송
  const alertResult = await sendKakaoAlert({
    recipient:    owner ? 'owner' : 'operator',
    owner_id:     owner?.id,
    message_type: isMonthly ? 'monthly_report' : 'weekly_report',
    content:      buildAlertContent(store.name, reportType, periodStart, periodEnd, healthScore, scoreDelta, scoreLabel, warnings, reviewStats, excelFileUrl, reportId),
  });

  // Report 상태 업데이트
  const finalStatus = alertResult.status === 'success' ? 'sent' : 'failed';
  await db.update(reports).set({ status: finalStatus, sentAt: alertResult.status === 'success' ? new Date() : undefined }).where(eq(reports.id, reportId));

  return { store_id: storeId, report_id: reportId, status: finalStatus, excel_file_url: excelFileUrl };
}

// ── Review aggregation ────────────────────────────────────

function aggregateReviewStats(periodReviews: Array<{ platform: string; rating: number | null; content: string; replied: boolean }>) {
  const ratedReviews = periodReviews.filter((r) => r.rating !== null);
  const avgRating    = ratedReviews.length > 0
    ? parseFloat((ratedReviews.reduce((s, r) => s + r.rating!, 0) / ratedReviews.length).toFixed(2))
    : null;

  // 플랫폼별
  const byPlatformMap = new Map<string, { count: number; ratingSum: number; ratingCount: number }>();
  for (const r of periodReviews) {
    const p = byPlatformMap.get(r.platform) ?? { count: 0, ratingSum: 0, ratingCount: 0 };
    p.count++;
    if (r.rating !== null) { p.ratingSum += r.rating; p.ratingCount++; }
    byPlatformMap.set(r.platform, p);
  }
  const byPlatform: PlatformSummary[] = [...byPlatformMap.entries()].map(([platform, v]) => ({
    platform, review_count: v.count,
    avg_rating: v.ratingCount > 0 ? parseFloat((v.ratingSum / v.ratingCount).toFixed(2)) : null,
  }));

  // 별점 분포
  const ratingMap = new Map<number, number>();
  for (const r of ratedReviews) ratingMap.set(r.rating!, (ratingMap.get(r.rating!) ?? 0) + 1);
  const byRating: RatingSummary[] = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: ratingMap.get(rating) ?? 0 }));

  // 키워드 빈도 (긍정 ≥3점, 부정 ≤2점)
  const positiveTexts = periodReviews.filter((r) => r.rating === null || r.rating >= 3).map((r) => r.content);
  const negativeTexts = periodReviews.filter((r) => r.rating !== null && r.rating <= 2).map((r) => r.content);

  const topPositive = topKeywords(positiveTexts, 10);
  const topNegative = topKeywords(negativeTexts, 10);

  // 메뉴 인사이트 (부정 리뷰에서 반복 명사 추출)
  const menuInsights = extractMenuInsights(negativeTexts, topNegative);

  return {
    total_count:            periodReviews.length,
    avg_rating:             avgRating,
    avg_rating_delta:       null as number | null,
    by_platform:            byPlatform,
    by_rating:              byRating,
    top_positive_keywords:  topPositive,
    top_negative_keywords:  topNegative,
    menu_insights:          menuInsights,
    unanswered_count:       periodReviews.filter((r) => !r.replied).length,
  };
}

/** 간단한 한국어 단어 빈도 추출 (외부 NLP 없는 기본 구현) */
function topKeywords(texts: string[], topN: number): KeywordCount[] {
  const freq = new Map<string, number>();
  for (const text of texts) {
    const words = text.split(/[\s\r\n,!?.。，！？~…'"]+/).filter((w) => w.length >= 2);
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([keyword, count]) => ({ keyword, count }));
}

/** 부정 리뷰에서 3회 이상 반복 키워드를 메뉴 인사이트로 변환 */
function extractMenuInsights(negativeTexts: string[], topNegative: KeywordCount[]): MenuInsight[] {
  return topNegative
    .filter((kw) => kw.count >= 3)
    .slice(0, 5)
    .map((kw) => ({
      menu:          kw.keyword,
      mention_count: kw.count,
      negative_count: kw.count,
      suggestion:    `'${kw.keyword}' 관련 부정 리뷰 ${kw.count}건 — 해당 메뉴/서비스 개선 검토`,
    }));
}

// ── Helpers ───────────────────────────────────────────────

async function loadPrevScore(storeId: string, reportType: 'weekly' | 'monthly', periodStart: string): Promise<number | null> {
  const prevStart = reportType === 'weekly'
    ? dayjs(periodStart).subtract(7, 'day').format('YYYY-MM-DD')
    : dayjs(periodStart).subtract(1, 'month').format('YYYY-MM-DD');

  const [row] = await db
    .select({ score: healthScores.score })
    .from(healthScores)
    .where(and(eq(healthScores.storeId, storeId), eq(healthScores.periodType, reportType), eq(healthScores.periodStart, prevStart)));

  return row?.score ?? null;
}

function buildAlertContent(
  storeName: string, reportType: string, periodStart: string, periodEnd: string,
  score: number | null, scoreDelta: number | null, scoreLabel: string,
  warnings: Array<{ severity: string; message: string; suggestion: string; type: string }>,
  reviewStats: ReturnType<typeof aggregateReviewStats>,
  excelFileUrl: string | null, reportId: string,
): Record<string, unknown> {
  const base = {
    store_name:      storeName,
    period:          `${periodStart} ~ ${periodEnd}`,
    dashboard_url:   `${APP_URL}/report/${reportId}`,
    excel_file_url:  excelFileUrl,
  };

  if (reportType === 'weekly') {
    return {
      ...base,
      health_score:       score,
      health_score_delta: scoreDelta,
      score_label:        scoreLabel,
      warnings:           warnings.filter((w) => w.type !== 'no_impressions_data').slice(0, 3),
      unanswered_count:   reviewStats.unanswered_count,
    };
  }

  return {
    ...base,
    total_reviews:          reviewStats.total_count,
    avg_rating:             reviewStats.avg_rating,
    rating_delta:           reviewStats.avg_rating_delta,
    top_positive_keywords:  reviewStats.top_positive_keywords.slice(0, 3).map((k) => k.keyword),
    top_negative_keywords:  reviewStats.top_negative_keywords.slice(0, 3).map((k) => k.keyword),
    menu_insights:          reviewStats.menu_insights.slice(0, 3),
  };
}
