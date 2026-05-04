# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**Review SaaS** — 자영업자/소상공인을 위한 AI 리뷰 관리 솔루션.
월 100만원짜리 플레이스 운영대행을 월 5만원 SaaS로 대체하는 것이 목표.

자세한 기획은 `README.md`, 시스템 아키텍처는 `docs/architecture.md` 참고.

---

## 주요 명령어

```bash
# 개발
npm run dev               # src/index.ts 실행
npm run build             # TypeScript 컴파일
npm test                  # Jest 전체 테스트
npm test -- --testPathPattern=parser  # 단일 테스트 파일

# 스크래퍼 (단독 실행)
npm run scrape:naver      # 네이버 플레이스 스크래퍼
npm run scrape:baemin     # 배민 스크래퍼

# 에이전트 (단독 실행)
npm run collect -- <storeId> [naver,baemin]   # 리뷰 수집
npm run crisis -- <storeId>                   # 위기 감지
npm run draft -- <storeId>                    # 답글 초안 생성
npm run organizer                             # 1시간 스케줄러 시작
npm run report -- <storeId> weekly            # 주간 리포트 생성

# DB
npm run db:migrate        # 마이그레이션 실행 (drizzle-kit generate 후)
npm run db:generate       # Drizzle 마이그레이션 파일 생성
npm run db:seed           # 테스트 매장 시드 (SEED_NAVER_PLACE_ID 필요)
npm run db:studio         # Drizzle Studio 웹 UI

# 검증
npm run verify            # Week 1 E2E 파이프라인 검증 (DB+AI 필요)
```

**필수 환경변수** (`.env`):
```
DATABASE_URL=             # Neon PostgreSQL 연결 문자열
ANTHROPIC_API_KEY=        # Claude API (crisis-detector, reply-drafter에서 사용)
SEED_NAVER_PLACE_ID=      # db:seed용 네이버 플레이스 ID
SEED_NAVER_COOKIE=        # db:seed용 네이버 쿠키
KAKAO_API_KEY=            # 카카오 Bizm (없으면 콘솔 출력으로 대체)
APP_URL=                  # 리포트 링크 base URL (기본: https://app.example.com)
```

---

## 아키텍처

### 전체 흐름

```
organizer (스케줄러/이벤트 라우터)
  └─ 매 1시간 → review-collector
       └─ 수집 완료 이벤트 → [reply-drafter, crisis-detector] 병렬 실행
  └─ 매주 월 09:00 KST → insight-reporter (weekly)
  └─ 매월 1일 09:00 KST → insight-reporter (monthly)
```

### Agent → Skill 호출 그래프

| Agent | 사용하는 Skill |
|-------|---------------|
| review-collector | naver-place-scraper, baemin-scraper |
| reply-drafter | reply-generation, kakao-alert |
| crisis-detector | sentiment-classification, kakao-alert |
| insight-reporter | place-health-score, excel-report, kakao-alert |

### 파일 구조

```
src/
  agents/
    organizer/        index.ts (이벤트 핸들러), scheduler.ts, events.ts, run.ts
    review-collector/ index.ts, normalizer.ts, types.ts, run.ts
    reply-drafter/    index.ts, diversity.ts, types.ts, run.ts
    crisis-detector/  index.ts, types.ts, run.ts
    insight-reporter/ index.ts, types.ts, run.ts
  skills/
    naver-place-scraper/   index.ts, parser.ts, selectors.ts, run.ts
    baemin-scraper/        index.ts, parser.ts, selectors.ts, run.ts
    sentiment-classification/  index.ts   ← Claude API
    reply-generation/          index.ts   ← Claude API
    place-health-score/        index.ts   ← DB 기반 계산
    excel-report/              index.ts   ← ExcelJS, 6 시트
    kakao-alert/               index.ts   ← 스텁 (콘솔 출력)
  db/
    schema.ts   ← Drizzle 테이블 정의
    index.ts    ← db 인스턴스 export
    migrate.ts, seed.ts
  utils/
    delay.ts, date-parser.ts, cookie.ts
  types/review.ts
  verify.ts     ← 8단계 E2E 검증 스크립트
```

