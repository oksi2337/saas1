/**
 * 배민 사장님 센터 리뷰 관리 페이지 셀렉터.
 * ceo.baemin.com은 React SPA이므로 aria 속성과 data 속성을 우선 사용한다.
 */
export const SELECTORS = {
  // 로그인 상태 확인
  loginCheck: '.ceo-header__username, [class*="userName"], [data-testid="user-name"]',

  // 리뷰 목록 컨테이너
  reviewList: [
    '[class*="reviewList"]',
    '[class*="review-list"]',
    'ul[class*="Review"]',
    '.review-list-wrap ul',
  ],

  // 개별 리뷰 아이템
  reviewItem: [
    '[class*="reviewItem"]',
    '[class*="review-item"]',
    'li[class*="Review"]',
    '[data-testid="review-item"]',
  ],

  // 작성자명 (배민은 항상 마스킹: 김**, 이**)
  authorName: [
    '[class*="reviewerName"]',
    '[class*="reviewer-name"]',
    '[class*="userName"]',
    '[data-testid="reviewer-name"]',
  ],

  // 별점
  ratingAriaLabel: '[aria-label*="별점"], [aria-label*="star"]',
  starFilled: '[class*="starFill"], [class*="star-fill"], [class*="starActive"]',

  // 리뷰 본문
  content: [
    '[class*="reviewContent"]',
    '[class*="review-content"]',
    '[class*="reviewText"]',
    '[data-testid="review-content"]',
    'p[class*="review"]',
  ],

  // 작성일
  date: [
    'time[datetime]',
    '[class*="reviewDate"]',
    '[class*="review-date"]',
    '[class*="createdAt"]',
    'span[class*="date"]',
  ],

  // 메뉴별 세부 평점 (맛/양/배달)
  menuRatingWrap: '[class*="detailScore"], [class*="detail-score"], [class*="subRating"]',
  tasteRating:    '[class*="taste"], [data-rating-type="taste"]',
  quantityRating: '[class*="amount"], [class*="quantity"], [data-rating-type="quantity"]',
  deliveryRating: '[class*="delivery"], [data-rating-type="delivery"]',

  // 리뷰 이미지
  images: [
    '[class*="reviewImage"] img',
    '[class*="review-image"] img',
    'img[class*="reviewImg"]',
  ],

  // 사장님 답글
  ownerReply: [
    '[class*="ownerReply"]',
    '[class*="owner-reply"]',
    '[class*="ceoReply"]',
    '[data-testid="owner-reply"]',
  ],

  // 다음 페이지 / 더보기
  moreButton: [
    'button[class*="more"]',
    'button[class*="More"]',
    '[data-testid="load-more"]',
    'a[class*="more"]',
  ],

  // 페이지네이션 (버튼 방식)
  nextPageBtn: [
    'button[aria-label="다음 페이지"]',
    '[class*="pagination"] button:last-child',
    'button[class*="next"]',
  ],
} as const;

export const BAEMIN_REVIEW_URL = 'https://ceo.baemin.com/review';
export const BAEMIN_DOMAIN = '.baemin.com';
