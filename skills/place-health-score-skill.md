# place-health-score-skill

## 역할 요약

매장의 플레이스 헬스 스코어(0~100점)를 산출한다. 네이버 플레이스 통계(노출수·클릭수), 사진 업데이트 빈도, 리뷰 추이를 종합하여 점수를 계산하고 이상 지표를 감지한다. 이 제품의 핵심 차별화 기능이다.

---

## 입력 명세

```typescript
interface PlaceHealthScoreInput {
  store_id: string;
  period_start: string;    // ISO 8601 date (예: "2026-04-28")
  period_end: string;      // ISO 8601 date (예: "2026-05-04")
  include_competitor: boolean;  // Agency 플랜만 true
  auth: {
    naver_stat_cookie?: string;  // 네이버 플레이스 통계 페이지 접근용
  };
}
```

---

## 출력 명세

성공 시:

```typescript
interface PlaceHealthScoreOutput {
  status: "success";
  store_id: string;
  period_start: string;
  period_end: string;

  health_score: number;          // 종합 점수 0~100
  health_score_delta: number;    // 전 주기 대비 변화량 (양수=상승, 음수=하락)
  score_label: "우수" | "양호" | "보통" | "주의" | "위험";

  metrics: HealthMetrics;
  warning_items: WarningItem[];
  competitor_comparison: CompetitorData | null;  // Agency 플랜만
}

interface HealthMetrics {
  // 네이버 플레이스 통계 (수집 성공 시)
  impression_count: number | null;       // 노출수
  impression_delta: number | null;       // 전 주기 대비 변화율 (%)
  click_count: number | null;            // 클릭수 (전화/길찾기/예약 합산)
  click_rate: number | null;             // 클릭률 = 클릭수 / 노출수
  click_rate_delta: number | null;       // 전 주기 대비 변화율 (%)
  phone_click: number | null;            // 전화 클릭수
  direction_click: number | null;        // 길찾기 클릭수
  save_click: number | null;             // 저장(찜) 클릭수

  // 사진 업데이트 (DB 기반)
  days_since_last_photo: number;         // 마지막 사진 업로드 후 경과일
  photo_count_this_period: number;       // 해당 기간 업로드된 사진 수

  // 리뷰 지표 (DB 기반)
  review_count_this_period: number;      // 해당 기간 신규 리뷰 수
  avg_rating_this_period: number | null; // 해당 기간 평균 별점
  avg_rating_delta: number | null;       // 전 주기 대비 변화량
  negative_review_count: number;         // ⭐1~2점 리뷰 수
  unanswered_review_count: number;       // 미답글 리뷰 수
}

interface WarningItem {
  type: "photo_stale" | "click_drop" | "score_drop" | "negative_spike" | "unanswered_reviews" | "no_impressions_data";
  severity: "info" | "warning" | "critical";
  message: string;       // 사장님용 한국어 메시지
  suggestion: string;    // 구체적 액션 제안
}

interface CompetitorData {
  nearby_avg_photo_update_days: number;   // 인근 경쟁 매장 평균 사진 업데이트 주기
  nearby_avg_rating: number;              // 인근 경쟁 매장 평균 별점
  rank_in_category: number | null;        // 카테고리 내 노출 순위 (수집 가능 시)
}
```

실패 시:

```typescript
interface PlaceHealthScoreError {
  status: "partial" | "failed";
  // partial: 네이버 통계 수집 실패했지만 DB 기반 지표는 계산 가능
  health_score: number | null;
  metrics: HealthMetrics;   // 수집 실패 항목은 null
  warning_items: WarningItem[];
  error_message: string;
}
```

출력 예시:

```json
{
  "status": "success",
  "store_id": "store_abc123",
  "period_start": "2026-04-28",
  "period_end": "2026-05-04",
  "health_score": 68,
  "health_score_delta": -7,
  "score_label": "보통",
  "metrics": {
    "impression_count": 1240,
    "impression_delta": -12.3,
    "click_count": 87,
    "click_rate": 0.070,
    "click_rate_delta": -18.5,
    "phone_click": 34,
    "direction_click": 41,
    "save_click": 12,
    "days_since_last_photo": 18,
    "photo_count_this_period": 0,
    "review_count_this_period": 7,
    "avg_rating_this_period": 4.1,
    "avg_rating_delta": -0.2,
    "negative_review_count": 1,
    "unanswered_review_count": 4
  },
  "warning_items": [
    {
      "type": "photo_stale",
      "severity": "warning",
      "message": "18일째 신규 사진이 없습니다.",
      "suggestion": "메뉴 또는 매장 내부 사진 1~2장 업로드를 권장합니다. 사진 업데이트는 네이버 노출 알고리즘에 긍정적 영향을 줍니다."
    },
    {
      "type": "click_drop",
      "severity": "warning",
      "message": "전화 클릭률이 지난주 대비 18.5% 하락했습니다.",
      "suggestion": "전화번호 정보가 최신 상태인지 확인해 주세요. 영업시간 정보도 함께 점검을 권장합니다."
    }
  ],
  "competitor_comparison": null
}
```

