import dayjs from 'dayjs';
import { and, eq, gte, lte, lt, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { reviews, stores } from '../../db/schema';

// ── Types ─────────────────────────────────────────────────

export interface PlaceHealthScoreInput {
  store_id: string;
  period_start: string;  // "YYYY-MM-DD"
  period_end: string;
  prev_score?: number | null;  // 직전 기간 점수 (delta 계산용)
}

export interface WarningItem {
  type: 'photo_stale' | 'click_drop' | 'score_drop' | 'negative_spike' | 'unanswered_reviews' | 'no_impressions_data';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  suggestion: string;
}

export interface HealthMetrics {
  impression_count:       number | null;
  impression_delta:       number | null;
  click_count:            number | null;
  click_rate:             number | null;
  click_rate_delta:       number | null;
  phone_click:            number | null;
  direction_click:        number | null;
  save_click:             number | null;
  days_since_last_photo:  number;
  photo_count_this_period: number;
  review_count_this_period: number;
  avg_rating_this_period: number | null;
  avg_rating_delta:       number | null;
  negative_review_count:  number;
  unanswered_review_count: number;
}

export type ScoreLabel = '우수' | '양호' | '보통' | '주의' | '위험';

export type PlaceHealthScoreOutput =
  | {
      status: 'success' | 'partial';
      store_id: string;
      period_start: string;
      period_end: string;
      health_score: number;
      health_score_delta: number | null;
      score_label: ScoreLabel;
      metrics: HealthMetrics;
      warning_items: WarningItem[];
      naver_stat_collected: boolean;
    }
  | {
      status: 'failed';
      error_message: string;
      health_score: null;
      metrics: HealthMetrics;
      warning_items: WarningItem[];
    };

// ── Main ──────────────────────────────────────────────────

export async function calcHealthScore(
  input: PlaceHealthScoreInput,
): Promise<PlaceHealthScoreOutput> {
  const { store_id, period_start, period_end, prev_score } = input;

  const start = dayjs(period_start).startOf('day').toDate();
  const end   = dayjs(period_end).endOf('day').toDate();

  try {
    // 매장 정보 (마지막 사진 업로드 시각)
    const [store] = await db.select().from(stores).where(eq(stores.id, store_id));
    if (!store) {
      return { status: 'failed', error_message: `Store not found: ${store_id}`, health_score: null, metrics: emptyMetrics(), warning_items: [] };
    }

    // 당기 리뷰 집계
    const periodReviews = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.storeId, store_id), gte(reviews.reviewedAt, start), lte(reviews.reviewedAt, end)));

    // 전기 동일 기간 집계 (delta 계산)
    const periodDays = dayjs(period_end).diff(dayjs(period_start), 'day') + 1;
    const prevStart  = dayjs(period_start).subtract(periodDays, 'day').startOf('day').toDate();
    const prevEnd    = dayjs(period_start).subtract(1, 'day').endOf('day').toDate();
    const prevReviews = await db
      .select()
      .from(reviews)
      .where(and(eq(reviews.storeId, store_id), gte(reviews.reviewedAt, prevStart), lte(reviews.reviewedAt, prevEnd)));

    // 지표 계산
    const daysSinceLastPhoto = store.lastPhotoUploadedAt
      ? dayjs().diff(dayjs(store.lastPhotoUploadedAt), 'day')
      : 999;

    const reviewCount   = periodReviews.length;
    const ratedReviews  = periodReviews.filter((r) => r.rating !== null);
    const avgRating     = ratedReviews.length > 0
      ? ratedReviews.reduce((s, r) => s + r.rating!, 0) / ratedReviews.length
      : null;

    const prevRated = prevReviews.filter((r) => r.rating !== null);
    const prevAvgRating = prevRated.length > 0
      ? prevRated.reduce((s, r) => s + r.rating!, 0) / prevRated.length
      : null;

    const negativeCount    = periodReviews.filter((r) => r.rating !== null && r.rating <= 2).length;
    const unansweredCount  = periodReviews.filter((r) => !r.replied).length;

    const metrics: HealthMetrics = {
      impression_count:        null,  // Naver stats: 미구현
      impression_delta:        null,
      click_count:             null,
      click_rate:              null,
      click_rate_delta:        null,
      phone_click:             null,
      direction_click:         null,
      save_click:              null,
      days_since_last_photo:   daysSinceLastPhoto,
      photo_count_this_period: 0,     // 사진 수집 미구현
      review_count_this_period: reviewCount,
      avg_rating_this_period:  avgRating,
      avg_rating_delta:        avgRating !== null && prevAvgRating !== null
        ? parseFloat((avgRating - prevAvgRating).toFixed(2))
        : null,
      negative_review_count:   negativeCount,
      unanswered_review_count: unansweredCount,
    };

    // 헬스 스코어 계산 (Naver stats 없는 경우 DB 기반만)
    const score = calcScore(metrics, reviewCount);
    const scoreDelta = prev_score !== null && prev_score !== undefined
      ? score - prev_score
      : null;

    const warnings = detectWarnings(metrics, score, scoreDelta);

    return {
      status:               'partial',  // Naver 통계 없으므로 partial
      store_id,
      period_start,
      period_end,
      health_score:         score,
      health_score_delta:   scoreDelta,
      score_label:          toScoreLabel(score),
      metrics,
      warning_items:        warnings,
      naver_stat_collected: false,
    };
  } catch (err) {
    return {
      status:        'failed',
      error_message: err instanceof Error ? err.message : String(err),
      health_score:  null,
      metrics:       emptyMetrics(),
      warning_items: [],
    };
  }
}

// ── Score calculation ─────────────────────────────────────

