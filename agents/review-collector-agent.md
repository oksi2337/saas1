# review-collector-agent

## 역할 요약

5개 플랫폼(네이버, 배민, 쿠팡이츠, 카카오맵, 구글맵)에서 신규 리뷰를 수집하고, 중복을 제거한 뒤 표준 스키마로 변환하여 DB에 적재한다. 수집 완료 후 organizer-agent에 신호를 보낸다. 직접 스케줄을 갖지 않으며, 항상 organizer-agent의 호출로 실행된다.

---

## 책임 (Responsibility)

### 담당한다
- **스크래퍼 호출**: 매장별 활성 플랫폼 목록을 확인하고 해당 스크래퍼 skill 호출
- **증분 수집**: 매장별 플랫폼별 `last_collected_at` 이후 신규 리뷰만 가져옴
- **중복 제거**: `(store_id, platform, platform_review_id)` 복합키로 이미 DB에 있는 리뷰 스킵
- **표준 스키마 변환**: 플랫폼마다 다른 응답 구조를 통일된 `Review` 스키마로 정규화
- **DB 적재**: 신규 리뷰 INSERT, 이미 답글이 달린 리뷰는 `replied: true`로 업데이트
- **수집 완료 신호**: organizer-agent에 `collection.completed` 이벤트 전송
- **플랫폼별 상태 기록**: 수집 성공/실패 결과를 `CollectionLog`에 기록

### 담당하지 않는다
- 리뷰 감성 분석 → `crisis-detector-agent` + `sentiment-classification-skill`
- 답글 초안 생성 → `reply-drafter-agent`
- 리포트 생성 → `insight-reporter-agent`
- 크롤링 차단 우회 자동화 (차단 감지 시 실패로 처리하고 OAuth 안내만)

---

## 트리거 조건 (Triggers)

이 agent는 독립 스케줄을 갖지 않는다. 아래 경우에만 organizer-agent로부터 호출된다.

| 호출 사유 | 전달되는 `priority` |
|---|---|
| 정기 수집 (1시간 주기 스케줄) | `normal` |
| 매장 신규 등록 직후 초기 수집 | `high` |
| 사장님 또는 운영자 수동 요청 | `high` |

---

## 입력 (Input)

organizer-agent가 전달하는 수집 작업 명세.

```json
{
  "task": "collect_reviews",
  "store_id": "store_abc123",
  "platforms": ["naver", "baemin"],
  "priority": "normal | high",
  "scheduled_at": "2026-05-04T10:00:00+09:00"
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `store_id` | string | 수집 대상 매장 ID |
| `platforms` | string[] | 수집할 플랫폼 목록 (매장별 구독 플랜에 따라 다름) |
| `priority` | `normal \| high` | `high`이면 재시도 대기 없이 즉시 실행 |
| `scheduled_at` | ISO 8601 | 작업이 예약된 시각 (로그용) |

---

## 출력 (Output)

### 1. DB 적재 — Review 표준 스키마

플랫폼별 원본을 아래 스키마로 변환하여 `reviews` 테이블에 INSERT.

```typescript
interface Review {
  id: string;                        // 내부 UUID
  store_id: string;
  platform: "naver" | "baemin" | "coupangeats" | "kakaomap" | "google";
  platform_review_id: string;        // 플랫폼 원본 ID (중복 방지 키)
  author_name: string;
  rating: 1 | 2 | 3 | 4 | 5;
  content: string;
  image_urls: string[];              // 리뷰 첨부 사진
  replied: boolean;
  reply_content: string | null;      // 이미 답글 있으면 수집
  reviewed_at: string;               // 리뷰 작성 시각 (ISO 8601)
  collected_at: string;              // 수집 시각 (ISO 8601)
}
```

> **중복 처리**: `(store_id, platform, platform_review_id)` 복합 유니크 제약. 이미 존재하면 INSERT 스킵, 단 `replied` 상태가 바뀐 경우 UPDATE.

### 2. 수집 완료 신호 → organizer-agent

```json
{
  "event": "collection.completed",
  "store_id": "store_abc123",
  "platform": "naver",
  "new_review_count": 3,
  "new_review_ids": ["rv_001", "rv_002", "rv_003"],
  "collected_at": "2026-05-04T10:00:00+09:00"
}
```

플랫폼별로 신호를 분리해 전송한다. `new_review_count: 0`이면 신호를 보내지 않는다 (organizer가 불필요한 작업을 트리거하지 않도록).

### 3. 수집 로그 — CollectionLog 스키마

```typescript
interface CollectionLog {
  id: string;
  store_id: string;
  platform: string;
  status: "success" | "failed" | "blocked";
  new_review_count: number;
  error_message: string | null;     // 실패 시 원인
  started_at: string;
  finished_at: string;
}
```

---

## 사용하는 Skill

| Skill | 호출 조건 |
|---|---|
| `naver-place-scraper-skill` | `platforms`에 `"naver"` 포함 시 |
| `baemin-scraper-skill` | `platforms`에 `"baemin"` 포함 시 |
| `coupangeats-scraper-skill` | `platforms`에 `"coupangeats"` 포함 시 |
| `kakaomap-scraper-skill` | `platforms`에 `"kakaomap"` 포함 시 |
| `google-maps-scraper-skill` | `platforms`에 `"google"` 포함 시 |

각 스크래퍼 skill은 병렬 호출한다. 한 플랫폼 실패가 다른 플랫폼 수집을 막지 않는다.

---

## 호출하는 Agent

없음. 이 agent는 skill만 호출하고 결과를 organizer-agent에게 신호로 반환한다.

---

## 처리 흐름

```
organizer-agent → collect_reviews 작업 수신
        │
        ▼
