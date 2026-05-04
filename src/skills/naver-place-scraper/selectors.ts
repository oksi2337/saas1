/**
 * 네이버 플레이스 모바일 리뷰 페이지 셀렉터.
 * Naver는 CSS 클래스명을 자주 변경하므로 aria-label·data 속성을 우선,
 * 구조적 위치(fallback)를 보조로 사용한다.
 * DOM 변경 감지 시 이 파일만 업데이트하면 된다.
 */
export const SELECTORS = {
  // 리뷰 목록 컨테이너
  reviewList: [
    'ul.place_section_content',
    '#reviewListWrapper ul',
    '.ReviewList',
    'ul[data-nclick]',
  ],

  // 개별 리뷰 아이템
  reviewItem: [
    'li.place_section_content > div',
    '.ReviewList > li',
    'li[data-review-id]',
  ],

  // 작성자명
  authorName: [
    '.reviewer_name',
    '.name_user',
    '[class*="reviewer"] span:first-child',
    'a[href*="/user/"] span',
  ],

  // 별점: aria-label="별점 N점" 패턴이 가장 안정적
  ratingAriaLabel: '[aria-label*="별점"]',
  starIcon: '.place_star_score, .star_score, [class*="star"]',

  // 리뷰 본문
  content: [
    '.ReviewText',
    '.review_text',
    '.text_comment',
    '[class*="review"] p',
    '.pui__jhBFMA',  // 2024년 이후 obfuscated class
  ],

  // 작성일
  date: [
    'time[datetime]',
    '.date_review',
    '.time_review',
    '[class*="date"]',
    'span[class*="time"]',
  ],

  // 이미지
  images: [
    '.ReviewImage img',
    '.img_review img',
    '[class*="review"] img[src*="phinf"]',
    'img[src*="ldb.phinf"]',
  ],

  // 사장님 답글
  ownerReply: [
    '.owner_reply',
    '.ceo_reply',
    '.reply_section',
    '[class*="reply"]',
    '[class*="owner"]',
  ],

  // 더보기 버튼 (페이지네이션)
  moreButton: [
    'a.place_more_btn',
    'button[class*="more"]',
    '.place_section_content + a',
    'a[data-pui-click*="more"]',
  ],
} as const;

/** 모바일 리뷰 페이지 URL */
export const buildReviewUrl = (placeId: string) =>
  `https://m.place.naver.com/restaurant/${placeId}/review/visitor`;

/** OAuth 방식 API 엔드포인트 (추후 연동) */
export const NAVER_API_BASE = 'https://api.place.naver.com/v1';
