# reply-drafter-agent

## 역할 요약

신규 리뷰에 대한 답글 초안을 생성하고, 사장님 컨펌 대기열에 등록한다. 사장님의 과거 답글 톤을 학습하여 "사장님이 쓴 것 같은" 초안을 만드는 것이 핵심 목표다. 초안 생성 후 다양성 검증을 통과해야 대기열에 등록되며, 발행은 절대 자동으로 하지 않는다.

---

## 책임 (Responsibility)

### 담당한다
- **톤 로딩**: 매장별 톤 프로필(`tone-learning-skill` 결과물)을 DB에서 조회
- **초안 생성**: `reply-generation-skill`을 호출하여 리뷰별 답글 초안 생성
- **다양성 검증**: 최근 N개 답글과 유사도 비교 — 임계값 초과 시 재생성 (최대 3회)
- **컨펌 대기열 등록**: 검증 통과한 초안을 `pending_replies` 테이블에 INSERT
- **카카오톡 알림**: 초안이 준비됐음을 사장님에게 알림 (`kakao-alert-skill` 호출)
- **톤 미학습 처리**: 톤 프로필이 없는 매장은 기본 톤으로 생성 + 사장님에게 톤 학습 안내

### 담당하지 않는다
- 답글 발행 → 사장님 컨펌 이후 별도 처리 (이 agent의 책임 밖)
- 위기 리뷰(⭐1~2점) 대응 → `crisis-detector-agent`가 별도로 처리
- 톤 학습 실행 → `tone-learning-skill` (이 agent는 결과물만 읽음)
- 리뷰 수집 → `review-collector-agent`

---

## 트리거 조건 (Triggers)

독립 스케줄 없음. organizer-agent가 `collection.completed` 이벤트를 받고 호출한다.

| 호출 조건 | 비고 |
|---|---|
| `new_review_count > 0` 인 `collection.completed` 이벤트 발생 | crisis-detector-agent와 동시 호출 |
| ⭐3~5점 리뷰에 한해 초안 생성 | ⭐1~2점은 crisis-detector가 별도 처리하므로 여기선 스킵 |

> ⭐1~2점 리뷰는 위기 대응 흐름(`crisis-detector-agent`)이 담당하므로 이 agent는 **⭐3점 이상 리뷰만** 처리한다.

---

## 입력 (Input)

organizer-agent가 전달하는 답글 초안 생성 요청.

```json
{
  "task": "draft_replies",
  "store_id": "store_abc123",
  "review_ids": ["rv_001", "rv_002", "rv_003"]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `store_id` | string | 대상 매장 ID |
| `review_ids` | string[] | 초안을 생성할 리뷰 ID 목록 (신규 리뷰만) |

agent 내부에서 `review_ids`로 DB 조회하여 리뷰 상세 내용을 가져온다.

---

## 출력 (Output)

### 1. DB 적재 — Reply 초안 스키마

```typescript
interface PendingReply {
  id: string;                         // 내부 UUID
  store_id: string;
  review_id: string;
  draft_content: string;              // 생성된 답글 초안
  generation_attempt: number;         // 몇 번째 시도에서 다양성 통과했는지
  diversity_score: number;            // 최근 답글과의 최대 유사도 (0.0~1.0)
  tone_profile_id: string | null;     // 사용된 톤 프로필 ID (없으면 null = 기본 톤)
  status: "pending" | "approved" | "rejected" | "edited";
  created_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;        // 사장님 user_id
  final_content: string | null;       // 사장님이 수정한 경우 최종 내용
}
```

### 2. 카카오톡 알림 → `kakao-alert-skill`

초안 등록 완료 시 사장님에게 알림.

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "draft_ready",
  "content": {
    "store_name": "맛있는 식당",
    "new_draft_count": 3,
    "dashboard_url": "https://app.example.com/inbox/store_abc123"
  }
}
```

