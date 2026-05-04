# google-maps-scraper-skill

## 역할 요약

구글 맵에서 특정 매장의 신규 리뷰를 수집한다. Google Places API(유료)를 1순위로 사용하고, API 비용이 문제가 되는 경우 공개 페이지 스크래핑으로 폴백한다. 1주차 MVP에서는 우선순위가 낮으며, 네이버·배민 안정화 이후 활성화한다.

> **구현 우선순위**: 5순위 (1주차 MVP 범위 밖)

---

## 입력 명세

```typescript
interface GoogleMapsScraperInput {
  store_id: string;
  google_place_id: string;           // Google Place ID (ChIJ... 형식)
  last_collected_at: string | null;
  auth: {
    method: "places_api" | "scraping";
    places_api_key?: string;         // Google Cloud API Key
  };
}
```

| 필드 | 예시 |
|---|---|
| `google_place_id` | `"ChIJN1t_tDeuEmsRUsoyG83frY4"` |
| `auth.method` | `"places_api"` (기본) / `"scraping"` (폴백) |

---

## 출력 명세

성공 시:

```typescript
interface GoogleMapsScraperOutput {
  status: "success";
  reviews: ScrapedReview[];
  next_page_available: boolean;
}

interface ScrapedReview {
  platform_review_id: string;        // Google review ID
  author_name: string;
  rating: number;                    // 1~5
  content: string;                   // 원문 텍스트 (다국어 포함)
  content_translated: string | null; // 한국어 번역본 (Places API 제공 시)
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string;
  // 구글 전용 추가 필드
  author_reviews_count?: number;     // 작성자 총 리뷰 수 (신뢰도 참고)
  language?: string;                 // 리뷰 언어 코드 ("ko", "en", ...)
}
```

실패 시:

```typescript
interface GoogleMapsScraperError {
  status: "failed" | "blocked" | "auth_expired" | "not_implemented" | "quota_exceeded";
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
      "platform_review_id": "gm_rv_ChIJabc123def456",
      "author_name": "John Kim",
      "rating": 5,
      "content": "Amazing food! The kimchi jjigae was perfect.",
      "content_translated": "음식이 너무 맛있어요! 김치찌개가 완벽했어요.",
      "image_urls": ["https://lh3.googleusercontent.com/..."],
      "replied": true,
      "reply_content": "Thank you so much for your kind review!",
      "reviewed_at": "2026-05-01T09:00:00+09:00",
      "author_reviews_count": 47,
      "language": "en"
    }
  ],
  "next_page_available": false
}
```

---

## 처리 로직

```
1. 입력 검증
   - google_place_id ChIJ... 형식 확인
   - auth.method에 맞는 자격증명 확인

2-A. places_api 방식 (기본)
   - Google Places API v1 호출
   - GET https://places.googleapis.com/v1/places/{place_id}
     ?fields=reviews,userRatingCount
     &languageCode=ko
   - Authorization: API Key 헤더
   - 응답에서 reviews 배열 추출
   - 주의: Places API는 최근 리뷰 5개만 반환 (하위 플랜 기준)
     → 더 많은 리뷰 필요 시 Places API Advanced 또는 scraping 방식 사용

2-B. scraping 방식 (폴백)
   - Playwright로 maps.google.com 접속
   - 매장 페이지 → 리뷰 탭 → 최신순 정렬
   - 무한 스크롤로 리뷰 로드 (last_collected_at 기준 중단)

3. 증분 필터링
   - Places API는 최신순 정렬 보장 안 됨
     → reviewed_at으로 last_collected_at 이전 리뷰 필터링

4. 번역 처리
   - Places API 응답의 originalText + translatedText 모두 보존
   - 한국어 리뷰는 content_translated: null

5. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| Google Places API v1 | 공식 장소/리뷰 데이터 | Google Cloud 프로젝트 + API 키 필요. 유료 (1000건당 약 $17) |
| `playwright` | scraping 방식 폴백 | |
| Google Cloud 청구 계정 | API 사용 비용 | 월 $200 무료 크레딧 제공 (초과 시 청구) |

---

## API 비용 관리

| 상황 | 전략 |
|---|---|
| 매장 수 10개 이하 | Places API 사용 (월 무료 크레딧 내 소화 가능) |
| 매장 수 증가로 비용 발생 | scraping 방식으로 전환 결정 (운영자 판단) |
| Places API 일일 할당량 초과 | `quota_exceeded` 반환 → 다음 수집 주기로 스킵 |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 미구현 상태 (MVP 이전) | `not_implemented` | 즉시 반환. review-collector-agent가 스킵 처리 |
| API 키 무효 / 만료 | `auth_expired` | 즉시 중단, API 키 재확인 안내 |
| API 할당량 초과 | `quota_exceeded` | 즉시 중단, 다음 주기 재시도 |
| 봇 감지 (scraping 방식) | `blocked` | 즉시 중단, 우회 금지 |
| Place ID 존재하지 않음 | `failed` | 404 응답 후 반환 |
| 리뷰 0건 (또는 Places API 5개 제한으로 신규 없음) | `success` | `reviews: []` 정상 반환 |

---

## 제약 사항

- **다국어 리뷰 처리**: 외국어 리뷰는 `content_translated`에 한국어 번역본을 보존. review-collector-agent 정규화 시 한국어 번역본을 `content`로 사용하고 원문은 보조 필드로 저장.
- **Places API 리뷰 수 제한**: Google Places API 기본 플랜은 최근 리뷰 5개만 반환. 신규 매장 등록 초기 수집(전량) 시에는 scraping 방식 병행 권고.
- **요청 간격**: scraping 방식 시 페이지 이동 간 2~4초 랜덤 딜레이 (구글 봇 감지 민감도 높음).
- **최대 수집 페이지**: 1회 실행당 10페이지 상한.
- **차단 우회 자동화 금지**.
- **쓰기 요청 금지**: 사장님 답글(Google Reply) 발행은 이 skill의 범위 밖.
