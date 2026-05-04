import { chromium, Browser, BrowserContext, Page } from 'playwright';
import dayjs from 'dayjs';
import { BaeminScraperInput, BaeminScraperOutput, BaeminScrapedReview } from '../../types/review';
import { pageDelay } from '../../utils/delay';
import { SELECTORS, BAEMIN_REVIEW_URL, BAEMIN_DOMAIN } from './selectors';
import {
  parseBaeminDate,
  parseCookieString,
  parseBaeminRating,
  parseMenuRatings,
  generateBaeminFallbackId,
} from './parser';

const MAX_PAGES = 10;
const NAV_TIMEOUT_MS = 30_000;

export async function scrapeBaemin(input: BaeminScraperInput): Promise<BaeminScraperOutput> {
  const { last_collected_at, auth } = input;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await createContext(browser, auth);
    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const navResult = await navigateToReviewPage(page);
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
  auth: BaeminScraperInput['auth'],
): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });

  if (auth.method === 'cookie' && auth.cookie) {
    const cookies = parseCookieString(auth.cookie, BAEMIN_DOMAIN);
    if (cookies.length > 0) await context.addCookies(cookies);
  }

  if (auth.method === 'ceo_api' && auth.ceo_api_token) {
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${auth.ceo_api_token}`,
    });
  }

  return context;
}

// ── Navigation ────────────────────────────────────────────

async function navigateToReviewPage(page: Page): Promise<'ok' | BaeminScraperOutput> {
  try {
    const response = await page.goto(BAEMIN_REVIEW_URL, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    if (!response) return { status: 'failed', error_message: '페이지 응답 없음', reviews: [] };
    if (response.status() === 401 || response.status() === 403) {
      return { status: 'auth_expired', error_message: `인증 오류 (${response.status()})`, reviews: [] };
    }

    // 로그인 페이지로 리다이렉트 됐는지 확인
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/signin')) {
      return { status: 'auth_expired', error_message: '세션 만료 — 로그인 페이지로 리다이렉트', reviews: [] };
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (isBlockedPage(bodyText)) {
      return { status: 'blocked', error_message: '봇 감지 / 접근 차단', reviews: [] };
    }

    // 리뷰 목록 등장 대기
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
): Promise<{ reviews: BaeminScrapedReview[]; nextPageAvailable: boolean }> {
  const cutoff = lastCollectedAt ? dayjs(lastCollectedAt) : null;
  const all: BaeminScrapedReview[] = [];
  let pageNum = 0;
  let reachedCutoff = false;

  while (pageNum < MAX_PAGES && !reachedCutoff) {
    const batch = await extractAndNormalize(page);

    for (const review of batch) {
      if (cutoff && !dayjs(review.reviewed_at).isAfter(cutoff)) {
        reachedCutoff = true;
        break;
      }
      all.push(review);
    }

    if (reachedCutoff) break;

    const hasMore = await goToNextPage(page);
    if (!hasMore) break;

    pageNum++;
    await pageDelay();
  }

  return { reviews: all, nextPageAvailable: !reachedCutoff && pageNum >= MAX_PAGES };
}

// ── DOM Extraction ────────────────────────────────────────

async function extractAndNormalize(page: Page): Promise<BaeminScrapedReview[]> {
  type RawItem = {
    reviewId: string;
    author: string;
    ratingText: string;
    starFilledCount: number;
    content: string;
    rawDate: string;
    imageUrls: string[];
    replied: boolean;
    replyContent: string | null;
    tasteText: string;
    quantityText: string;
    deliveryText: string;
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
      const reviewId =
        item.getAttribute('data-review-id') ||
        item.getAttribute('data-id') ||
        '';

      const author = first(item, sels.authorName)?.textContent?.trim() ?? '알 수 없음';

      // 별점 — aria-label 우선
      let ratingText = '';
      const ratingEl = item.querySelector(sels.ratingAriaLabel);
      if (ratingEl) ratingText = ratingEl.getAttribute('aria-label') ?? ratingEl.textContent?.trim() ?? '';

      // 채워진 별 아이콘 개수
      const starEls = Array.from(item.querySelectorAll(sels.starFilled));
      const starFilledCount = starEls.length;

      const content = first(item, sels.content)?.textContent?.trim() ?? '';

      const dateEl = first(item, sels.date);
      const rawDate = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

      const imageUrls = Array.from(item.querySelectorAll(sels.images))
        .map((img) => (img as HTMLImageElement).src)
        .filter((src) => Boolean(src) && !src.startsWith('data:'));

      const replyEl = first(item, sels.ownerReply);
      const replied = replyEl !== null;
      const replyContent = replied ? (replyEl?.textContent?.trim() ?? null) : null;

      // 세부 평점
      const tasteEl    = item.querySelector(sels.tasteRating);
      const quantityEl = item.querySelector(sels.quantityRating);
      const deliveryEl = item.querySelector(sels.deliveryRating);

      return {
        reviewId,
        author,
        ratingText,
        starFilledCount,
        content,
        rawDate,
        imageUrls,
        replied,
        replyContent,
        tasteText:    tasteEl?.textContent?.trim()    ?? '',
        quantityText: quantityEl?.textContent?.trim() ?? '',
        deliveryText: deliveryEl?.textContent?.trim() ?? '',
      };
    });
  }, {
    reviewItem:      Array.from(SELECTORS.reviewItem),
    authorName:      Array.from(SELECTORS.authorName),
    ratingAriaLabel: SELECTORS.ratingAriaLabel,
    starFilled:      SELECTORS.starFilled,
    content:         Array.from(SELECTORS.content),
    date:            Array.from(SELECTORS.date),
    images:          Array.from(SELECTORS.images).join(', '),
    ownerReply:      Array.from(SELECTORS.ownerReply),
    tasteRating:     SELECTORS.tasteRating,
    quantityRating:  SELECTORS.quantityRating,
    deliveryRating:  SELECTORS.deliveryRating,
  });

  return rawItems.map((item) => {
    const reviewedAt = parseBaeminDate(item.rawDate);
    const rating =
      parseBaeminRating(item.ratingText) ||
      item.starFilledCount ||
      0;
    const platformReviewId =
      item.reviewId ||
      generateBaeminFallbackId(item.author, reviewedAt, item.content);
    const menuRatings = parseMenuRatings(item.tasteText, item.quantityText, item.deliveryText);

    return {
      platform_review_id: platformReviewId,
      author_name: item.author,
      rating,
      content: item.content,
      image_urls: item.imageUrls,
      replied: item.replied,
      reply_content: item.replyContent,
      reviewed_at: reviewedAt,
      ...(menuRatings ? { menu_ratings: menuRatings } : {}),
    };
  });
}

// ── Pagination ────────────────────────────────────────────

async function goToNextPage(page: Page): Promise<boolean> {
  // 더보기 버튼 방식
  const moreSel = SELECTORS.moreButton.join(', ');
  const moreBtn = page.locator(moreSel).first();
  if (await moreBtn.isVisible().catch(() => false)) {
    await moreBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return true;
  }

  // 다음 페이지 버튼 방식
  const nextSel = SELECTORS.nextPageBtn.join(', ');
  const nextBtn = page.locator(nextSel).first();
  if (await nextBtn.isVisible().catch(() => false)) {
    const disabled = await nextBtn.getAttribute('disabled');
    if (disabled !== null) return false;
    await nextBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return true;
  }

  return false;
}

// ── Error Detection ───────────────────────────────────────

function isBlockedPage(bodyText: string): boolean {
  return ['자동화된 요청', 'CAPTCHA', '비정상적인 접근', 'robot'].some((s) => bodyText.includes(s));
}

function isBlockedError(msg: string): boolean {
  return ['403', 'blocked', 'CAPTCHA'].some((s) => msg.includes(s));
}

function isAuthError(msg: string): boolean {
  return ['401', '로그인', 'login', 'session', 'auth_expired'].some((s) => msg.includes(s));
}
