# tone-learning-skill

## 역할 요약

사장님이 입력한 과거 답글 5개 이상을 분석하여 글쓰기 톤 프로필을 추출하고 DB에 저장한다. 이후 `reply-generation-skill`이 이 프로필을 참조하여 "사장님이 쓴 것 같은" 답글을 생성한다. 톤 학습은 사장님이 직접 트리거하며, 자동 실행되지 않는다.

---

## 입력 명세

```typescript
interface ToneLearningInput {
  store_id: string;
  owner_id: string;
  sample_replies: SampleReply[];     // 최소 5개, 최대 20개
}

interface SampleReply {
  review_content: string;            // 원본 리뷰 내용 (컨텍스트용)
  reply_content: string;             // 사장님이 직접 작성한 답글
}
```

| 필드 | 설명 |
|---|---|
| `sample_replies` | 최소 5개 필수. 5개 미만이면 학습 거부, 입력 요청 |
| `review_content` | 비워도 되나, 있으면 톤 분석 품질 향상 |

입력 예시:

```json
{
  "store_id": "store_abc123",
  "owner_id": "owner_xyz",
  "sample_replies": [
    {
      "review_content": "음식이 정말 맛있었어요! 재방문할게요.",
      "reply_content": "와~ 맛있게 드셨다니 너무 기쁘네요 ^^ 다음에 또 방문해 주시면 더 맛있게 준비해드릴게요! 감사합니다 :)"
    },
    {
      "review_content": "사장님이 불친절해요.",
      "reply_content": "죄송합니다 고객님. 불쾌한 경험을 드렸다면 진심으로 사과드려요. 다음에 오시면 더 따뜻하게 맞이하겠습니다."
    }
  ]
}
```

---

## 출력 명세

성공 시:

```typescript
interface ToneLearningOutput {
  status: "success";
  tone_profile_id: string;           // DB에 저장된 프로필 ID
  tone_profile: ToneProfile;
}

interface ToneProfile {
  id: string;
  store_id: string;
  // 분석 결과
  formality: "formal" | "semi-formal" | "casual";   // 존댓말 강도
  warmth: "warm" | "neutral" | "professional";       // 감성 온도
  length: "short" | "medium" | "long";               // 평균 답글 길이
  emoji_usage: "none" | "occasional" | "frequent";   // 이모지 사용 빈도
  signature_phrases: string[];       // 자주 쓰는 표현 (최대 5개)
  avoid_phrases: string[];           // 쓰지 않는 표현 (분석 결과)
  system_prompt: string;             // reply-generation-skill에 주입할 완성된 프롬프트
  sample_count: int;                 // 학습에 사용된 샘플 수
  created_at: string;
  updated_at: string;
}
```

실패 시:

```typescript
interface ToneLearningError {
  status: "failed" | "insufficient_samples";
  error_message: string;
  tone_profile: null;
}
```

출력 예시:

```json
{
  "status": "success",
  "tone_profile_id": "tp_store_abc123_v2",
  "tone_profile": {
    "id": "tp_store_abc123_v2",
    "store_id": "store_abc123",
    "formality": "semi-formal",
    "warmth": "warm",
    "length": "medium",
    "emoji_usage": "occasional",
    "signature_phrases": ["감사합니다 :)", "다음에 또 방문해 주세요", "맛있게 드셨다니"],
    "avoid_phrases": ["안녕하세요", "항상 최선을"],
    "system_prompt": "당신은 작은 한식당 사장님입니다. 답글을 쓸 때 반말과 존댓말이 섞인 따뜻한 말투를 사용합니다. '감사합니다 :)'처럼 이모지를 가끔 사용하고, 너무 격식체는 피합니다. 답글 길이는 2~4문장이 적당합니다.",
    "sample_count": 8,
    "created_at": "2026-05-04T10:00:00+09:00",
    "updated_at": "2026-05-04T10:00:00+09:00"
  }
}
```

---

## 처리 로직

```
1. 입력 검증
   - sample_replies 개수 확인 (5개 미만 → insufficient_samples 반환)
   - 각 reply_content 비어있지 않은지 확인

2. Claude API 호출 — 톤 분석
   프롬프트 구성:
   - 역할: "사장님의 답글 스타일을 분석하는 전문가"
   - 입력: sample_replies 전체
   - 요청:
     * formality / warmth / length / emoji_usage 분류
     * 자주 쓰는 표현 최대 5개 추출
     * 절대 쓰지 않는 표현 패턴 추출
     * 위 분석을 바탕으로 reply-generation에 사용할 system_prompt 작성

3. 응답 파싱
   - Claude 응답을 ToneProfile 구조체로 파싱
   - system_prompt는 Claude가 직접 작성한 자연어 프롬프트 그대로 사용

4. DB 저장
   - 기존 프로필 있으면 버전 업 (updated_at 갱신, 이전 버전 보존)
   - 새 프로필이면 INSERT

5. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| Claude API (`claude-sonnet-4-6`) | 톤 분석 및 system_prompt 생성 | 프롬프트 캐싱 불필요 (1회성 호출) |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| 샘플 5개 미만 | `insufficient_samples` | 즉시 반환, 추가 입력 요청 메시지 포함 |
| Claude API 호출 실패 | `failed` | 에러 메시지 반환. 재시도는 호출자(사장님 액션) 판단 |
| 응답 파싱 실패 (구조체 불일치) | `failed` | raw 응답 로그 저장 후 반환 |
| 샘플이 너무 짧거나 의미 없음 (전부 "감사합니다" 1단어) | `success` + 경고 | 프로필 생성하되 `warning: "샘플 품질이 낮아 정확도가 떨어질 수 있습니다"` 함께 반환 |

---

## 제약 사항

- **자동 실행 금지**: 이 skill은 사장님이 직접 "톤 학습" 버튼을 눌렀을 때만 실행된다. 리뷰 수집 파이프라인에서 자동 트리거되지 않는다.
- **버전 관리**: 재학습 시 이전 프로필을 덮어쓰지 않고 버전으로 보존한다. reply-generation-skill은 항상 최신 버전을 사용.
- **최소 샘플 5개**: 샘플이 적으면 톤 분석 신뢰도가 낮아져 오히려 이상한 답글이 생성된다. 5개 미만은 학습 자체를 거부.
