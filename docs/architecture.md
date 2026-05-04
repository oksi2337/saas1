# 시스템 아키텍처

## 전체 구조

```
┌─────────────────────────────────────────────────────────┐
│                  Organizer Agent                         │
│  (전체 조율 / 스케줄링 / agent 간 메시지 라우팅)          │
└──────┬───────────┬───────────┬───────────┬─────────────┘
       │           │           │           │
       ▼           ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Review   │ │ Reply    │ │ Crisis   │ │ Insight  │
│Collector │ │ Drafter  │ │ Detector │ │ Reporter │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │            │
     ▼            ▼            ▼            ▼
   [Skills 레이어 — 11개 스킬]
```

## Agent 역할 분담

### organizer-agent
- 모든 작업의 진입점
- 스케줄 관리 (수집 주기, 리포트 발송 시점)
- agent 간 메시지 큐 관리
- 매장 등록/해제 라이프사이클

### review-collector-agent
- 5개 플랫폼 신규 리뷰 수집
- 중복 제거, 표준 스키마로 변환
- DB 적재 후 organizer에 신호

### reply-drafter-agent
- 신규 리뷰 → 톤 학습 결과 기반 답글 초안 생성
- 다양성 검증 (이전 답글과 너무 비슷하면 재생성)
- 사장님 컨펌 대기열에 등록

### crisis-detector-agent
- ⭐1~2점 리뷰 실시간 감지
- 상황 분류 (음식 / 배달 / 응대 / 블랙)
- 카톡 알림 즉시 발송
- 삭제 요청 가능 여부 자동 판단

### insight-reporter-agent
- 주간 헬스 스코어 리포트 (월요일 9시)
- 월간 인사이트 리포트 (매월 1일)
- Excel 자동 생성 후 카톡으로 발송

## Skill 분류

### 수집 (5개)
- `naver-place-scraper-skill`
- `baemin-scraper-skill`
- `coupangeats-scraper-skill`
- `kakaomap-scraper-skill`
- `google-maps-scraper-skill`

### 분석/생성 (4개)
- `tone-learning-skill` — 사장님 과거 답글 5개로 톤 추출
- `reply-generation-skill` — 톤 기반 답글 생성 + 다양성 검증
- `sentiment-classification-skill` — 부정 리뷰 상황 분류
- `place-health-score-skill` — ★ 노출/클릭/사진 업데이트 종합 점수

### 출력 (2개)
- `excel-report-skill` — 월간 리포트 Excel 생성
- `kakao-alert-skill` — 카톡 비즈메시지 발송

## 의존 관계

> Phase A-4 검증 완료 기준. 원안 대비 3건 추가 반영.

```
organizer-agent
  ├─ kakao-alert-skill                 ← 시스템 오류 운영자 알림 (직접)
  │
  ├─ review-collector-agent
  │   ├─ naver-place-scraper-skill
  │   ├─ baemin-scraper-skill
  │   ├─ coupangeats-scraper-skill
  │   ├─ kakaomap-scraper-skill
  │   └─ google-maps-scraper-skill
  │
  ├─ reply-drafter-agent
  │   ├─ tone-learning-skill
  │   ├─ reply-generation-skill
  │   └─ kakao-alert-skill             ← 초안 준비 사장님 알림
  │
  ├─ crisis-detector-agent
  │   ├─ sentiment-classification-skill
  │   ├─ reply-generation-skill        ← 위기 답글 초안 생성
  │   └─ kakao-alert-skill             ← 위기 즉시 알림
  │
  └─ insight-reporter-agent
      ├─ place-health-score-skill
      ├─ excel-report-skill
      └─ kakao-alert-skill             ← 리포트 발송
```

## 데이터 흐름

```
[5개 플랫폼]
    │ (스크래핑 / OAuth API)
    ▼
[review-collector-agent]
    │ (표준화 / 중복제거)
    ▼
[Reviews DB] ──────────────┐
    │                      │
    ├──→ [reply-drafter]   │
    │       │              │
    │       ▼              │
    │   [Replies DB]       │
    │                      │
    ├──→ [crisis-detector] │
    │       │              │
    │       ▼              │
    │   [Kakao Alert]      │
    │                      │
    └──→ [insight-reporter]┘
            │
            ▼
        [Excel + Kakao]
```
