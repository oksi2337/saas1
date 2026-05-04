# crisis-detector-agent

## 역할 요약

⭐1~2점 리뷰를 감지하고 상황을 분류한 뒤, 사장님에게 즉시 카카오톡 알림을 보낸다. 상황에 따라 삭제 요청 가능 여부를 판단하고, 상황별 대응 가이드를 함께 제공한다. 빠른 대응이 핵심이므로 수집 완료 즉시 실행된다.

---

## 책임 (Responsibility)

### 담당한다
- **위기 리뷰 필터링**: 전달받은 리뷰 목록에서 ⭐1~2점만 추출
- **상황 분류**: `sentiment-classification-skill`로 위기 유형 분류 (음식 / 배달 / 응대 / 블랙컨슈머)
- **삭제 요청 가능 여부 판단**: 분류 결과 + 플랫폼 정책 기준으로 자동 판단
- **즉시 카카오톡 알림**: 분류 결과 + 대응 가이드 + 삭제 가능 여부 포함하여 사장님에게 즉시 발송
- **위기 리뷰 DB 기록**: `crisis_alerts` 테이블에 감지 이력 저장
- **답글 초안 생성 요청**: 위기 유형별 특수 톤의 답글 초안을 `reply-generation-skill`로 생성하여 컨펌 대기열 등록

### 담당하지 않는다
- ⭐3점 이상 리뷰 처리 → `reply-drafter-agent`
- 리뷰 수집 → `review-collector-agent`
- 플랫폼에 삭제 요청 직접 발송 → 사장님 컨펌 후 별도 처리 (이 agent의 범위 밖)
- 주간/월간 리포트 → `insight-reporter-agent`

---

## 트리거 조건 (Triggers)

독립 스케줄 없음. organizer-agent가 `collection.completed` 이벤트 수신 시 `reply-drafter-agent`와 동시에 호출된다.

| 호출 조건 | 비고 |
|---|---|
| `new_review_count > 0`인 `collection.completed` 이벤트 | 전달받은 리뷰 중 ⭐1~2점이 없으면 즉시 정상 종료 |

---

## 입력 (Input)

organizer-agent가 전달하는 위기 감지 요청.

```json
{
  "task": "detect_crisis",
  "store_id": "store_abc123",
  "review_ids": ["rv_001", "rv_002", "rv_003"]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `store_id` | string | 대상 매장 ID |
| `review_ids` | string[] | 신규 수집된 전체 리뷰 ID (필터링은 agent 내부에서) |

agent 내부에서 `review_ids`로 DB 조회 후 `rating <= 2`인 리뷰만 처리한다.

---

## 출력 (Output)

### 1. DB 적재 — CrisisAlert 스키마

```typescript
interface CrisisAlert {
  id: string;
  store_id: string;
  review_id: string;
  platform: "naver" | "baemin" | "coupangeats" | "kakaomap" | "google";
  rating: 1 | 2;
  crisis_type: "food" | "delivery" | "service" | "blackconsumer" | "unknown";
  deletion_eligible: boolean;          // 삭제 요청 가능 여부
  deletion_reason: string | null;      // 삭제 가능 사유 (예: "허위 사실 포함")
  alert_sent_at: string;               // 카톡 알림 발송 시각
  status: "alerted" | "replied" | "deletion_requested" | "resolved";
  created_at: string;
}
```

### 2. 카카오톡 즉시 알림 → `kakao-alert-skill`

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "crisis_alert",
  "content": {
    "store_name": "맛있는 식당",
    "platform": "naver",
    "rating": 1,
    "review_snippet": "음식이 너무 짰어요. 다시는 안 올게요.",
    "crisis_type": "food",
    "crisis_label": "음식 품질 문제",
    "response_guide": "음식 간에 대한 불만입니다. 진심 어린 사과와 함께 개선 의지를 답글로 표현하는 것이 효과적입니다.",
    "deletion_eligible": false,
    "deletion_reason": null,
    "draft_ready": true,
    "action_url": "https://app.example.com/crisis/alert_id_001"
  }
}
```

> 삭제 가능 케이스 예시:
> ```json
> {
>   "deletion_eligible": true,
>   "deletion_reason": "허위 사실 포함 (방문 기록 없음)",
>   "deletion_guide": "네이버 고객센터 → 리뷰 신고 → '사실과 다른 내용' 선택"
> }
> ```

### 3. 위기 답글 초안 → `pending_replies` 테이블

`reply-generation-skill`로 위기 전용 톤(공감 + 사과 + 개선 의지)의 초안을 생성하여 `pending_replies`에 INSERT. `crisis_alert_id`를 외래키로 연결.

```typescript
// PendingReply에 위기 전용 필드 추가
{
  ...PendingReply,
  is_crisis_reply: true,
  crisis_alert_id: "alert_id_001",
  crisis_type: "food"
}
```

