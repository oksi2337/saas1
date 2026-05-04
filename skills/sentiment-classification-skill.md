# sentiment-classification-skill

## 역할 요약

⭐1~2점 리뷰의 내용을 분석하여 위기 유형을 분류하고, 플랫폼 정책 기준으로 삭제 요청 가능 여부를 판단한다. `crisis-detector-agent`가 단독으로 사용한다.

---

## 입력 명세

```typescript
interface SentimentClassificationInput {
  review: {
    content: string;
    rating: number;              // 1~2 (이 skill은 저평점 리뷰만 처리)
    platform: "naver" | "baemin" | "coupangeats" | "kakaomap" | "google";
    reviewed_at: string;
  };
  store: {
    store_id: string;
    store_name: string;
    store_category: string;      // 예: "한식당", "치킨집"
    platform_store_id: string;   // 방문 기록 조회용
  };
}
```

입력 예시:

```json
{
  "review": {
    "content": "진짜 최악이에요. 머리카락이 나왔는데 사장이 오히려 화내면서 환불도 안 해줬어요. 다시는 안 옵니다.",
    "rating": 1,
    "platform": "naver",
    "reviewed_at": "2026-05-04T12:30:00+09:00"
  },
  "store": {
    "store_id": "store_abc123",
    "store_name": "맛있는 한식당",
    "store_category": "한식당",
    "platform_store_id": "1234567890"
  }
}
```

---

## 출력 명세

성공 시:

```typescript
interface SentimentClassificationOutput {
  status: "success";
  crisis_type: "food" | "delivery" | "service" | "blackconsumer" | "unknown";
  crisis_label: string;                  // 사장님용 한국어 레이블
  confidence: number;                    // 분류 신뢰도 0.0~1.0
  summary: string;                       // 리뷰 핵심 요약 (1문장, 알림용)
  response_guide: string;                // 사장님용 대응 가이드 (2~3문장)
  deletion_eligible: boolean;
  deletion_reason: string | null;        // 삭제 가능 사유 (한국어)
  deletion_guide: string | null;         // 삭제 신고 방법 안내
  keywords: string[];                    // 핵심 키워드 (월간 리포트 활용)
}
```

실패 시:

```typescript
interface SentimentClassificationError {
  status: "failed";
  error_message: string;
  // 폴백값 (알림은 무조건 나가야 하므로)
  crisis_type: "unknown";
  crisis_label: "분류 불가";
  confidence: 0;
  summary: string;                       // 리뷰 앞 50자 그대로 사용
  response_guide: "고객의 불만 내용을 확인하고 진심 어린 답글을 달아주세요.";
  deletion_eligible: false;
  deletion_reason: null;
  deletion_guide: null;
  keywords: [];
}
```

출력 예시:

```json
{
  "status": "success",
  "crisis_type": "service",
  "crisis_label": "직원 응대 문제",
  "confidence": 0.92,
  "summary": "이물질 발견 후 사장의 부적절한 응대에 대한 강한 불만",
  "response_guide": "이물질 관련 불만은 즉각적인 사과가 최우선입니다. 환불 처리 여부와 관계없이 고객의 불쾌함에 공감하는 답글을 먼저 달고, 개선 의지를 표현하세요. 직접 연락처를 제공하여 오프라인 해결을 유도하는 것도 효과적입니다.",
  "deletion_eligible": false,
  "deletion_reason": null,
  "deletion_guide": null,
  "keywords": ["이물질", "환불 거절", "불친절"]
}
```

삭제 가능 케이스 예시:

```json
{
  "crisis_type": "blackconsumer",
  "crisis_label": "블랙컨슈머 의심",
  "confidence": 0.78,
  "summary": "방문 사실 없이 과도한 보상 요구 및 협박성 표현",
  "deletion_eligible": true,
  "deletion_reason": "협박성 표현 및 사실과 다른 내용 포함",
  "deletion_guide": "네이버 플레이스 → 해당 리뷰 → '신고하기' → '사실과 다른 내용' 또는 '욕설/비방' 선택. 처리까지 3~7일 소요됩니다."
}
```

---

## 처리 로직