### 3. 톤 학습 안내 알림 (톤 프로필 미존재 시)

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "tone_setup_required",
  "content": {
    "store_name": "맛있는 식당",
    "message": "답글 톤 학습이 되어 있지 않아 기본 톤으로 초안을 생성했습니다. 과거 답글 5개를 등록하시면 사장님 스타일에 맞는 초안을 만들어 드립니다.",
    "setup_url": "https://app.example.com/tone-setup/store_abc123"
  }
}
```

---

## 사용하는 Skill

| Skill | 호출 시점 | 비고 |
|---|---|---|
| `tone-learning-skill` | 매장 톤 프로필 조회 시 | 결과물(tone_profile)을 읽기만 함. 학습 실행은 사장님이 직접 트리거 |
| `reply-generation-skill` | 리뷰별 초안 생성 시 | 다양성 검증 실패 시 최대 3회까지 재호출 |
| `kakao-alert-skill` | 초안 등록 완료 시 / 톤 학습 안내 시 | |

---

## 호출하는 Agent

없음. skill만 호출하고 결과를 DB에 쓴 뒤 종료한다.

---

## 처리 흐름

```
organizer-agent → draft_replies 요청 수신
        │
        ▼
review_ids로 DB 조회 → 리뷰 상세 가져오기
        │
        ▼
rating 필터: ⭐1~2점 리뷰 제외 (crisis-detector 담당)
        │
        ▼
매장 톤 프로필 조회 (tone-learning-skill)
 ├── 프로필 있음 → 해당 tone_profile 사용
 └── 프로필 없음 → 기본 톤 사용 + 나중에 setup 안내 플래그 세팅
        │
        ▼
리뷰별 순차 처리:
  ┌──────────────────────────────┐
  │ reply-generation-skill 호출  │
  │   └── 초안 생성 (attempt 1)  │
  │            │                 │
  │            ▼                 │
  │   다양성 검증                │
  │   (최근 20개 답글과 유사도)  │
  │    ├── 통과(< 0.7) → 등록    │
  │    └── 실패(≥ 0.7) → 재생성  │
  │         (최대 attempt 3)     │
  │         3회 모두 실패 → 마지막│
  │         초안 그대로 등록     │
  │         (diversity_score 표시)│
  └──────────────────────────────┘
        │
        ▼
통과한 초안을 pending_replies 테이블에 INSERT
        │
        ▼
카카오톡 알림 발송 (draft_ready)
        │
        └── 톤 프로필 없었으면 tone_setup_required 알림도 발송
```

---

## 다양성 검증 상세

| 항목 | 기준 |
|---|---|
| 비교 대상 | 해당 매장의 최근 20개 `approved` 답글 |
| 유사도 측정 | 코사인 유사도 (문장 임베딩 기반) |
| 통과 기준 | 모든 비교 대상과의 유사도 < 0.70 |
| 재생성 시 지시 | `reply-generation-skill`에 "이전 초안과 다른 표현, 다른 문장 구조 사용" 명시 |
| 최대 재시도 | 3회. 3회 후에도 실패 시 `diversity_score`를 초안과 함께 저장하고 사장님이 대시보드에서 확인 가능하게 표시 |
| 최근 답글 없음 | 비교 대상이 없으면 다양성 검증 스킵 (통과 처리) |

---

## 오류 처리

| 케이스 | 처리 |
|---|---|
| `reply-generation-skill` 호출 실패 | 해당 리뷰 스킵, 나머지 리뷰 계속 처리. 실패 리뷰는 `draft_failed` 상태로 DB 기록 |
| 톤 프로필 DB 조회 실패 | 기본 톤으로 폴백, 오류 로그 기록 |
| `kakao-alert-skill` 실패 | 알림 실패는 초안 등록을 막지 않는다. 알림 재시도 큐에 등록 |
| 모든 리뷰가 ⭐1~2점으로 필터링된 경우 | 처리할 리뷰 없음으로 정상 종료 (organizer에 별도 신호 없음) |
| `pending_replies` INSERT 중복 | `(store_id, review_id)` 유니크 제약으로 무시 (이미 초안 있는 리뷰는 재생성 안 함) |

---

## 제약 사항

- **답글 자동 발행 절대 금지**: 이 agent는 `pending` 상태의 초안만 생성한다. 발행(`approved` → 플랫폼 POST) 트리거는 사장님 컨펌 액션으로만 발생하며, 이 agent의 책임 범위 밖이다.
- **⭐1~2점 리뷰 처리 금지**: 위기 리뷰는 crisis-detector-agent가 전담한다. 두 agent가 같은 리뷰에 중복 대응하지 않도록 rating 필터를 강제한다.
- **기존 초안 재생성 금지**: `pending_replies`에 이미 초안이 있는 리뷰는 다시 생성하지 않는다. 사장님이 명시적으로 "재생성" 버튼을 누른 경우만 예외.