---

## 사용하는 Skill

| Skill | 호출 시점 | 비고 |
|---|---|---|
| `sentiment-classification-skill` | ⭐1~2점 리뷰 상황 분류 시 | 위기 유형 + 삭제 가능 여부 판단 |
| `reply-generation-skill` | 위기 전용 답글 초안 생성 시 | 일반 답글과 다른 프롬프트 (공감/사과 톤 강조) |
| `kakao-alert-skill` | 분류 완료 즉시 | 지연 없이 즉시 발송 |

---

## 호출하는 Agent

없음. skill만 호출하고 결과를 DB에 쓴 뒤 종료한다.

---

## 위기 유형 분류 기준

| 유형 | `crisis_type` | 판단 기준 | 대응 가이드 방향 |
|---|---|---|---|
| 음식 품질 | `food` | 맛/온도/위생/양 키워드 | 사과 + 품질 개선 의지 표명 |
| 배달 문제 | `delivery` | 배달 시간/포장/누락 키워드 | 사과 + 배달 파트너사 확인 안내 |
| 직원 응대 | `service` | 불친절/무시/말투 키워드 | 사과 + 내부 교육 약속 |
| 블랙컨슈머 의심 | `blackconsumer` | 협박성 표현 / 방문 기록 불일치 / 과도한 보상 요구 | 삭제 요청 우선 검토 + 신중한 답글 |
| 분류 불가 | `unknown` | 위 유형에 해당 없음 | 일반 사과 톤 초안 생성 |

---

## 삭제 요청 가능 여부 판단 기준

플랫폼별 정책 기준으로 판단. `sentiment-classification-skill`의 분류 결과와 조합.

| 삭제 가능 사유 | 조건 |
|---|---|
| 허위 사실 | 방문/주문 기록 없음 OR 사실과 명백히 다른 내용 |
| 비속어/혐오 표현 | 리뷰 본문에 욕설, 차별 표현 포함 |
| 광고성 리뷰 | 경쟁사 언급, 타 업체 홍보 |
| 개인정보 포함 | 직원 실명, 전화번호 등 |
| 블랙컨슈머 패턴 | `crisis_type: "blackconsumer"` + 보상 요구 표현 |

> 삭제 가능으로 판단해도 **자동 신고 요청 금지**. 사장님이 확인 후 직접 신고.

---

## 처리 흐름

```
organizer-agent → detect_crisis 요청 수신
        │
        ▼
review_ids로 DB 조회 → rating <= 2 필터링
        │
        ├── 해당 없음 → 정상 종료 (organizer에 별도 신호 없음)
        │
        └── 위기 리뷰 있음 → 리뷰별 순차 처리:
              │
              ▼
        sentiment-classification-skill 호출
        → crisis_type, deletion_eligible, deletion_reason 반환
              │
              ▼
        reply-generation-skill 호출 (위기 전용 프롬프트)
        → 답글 초안 생성
              │
              ▼
        CrisisAlert DB INSERT
        PendingReply DB INSERT (crisis 플래그 포함)
              │
              ▼
        kakao-alert-skill 호출 (즉시 발송)
```

---

## 오류 처리

| 케이스 | 처리 |
|---|---|
| `sentiment-classification-skill` 실패 | `crisis_type: "unknown"`으로 처리하고 알림은 정상 발송. 분류 없이 일반 사과 초안 생성 |
| `reply-generation-skill` 실패 | 초안 없이 알림만 발송. `draft_ready: false`로 메시지 구성 |
| `kakao-alert-skill` 실패 | `CrisisAlert.status`를 `alert_failed`로 저장, 재시도 큐 등록. 위기 알림은 최우선이므로 최대 5회 재시도 (일반 알림은 3회) |
| 동일 리뷰 중복 감지 | `(store_id, review_id)` 유니크 제약으로 INSERT 무시 |
| 여러 위기 리뷰 동시 발생 | 리뷰별 알림을 개별 발송하지 않고 하나의 메시지에 묶어서 발송 (알림 폭탄 방지, 최대 5개까지 묶음, 초과 시 "+N개 더" 표시) |

---

## 제약 사항

- **삭제 자동 신고 금지**: 삭제 가능으로 판단해도 플랫폼에 자동으로 신고 요청을 보내지 않는다. 사장님이 가이드를 보고 직접 신고.
- **답글 자동 발행 금지**: 위기 답글 초안도 `pending` 상태로만 등록. 발행은 사장님 컨펌 필수.
- **⭐3점 이상 처리 금지**: 일반 리뷰는 `reply-drafter-agent` 담당. 중복 처리 방지.
- **알림 묶음 처리**: 같은 수집 배치에서 위기 리뷰가 여러 개일 때 알림을 각각 보내면 사장님이 알림 폭탄을 받는다. 배치 단위로 묶어 1건 발송.
