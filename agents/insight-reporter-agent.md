# insight-reporter-agent

## 역할 요약

매주 월요일 주간 헬스 스코어 리포트를, 매월 1일 월간 인사이트 리포트를 생성하여 사장님에게 카카오톡으로 발송한다. 플레이스 노출·클릭 지표와 리뷰 데이터를 종합하여 "운영대행사 수준의 인사이트"를 자동으로 제공하는 것이 이 제품의 핵심 차별화 포인트다.

---

## 책임 (Responsibility)

### 담당한다
- **주간 헬스 스코어 산출**: `place-health-score-skill` 호출로 매장별 헬스 스코어 계산
- **이상 지표 감지**: 헬스 스코어 하락 / 사진 미업데이트 / 클릭률 급락 등 경고 항목 추출
- **월간 리뷰 분석**: 키워드 트렌드, 메뉴별 만족도, 긍정/부정 비율 집계
- **메뉴 개선 제안 생성**: 반복 부정 키워드 기반 구체적 액션 제안 (예: "김치찌개 짜다는 리뷰 4건 → 간 조정 검토")
- **Excel 리포트 생성**: `excel-report-skill` 호출로 사장님용 Excel 파일 생성
- **카카오톡 발송**: `kakao-alert-skill`로 리포트 요약 + Excel 파일 전송
- **리포트 이력 DB 기록**: `reports` 테이블에 발송 이력 저장

### 담당하지 않는다
- 리뷰 수집 → `review-collector-agent`
- 답글 초안 생성 → `reply-drafter-agent`
- 위기 리뷰 즉시 알림 → `crisis-detector-agent`
- 플레이스 지표 직접 수집 (노출수/클릭수 크롤링) → `place-health-score-skill` 내부 처리

---

## 트리거 조건 (Triggers)

### 스케줄 트리거 (organizer-agent가 호출)

| 리포트 종류 | 주기 | 발송 시각 |
|---|---|---|
| 주간 헬스 스코어 | 매주 월요일 | 09:00 KST |
| 월간 인사이트 | 매월 1일 | 09:00 KST |

### 수동 트리거

| 트리거 | 진입점 | 비고 |
|---|---|---|
| 웹 대시보드 "지금 리포트 발송" | 운영자 | 특정 매장 또는 전체 |
| 카카오톡 `/리포트` 명령 | 사장님 | 본인 매장 최신 리포트 재발송 |

---

## 입력 (Input)

organizer-agent가 전달하는 리포트 생성 요청.

```json
{
  "task": "generate_report",
  "store_id": "store_abc123",
  "report_type": "weekly | monthly",
  "period_start": "2026-04-28",
  "period_end": "2026-05-04"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `store_id` | string | 대상 매장 ID (`null`이면 활성 매장 전체) |
| `report_type` | `weekly \| monthly` | 리포트 종류 |
| `period_start` | date string | 집계 기간 시작 |
| `period_end` | date string | 집계 기간 종료 |

---

## 출력 (Output)

### 1. DB 적재 — Report 스키마

```typescript
interface Report {
  id: string;
  store_id: string;
  report_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  health_score: number | null;          // 주간 리포트 시 산출 (0~100)
  health_score_delta: number | null;    // 전주 대비 변화량
  warning_items: WarningItem[];         // 이상 지표 목록
  excel_file_url: string | null;        // 생성된 Excel 파일 URL
  sent_at: string | null;               // 카톡 발송 시각
  status: "generated" | "sent" | "failed";
  created_at: string;
}

interface WarningItem {
  type: "photo_stale" | "click_drop" | "score_drop" | "review_spike" | "unanswered_reviews";
  severity: "info" | "warning" | "critical";
  message: string;                      // 사장님용 한국어 메시지
  suggestion: string;                   // 구체적 액션 제안
}
```

### 2. 주간 헬스 스코어 카카오톡 메시지

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "weekly_report",
  "content": {
    "store_name": "맛있는 식당",
    "period": "4/28(월) ~ 5/4(일)",
    "health_score": 72,
    "health_score_delta": -5,
    "score_label": "보통",
    "warnings": [
      {
        "severity": "critical",
        "message": "2주째 신규 사진 없음 → 노출 하락 위험",
        "suggestion": "메뉴 또는 매장 내부 사진 1장 이상 업로드를 권장합니다."
      },
      {
        "severity": "warning",
        "message": "전화 클릭률 전주 대비 23% 하락",
        "suggestion": "전화번호가 최신 정보인지 확인해 주세요."
      }
    ],
    "unanswered_count": 5,
    "dashboard_url": "https://app.example.com/report/report_id_001"
  }
}
```