### 핵심 DB 테이블

- `users` — 사장님 계정 (plan: 'lite'|'pro'|'agency')
- `stores` — 매장 (status: 'active'|'inactive')
- `store_platforms` — 매장 × 플랫폼 (naver|baemin 등)
- `reviews` — 수집된 리뷰 (UNIQUE: storeId+platform+platformReviewId)
- `pending_replies` — AI 생성 답글 초안 (status: 'pending'|'approved'|'rejected')
- `crisis_alerts` — 위기 리뷰 알림 이력
- `health_scores` — 주/월별 헬스 스코어
- `reports` — 리포트 발송 이력
- `message_logs` — 카카오 알림 발송 이력

---

## 작업 방식

### 아키텍처 단위
**agent + skill 파일을 아키텍처 단위로 사용한다.**

- `agents/*.md` — 책임 단위. 무엇을 할지, 언제 할지, 누구를 부를지
- `skills/*.md` — 실행 단위. 구체적인 입출력과 처리 로직

코드를 짜기 전에 반드시 해당 agent/skill 파일을 먼저 확인하고, 정의된 책임 경계를 벗어나지 않게 작업한다. 새로운 책임이 필요하면 먼저 agent/skill 파일을 업데이트한 뒤에 코드를 작성한다.

### 진행 순서
**Phase A (아키텍처 정의) → Phase B (구현)** 순서로 진행한다. 현재 단계는 `docs/roadmap.md`에서 확인.

---

## 구현 패턴

### 중복 방지
- 리뷰 수집: `UNIQUE(storeId, platform, platformReviewId)` + `onConflictDoNothing()`
- 위기 알림: `UNIQUE(storeId, reviewId)` + `onConflictDoNothing()`
- 동시 수집: `organizer/index.ts`의 `runningCollections: Set<string>` (단일 프로세스 한정)

### AI 답글 다양성 검증
`reply-drafter/diversity.ts`: 문자 바이그램 TF cosine similarity
- 임계값: `DIVERSITY_THRESHOLD = 0.70` (0.70 이상이면 재생성)
- 최대 재시도: `MAX_ATTEMPTS = 3`
- 비교 대상: 최근 20개 approved 답글 + 같은 배치 내 생성된 초안

### Claude API 사용
- 모델: `claude-sonnet-4-6`
- sentiment-classification: JSON 모드 (`{is_crisis, crisis_type, deletion_eligible, urgency, summary}`)
- reply-generation: 재시도 시 temperature 상승 (0.80 → 0.85 → 0.90)
- 전화번호/URL 정규식으로 생성 결과 후처리

### 스텁 현황 (미완성)
| 기능 | 현재 상태 | 완성 조건 |
|------|----------|----------|
| 카카오 알림 | 콘솔 출력 (KAKAO_API_KEY 없으면) | 템플릿 승인 후 실제 API 연동 |
| 네이버 통계 (노출수) | 항상 `null` | Naver Partner Center API 또는 스크래핑 |
| Excel 저장소 | 로컬 `./reports/` | S3 또는 Vercel Blob 연동 |
| 헬스 스코어 | `status: 'partial'` | 노출수 데이터 확보 후 완성 |

---

## 핵심 컨벤션

- 답글은 **자동 발행 금지**, 항상 사장님 컨펌 거침 (네이버 2026 정책 대응)
- AI 답글 생성 시 **다양성 검증 필수** (이전 답글과 너무 비슷하면 재생성)
- 사장님 인터페이스는 **카카오톡 우선**, 웹 대시보드는 보조

---

## 금지 사항

1. **답글 자동 발행 기능을 만들지 않는다** — 사장님 컨펌 단계 반드시 거침
2. **5개 플랫폼을 동시에 구현하려 하지 않는다** — 1주차는 네이버 + 배민만
3. **크롤링 차단 시 우회 시도를 자동화하지 않는다** — 사장님 OAuth로 전환
