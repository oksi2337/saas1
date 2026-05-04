# kakao-alert-skill

## 역할 요약

카카오 비즈메시지(알림톡/친구톡)를 통해 사장님 또는 운영자에게 메시지를 발송한다. 시스템 전체에서 유일한 외부 발송 채널이다. 모든 agent가 이 skill을 통해 사람에게 메시지를 보낸다.

---

## 입력 명세

```typescript
interface KakaoAlertInput {
  recipient: "owner" | "operator";
  owner_id?: string;                   // recipient가 "owner"일 때 필수
  message_type: MessageType;
  content: MessageContent;
  options?: {
    retry_on_fail: boolean;            // 기본 true
    priority: "normal" | "urgent";    // urgent는 재시도 5회, normal은 3회
  };
}

type MessageType =
  | "draft_ready"          // 답글 초안 준비
  | "tone_setup_required"  // 톤 학습 안내
  | "crisis_alert"         // ⭐1~2점 위기 리뷰
  | "weekly_report"        // 주간 리포트
  | "monthly_report"       // 월간 리포트
  | "system_error"         // 시스템 오류 (운영자용)
  | "auth_required"        // 재로그인/재인증 필요
  | "collection_blocked";  // 크롤링 차단

// 각 message_type별 content 구조는 각 agent 명세 참고
type MessageContent = Record<string, unknown>;
```

입력 예시:

```json
{
  "recipient": "owner",
  "owner_id": "owner_xyz",
  "message_type": "crisis_alert",
  "content": {
    "store_name": "맛있는 한식당",
    "platform": "naver",
    "rating": 1,
    "review_snippet": "음식이 너무 짰어요.",
    "crisis_type": "food",
    "crisis_label": "음식 품질 문제",
    "response_guide": "진심 어린 사과와 개선 의지를 표현해 주세요.",
    "deletion_eligible": false,
    "draft_ready": true,
    "action_url": "https://app.example.com/crisis/alert_001"
  },
  "options": {
    "retry_on_fail": true,
    "priority": "urgent"
  }
}
```

---

## 출력 명세

성공 시:

```typescript
interface KakaoAlertOutput {
  status: "success";
  message_id: string;        // 카카오 API가 반환하는 메시지 ID
  sent_at: string;           // ISO 8601
}
```

실패 시:

```typescript
interface KakaoAlertError {
  status: "failed";
  error_code: string;        // 카카오 API 에러 코드
  error_message: string;
  retryable: boolean;        // 재시도 가능 여부
}
```

---

## 메시지 타입별 템플릿

### `draft_ready` — 알림톡

```
[맛있는 한식당] 새 리뷰 답글 초안이 준비됐어요.

신규 리뷰 3건에 대한 초안을 확인하고 발행해 주세요.

👉 확인하기: {dashboard_url}
```

### `crisis_alert` — 알림톡 (urgent)

```
[맛있는 한식당] ⚠️ 위기 리뷰 알림

플랫폼: 네이버  |  별점: ⭐1점
유형: 음식 품질 문제

리뷰: "음식이 너무 짰어요."

대응 가이드: 진심 어린 사과와 개선 의지를 표현해 주세요.

👉 지금 답글 달기: {action_url}
```

삭제 가능 케이스 추가 블록:

```
🗑️ 삭제 요청 가능: 허위 사실 포함
→ 신고 방법: 네이버 플레이스 → 해당 리뷰 → 신고하기
```

### `weekly_report` — 알림톡

```
[맛있는 한식당] 이번 주 플레이스 리포트

기간: 4/28(월) ~ 5/4(일)
헬스 스코어: 72점 (▼7점)  |  등급: 보통

⚠️ 주의 항목
• 18일째 신규 사진 없음 → 노출 하락 위험
• 전화 클릭률 18.5% 하락

미답글 리뷰: 5건

👉 대시보드 보기: {dashboard_url}
```

### `monthly_report` — 알림톡 + Excel 파일

```
[맛있는 한식당] 2026년 4월 월간 리포트

리뷰 47건  |  평균 ⭐4.2 (▲0.1)
긍정 키워드: 친절, 맛있어요, 재방문
개선 필요: 짜다(4건), 대기시간(3건)

💡 메뉴 제안
• 김치찌개: 짜다는 리뷰 4건 → 간 조정 검토

📎 상세 Excel 리포트: {excel_file_url}
👉 대시보드 보기: {dashboard_url}
```

