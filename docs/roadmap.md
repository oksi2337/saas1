# 진행 로드맵

## 진행 순서: **Phase A (아키텍처) → Phase B (구현)**

agent/skill 파일을 먼저 작성해서 책임 경계를 명확히 잡고, 그 다음에 바이브코딩으로 실제 구현에 들어간다.

---

## Phase A — 아키텍처 정의 (1주차 전반, 2~3일)

### A-1. Agent 파일 작성 (5개)
순서대로:
1. `agents/organizer-agent.md`
2. `agents/review-collector-agent.md`
3. `agents/reply-drafter-agent.md`
4. `agents/crisis-detector-agent.md`
5. `agents/insight-reporter-agent.md`

각 agent 파일에 들어가야 할 내용:
- 책임 (Responsibility)
- 입력 / 출력 (Input / Output)
- 사용하는 skill 목록
- 호출하는 다른 agent
- 트리거 조건 (이벤트 / 스케줄)

### A-2. Skill 파일 작성 (11개)

**수집 그룹** (5개)
- `skills/naver-place-scraper-skill.md`
- `skills/baemin-scraper-skill.md`
- `skills/coupangeats-scraper-skill.md`
- `skills/kakaomap-scraper-skill.md`
- `skills/google-maps-scraper-skill.md`

**분석/생성 그룹** (4개)
- `skills/tone-learning-skill.md`
- `skills/reply-generation-skill.md`
- `skills/sentiment-classification-skill.md`
- `skills/place-health-score-skill.md`

**출력 그룹** (2개)
- `skills/excel-report-skill.md`
- `skills/kakao-alert-skill.md`

각 skill 파일에 들어가야 할 내용:
- 입력 명세 (타입, 예시)
- 출력 명세 (타입, 예시)
- 처리 로직 단계별 설명
- 외부 의존성 (API, 라이브러리)
- 실패/예외 케이스

### A-3. 데이터 모델 확정
`docs/data-model.md`에 정의:
- Store (매장)
- Review (리뷰)
- Reply (답글)
- HealthScore (헬스 스코어)
- Alert (알림 이력)
- User (사장님 계정)

### A-4. 의존 관계 검증
- agent ↔ skill 매핑이 architecture.md의 의존 관계도와 일치하는지 확인
- 순환 참조 없는지 확인
- skill 중복 책임 없는지 확인

---

## Phase B — MVP 구현 (1주차 후반 ~ 4주차)

### Week 1 (남은 절반): 데이터 수집 기반
**산출물**
- 네이버 플레이스 크롤러 동작
- 배민 크롤러 동작
- DB 스키마 + 마이그레이션
- 매장 1개 등록 → 리뷰 자동 수집되는 파이프라인

**검증 기준**
- [ ] 본인 단골가게 1곳 등록
- [ ] 네이버 + 배민에서 신규 리뷰가 1시간 내 DB에 적재됨
- [ ] 중복 리뷰 발생 없음

### Week 2: 답글 + 사장님 인터페이스
**산출물**
- 톤 학습 (과거 답글 5개 입력 → 프롬프트 자동 생성)
- AI 답글 초안 생성 + 다양성 검증
- 웹 대시보드 (리뷰 인박스 + 1초 컨펌)

**검증 기준**
- [ ] 사장님이 초안을 보고 "내가 쓴 거 같다" 또는 "이 정도면 그대로 발행 가능" 반응
- [ ] 같은 패턴 답글 연속 발생 시 재생성 확인

### Week 3: 헬스 스코어 + 위기 대응
**산출물**
- 플레이스 헬스 스코어 산출 로직
- 주간 리포트 발송
- ⭐1~2점 리뷰 카톡 즉시 알림

**검증 기준**
- [ ] 첫 데모 매장 확보 (지인 사장님 1명)
- [ ] 사장님이 카톡 알림 받고 5분 내 대응
- [ ] 헬스 스코어 리포트 받고 "이거 도움 된다" 반응

### Week 4: 결제 + 영업 시작
**산출물**
- Excel 월간 리포트
- 토스페이먼츠 정기결제 연동
- 무료 1개월 → 유료 전환 플로우

**검증 기준**
- [ ] 첫 유료 결제 1건
- [ ] 사장님 본인이 다른 사장님 1명 소개

---

## 주의 사항

### Phase A에서 빠지면 안 되는 것
- **자동 발행 X, 사장님 컨펌 방식**으로 명시 (네이버 정책 대응)
- **답글 다양성 검증** 로직을 reply-generation-skill에 명시
- 크롤링 차단 대비 **OAuth 백업 경로** 설계

### Phase B에서 빠지지 말 것
- 디자인 욕심 X — 카카오톡 봇 + 간단한 웹 대시보드면 충분
- 5개 플랫폼 완벽 X — 1주차는 네이버 + 배민 2개면 충분
- 결제 연동을 4주차까지 미루지 않기 (3주차 후반에 미리 붙이기 시작)
