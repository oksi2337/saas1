# organizer-agent

## 역할 요약

전체 시스템의 진입점이자 조율자. 스케줄을 관리하고, 이벤트를 받아 적절한 하위 agent에게 작업을 위임하며, agent 간 메시지 흐름을 라우팅한다. 직접 비즈니스 로직을 실행하지 않는다.

---

## 책임 (Responsibility)

### 담당한다
- **스케줄 관리**: 리뷰 수집 주기(1시간), 주간 리포트(매주 월요일 09:00), 월간 리포트(매월 1일 09:00) 타이머 관리
- **매장 라이프사이클**: 매장 등록 시 파이프라인 초기화, 매장 해제 시 관련 작업 정리
- **이벤트 라우팅**: `review-collector-agent`가 수집 완료 신호를 보내면 `reply-drafter-agent`와 `crisis-detector-agent`에 동시 위임
- **시스템 오류 감시**: 하위 agent가 연속 3회 실패 시 카카오톡으로 운영자 알림 발송
- **중복 실행 방지**: 동일 매장에 대한 수집 작업이 이미 실행 중이면 새 작업 스킵

### 담당하지 않는다
- 실제 리뷰 데이터 파싱/저장 → `review-collector-agent`
- 답글 초안 생성 → `reply-drafter-agent`
- 위기 리뷰 판단 → `crisis-detector-agent`
- 리포트 생성 → `insight-reporter-agent`
- 직접 skill 호출 (단, 시스템 오류 알림 한정으로 `kakao-alert-skill` 직접 호출 허용)

---

## 트리거 조건 (Triggers)

### 스케줄 트리거

| 트리거 | 주기 | 동작 |
|---|---|---|
| `collect.all` | 매 1시간 | 활성 상태 모든 매장에 수집 작업 발행 |
| `report.weekly` | 매주 월요일 09:00 KST | `insight-reporter-agent`에 주간 리포트 요청 |
| `report.monthly` | 매월 1일 09:00 KST | `insight-reporter-agent`에 월간 리포트 요청 |

### 이벤트 트리거

| 이벤트 | 발생 시점 | 동작 |
|---|---|---|
| `store.registered` | 사장님이 새 매장 등록 | 매장 초기화 → 즉시 1회 수집 작업 발행 |
| `store.deactivated` | 매장 해제/구독 종료 | 해당 매장의 예약 작업 전부 취소 |
| `collection.completed` | `review-collector-agent` 수집 완료 신호 | 신규 리뷰가 있으면 `reply-drafter-agent` + `crisis-detector-agent` 동시 호출 |
| `agent.failed` | 하위 agent 작업 실패 | 재시도 큐에 등록 (최대 2회), 3회 실패 시 운영자 알림 |

### 수동 트리거

| 트리거 | 진입점 | 동작 |
|---|---|---|
| 카카오톡 `/수집` 명령 | 사장님 또는 운영자 | 특정 매장 즉시 수집 1회 실행 |
| 웹 대시보드 "지금 수집" 버튼 | 운영자 | 전체 또는 특정 매장 즉시 수집 |

---

## 입력 (Input)

### 1. 매장 등록 이벤트
```json
{
  "event": "store.registered",
  "store_id": "string",
  "store_name": "string",
  "owner_id": "string",
  "platforms": ["naver", "baemin"],
  "plan": "lite | pro | agency"
}
```

### 2. 수집 완료 신호 (`review-collector-agent` → organizer)
```json
{
  "event": "collection.completed",
  "store_id": "string",
  "platform": "naver | baemin | coupangeats | kakaomap | google",
  "new_review_count": 3,
  "new_review_ids": ["rv_001", "rv_002", "rv_003"],
  "collected_at": "2026-05-04T10:00:00+09:00"
}
```

### 3. Agent 실패 신호
```json
{
  "event": "agent.failed",
  "agent": "review-collector-agent",
  "store_id": "string",
  "attempt": 2,
  "error": "string",
  "failed_at": "2026-05-04T10:00:00+09:00"
}
```

### 4. 수동 명령 (카카오톡 / 웹)
```json
{
  "event": "manual.trigger",
  "command": "collect_now | report_now",
  "store_id": "string | null",
  "requested_by": "owner | operator"
}
```