### `auth_required` — 알림톡

```
[맛있는 한식당] 재로그인이 필요해요

{platform} 리뷰 수집이 중단됐습니다.
아래 링크에서 다시 로그인해 주세요.

👉 재로그인: {auth_url}
```

### `system_error` — 문자 또는 카카오톡 (운영자용)

```
[시스템 오류] {agent} 3회 연속 실패

매장: {store_name} ({store_id})
오류: {error_summary}
발생: {failed_at}

확인 필요
```

---

## 처리 로직

```
1. 입력 검증
   - recipient가 "owner"이면 owner_id로 사장님 카카오 채널 수신 동의 여부 확인
   - message_type 유효성 확인

2. 수신자 정보 조회
   - owner_id → DB에서 카카오 채널 수신 동의 여부 + 발송 가능 전화번호 조회
   - 수신 미동의 시 발송 스킵, 로그 기록

3. 템플릿 렌더링
   - message_type에 맞는 템플릿 선택
   - content 필드를 템플릿 변수에 바인딩

4. 카카오 비즈메시지 API 호출
   - 알림톡 우선 (채널 추가 사용자)
   - 알림톡 실패 시 친구톡 → SMS 순으로 폴백

5. 발송 결과 기록
   - MessageLog 테이블에 INSERT
   - 실패 시 retryable 여부 판단 후 반환

6. 결과 반환
```

---

## 외부 의존성

| 의존성 | 용도 | 비고 |
|---|---|---|
| 카카오 비즈메시지 API | 알림톡 / 친구톡 발송 | 카카오 비즈니스 채널 개설 + 알림톡 템플릿 심사 필요 |
| SMS API (문자 폴백) | 카카오 알림톡 실패 시 최후 수단 | 국내 문자 발송 서비스 (솔라피, NHN 등) |

---

## 발송 채널 폴백 순서

```
알림톡 (채널 추가 사용자)
  └── 실패 시 → 친구톡 (카카오 친구 추가 사용자)
                └── 실패 시 → SMS (전화번호 기반)
                              └── 실패 시 → MessageLog에 "발송 실패" 기록
```

---

## MessageLog 스키마

```typescript
interface MessageLog {
  id: string;
  recipient_type: "owner" | "operator";
  owner_id: string | null;
  message_type: string;
  channel_used: "alimtalk" | "friendtalk" | "sms" | null;
  status: "success" | "failed" | "skipped";
  kakao_message_id: string | null;
  error_code: string | null;
  sent_at: string | null;
  created_at: string;
}
```

---

## 실패 / 예외 케이스

| 케이스 | `status` | `retryable` | 처리 |
|---|---|---|---|
| 카카오 API 일시 장애 (5xx) | `failed` | true | 지수 백오프 재시도 |
| 잘못된 수신자 전화번호 | `failed` | false | 재시도 없음, 사장님 정보 수정 필요 |
| 알림톡 템플릿 미승인 | `failed` | false | 운영자 알림 후 SMS 폴백 |
| 수신 미동의 사용자 | `skipped` | false | 조용히 스킵, 로그만 기록 |
| content 필드 누락 (템플릿 렌더링 오류) | `failed` | false | 렌더링 오류 로그 기록 |
| 카카오 일일 발송 한도 초과 | `failed` | true | 자정 이후 재시도 |

---

## 제약 사항

- **알림톡 템플릿 사전 심사 필수**: 카카오 알림톡은 메시지 내용을 카카오가 사전 승인해야 발송 가능하다. 모든 `message_type` 템플릿에 대해 카카오 심사를 받아야 한다. Phase B 시작 전에 심사 신청.
- **수신 동의 확인**: 사장님이 카카오 채널을 추가하지 않으면 알림톡 발송 불가. 가입 플로우에서 채널 추가 유도 필수.
- **발송 기록 필수**: 모든 발송 시도(성공/실패/스킵)를 `MessageLog`에 기록한다. 미발송 분쟁 대비 및 디버깅용.
- **쓰기 전용**: 이 skill은 메시지 발송만 담당한다. 사장님 응답(답글 컨펌, 버튼 클릭 등)의 수신 처리는 별도 웹훅 핸들러의 책임이다.
