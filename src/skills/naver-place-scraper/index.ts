import { chromium, Browser, BrowserContext, Page } from 'playwright';
import dayjs from 'dayjs';
import { NaverScraperInput, NaverScraperOutput, ScrapedReview } from '../../types/review';
import { pageDelay } from '../../utils/delay';
import { buildReviewUrl, SELECTORS } from './selectors';
import {
  parseNaverDate,
  generateFallbackReviewId,
  parseCookieString,
} from './parser';

const MAX_PAGES = 10;
const NAV_TIMEOUT_MS = 30_000;

export async function scrapeNaverPlace(input: NaverScraperInput): Promise<NaverScraperOutput> {
  const { naver_place_id, last_collected_at, auth } = input;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await createContext(browser, auth);
    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const navResult = await navigateToReviewPage(page, buildReviewUrl(naver_place_id));
    if (navResult !== 'ok') return navResult;

    const { reviews, nextPageAvailable } = await collectReviews(page, last_collected_at);

    return { status: 'success', reviews, next_page_available: nextPageAvailable };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isBlockedError(message)) return { status: 'blocked', error_message: message, reviews: [] };
    if (isAuthError(message))   return { status: 'auth_expired', error_message: message, reviews: [] };
    return { status: 'failed', error_message: message, reviews: [] };
  } finally {
    await browser?.close();
  }
}

// ── Auth / Context ────────────────────────────────────────

