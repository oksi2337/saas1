# naver-place-scraper-skill

## 역할 요약

네이버 플레이스에서 특정 매장의 신규 리뷰를 수집한다. JavaScript 렌더링이 필요한 SPA 구조이므로 헤드리스 브라우저로 접근한다. 차단 시 사장님 OAuth 계정으로 전환한다.

---

## 입력 명세

```typescript
interface NaverScraperInput {
  store_id: string;                  // 내부 매장 ID (로그용)
  naver_place_id: string;            // 네이버 플레이스 업체 ID (URL에서 추출)
  last_collected_at: string | null;  // ISO 8601. null이면 최근 50개 전량 수집
  auth: {
    method: "cookie" | "oauth";
    cookie?: string;                 // 사장님 네이버 로그인 세션 쿠키
    oauth_token?: string;            // OAuth 액세스 토큰
  };
}
```

| 필드 | 예시 |
|---|---|
| `naver_place_id` | `"1234567890"` (m.place.naver.com/restaurant/**1234567890**/review) |
| `last_collected_at` | `"2026-05-03T10:00:00+09:00"` |
| `auth.method` | `"cookie"` (기본) / `"oauth"` (차단 시 전환) |

---

## 출력 명세

성공 시:

```typescript
interface NaverScraperOutput {
  status: "success";
  reviews: ScrapedReview[];
  next_page_available: boolean;  // 페이지가 더 있으나 last_collected_at 도달로 중단
}

interface ScrapedReview {
  platform_review_id: string;   // 네이버 내부 리뷰 ID
  author_name: string;
  rating: number;               // 1~5 (네이버는 별점 + 방문자 리뷰 혼재, 방문자 리뷰는 rating: 0으로 처리)
  content: string;
  image_urls: string[];
  replied: boolean;
  reply_content: string | null;
  reviewed_at: string;          // ISO 8601
}
```

실패 시:

```typescript
interface NaverScraperError {
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
      "platform_review_id": "nv_rv_99887766",
      "author_name": "홍길동",
      "rating": 5,
      "content": "음식도 맛있고 사장님도 친절해요!",
      "image_urls": ["https://phinf.pstatic.net/..."],
      "replied": true,
      "reply_content": "감사합니다 :)",
      "reviewed_at": "2026-05-03T14:22:00+09:00"
    }
  ],
  "next_page_available": false
}
```

---

## 처리 로직

```
1. 입력 검증
   - naver_place_id 형식 확인
   - auth.method에 맞는 자격증명 존재 여부 확인

2. 헤드리스 브라우저 실행 (Playwright)
   - 사장님 세션 쿠키 주입 (cookie 방식) 또는 OAuth 토큰 헤더 설정
   - User-Agent: 실제 모바일 브라우저 UA 사용

3. 리뷰 목록 페이지 로드
   - URL: https://m.place.naver.com/restaurant/{naver_place_id}/review/visitor
   - JS 렌더링 완료 대기 (네트워크 idle 또는 리뷰 컨테이너 DOM 등장 기준)

4. 증분 수집 루프
   - 최신 리뷰부터 순서대로 파싱
   - 각 리뷰의 reviewed_at이 last_collected_at 이전이면 수집 중단
   - "더보기" 버튼 또는 무한 스크롤로 다음 페이지 로드 (최대 10페이지)

5. 리뷰 파싱
   - 리뷰 ID: DOM 속성 또는 URL 파라미터에서 추출
   - 별점: .place_blind 요소 또는 aria-label 텍스트에서 숫자 추출
   - 답글 여부: 사장님 답글 DOM 존재 여부 확인

6. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| `playwright` | 헤드리스 브라우저 조작 | Chromium 기반. puppeteer도 대체 가능 |
| 네이버 로그인 세션 쿠키 | 로그인 상태 유지 | 사장님 본인 계정. 주기적 갱신 필요 |
| 네이버 OAuth API | 쿠키 차단 시 백업 인증 | 사장님이 직접 연동 |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 봇 감지 / CAPTCHA | `blocked` | 즉시 중단, review-collector-agent에 반환 |
| 세션 쿠키 만료 | `auth_expired` | 즉시 중단, 사장님 재로그인 안내 플래그 설정 |
| 페이지 로드 타임아웃 (30초) | `failed` | 재시도 없이 중단, 상위 agent가 재시도 관리 |
| 네이버 플레이스 DOM 구조 변경 | `failed` | 파싱 오류 메시지 포함하여 반환. 자동 우회 시도 금지 |
| `naver_place_id` 존재하지 않음 | `failed` | 404 감지 후 반환 |
| 리뷰 0건 (last_collected_at 이후 신규 없음) | `success` | `reviews: []`로 정상 반환 |

---

## 제약 사항

- **요청 간격**: 페이지 로드 간 1~3초 랜덤 딜레이. 연속 고속 요청 금지.
- **최대 수집 페이지**: 1회 실행당 10페이지(약 100개 리뷰) 상한. 초과 시 `next_page_available: true` 반환.
- **차단 우회 자동화 금지**: 봇 감지 시 IP 변경, UA 스푸핑 루프 등 시도하지 않는다. `blocked` 반환 후 상위 agent가 OAuth 전환 결정.
- **쓰기 요청 금지**: 리뷰 페이지에서 어떤 POST/PUT 요청도 보내지 않는다.
