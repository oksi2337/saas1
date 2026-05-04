# excel-report-skill

## 역할 요약

월간(또는 주간 Pro+) 인사이트 데이터를 받아 사장님용 Excel 파일을 생성하고 스토리지에 업로드한 뒤 다운로드 URL을 반환한다. `insight-reporter-agent`가 단독으로 사용한다.

---

## 입력 명세

```typescript
interface ExcelReportInput {
  store_id: string;
  store_name: string;
  report_type: "weekly" | "monthly";
  period_start: string;    // "2026-04-01"
  period_end: string;      // "2026-04-30"

  health: {
    score: number | null;
    score_delta: number | null;
    score_label: string;
    metrics: HealthMetrics;          // place-health-score-skill 출력 그대로
    warning_items: WarningItem[];
  };

  reviews: {
    total_count: number;
    avg_rating: number | null;
    avg_rating_delta: number | null;
    by_platform: PlatformSummary[];
    by_rating: RatingSummary[];
    top_positive_keywords: KeywordCount[];
    top_negative_keywords: KeywordCount[];
    menu_insights: MenuInsight[];
    unanswered_count: number;
  };
}

interface PlatformSummary {
  platform: string;
  review_count: number;
  avg_rating: number | null;
}

interface RatingSummary {
  rating: number;    // 1~5
  count: number;
}

interface KeywordCount {
  keyword: string;
  count: number;
}

interface MenuInsight {
  menu: string;
  mention_count: number;
  negative_count: number;
  suggestion: string;
}
```

입력 예시 (일부):

```json
{
  "store_id": "store_abc123",
  "store_name": "맛있는 한식당",
  "report_type": "monthly",
  "period_start": "2026-04-01",
  "period_end": "2026-04-30",
  "health": {
    "score": 72,
    "score_delta": 3,
    "score_label": "양호",
    "metrics": { "impression_count": 5200, "click_rate": 0.071, "days_since_last_photo": 5 },
    "warning_items": []
  },
  "reviews": {
    "total_count": 47,
    "avg_rating": 4.2,
    "avg_rating_delta": 0.1,
    "by_platform": [
      { "platform": "naver", "review_count": 31, "avg_rating": 4.3 },
      { "platform": "baemin", "review_count": 16, "avg_rating": 4.0 }
    ],
    "by_rating": [
      { "rating": 5, "count": 22 },
      { "rating": 4, "count": 18 },
      { "rating": 3, "count": 4 },
      { "rating": 2, "count": 2 },
      { "rating": 1, "count": 1 }
    ],
    "top_positive_keywords": [
      { "keyword": "친절", "count": 14 },
      { "keyword": "맛있어요", "count": 11 }
    ],
    "top_negative_keywords": [
      { "keyword": "짜다", "count": 4 },
      { "keyword": "대기 시간", "count": 3 }
    ],
    "menu_insights": [
      {
        "menu": "김치찌개",
        "mention_count": 12,
        "negative_count": 4,
        "suggestion": "짜다는 리뷰 4건 → 간 조정 검토"
      }
    ],
    "unanswered_count": 3
  }
}
```

---

## 출력 명세

성공 시:

```typescript
interface ExcelReportOutput {
  status: "success";
  file_url: string;          // 스토리지 다운로드 URL (유효기간 7일)
  file_name: string;         // 예: "맛있는한식당_2026년4월_리포트.xlsx"
  file_size_bytes: number;
}
```

실패 시:

```typescript
interface ExcelReportError {
  status: "failed";
  error_message: string;
  file_url: null;
}
```

출력 예시:

```json
{
  "status": "success",
  "file_url": "https://storage.example.com/reports/store_abc123_2026-04.xlsx?token=...",
  "file_name": "맛있는한식당_2026년4월_리포트.xlsx",
  "file_size_bytes": 48320
}
```

---

## Excel 파일 구성 (시트 목록)

| 시트명 | 내용 |
|---|---|
| `요약` | 헬스 스코어, 총 리뷰 수, 평균 별점, 주요 경고 항목 — 1페이지 한눈에 |
| `리뷰 현황` | 플랫폼별/별점별 분포 표 + 막대 차트 |
| `키워드 분석` | 긍정/부정 키워드 빈도 표 + 워드클라우드 대체 순위 목록 |
| `메뉴 인사이트` | 메뉴별 언급 수, 부정 언급 수, 개선 제안 |
| `플레이스 지표` | 노출수, 클릭수, 클릭률 주간 추이 표 (네이버 통계 있을 때만) |
| `전체 리뷰 목록` | 기간 내 수집된 전체 리뷰 (날짜, 플랫폼, 별점, 내용, 답글 여부) |

---

## 처리 로직

```
1. 입력 검증
   - 필수 필드 존재 확인
   - period_start < period_end 확인

2. ExcelJS로 워크북 생성
   - 각 시트 순서대로 생성
   - 한국어 폰트 (맑은 고딕) 지정
   - 헤더 행: 배경색 진한 녹색, 폰트 흰색, 볼드

3. 요약 시트
   - 상단: 매장명, 기간, 생성일
   - 헬스 스코어 셀: 점수에 따라 색상 조건부 서식
     (우수=초록, 양호=연초록, 보통=노랑, 주의=주황, 위험=빨강)
   - 경고 항목 목록

4. 리뷰 현황 시트
   - 플랫폼별 테이블
   - 별점 분포 테이블 + 내장 막대 차트

5. 키워드 분석 시트
   - 긍정 Top 10 / 부정 Top 10 나란히 배치

6. 메뉴 인사이트 시트
   - 부정 언급 3회 이상 메뉴 강조 (배경색 연노랑)

7. 플레이스 지표 시트
   - 네이버 통계 없으면 시트 생성하되 "이번 기간 통계 수집 불가" 메시지

8. 전체 리뷰 목록 시트
   - DB에서 기간 내 전체 리뷰 조회하여 행으로 출력
   - 별점 1~2는 행 배경색 연분홍으로 강조

9. 파일 버퍼로 직렬화 → 스토리지 업로드
   - 파일명: {store_name}_{YYYY년M월}_리포트.xlsx
   - URL 유효기간: 7일

10. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| `exceljs` | Excel 파일 생성 | 차트, 조건부 서식, 한국어 폰트 지원 |
| Vercel Blob / S3 | 생성된 파일 업로드 | 파일을 직접 카톡에 첨부하기 위해 URL 필요 |
| 내부 DB | 전체 리뷰 목록 조회 (리뷰 시트) | |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 스토리지 업로드 실패 | `failed` | 로컬 파일 생성은 성공했어도 URL 없으면 `failed` 반환 |
| 전체 리뷰 DB 조회 실패 | `success` (부분) | 리뷰 목록 시트 제외하고 나머지 시트만으로 생성 |
| `reviews.total_count: 0` | `success` | "이번 기간 리뷰 없음" 메시지 포함한 파일 생성 |
| 네이버 통계 없음 (`metrics.impression_count: null`) | `success` | 플레이스 지표 시트에 "통계 수집 불가" 표시 후 나머지 시트 정상 생성 |

---

## 제약 사항

- **읽기 전용 데이터만 사용**: 이 skill은 DB에 쓰지 않는다. 파일 생성 + 스토리지 업로드만 담당.
- **파일 보존 기간**: 스토리지 URL 유효기간 7일. 사장님이 다운로드하지 않아도 insight-reporter-agent가 DB에 `excel_file_url`을 보관하므로 재발급 가능.
- **차트는 기본 내장 차트만**: 외부 차트 라이브러리 이미지 삽입은 서버 환경에서 불안정하므로 ExcelJS 내장 차트(막대, 선)만 사용.
