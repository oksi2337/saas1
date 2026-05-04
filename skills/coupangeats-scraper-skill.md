# coupangeats-scraper-skill

## 역할 요약

쿠팡이츠에서 특정 매장의 신규 리뷰를 수집한다. 쿠팡이츠 사장님 센터(store.coupangeats.com) 세션 기반으로 접근한다. 1주차 MVP에서는 우선순위가 낮으며, 네이버·배민 안정화 이후 활성화한다.

> **구현 우선순위**: 3순위 (1주차 MVP 범위 밖. 네이버·배민 안정화 후 활성화)

---

## 입력 명세

```typescript
interface CoupangEatsScraperInput {
  store_id: string;
  coupangeats_store_id: string;      // 쿠팡이츠 업주 ID
  last_collected_at: string | null;
  auth: {
    method: "cookie";
    cookie: string;                  // 쿠팡이츠 사장님 센터 세션 쿠키
  };
}
```

| 필드 | 예시 |
|---|---|
| `coupangeats_store_id` | `"ce_store_77889900"` |

---

## 출력 명세

성공 시:

```typescript
interface CoupangEatsScraperOutput {
  status: "success";
  reviews: ScrapedReview[];
  next_page_available: boolean;
}

interface ScrapedReview {
  platform_review_id: string;
  author_name: string;
  rating: number;               // 1~5
  content: string;
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string;
  // 쿠팡이츠 전용 추가 필드
  ordered_menu?: string[];      // 주문한 메뉴명 목록 (표시되는 경우)
}
```

실패 시:

```typescript
interface CoupangEatsScraperError {
  status: "failed" | "blocked" | "auth_expired" | "not_implemented";
  error_message: string;
  reviews: [];
}
```

출력 예시:

```json
{
  "status": "success",
  "reviews": [
    {
      "platform_review_id": "ce_rv_11223355",
      "author_name": "이*진",
      "rating": 5,
      "content": "빠르게 와서 좋았어요. 맛도 최고!",
      "image_urls": ["https://image.coupangeats.com/..."],
      "replied": false,
      "reply_content": null,
      "reviewed_at": "2026-05-02T20:10:00+09:00",
      "ordered_menu": ["후라이드 치킨 1마리", "콜라 1.5L"]
    }
  ],
  "next_page_available": false
}
```

---

## 처리 로직

```
1. 입력 검증
   - coupangeats_store_id 형식 확인
   - 세션 쿠키 존재 여부 확인

2. 헤드리스 브라우저 실행 (Playwright)
   - 세션 쿠키 주입
   - URL: https://store.coupangeats.com/merchant/reviews (로그인 후 접근)

3. 증분 수집 루프
   - 최신 리뷰부터 파싱
   - reviewed_at이 last_collected_at 이전이면 중단
   - 페이지네이션 처리 (최대 10페이지)

4. 리뷰 파싱
   - 별점: 별 아이콘 개수 또는 aria-label에서 추출
   - 주문 메뉴: 리뷰 하단 메뉴 태그 추출 (존재 시)
   - 이미지: CDN URL 추출

5. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| `playwright` | 헤드리스 브라우저 조작 | |
| 쿠팡이츠 사장님 세션 쿠키 | 로그인 상태 유지 | 만료 주기 확인 필요 |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 미구현 상태 (MVP 이전) | `not_implemented` | 즉시 반환. review-collector-agent가 해당 플랫폼 스킵 처리 |
| 세션 만료 | `auth_expired` | 즉시 중단, 재로그인 안내 |
| 봇 감지 | `blocked` | 즉시 중단, 우회 금지 |
| 페이지 로드 타임아웃 (30초) | `failed` | 중단 후 반환 |
| DOM 구조 변경 | `failed` | 파싱 오류 반환 |
| 리뷰 0건 | `success` | `reviews: []` 정상 반환 |

---

## 제약 사항

- **구현 우선순위 명시**: `not_implemented` 상태를 지원하여 MVP 단계에서 이 skill이 등록되지 않아도 시스템이 정상 동작하도록 설계.
- **요청 간격**: 페이지 이동 간 1~3초 랜덤 딜레이.
- **최대 수집 페이지**: 1회 실행당 10페이지 상한.
- **주문 메뉴 데이터 보존**: 쿠팡이츠 고유의 주문 메뉴 정보는 `ordered_menu`로 보존. 월간 리포트의 메뉴별 만족도 분석에 활용.
- **차단 우회 자동화 금지**.
- **쓰기 요청 금지**.
