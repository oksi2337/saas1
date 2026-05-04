import { v4 as uuidv4 } from 'uuid';
import type { ScrapedReview, BaeminScrapedReview, Platform } from '../../types/review';
import type { NewReview } from '../../db/schema';

/**
 * 스크래퍼 출력(ScrapedReview)을 DB 삽입용(NewReview)으로 변환.
 * platform_extra에 플랫폼 고유 데이터를 보존한다.
 */
export function normalizeReview(
  scraped: ScrapedReview,
  storeId: string,
  platform: Platform,
): NewReview {
  // 배민 세부 평점 등 플랫폼 고유 데이터를 platform_extra에 보존
  const platformExtra: Record<string, unknown> = {};
  if (isBaeminReview(scraped) && scraped.menu_ratings) {
    platformExtra['menu_ratings'] = scraped.menu_ratings;
  }

  return {
    id:               uuidv4(),
    storeId,
    platform,
    platformReviewId: scraped.platform_review_id,
    authorName:       scraped.author_name,
    rating:           scraped.rating > 0 ? scraped.rating : null,  // 별점 없는 리뷰는 null
    content:          scraped.content,
    imageUrls:        scraped.image_urls,
    replied:          scraped.replied,
    replyContent:     scraped.reply_content ?? null,
    reviewedAt:       new Date(scraped.reviewed_at),
    collectedAt:      new Date(),
    platformExtra,
  };
}

function isBaeminReview(r: ScrapedReview): r is BaeminScrapedReview {
  return 'menu_ratings' in r;
}
