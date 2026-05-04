# Phase A-4 의존 관계 검증

agent ↔ skill 매핑이 architecture.md 원안과 일치하는지 확인하고,
순환 참조·중복 책임 여부를 점검한다.

---

## 1. Agent → Skill 매핑 대조

### 원안(architecture.md) vs 실제 작성 결과

| Agent | 원안 | 실제 | 비고 |
|---|---|---|---|
| organizer-agent | (skill 없음) | `kakao-alert-skill` | **추가** — 시스템 오류 운영자 알림 |
| review-collector-agent | 5개 스크래퍼 | 5개 스크래퍼 | 일치 |
| reply-drafter-agent | `tone-learning-skill`, `reply-generation-skill` | 위 2개 + `kakao-alert-skill` | **추가** — "초안 준비" 사장님 알림 |
| crisis-detector-agent | `sentiment-classification-skill`, `kakao-alert-skill` | 위 2개 + `reply-generation-skill` | **추가** — 위기 답글 초안 생성 |
| insight-reporter-agent | `place-health-score-skill`, `excel-report-skill`, `kakao-alert-skill` | 동일 | 일치 |

**결론**: 원안 대비 3건 추가. 모두 설계 단계에서 발견된 필요 기능이며 제거가 아닌 추가이므로 의존 관계 위반 없음. architecture.md 업데이트 필요.

---

## 2. 순환 참조 검증

```
organizer-agent
  ├─ review-collector-agent  → skill만 호출, agent 재호출 없음  ✅
  ├─ reply-drafter-agent     → skill만 호출, agent 재호출 없음  ✅
  ├─ crisis-detector-agent   → skill만 호출, agent 재호출 없음  ✅
  └─ insight-reporter-agent  → skill만 호출, agent 재호출 없음  ✅
```

모든 하위 agent는 skill만 호출하고 다른 agent를 호출하지 않는다.  
**순환 참조 없음. ✅**

---

## 3. Skill 중복 책임 검증

### 공유 skill 분석

| Skill | 사용 Agent | 중복 여부 | 판정 |
|---|---|---|---|
| `kakao-alert-skill` | organizer, reply-drafter, crisis-detector, insight-reporter | 동일 기능(발송)을 공유 | **정상** — 유틸리티 skill. 플랫폼 발송 책임 단일화 |
| `reply-generation-skill` | reply-drafter-agent, crisis-detector-agent | 동일 skill, 다른 mode | **정상** — `mode: "normal"` vs `mode: "crisis"`로 분기. 생성 로직 중복 없음 |

### 단독 사용 skill 확인

| Skill | 사용 Agent | 판정 |
|---|---|---|
| 5개 스크래퍼 | review-collector-agent 전용 | ✅ |
| `tone-learning-skill` | reply-drafter-agent 전용 | ✅ |
| `sentiment-classification-skill` | crisis-detector-agent 전용 | ✅ |
| `place-health-score-skill` | insight-reporter-agent 전용 | ✅ |
| `excel-report-skill` | insight-reporter-agent 전용 | ✅ |

**중복 책임 없음. ✅**

---

## 4. 리뷰 처리 경계 검증

reply-drafter-agent와 crisis-detector-agent가 같은 리뷰를 중복 처리하는지 확인.

| 구분 | reply-drafter-agent | crisis-detector-agent |
|---|---|---|
| 처리 대상 | ⭐3~5점 | ⭐1~2점 |
| 경계 명시 | "⭐1~2점 리뷰 처리 금지" 명시 | "⭐3점 이상 처리 금지" 명시 |
| 동시 호출 | organizer가 두 agent를 동시 호출 | 동일 |
| 중복 초안 위험 | review_id 유니크 제약으로 차단 | 동일 |

**경계 명확, 중복 없음. ✅**

---

## 5. 데이터 흐름 무결성 검증

```
[플랫폼]
    │ 스크래핑 / OAuth
    ▼
review-collector-agent
    │ reviews 테이블 INSERT
    │ collection.completed → organizer
    ▼
organizer-agent
    ├─→ reply-drafter-agent (⭐3~5 리뷰)
    │       │ pending_replies INSERT
    │       └─→ kakao-alert-skill (사장님 알림)
    │
    └─→ crisis-detector-agent (⭐1~2 리뷰)
            │ crisis_alerts INSERT
            │ pending_replies INSERT (is_crisis_reply: true)
            └─→ kakao-alert-skill (사장님 즉시 알림)

[스케줄]
    │
    ▼
organizer-agent
    └─→ insight-reporter-agent
            │ health_scores INSERT
            │ reports INSERT
            └─→ kakao-alert-skill (리포트 발송)
```

각 단계에서 쓰는 테이블이 겹치지 않는지 확인:

| Agent | 쓰는 테이블 | 충돌 여부 |
|---|---|---|
| review-collector-agent | `reviews`, `collection_logs` | - |
| reply-drafter-agent | `pending_replies` | - |
| crisis-detector-agent | `crisis_alerts`, `pending_replies` | reply-drafter와 같은 테이블 쓰나, review_id 유니크 제약으로 충돌 방지 |
| insight-reporter-agent | `health_scores`, `reports` | - |
| kakao-alert-skill | `message_logs` | - |

**데이터 흐름 무결성 이상 없음. ✅**

---

## 6. 발견 사항 및 조치

| # | 발견 사항 | 조치 |
|---|---|---|
| 1 | architecture.md 의존 관계도가 실제 3건 누락 | architecture.md 업데이트 |
| 2 | crisis-detector와 reply-drafter 모두 `pending_replies`에 INSERT | review_id 유니크 제약으로 충돌 방지 확인. 추가 조치 불필요 |
| 3 | `kakao-alert-skill` 4개 agent 공유 | 단일 발송 책임 집중이므로 의도된 설계. 변경 불필요 |

---

## 최종 판정

| 검증 항목 | 결과 |
|---|---|
| agent ↔ skill 매핑 일치 | architecture.md 업데이트 후 일치 ✅ |
| 순환 참조 | 없음 ✅ |
| skill 중복 책임 | 없음 ✅ |
| 리뷰 처리 경계 | 명확 ✅ |
| 데이터 흐름 무결성 | 이상 없음 ✅ |

**Phase A-4 통과. Phase B 진입 가능.**
