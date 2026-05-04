export { parseKoreanDate as parseBaeminDate } from '../../utils/date-parser';
export { parseCookieString } from '../../utils/cookie';

import type { MenuRatings } from '../../types/review';

/**
 * 배민 별점 텍스트에서 숫자 추출.
 * 형식: "5점", "4점 만점에 5점", aria-label="별점 4점"
 */
export function parseBaeminRating(raw: string): number {
  const m = raw.match(/(\d)[점]?\s*$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 5) return n;
  }
  return 0;
}

/**
 * 세부 평점 텍스트("맛 4점", "양 3점", "배달 5점")에서 MenuRatings 추출.
 * 없거나 파싱 불가 시 undefined 반환.
 */
export function parseMenuRatings(
  tasteText: string,
  quantityText: string,
  deliveryText: string,
): MenuRatings | undefined {
  const parse = (text: string): number | undefined => {
    const m = text.match(/(\d)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return n >= 1 && n <= 5 ? n : undefined;
    }
    return undefined;
  };

  const taste    = parse(tasteText);
  const quantity = parse(quantityText);
  const delivery = parse(deliveryText);

  if (taste === undefined && quantity === undefined && delivery === undefined) return undefined;
  return { taste, quantity, delivery };
}

/**
 * 배민 리뷰 ID 폴백 생성 (배민은 data-review-id를 잘 노출하지 않음).
 */
export function generateBaeminFallbackId(
  author: string,
  reviewedAt: string,
  contentSnippet: string,
): string {
  const seed = `bm|${author}|${reviewedAt.slice(0, 10)}|${contentSnippet.slice(0, 20)}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
  }
  return `bm_generated_${Math.abs(hash).toString(16)}`;
}
