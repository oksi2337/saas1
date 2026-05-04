# baemin-scraper-skill

## 역할 요약

배달의민족에서 특정 매장의 신규 리뷰를 수집한다. 배민 사장님 계정(ceo.baemin.com) 세션 기반으로 접근하며, 공개 페이지 스크래핑과 사장님 전용 API 두 가지 경로를 지원한다.

---

## 입력 명세

```typescript
interface BaeminScraperInput {
  store_id: string;
  baemin_store_id: string;           // 배민 내부 업주 ID
  last_collected_at: string | null;  // null이면 최근 50개 전량 수집
  auth: {
    method: "cookie" | "ceo_api";
    cookie?: string;                 // 배민 사장님 웹 세션 쿠키
    ceo_api_token?: string;          // 배민 CEO API 액세스 토큰
  };
}
```

| 필드 | 예시 |
|---|---|
| `baemin_store_id` | `"shop_11223344"` |
| `auth.method` | `"cookie"` (기본) / `"ceo_api"` (공식 연동 시) |

---

## 출력 명세

성공 시:

```typescript
interface BaeminScraperOutput {
  status: "success";
  reviews: ScrapedReview[];
  next_page_available: boolean;
}

interface ScrapedReview {
  platform_review_id: string;
  author_name: string;
  rating: number;               // 1~5 (배민은 별점 + 맛/양/배달 세부 항목 혼재)
  content: string;
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string;
  // 배민 전용 추가 필드 (review-collector-agent에서 정규화 시 사용)
  menu_ratings?: {
    taste?: number;
    quantity?: number;
    delivery?: number;
  };
}
```

실패 시:

```typescript
interface BaeminScraperError {
  status: "failed" | "blocked" | "auth_expired";
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
      "platform_review_id": "bm_rv_55443322",
      "author_name": "김**",
      "rating": 4,
      "content": "맛있어요. 포장도 꼼꼼하게 해주셨어요.",
      "image_urls": [],
      "replied": false,
      "reply_content": null,
      "reviewed_at": "2026-05-03T19:45:00+09:00",
      "menu_ratings": { "taste": 5, "quantity": 4, "delivery": 4 }
    }
  ],
  "next_page_available": false
}
```

---

## 처리 로직

```
1. 입력 검증
   - baemin_store_id 형식 확인
   - auth.method에 맞는 자격증명 존재 여부 확인

2-A. cookie 방식 (기본)
   - Playwright로 ceo.baemin.com 접속
   - 세션 쿠키 주입 후 리뷰 관리 페이지 로드
   - URL: https://ceo.baemin.com/review (로그인 후 접근 가능)

2-B. ceo_api 방식 (공식 연동)
   - 배민 CEO API 엔드포인트에 HTTP 요청
   - Authorization: Bearer {ceo_api_token}
   - 페이지네이션 파라미터로 증분 수집

3. 증분 수집 루프
   - 최신 리뷰부터 파싱
   - reviewed_at이 last_collected_at 이전이면 중단
   - 페이지네이션 처리 (최대 10페이지)

4. 리뷰 파싱
   - 별점: 기본 별점 + 세부 항목(맛/양/배달) 각각 추출
   - 작성자: 배민은 이름 일부 마스킹("김**") 그대로 저장
   - 이미지: CDN URL 추출

5. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| `playwright` | cookie 방식 헤드리스 접근 | ceo_api 방식에서는 불필요 |
| 배민 사장님 세션 쿠키 | 로그인 상태 유지 | 사장님 계정. 만료 주기 짧음 (7일 내외) |
| 배민 CEO API | 공식 데이터 접근 | 파트너십 계약 필요 여부 확인 필요 |
| `axios` / `node-fetch` | ceo_api 방식 HTTP 요청 | |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 세션 만료 / 재로그인 요구 | `auth_expired` | 즉시 중단, 재로그인 안내 플래그 설정 |
| 봇 감지 | `blocked` | 즉시 중단, 우회 시도 금지 |
| API rate limit 초과 | `blocked` | 즉시 중단, 1시간 후 재시도 권고 |
| 페이지 로드 타임아웃 (30초) | `failed` | 중단 후 반환 |
| DOM 구조 변경 (cookie 방식) | `failed` | 파싱 오류 반환, 자동 우회 금지 |
| 리뷰 0건 | `success` | `reviews: []` 정상 반환 |

---

## 제약 사항

- **요청 간격**: 페이지 이동 간 1~3초 랜덤 딜레이.
- **최대 수집 페이지**: 1회 실행당 10페이지 상한.
- **세부 평점 보존**: 배민의 맛/양/배달 세부 항목은 `menu_ratings`로 별도 보존. review-collector-agent가 정규화 시 참고용으로 활용.
- **차단 우회 자동화 금지**: `blocked` 반환 후 상위 agent가 처리 결정.
- **쓰기 요청 금지**: 리뷰 조회만. 사장님 답글 발행 등 쓰기 요청 절대 금지.