---

## 처리 로직

```
1. 입력 검증
   - period_start < period_end 확인
   - store_id 존재 여부 확인

2. DB 기반 지표 계산 (항상 수행)
   - review 테이블에서 기간 내 리뷰 집계
     * 리뷰 수, 평균 별점, 부정 리뷰 수, 미답글 수
   - 이전 기간 동일 지표 집계 → delta 계산
   - store 테이블에서 마지막 사진 업로드 시각 조회 → days_since_last_photo

3. 네이버 플레이스 통계 수집 (성공 시 점수 정밀도 향상)
   - Playwright로 https://partner.naver.com 통계 페이지 접근
   - naver_stat_cookie로 인증
   - 기간별 노출수, 클릭수, 전화/길찾기/저장 클릭수 파싱
   - 실패 시 → 해당 항목 null 처리, status: "partial"로 계속 진행

4. 헬스 스코어 계산
   [가중치 배분]
   - 클릭률 (30%): click_rate 절대값 + delta 반영
   - 사진 업데이트 빈도 (25%): days_since_last_photo 기준
   - 리뷰 평점 (20%): avg_rating + delta 반영
   - 미답글 비율 (15%): unanswered / total_reviews
   - 노출수 추이 (10%): impression_delta 반영

   [네이버 통계 없는 경우]
   - 클릭률/노출수 항목 제외, 나머지 항목 가중치 재배분하여 계산
   - health_score에 "(통계 미반영)" 플래그

5. 이상 지표 감지 → WarningItem 생성
   (임계값은 crisis-detector-agent의 헬스 스코어 경고 임계값 참고)

6. [Agency 플랜] 경쟁 매장 비교
   - 동일 카테고리 + 반경 500m 매장 목록 조회
   - 평균 사진 업데이트 주기, 평균 별점 계산

7. 결과 반환
```

---

## 헬스 스코어 등급 기준

| 점수 | 등급 |
|---|---|
| 85~100 | 우수 |
| 70~84 | 양호 |
| 50~69 | 보통 |
| 30~49 | 주의 |
| 0~29 | 위험 |

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| `playwright` | 네이버 플레이스 파트너센터 통계 페이지 스크래핑 | 공식 API 없음. 차단 시 DB 기반으로만 계산 |
| 네이버 파트너센터 세션 쿠키 | 통계 페이지 인증 | 사장님 계정. 주기적 갱신 필요 |
| 내부 DB | 리뷰/사진 지표 집계 | 항상 사용 (네이버 통계와 독립) |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 네이버 통계 페이지 접근 실패 | `partial` | DB 기반 지표만으로 점수 계산. insight-reporter-agent에 통계 미반영 명시 |
| 네이버 쿠키 만료 | `partial` | 위와 동일. 사장님 재로그인 안내 WarningItem 추가 |
| DB 집계 실패 | `failed` | 전체 실패 반환 |
| 신규 매장 (리뷰 0건, 사진 0건) | `success` | 데이터 부족 안내 WarningItem 포함, health_score: null |
| 이전 기간 데이터 없음 (delta 계산 불가) | `success` | delta 관련 필드 null, delta 기반 warning 미발행 |

---

## 제약 사항

- **네이버 전용 통계**: 노출수/클릭수는 현재 네이버 플레이스만 제공. 배민·쿠팡이츠의 유사 통계는 향후 플랫폼 협의 후 추가.
- **통계 없어도 동작**: 네이버 통계 수집 실패가 리포트 전체를 막아서는 안 된다. DB 기반 지표만으로도 의미 있는 점수와 경고를 생성한다.
- **경쟁 매장 비교는 Agency 플랜만**: 추가 스크래핑 부하가 있으므로 플랜 확인 후 조건부 실행.
- **차단 우회 자동화 금지**: 네이버 통계 페이지 차단 시 `partial` 반환. 우회 시도 금지.
