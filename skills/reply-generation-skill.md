# reply-generation-skill

## 역할 요약

리뷰 내용과 사장님 톤 프로필을 바탕으로 답글 초안 1개를 생성한다. 다양성 지시(재생성 시)를 받아 이전 초안과 다른 표현을 사용한다. 다양성 검증 자체는 이 skill의 책임이 아니며, 호출자(`reply-drafter-agent`, `crisis-detector-agent`)가 유사도를 판단하고 재호출 여부를 결정한다.

---

## 입력 명세

```typescript
interface ReplyGenerationInput {
  review: {
    content: string;
    rating: number;                    // 1~5
    platform: string;                  // "naver" | "baemin" | ...
  };
  tone_profile: ToneProfile | null;    // null이면 기본 톤 사용
  context: {
    store_name: string;
    store_category: string;            // 예: "한식당", "치킨집"
  };
  generation_options: {
    mode: "normal" | "crisis";         // crisis: 공감/사과 톤 강조
    attempt: number;                   // 1부터 시작. 재생성 시 증가
    diversity_instruction?: string;    // attempt >= 2일 때 전달. "이전 답글과 다른 표현 사용"
    previous_drafts?: string[];        // attempt >= 2일 때 이전 초안 목록 (참고용)
  };
}
```

| 필드 | 설명 |
|---|---|
| `tone_profile` | `tone-learning-skill` 결과물. null이면 기본 톤 프롬프트 사용 |
| `mode` | `"crisis"` 시 공감·사과·개선의지 톤 우선. 일반 답글과 프롬프트 다름 |
| `attempt` | 1이면 첫 생성. 2~3이면 다양성 실패로 재생성 |
| `diversity_instruction` | "이전 답글과 다른 문장 구조, 다른 시작 표현 사용" 등 구체적 지시 |
| `previous_drafts` | Claude에게 "이 답글들과 달라야 한다"는 참고 입력으로 제공 |

입력 예시 (재생성):

```json
{
  "review": {
    "content": "음식이 너무 짰어요. 조금만 싱겁게 해주세요.",
    "rating": 3,
    "platform": "naver"
  },
  "tone_profile": {
    "system_prompt": "따뜻하고 친근한 말투, 이모지 가끔 사용, 2~3문장",
    "signature_phrases": ["감사합니다 :)", "다음에 또 방문해 주세요"]
  },
  "context": {
    "store_name": "맛있는 한식당",
    "store_category": "한식당"
  },
  "generation_options": {
    "mode": "normal",
    "attempt": 2,
    "diversity_instruction": "이전 답글과 다른 시작 표현과 문장 구조를 사용하세요.",
    "previous_drafts": [
      "소중한 의견 감사드려요. 말씀해주신 간 문제 꼭 개선하겠습니다 :)"
    ]
  }
}
```

---

## 출력 명세

성공 시:

```typescript
interface ReplyGenerationOutput {
  status: "success";
  draft: string;                       // 생성된 답글 초안 (완성된 텍스트)
  token_usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
```

실패 시:

```typescript
interface ReplyGenerationError {
  status: "failed";
  error_message: string;
  draft: null;
}
```

출력 예시:

```json
{
  "status": "success",
  "draft": "귀한 말씀 남겨주셔서 감사해요! 간이 세다는 의견 잘 들었습니다. 주방에 바로 전달해서 조절하겠습니다. 다음엔 더 맛있게 드실 수 있도록 신경 쓸게요 :)"
}
```

---

## 처리 로직

```
1. 입력 검증
   - review.content, context.store_name 비어있지 않은지 확인

2. 프롬프트 구성
   [시스템 프롬프트]
   - tone_profile.system_prompt 사용 (null이면 기본값)
   - mode가 "crisis"이면 추가 지시:
     "이 리뷰는 불만 리뷰입니다. 방어적이지 않게, 진심 어린 공감과
      사과를 먼저 표현하고, 구체적인 개선 의지를 포함하세요."

   [유저 프롬프트]
   - "다음 리뷰에 대한 답글을 {store_name} 사장님 입장에서 작성해주세요."
   - 리뷰 내용 제공
   - attempt >= 2이면 diversity_instruction 추가
   - previous_drafts 제공 (있을 경우):
     "다음 답글들과 비슷한 표현을 피하세요: ..."

3. Claude API 호출
   - 모델: claude-sonnet-4-6
   - max_tokens: 300 (답글은 짧게)
   - temperature: 0.8 (attempt 증가마다 +0.05, 최대 0.95)
     → 재생성 시 더 다양한 표현 유도

4. 응답 후처리
   - 앞뒤 공백 제거
   - 플랫폼 금지 문구 필터 (예: 네이버 정책상 외부 링크, 전화번호 포함 시 제거)

5. 결과 반환
```

---

## 기본 톤 프롬프트 (tone_profile이 null일 때)

```
당신은 소규모 식당 사장님입니다.
답글을 쓸 때 정중하고 따뜻한 말투를 사용합니다.
2~3문장으로 간결하게 작성하고, 고객의 의견에 공감하는 표현을 포함합니다.
과도한 마케팅 표현이나 상투적인 문구("항상 최선을 다하겠습니다" 등)는 피합니다.
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| Claude API (`claude-sonnet-4-6`) | 답글 초안 생성 | 답글은 짧아 비용 낮음. 프롬프트 캐싱 적용 가능 (system prompt 캐싱) |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| Claude API 호출 실패 / 타임아웃 | `failed` | 에러 반환. 재시도는 reply-drafter-agent가 결정 |
| 응답이 비어있거나 너무 짧음 (10자 미만) | `failed` | 재생성 요청으로 처리 |
| 플랫폼 정책 위반 문구 포함 | `success` + 후처리 | 위반 문구 자동 제거 후 반환. 제거 후 10자 미만이면 `failed` |
| `review.content`가 빈 리뷰 (별점만) | `success` | 별점만 있는 리뷰 전용 프롬프트 사용 ("별점 리뷰에 짧은 감사 인사") |

---

## 제약 사항

- **1회 호출 = 초안 1개**: 이 skill은 단일 초안만 반환한다. 다양성 검증과 재시도 루프는 호출자(reply-drafter-agent)의 책임이다.
- **temperature 점진 증가**: 재생성 시 temperature를 높여 다양성을 자연스럽게 유도한다. 무작위성이 높아지므로 attempt 3 이후에는 호출하지 않도록 호출자가 제한.
- **system prompt 캐싱**: 동일 tone_profile.system_prompt는 Claude API 프롬프트 캐싱을 적용하여 비용 절감.
- **답글 자동 발행 금지**: 이 skill은 텍스트 생성만 담당한다. 플랫폼 POST 요청은 절대 포함하지 않는다.
