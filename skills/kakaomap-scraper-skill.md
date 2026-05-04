# kakaomap-scraper-skill

## 역할 요약

카카오맵에서 특정 매장의 신규 리뷰(댓글)를 수집한다. 카카오맵 리뷰는 공개 페이지에서 접근 가능하며, 카카오 로컬 API를 통한 공식 접근과 공개 페이지 스크래핑 두 경로를 지원한다. 1주차 MVP에서는 우선순위가 낮으며, 네이버·배민 안정화 이후 활성화한다.

> **구현 우선순위**: 4순위 (1주차 MVP 범위 밖)

---

## 입력 명세

```typescript
interface KakaoMapScraperInput {
  store_id: string;
  kakao_place_id: string;            // 카카오맵 장소 ID
  last_collected_at: string | null;
  auth: {
    method: "kakao_api" | "cookie";
    kakao_api_key?: string;          // Kakao REST API Key (공개 장소 정보용)
    cookie?: string;                 // 사장님 카카오 계정 세션 (답글 관리 페이지용)
  };
}
```

| 필드 | 예시 |
|---|---|
| `kakao_place_id` | `"12345678"` (map.kakao.com/actions/entry?enterFrom=main&lcode=**12345678**) |
| `auth.method` | `"kakao_api"` (공개 리뷰 수집) / `"cookie"` (답글 관리 페이지 접근) |

---

## 출력 명세

성공 시:

```typescript
interface KakaoMapScraperOutput {
  status: "success";
  reviews: ScrapedReview[];
  next_page_available: boolean;
}

interface ScrapedReview {
  platform_review_id: string;
  author_name: string;
  rating: number;               // 1~5 (카카오맵은 별점 없고 좋아요만 있는 경우 존재 → rating: 0)
  content: string;
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string;
  // 카카오맵 전용 추가 필드
  like_count?: number;          // 리뷰 좋아요 수
  visit_count?: number;         // 작성자 방문 횟수 (표시되는 경우)
}
```

실패 시:

```typescript
interface KakaoMapScraperError {
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
      "platform_review_id": "km_rv_66778899",
      "author_name": "박민수",
      "rating": 4,
      "content": "분위기 좋고 음식도 맛있어요. 주차가 좀 불편해요.",
      "image_urls": [],
      "replied": false,
      "reply_content": null,
      "reviewed_at": "2026-05-01T13:30:00+09:00",
      "like_count": 3,
      "visit_count": 2
    }
  ],
  "next_page_available": false
}
```

---

## 처리 로직

```
1. 입력 검증
   - kakao_place_id 형식 확인
   - auth.method에 맞는 자격증명 확인

2-A. kakao_api 방식 (기본, 공개 리뷰)
   - Kakao Local API: GET /v2/local/search/keyword.json?query=...
   - 장소 상세: GET /v2/local/geo/transcoord.json (장소 ID 기반)
   - 리뷰 API 엔드포인트 확인 필요 (카카오 공개 API에 리뷰 직접 접근 불가 시 cookie 방식으로 폴백)

2-B. cookie 방식 (사장님 계정 접근)
   - Playwright로 place.map.kakao.com 접속
   - 사장님 카카오 계정 쿠키 주입
   - 리뷰 목록 페이지 로드

3. 증분 수집 루프
   - 최신 리뷰부터 파싱
   - reviewed_at이 last_collected_at 이전이면 중단
   - 페이지네이션 처리 (최대 10페이지)

4. 리뷰 파싱
   - 카카오맵은 별점 없는 텍스트 리뷰 존재 → rating: 0으로 저장
   - 좋아요 수, 방문 횟수 추출 (존재 시)

5. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| Kakao REST API | 장소 정보 및 리뷰 조회 | developers.kakao.com에서 API 키 발급 |
| `playwright` | cookie 방식 헤드리스 접근 | kakao_api 방식에서는 불필요 |
| 카카오 계정 세션 쿠키 | 사장님 답글 관리 접근 | cookie 방식에서만 사용 |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 미구현 상태 (MVP 이전) | `not_implemented` | 즉시 반환. review-collector-agent가 스킵 처리 |
| Kakao API 인증 실패 | `auth_expired` | 즉시 중단, API 키 재확인 안내 |
| 세션 만료 (cookie 방식) | `auth_expired` | 즉시 중단, 재로그인 안내 |
| API rate limit 초과 | `blocked` | 즉시 중단, 1시간 후 재시도 권고 |
| 페이지 로드 타임아웃 (30초) | `failed` | 중단 후 반환 |
| 카카오 API에 리뷰 엔드포인트 없음 | `failed` | cookie 방식으로 재시도 (단, 자동 전환은 review-collector가 결정) |
| 리뷰 0건 | `success` | `reviews: []` 정상 반환 |

---

## 제약 사항

- **별점 없는 리뷰 처리**: 카카오맵의 텍스트 전용 리뷰(`rating: 0`)는 위기 감지 대상에서 제외. review-collector-agent 정규화 시 `rating: null`로 변환하여 별점 기반 필터에서 스킵되도록 처리.
- **요청 간격**: 페이지 이동 간 1~3초 랜덤 딜레이.
- **최대 수집 페이지**: 1회 실행당 10페이지 상한.
- **차단 우회 자동화 금지**.
- **쓰기 요청 금지**.