```
1. 입력 검증
   - review.rating이 1~2인지 확인 (아니면 즉시 반환)
   - review.content 비어있지 않은지 확인

2. Claude API 호출 — 위기 분류
   [시스템 프롬프트]
   "당신은 자영업 리뷰 관리 전문가입니다. 저평점 리뷰를 분석하여
    위기 유형을 분류하고 사장님에게 실질적인 대응 가이드를 제공합니다."

   [유저 프롬프트]
   - 매장 정보, 리뷰 내용, 평점 제공
   - 분류 요청:
     * crisis_type: food / delivery / service / blackconsumer / unknown 중 하나
     * 분류 근거 (confidence)
     * 리뷰 핵심 요약 (1문장)
     * 사장님용 대응 가이드 (2~3문장)
     * 삭제 요청 가능 여부 판단:
       - 허위 사실 포함 여부
       - 비속어/협박성 표현 여부
       - 광고성/경쟁사 언급 여부
       - 블랙컨슈머 패턴 여부
     * 핵심 키워드 추출

3. 응답 파싱
   - JSON 구조체로 파싱

4. 플랫폼별 삭제 가이드 주입
   - deletion_eligible: true이면 platform에 맞는 삭제 신고 안내 텍스트 추가
   - 플랫폼별 신고 경로는 하드코딩된 가이드 텍스트 사용

5. 결과 반환
```

---

## 플랫폼별 삭제 신고 가이드 (하드코딩)

| 플랫폼 | 신고 경로 |
|---|---|
| 네이버 | 플레이스 관리자 → 해당 리뷰 → 신고하기 → 사유 선택 |
| 배민 | 사장님 센터 → 리뷰 관리 → 해당 리뷰 → 부적절한 리뷰 신고 |
| 쿠팡이츠 | 사장님 센터 → 고객 리뷰 → 리뷰 신고 |
| 카카오맵 | 카카오맵 앱 → 해당 리뷰 → 신고 |
| 구글 | 구글 비즈니스 프로필 → 리뷰 → 신고 |

---

## 위기 유형 분류 기준

| 유형 | `crisis_type` | 핵심 키워드/패턴 |
|---|---|---|
| 음식 품질 | `food` | 맛, 냄새, 위생, 이물질, 상함, 양, 온도 |
| 배달 문제 | `delivery` | 배달 시간, 늦음, 식음, 누락, 포장, 배달기사 |
| 직원 응대 | `service` | 불친절, 무시, 말투, 화냄, 환불 거부, 응대 |
| 블랙컨슈머 | `blackconsumer` | 협박, "올리겠다", 과도한 보상, 방문 기록 없음, 반복 민원 |
| 분류 불가 | `unknown` | 위 유형 해당 없거나 내용 불충분 |

> 두 가지 이상 해당 시 가장 심각한 유형을 선택 (예: 응대 문제 + 협박성 → `blackconsumer`)

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| Claude API (`claude-sonnet-4-6`) | 위기 분류 및 가이드 생성 | |

---

## 실패 / 예외 케이스

| 케이스 | `status` | 처리 |
|---|---|---|
| Claude API 호출 실패 | `failed` | 폴백값 반환. crisis-detector-agent는 `unknown`으로 계속 알림 발송 |
| 응답 파싱 실패 | `failed` | 폴백값 반환 |
| rating > 2인 리뷰 입력 | `failed` | "이 skill은 rating 1~2 전용입니다" 메시지 반환 |
| 리뷰 내용이 너무 짧음 (5자 미만, 별점만) | `success` | `crisis_type: "unknown"`, `confidence: 0.3`으로 반환 |

---

## 제약 사항

- **삭제 자동 신고 금지**: `deletion_eligible: true`여도 이 skill은 신고 요청을 플랫폼에 보내지 않는다. 가이드 텍스트만 반환.
- **폴백 필수**: Claude API 실패 시에도 crisis-detector-agent가 알림을 발행할 수 있도록 `unknown` 폴백을 항상 반환한다. 빈 응답 금지.
- **분류 범위**: 이 skill은 저평점 리뷰만 처리한다. 긍정 리뷰 감성 분석이나 키워드 트렌드 집계는 insight-reporter-agent가 직접 DB 쿼리로 처리한다.
