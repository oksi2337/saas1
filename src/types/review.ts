export type Platform = 'naver' | 'baemin' | 'coupangeats' | 'kakaomap' | 'google';

export interface MenuRatings {
  taste?: number;     // 맛
  quantity?: number;  // 양
  delivery?: number;  // 배달
}

export interface ScrapedReview {
  platform_review_id: string;
  author_name: string;
  /** 1~5. 별점 없는 리뷰(카카오맵 텍스트 전용)는 0 */
  rating: number;
  content: string;
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string; // ISO 8601
}

// ── Naver ────────────────────────────────────────────────

export interface NaverScraperInput {
  store_id: string;
  naver_place_id: string;
  last_collected_at: string | null;
  auth: {
    method: 'cookie' | 'oauth';
    cookie?: string;
    oauth_token?: string;
  };
}

export type NaverScraperOutput =
  | { status: 'success'; reviews: ScrapedReview[]; next_page_available: boolean }
  | { status: 'failed' | 'blocked' | 'auth_expired'; error_message: string; reviews: [] };

// ── Baemin ───────────────────────────────────────────────

export interface BaeminScrapedReview extends ScrapedReview {
  menu_ratings?: MenuRatings;
}

export interface BaeminScraperInput {
  store_id: string;
  baemin_store_id: string;
  last_collected_at: string | null;
  auth: {
    method: 'cookie' | 'ceo_api';
    cookie?: string;
    ceo_api_token?: string;
  };
}

export type BaeminScraperOutput =
  | { status: 'success'; reviews: BaeminScrapedReview[]; next_page_available: boolean }
  | { status: 'failed' | 'blocked' | 'auth_expired'; error_message: string; reviews: [] };