### 3. 월간 인사이트 카카오톡 메시지 + Excel 첨부

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "monthly_report",
  "content": {
    "store_name": "맛있는 식당",
    "period": "2026년 4월",
    "total_reviews": 47,
    "avg_rating": 4.2,
    "rating_delta": 0.1,
    "top_positive_keywords": ["친절", "맛있어요", "재방문"],
    "top_negative_keywords": ["짜다", "대기 시간"],
    "menu_insights": [
      {
        "menu": "김치찌개",
        "negative_count": 4,
        "suggestion": "짜다는 리뷰 4건 → 간 조정 검토"
      }
    ],
    "excel_file_url": "https://storage.example.com/reports/store_abc123_2026-04.xlsx",
    "dashboard_url": "https://app.example.com/report/report_id_002"
  }
}
```

---

## 사용하는 Skill

| Skill | 호출 시점 | 비고 |
|---|---|---|
| `place-health-score-skill` | 주간/월간 리포트 모두 | 헬스 스코어 + 이상 지표 반환 |
| `excel-report-skill` | 월간 리포트 시 필수 / 주간 리포트 시 선택 | 주간은 카톡 요약만으로 충분, Pro 플랜 이상은 주간도 Excel 생성 |
| `kakao-alert-skill` | 리포트 생성 완료 후 | Excel 파일 URL 포함하여 발송 |

---

## 호출하는 Agent

없음. skill만 호출하고 결과를 DB에 쓰고 발송 후 종료한다.

---

## 처리 흐름

### 주간 리포트

```
organizer-agent → generate_report (weekly) 요청 수신
        │
        ▼
place-health-score-skill 호출
→ health_score, health_score_delta, warning_items 반환
        │
        ▼
미답글 리뷰 수 집계 (DB 조회: pending_replies WHERE status = 'pending')
        │
        ▼
[Pro 플랜 이상] excel-report-skill 호출 → Excel 파일 생성
        │
        ▼
Report DB INSERT
        │
        ▼
kakao-alert-skill 호출 (weekly_report 메시지)
        │
        ▼
Report.status = "sent" 업데이트
```

### 월간 리포트

```
organizer-agent → generate_report (monthly) 요청 수신
        │
        ▼
place-health-score-skill 호출
→ health_score, 월간 지표 반환
        │
        ▼
월간 리뷰 데이터 집계 (DB 조회)
 ├── 총 리뷰 수, 평균 평점, 평점 변화
 ├── 긍정/부정 키워드 빈도 집계
 └── 메뉴별 부정 언급 집계
        │
        ▼
메뉴 개선 제안 생성
(부정 키워드 3회 이상 반복된 메뉴에 대해 구체적 액션 제안)
        │
        ▼
excel-report-skill 호출 → Excel 파일 생성 + 스토리지 업로드
        │
        ▼
Report DB INSERT
        │
        ▼
kakao-alert-skill 호출 (monthly_report 메시지 + Excel URL)
        │
        ▼
Report.status = "sent" 업데이트
```

---

## 플랜별 기능 차등

| 기능 | Lite | Pro | Agency |
|---|---|---|---|
| 주간 헬스 스코어 카톡 요약 | O | O | O |
| 주간 Excel 리포트 | X | O | O |
| 월간 인사이트 카톡 요약 | O | O | O |
| 월간 Excel 리포트 | X | O | O |
| 메뉴별 개선 제안 | X | O | O |
| 경쟁 매장 비교 지표 | X | X | O |

---

## 헬스 스코어 경고 임계값

| 경고 유형 | `severity` | 조건 |
|---|---|---|
| 사진 미업데이트 | `warning` | 14일 이상 신규 사진 없음 |
| 사진 심각 미업데이트 | `critical` | 30일 이상 신규 사진 없음 |
| 전화 클릭률 하락 | `warning` | 전주 대비 20% 이상 하락 |
| 헬스 스코어 하락 | `warning` | 전주 대비 10점 이상 하락 |
| 헬스 스코어 급락 | `critical` | 전주 대비 20점 이상 하락 또는 50점 미만 |
| 미답글 리뷰 누적 | `info` | 미답글 리뷰 5개 이상 |
| 미답글 리뷰 과다 | `warning` | 미답글 리뷰 10개 이상 |
| 부정 리뷰 급증 | `critical` | 최근 7일 ⭐1~2점 리뷰 3개 이상 |

---

## 오류 처리

| 케이스 | 처리 |
|---|---|
| `place-health-score-skill` 실패 | 헬스 스코어 없이 리뷰 요약만으로 리포트 구성, `health_score: null`로 발송 |
| `excel-report-skill` 실패 | Excel 없이 카톡 요약만 발송, `excel_file_url: null` 표시 |
| `kakao-alert-skill` 실패 | `Report.status = "failed"` 기록, 재시도 큐 등록 (최대 3회). 재시도 모두 실패 시 운영자 알림 |
| 대상 매장 데이터 부족 (신규 매장, 리뷰 0건) | 리포트 발송 스킵. "아직 수집된 데이터가 부족합니다" 메시지만 발송 |
| 스케줄 발송 시각에 이전 리포트가 아직 생성 중 | 중복 생성 방지: `(store_id, report_type, period_start)` 유니크 제약으로 INSERT 차단 |

---

## 제약 사항

- **답글 자동 발행 금지**: 리포트에 미답글 리뷰 알림이 포함되더라도, 이 agent가 답글을 발행하거나 `reply-drafter-agent`를 직접 호출하지 않는다. 사장님이 대시보드에서 직접 처리.
- **리포트 소급 생성 금지**: 누락된 과거 주차 리포트를 자동으로 소급 생성하지 않는다. 운영자 수동 요청이 있을 때만 생성.
- **경쟁 매장 비교는 Agency 플랜만**: 경쟁 매장 데이터 수집은 추가 스크래핑 부하를 유발하므로 플랜 확인 후 조건부 실행.