---

## 출력 (Output)

### 1. 수집 작업 발행 → `review-collector-agent`
```json
{
  "task": "collect_reviews",
  "store_id": "string",
  "platforms": ["naver", "baemin"],
  "priority": "normal | high",
  "scheduled_at": "2026-05-04T10:00:00+09:00"
}
```

### 2. 답글 초안 요청 → `reply-drafter-agent`
```json
{
  "task": "draft_replies",
  "store_id": "string",
  "review_ids": ["rv_001", "rv_002", "rv_003"]
}
```

### 3. 위기 감지 요청 → `crisis-detector-agent`
```json
{
  "task": "detect_crisis",
  "store_id": "string",
  "review_ids": ["rv_001", "rv_002", "rv_003"]
}
```

### 4. 리포트 생성 요청 → `insight-reporter-agent`
```json
{
  "task": "generate_report",
  "store_id": "string | null",
  "report_type": "weekly | monthly",
  "period_start": "2026-04-28",
  "period_end": "2026-05-04"
}
```

### 5. 시스템 오류 알림 → `kakao-alert-skill` (직접)
```json
{
  "recipient": "operator",
  "message_type": "system_error",
  "content": {
    "agent": "review-collector-agent",
    "store_id": "string",
    "error_summary": "string",
    "failed_at": "2026-05-04T10:00:00+09:00"
  }
}
```

---

## 사용하는 Skill

| Skill | 사용 조건 |
|---|---|
| `kakao-alert-skill` | 하위 agent 3회 연속 실패 시 운영자 알림 한정 |

> 나머지 skill은 모두 하위 agent를 통해 간접 사용. organizer가 직접 호출하는 skill은 최소화한다.

---

## 호출하는 Agent

| Agent | 호출 시점 | 동기/비동기 |
|---|---|---|
| `review-collector-agent` | 스케줄 tick / 매장 등록 / 수동 트리거 | 비동기 (fire-and-forget) |
| `reply-drafter-agent` | `collection.completed` 이벤트, `new_review_count > 0` | 비동기 |
| `crisis-detector-agent` | `collection.completed` 이벤트, `new_review_count > 0` | 비동기 (reply-drafter와 동시) |
| `insight-reporter-agent` | 주간/월간 스케줄, `report_now` 수동 명령 | 비동기 |

---

## 상태 관리

organizer는 다음 상태를 DB에 유지한다.

| 상태 필드 | 타입 | 설명 |
|---|---|---|
| `store.status` | `active \| paused \| cancelled` | 매장 파이프라인 활성 여부 |
| `job.running_collection` | `Set<store_id>` | 현재 수집 중인 매장 목록 (중복 방지용) |
| `job.retry_count` | `Map<job_id, number>` | agent별 실패 재시도 횟수 |
| `schedule.last_collect` | `Map<store_id, timestamp>` | 매장별 마지막 수집 시각 |
| `schedule.next_collect` | `Map<store_id, timestamp>` | 다음 수집 예정 시각 |

---

## 오류 처리

| 케이스 | 처리 |
|---|---|
| 하위 agent 1~2회 실패 | 지수 백오프(5분, 15분)로 재시도 큐 등록 |
| 하위 agent 3회 실패 | 재시도 중단 + 운영자에게 카톡 알림 |
| 매장이 `cancelled` 상태인데 수집 트리거 | 작업 무시 (skip) |
| 동일 매장 수집이 이미 진행 중 | 새 트리거 무시 (중복 방지) |
| 스케줄러 자체 장애 | 재시작 후 마지막 수집 시각 기준으로 누락분 보완 수집 |

---

## 제약 사항

- **답글 자동 발행 금지**: organizer는 `reply-drafter-agent`에 "초안 생성"만 요청한다. 발행 명령은 반드시 사장님 컨펌 이후에만 가능하며, organizer가 직접 발행 트리거를 보내는 경우는 없다.
- **크롤링 차단 시 자동 우회 금지**: 수집 실패 시 재시도만 하고, OAuth 전환은 사장님이 직접 연동하도록 안내 메시지 발송에 그친다.