function calcScore(m: HealthMetrics, reviewCount: number): number {
  // Naver 통계 없으면 나머지 4개 지표로 100점 환산
  const photoScore  = photoPoints(m.days_since_last_photo);
  const ratingScore = ratingPoints(m.avg_rating_this_period);
  const answerScore = answerPoints(reviewCount, m.unanswered_review_count);
  const negScore    = negativePoints(reviewCount, m.negative_review_count);

  const total = photoScore * 35 + ratingScore * 30 + answerScore * 20 + negScore * 15;
  return Math.round(total / 100);
}

function photoPoints(days: number): number {
  if (days <= 0)  return 100;
  if (days <= 7)  return 90;
  if (days <= 14) return 80;
  if (days <= 30) return 50;
  if (days <= 60) return 20;
  return 0;
}

function ratingPoints(avg: number | null): number {
  if (avg === null) return 70; // 데이터 없음 → 중간값
  if (avg >= 4.5)   return 100;
  if (avg >= 4.0)   return 85;
  if (avg >= 3.5)   return 65;
  if (avg >= 3.0)   return 45;
  if (avg >= 2.5)   return 25;
  return 10;
}

function answerPoints(total: number, unanswered: number): number {
  if (total === 0) return 80;
  const ratio = (total - unanswered) / total;
  if (ratio >= 0.9)  return 100;
  if (ratio >= 0.7)  return 80;
  if (ratio >= 0.5)  return 60;
  if (ratio >= 0.3)  return 40;
  return 20;
}

function negativePoints(total: number, negative: number): number {
  if (total === 0) return 90;
  const ratio = negative / total;
  if (ratio === 0)   return 100;
  if (ratio <= 0.05) return 85;
  if (ratio <= 0.10) return 65;
  if (ratio <= 0.20) return 40;
  return 20;
}

function toScoreLabel(score: number): ScoreLabel {
  if (score >= 85) return '우수';
  if (score >= 70) return '양호';
  if (score >= 50) return '보통';
  if (score >= 30) return '주의';
  return '위험';
}

// ── Warning detection ─────────────────────────────────────

function detectWarnings(m: HealthMetrics, score: number, delta: number | null): WarningItem[] {
  const warnings: WarningItem[] = [];

  // 사진 미업데이트
  if (m.days_since_last_photo >= 30) {
    warnings.push({
      type: 'photo_stale', severity: 'critical',
      message:    `${m.days_since_last_photo}일째 신규 사진이 없습니다.`,
      suggestion: '메뉴 또는 매장 내부 사진을 업로드해 주세요. 사진 업데이트는 네이버 노출 알고리즘에 긍정적 영향을 줍니다.',
    });
  } else if (m.days_since_last_photo >= 14) {
    warnings.push({
      type: 'photo_stale', severity: 'warning',
      message:    `${m.days_since_last_photo}일째 신규 사진이 없습니다.`,
      suggestion: '메뉴 또는 매장 내부 사진 1~2장 업로드를 권장합니다.',
    });
  }

  // 헬스 스코어 하락
  if (delta !== null) {
    if (delta <= -20 || score < 50) {
      warnings.push({
        type: 'score_drop', severity: 'critical',
        message:    `헬스 스코어가 전 기간 대비 ${Math.abs(delta)}점 하락했습니다.`,
        suggestion: '리뷰 답글 처리와 사진 업데이트를 우선적으로 진행해 주세요.',
      });
    } else if (delta <= -10) {
      warnings.push({
        type: 'score_drop', severity: 'warning',
        message:    `헬스 스코어가 전 기간 대비 ${Math.abs(delta)}점 하락했습니다.`,
        suggestion: '이번 기간 미처리된 리뷰가 없는지 확인해 주세요.',
      });
    }
  }

  // 부정 리뷰 급증
  if (m.negative_review_count >= 3) {
    warnings.push({
      type: 'negative_spike', severity: 'critical',
      message:    `이번 기간 ⭐1~2점 리뷰가 ${m.negative_review_count}건 발생했습니다.`,
      suggestion: '위기 리뷰에 빠른 답글로 대응하면 전체 평점 하락을 방어할 수 있습니다.',
    });
  }

  // 미답글 누적
  if (m.unanswered_review_count >= 10) {
    warnings.push({
      type: 'unanswered_reviews', severity: 'warning',
      message:    `미답글 리뷰가 ${m.unanswered_review_count}건 누적되어 있습니다.`,
      suggestion: '초안이 준비된 리뷰부터 순서대로 발행해 주세요.',
    });
  } else if (m.unanswered_review_count >= 5) {
    warnings.push({
      type: 'unanswered_reviews', severity: 'info',
      message:    `미답글 리뷰 ${m.unanswered_review_count}건이 있습니다.`,
      suggestion: '대시보드에서 초안을 확인하고 발행해 주세요.',
    });
  }

  // Naver 통계 미수집 안내
  warnings.push({
    type: 'no_impressions_data', severity: 'info',
    message:    '네이버 플레이스 노출/클릭 통계가 반영되지 않았습니다.',
    suggestion: '네이버 파트너센터 연동 시 더 정밀한 헬스 스코어를 제공합니다.',
  });

  return warnings;
}

function emptyMetrics(): HealthMetrics {
  return {
    impression_count: null, impression_delta: null,
    click_count: null, click_rate: null, click_rate_delta: null,
    phone_click: null, direction_click: null, save_click: null,
    days_since_last_photo: 0, photo_count_this_period: 0,
    review_count_this_period: 0, avg_rating_this_period: null, avg_rating_delta: null,
    negative_review_count: 0, unanswered_review_count: 0,
  };
}