매장의 활성 플랫폼 목록 조회 (DB: store.platforms)
        │
        ▼
플랫폼별 스크래퍼 skill 병렬 호출
 ├── naver-place-scraper-skill (last_collected_at 이후)
 ├── baemin-scraper-skill
 └── ...
        │
        ▼
각 skill 응답 수신 (성공 / 실패 / 차단)
        │
        ├─ 성공 → 표준 스키마 변환 → 중복 제거 → DB INSERT
        │
        └─ 실패/차단 → CollectionLog에 기록 → organizer에 agent.failed 신호
        │
        ▼
신규 리뷰 있는 플랫폼만 collection.completed 신호 전송 → organizer-agent
```

---

## 오류 처리

| 케이스 | 처리 |
|---|---|
| 스크래퍼 타임아웃 (30초 초과) | 해당 플랫폼 실패 처리, 나머지 계속 진행 |
| HTTP 403 / 차단 감지 | `status: "blocked"`으로 CollectionLog 기록, organizer에 `agent.failed` 신호 전송. 우회 시도 금지 |
| 인증 만료 (쿠키/세션 무효) | `blocked`로 처리 + 사장님 OAuth 재연동 안내 (kakao-alert-skill은 organizer가 호출) |
| 플랫폼 응답 스키마 변경 (파싱 실패) | 해당 플랫폼 실패 처리 + `error_message`에 파싱 오류 상세 기록 |
| DB INSERT 실패 | 트랜잭션 롤백, organizer에 `agent.failed` 신호 |
| 모든 플랫폼 실패 | organizer에 `agent.failed` 신호 전송 (organizer가 재시도 큐 관리) |

---

## 제약 사항

- **증분 수집만**: 전체 리뷰를 매번 긁지 않는다. `last_collected_at` 이후 신규 리뷰만 가져와 DB 부하와 스크래핑 탐지 위험을 줄인다.
- **차단 우회 자동화 금지**: 크롤링 차단 감지 시 헤더 변경, IP 우회, User-Agent 스푸핑 등을 자동 시도하지 않는다.
- **답글 발행 불가**: 수집 과정에서 플랫폼에 어떤 쓰기 요청도 보내지 않는다 (읽기 전용).
- **병렬 호출 상한**: 동시 스크래퍼 호출은 플랫폼 수(최대 5개) 이내. 단일 플랫폼에 대한 동시 요청은 1개.