async function createContext(
  browser: Browser,
  auth: NaverScraperInput['auth'],
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  if (auth.method === 'cookie' && auth.cookie) {
    const cookies = parseCookieString(auth.cookie, '.naver.com');
    if (cookies.length > 0) await context.addCookies(cookies);
  }

  if (auth.method === 'oauth' && auth.oauth_token) {
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${auth.oauth_token}`,
    });
  }

  return context;
}

// ── Navigation ────────────────────────────────────────────

async function navigateToReviewPage(
  page: Page,
  url: string,
): Promise<'ok' | NaverScraperOutput> {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    if (!response) return { status: 'failed', error_message: '페이지 응답 없음', reviews: [] };
    if (response.status() === 404) return { status: 'failed', error_message: `플레이스 없음 (404): ${url}`, reviews: [] };
    if (response.status() === 401 || response.status() === 403) {
      return { status: 'auth_expired', error_message: `인증 오류 (${response.status()})`, reviews: [] };
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (isCaptchaPage(bodyText)) {
      return { status: 'blocked', error_message: '봇 감지 / CAPTCHA', reviews: [] };
    }

    // 리뷰 영역 등장 대기 (없으면 리뷰 0건으로 진행)
    await page
      .waitForSelector(SELECTORS.reviewItem.join(', '), { timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('timeout')) {
      return { status: 'failed', error_message: `페이지 로드 타임아웃 (${NAV_TIMEOUT_MS}ms)`, reviews: [] };
    }
    throw err;
  }
}

// ── Collection Loop ───────────────────────────────────────

async function collectReviews(
  page: Page,
  lastCollectedAt: string | null,
): Promise<{ reviews: ScrapedReview[]; nextPageAvailable: boolean }> {
  const cutoff = lastCollectedAt ? dayjs(lastCollectedAt) : null;
  const all: ScrapedReview[] = [];
  let pageNum = 0;
  let reachedCutoff = false;

  while (pageNum < MAX_PAGES && !reachedCutoff) {
    const batch = await extractAndNormalize(page);

    for (const review of batch) {
      // cutoff 이전 리뷰에 도달하면 수집 중단
      if (cutoff && !dayjs(review.reviewed_at).isAfter(cutoff)) {
        reachedCutoff = true;
        break;
      }
      all.push(review);
    }

    if (reachedCutoff) break;

    const hasMore = await clickMoreButton(page);
    if (!hasMore) break;

    pageNum++;
    await pageDelay();
  }

  return {
    reviews: all,
    nextPageAvailable: !reachedCutoff && pageNum >= MAX_PAGES,
  };
}

// ── DOM Extraction ────────────────────────────────────────

/** page.evaluate로 DOM에서 raw 데이터 추출 → Node.js에서 후처리 */
async function extractAndNormalize(page: Page): Promise<ScrapedReview[]> {
  type RawItem = {
    reviewId: string;
    author: string;
    rating: number;
    content: string;
    imageUrls: string[];
    replied: boolean;
    replyContent: string | null;
    rawDate: string;
  };

  const rawItems: RawItem[] = await page.evaluate((sels) => {
    function first(parent: ParentNode, list: string[]): Element | null {
      for (const s of list) {
        const el = parent.querySelector(s);
        if (el) return el;
      }
      return null;
    }

    function all(list: string[]): Element[] {
      for (const s of list) {
        const els = Array.from(document.querySelectorAll(s));
        if (els.length) return els;
      }
      return [];
    }

    return all(sels.reviewItem).map((item) => {
      // Review ID
      const reviewId =
        item.getAttribute('data-review-id') ||
        item.getAttribute('data-id') ||
        item.querySelector('[data-review-id]')?.getAttribute('data-review-id') ||
        '';

      // Author — pui__NMi-Dp 우선, 중복 텍스트 제거
      const authorEl = first(item, sels.authorName);
      const author = authorEl?.textContent?.trim() ?? '알 수 없음';

      // Rating — 2024+ 네이버 pui UI는 별점 미표시, aria-label 폴백 후 0
      let rating = 0;
      const ratingEl = item.querySelector('[aria-label*="별점"]');
      if (ratingEl) {
        const m = (ratingEl.getAttribute('aria-label') ?? '').match(/별점\s*(\d)/);
        if (m) rating = parseInt(m[1], 10);
      }
      if (rating === 0) {
        const stars = Array.from(item.querySelectorAll(sels.starIcon));
        const filled = stars.filter((s) => {
          const el = s as Element;
          return el.className.includes('active') || el.className.includes('fill');
        }).length;
        if (filled > 0) rating = filled;
      }

      // Content — data-pui-click-code="rvshowmore" 우선
      const contentEl = first(item, sels.content);
      const content = contentEl?.textContent?.trim() ?? '';

      // Date — pui__blind:last-child → "2026년 4월 22일 수요일" 형식 우선
      const dateEl = first(item, sels.date);
      const rawDate = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

      // Images
      const imageUrls = Array.from(item.querySelectorAll(sels.images))
        .map((img) => (img as HTMLImageElement).src)
        .filter((src) => Boolean(src) && !src.startsWith('data:'));

      // Owner reply
      const replyEl = first(item, sels.ownerReply);
      const replied = replyEl !== null;
      const replyContent = replied ? (replyEl?.textContent?.trim() ?? null) : null;

      return { reviewId, author, rating, content, imageUrls, replied, replyContent, rawDate };
    });
  }, {
    reviewItem: Array.from(SELECTORS.reviewItem),
    authorName: Array.from(SELECTORS.authorName),
    starIcon: SELECTORS.starIcon as string,
    content:  Array.from(SELECTORS.content),
    date:     Array.from(SELECTORS.date),
    images:   Array.from(SELECTORS.images).join(', '),
    ownerReply: Array.from(SELECTORS.ownerReply),
  });

  // Node.js 레이어에서 날짜 파싱 + ID 생성
  return rawItems.map((item) => {
    const reviewedAt = parseNaverDate(item.rawDate);
    const platformReviewId =
      item.reviewId || generateFallbackReviewId(item.author, reviewedAt, item.content);

    return {
      platform_review_id: platformReviewId,
      author_name: item.author,
      rating: item.rating,
      content: item.content,
      image_urls: item.imageUrls,
      replied: item.replied,
      reply_content: item.replyContent,
      reviewed_at: reviewedAt,
    };
  });
}

// ── More Button ───────────────────────────────────────────

async function clickMoreButton(page: Page): Promise<boolean> {
  const btn = page.locator(SELECTORS.moreButton.join(', ')).first();
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) return false;

  await btn.click();
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  return true;
}

// ── Error Detection ───────────────────────────────────────

function isCaptchaPage(bodyText: string): boolean {
  return ['자동화된 요청', 'CAPTCHA', '비정상적인 접근', '잠시 후 다시', 'robot'].some((s) =>
    bodyText.includes(s),
  );
}

function isBlockedError(msg: string): boolean {
  return ['403', 'blocked', 'CAPTCHA', '자동화'].some((s) => msg.includes(s));
}

function isAuthError(msg: string): boolean {
  return ['401', 'auth', '로그인', 'session'].some((s) => msg.includes(s));
}
