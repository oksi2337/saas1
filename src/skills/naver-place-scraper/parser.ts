export { parseKoreanDate as parseNaverDate } from '../../utils/date-parser';
export { parseCookieString } from '../../utils/cookie';

/**
 * aria-label="별점 N점" 또는 숫자 문자열에서 별점 추출.
 * 실패 시 0 반환.
 */
export function parseRating(raw: string): number {
  const ariaMatch = raw.match(/별점\s*(\d)/);
  if (ariaMatch) return parseInt(ariaMatch[1], 10);

  const num = parseInt(raw.trim(), 10);
  if (!isNaN(num) && num >= 1 && num <= 5) return num;

  return 0;
}

/** 채워진 별 아이콘 개수로 별점 추출 */
export function ratingFromStarCount(filledCount: number): number {
  return Math.min(5, Math.max(0, filledCount));
}

/**
 * 리뷰 ID를 DOM에서 찾지 못했을 때의 결정론적 폴백.
 * (author + date + content 앞 20자) 기반 해시로 동일 리뷰는 항상 동일 ID 생성.
 */
export function generateFallbackReviewId(
  author: string,
  reviewedAt: string,
  contentSnippet: string,
): string {
  const seed = `${author}|${reviewedAt.slice(0, 10)}|${contentSnippet.slice(0, 20)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  return `nv_generated_${Math.abs(hash).toString(16)}`;
}
