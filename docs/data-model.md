# 데이터 모델

agent/skill 파일 전체에서 참조된 스키마를 확정한다.

---

## 엔티티 목록

| 엔티티 | 테이블명 | 설명 |
|---|---|---|
| User | `users` | 사장님 계정 |
| Store | `stores` | 매장 |
| StorePlatform | `store_platforms` | 매장-플랫폼 연결 및 인증 정보 |
| ToneProfile | `tone_profiles` | 사장님 답글 톤 프로필 |
| Review | `reviews` | 수집된 리뷰 |
| PendingReply | `pending_replies` | 답글 초안 및 컨펌 이력 |
| CrisisAlert | `crisis_alerts` | 위기 리뷰 감지 이력 |
| HealthScore | `health_scores` | 주간/월간 헬스 스코어 |
| Report | `reports` | 리포트 생성 및 발송 이력 |
| CollectionLog | `collection_logs` | 플랫폼별 수집 실행 이력 |
| MessageLog | `message_logs` | 카카오톡/SMS 발송 이력 |

---

## 상세 스키마

### users

```sql
CREATE TABLE users (
  id              TEXT PRIMARY KEY,          -- UUID
  email           TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,             -- 카카오톡 발송 대상
  kakao_channel_consent BOOLEAN DEFAULT false, -- 알림톡 수신 동의
  plan            TEXT NOT NULL              -- 'lite' | 'pro' | 'agency'
    CHECK (plan IN ('lite', 'pro', 'agency')),
  plan_started_at TIMESTAMPTZ,
  plan_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### stores

```sql
CREATE TABLE stores (
  id              TEXT PRIMARY KEY,          -- UUID
  owner_id        TEXT NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,             -- 매장명
  category        TEXT NOT NULL,             -- 예: '한식당', '치킨집'
  address         TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  last_photo_uploaded_at TIMESTAMPTZ,        -- place-health-score-skill 사용
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

---

### store_platforms

매장별 플랫폼 연결 정보 및 수집 인증 자격증명을 관리한다.

```sql
CREATE TABLE store_platforms (
  id                  TEXT PRIMARY KEY,
  store_id            TEXT NOT NULL REFERENCES stores(id),
  platform            TEXT NOT NULL
    CHECK (platform IN ('naver', 'baemin', 'coupangeats', 'kakaomap', 'google')),
  platform_store_id   TEXT NOT NULL,         -- 플랫폼 내 업체 ID
  auth_method         TEXT NOT NULL
    CHECK (auth_method IN ('cookie', 'oauth', 'api_key', 'ceo_api')),
  auth_credential     TEXT,                  -- 암호화된 쿠키/토큰. 평문 저장 금지
  auth_expires_at     TIMESTAMPTZ,
  is_active           BOOLEAN DEFAULT true,
  last_collected_at   TIMESTAMPTZ,           -- 증분 수집 기준점
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),

  UNIQUE (store_id, platform)
);
```

> **보안**: `auth_credential`은 AES-256으로 암호화하여 저장. 애플리케이션 레이어에서 복호화.

---

### tone_profiles

```sql
CREATE TABLE tone_profiles (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  version           INTEGER NOT NULL DEFAULT 1,  -- 재학습 시 증가
  formality         TEXT NOT NULL
    CHECK (formality IN ('formal', 'semi-formal', 'casual')),
  warmth            TEXT NOT NULL
    CHECK (warmth IN ('warm', 'neutral', 'professional')),
  length            TEXT NOT NULL
    CHECK (length IN ('short', 'medium', 'long')),
  emoji_usage       TEXT NOT NULL
    CHECK (emoji_usage IN ('none', 'occasional', 'frequent')),
  signature_phrases TEXT[],                  -- 자주 쓰는 표현 (최대 5개)
  avoid_phrases     TEXT[],                  -- 쓰지 않는 표현
  system_prompt     TEXT NOT NULL,           -- reply-generation-skill에 주입할 프롬프트
  sample_count      INTEGER NOT NULL,        -- 학습에 사용된 샘플 수
  is_active         BOOLEAN DEFAULT true,    -- 최신 버전만 true
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 매장당 활성 프로필 1개 제약
CREATE UNIQUE INDEX idx_tone_profiles_active
  ON tone_profiles (store_id)
  WHERE is_active = true;
```

---

### reviews

```sql
CREATE TABLE reviews (
  id                  TEXT PRIMARY KEY,      -- UUID
  store_id            TEXT NOT NULL REFERENCES stores(id),
  platform            TEXT NOT NULL
    CHECK (platform IN ('naver', 'baemin', 'coupangeats', 'kakaomap', 'google')),
  platform_review_id  TEXT NOT NULL,         -- 플랫폼 원본 ID
  author_name         TEXT NOT NULL,
  rating              SMALLINT               -- 1~5. 별점 없는 리뷰(카카오맵)는 NULL
    CHECK (rating BETWEEN 1 AND 5),
  content             TEXT NOT NULL DEFAULT '',
  image_urls          TEXT[] DEFAULT '{}',
  replied             BOOLEAN DEFAULT false, -- 플랫폼에 답글 달린 여부
  reply_content       TEXT,                  -- 기 작성된 답글 내용
  reviewed_at         TIMESTAMPTZ NOT NULL,
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 플랫폼별 추가 데이터 (정규화 생략, JSON으로 보존)
  platform_extra      JSONB DEFAULT '{}',    -- menu_ratings, ordered_menu 등

  UNIQUE (store_id, platform, platform_review_id)
);

CREATE INDEX idx_reviews_store_collected ON reviews (store_id, collected_at DESC);
CREATE INDEX idx_reviews_store_rating    ON reviews (store_id, rating);
CREATE INDEX idx_reviews_replied         ON reviews (store_id, replied) WHERE replied = false;
```

---

### pending_replies

답글 초안 및 사장님 컨펌 이력.

```sql
CREATE TABLE pending_replies (
  id                    TEXT PRIMARY KEY,
  store_id              TEXT NOT NULL REFERENCES stores(id),
  review_id             TEXT NOT NULL REFERENCES reviews(id),
  draft_content         TEXT NOT NULL,
  generation_attempt    SMALLINT NOT NULL DEFAULT 1, -- 몇 번째 시도에서 다양성 통과
  diversity_score       REAL,                        -- 최근 답글과 최대 유사도 0.0~1.0
  tone_profile_id       TEXT REFERENCES tone_profiles(id),
  is_crisis_reply       BOOLEAN DEFAULT false,
  crisis_alert_id       TEXT REFERENCES crisis_alerts(id),

  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'edited')),

  -- 컨펌 이후
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          TEXT REFERENCES users(id),
  final_content         TEXT,                        -- 사장님이 수정한 최종 내용

  -- 발행 이후
  published_at          TIMESTAMPTZ,
  publish_status        TEXT
    CHECK (publish_status IN ('pending', 'published', 'failed')),

  created_at            TIMESTAMPTZ DEFAULT now(),

  UNIQUE (store_id, review_id)                       -- 리뷰당 초안 1개
);

CREATE INDEX idx_pending_replies_status ON pending_replies (store_id, status);
```

---

### crisis_alerts

```sql
CREATE TABLE crisis_alerts (
  id                  TEXT PRIMARY KEY,
  store_id            TEXT NOT NULL REFERENCES stores(id),
  review_id           TEXT NOT NULL REFERENCES reviews(id),
  platform            TEXT NOT NULL,
  rating              SMALLINT NOT NULL CHECK (rating IN (1, 2)),
  crisis_type         TEXT NOT NULL
    CHECK (crisis_type IN ('food', 'delivery', 'service', 'blackconsumer', 'unknown')),
  crisis_label        TEXT NOT NULL,
  confidence          REAL,
  summary             TEXT,
  response_guide      TEXT,
  deletion_eligible   BOOLEAN DEFAULT false,
  deletion_reason     TEXT,
  deletion_guide      TEXT,
  keywords            TEXT[] DEFAULT '{}',
  alert_sent_at       TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'alerted'
    CHECK (status IN ('alerted', 'replied', 'deletion_requested', 'resolved')),
  created_at          TIMESTAMPTZ DEFAULT now(),

  UNIQUE (store_id, review_id)
);

CREATE INDEX idx_crisis_alerts_store_status ON crisis_alerts (store_id, status);
```

---

### health_scores

```sql
CREATE TABLE health_scores (
  id                        TEXT PRIMARY KEY,
  store_id                  TEXT NOT NULL REFERENCES stores(id),
  period_type               TEXT NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  period_start              DATE NOT NULL,
  period_end                DATE NOT NULL,

  -- 종합 점수
  score                     SMALLINT,            -- 0~100. 데이터 부족 시 NULL
  score_delta               SMALLINT,
  score_label               TEXT,

  -- 네이버 플레이스 통계 (수집 성공 시)
  impression_count          INTEGER,
  impression_delta          REAL,
  click_count               INTEGER,
  click_rate                REAL,
  click_rate_delta          REAL,
  phone_click               INTEGER,
  direction_click           INTEGER,
  save_click                INTEGER,

  -- DB 기반 지표
  days_since_last_photo     INTEGER,
  photo_count_this_period   INTEGER,
  review_count_this_period  INTEGER,
  avg_rating_this_period    REAL,
  avg_rating_delta          REAL,
  negative_review_count     INTEGER,
  unanswered_review_count   INTEGER,

  -- 경고 항목
  warning_items             JSONB DEFAULT '[]',  -- WarningItem[]

  -- 수집 상태
  naver_stat_collected      BOOLEAN DEFAULT false,

  created_at                TIMESTAMPTZ DEFAULT now(),

  UNIQUE (store_id, period_type, period_start)
);
```

---

### reports

```sql
CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  report_type       TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly')),
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  health_score_id   TEXT REFERENCES health_scores(id),
  excel_file_url    TEXT,
  sent_at           TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'generated', 'sent', 'failed')),
  created_at        TIMESTAMPTZ DEFAULT now(),

  UNIQUE (store_id, report_type, period_start)
);
```

---

### collection_logs

```sql
CREATE TABLE collection_logs (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  platform          TEXT NOT NULL,
  status            TEXT NOT NULL
    CHECK (status IN ('success', 'failed', 'blocked', 'auth_expired', 'not_implemented')),
  new_review_count  INTEGER DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ
);

CREATE INDEX idx_collection_logs_store ON collection_logs (store_id, started_at DESC);
```

---

### message_logs

카카오톡/SMS 발송 이력. 미발송 분쟁 대비 및 디버깅용.

```sql
CREATE TABLE message_logs (
  id                TEXT PRIMARY KEY,
  recipient_type    TEXT NOT NULL CHECK (recipient_type IN ('owner', 'operator')),
  owner_id          TEXT REFERENCES users(id),
  message_type      TEXT NOT NULL,           -- 'draft_ready' | 'crisis_alert' | ...
  channel_used      TEXT
    CHECK (channel_used IN ('alimtalk', 'friendtalk', 'sms')),
  status            TEXT NOT NULL
    CHECK (status IN ('success', 'failed', 'skipped')),
  kakao_message_id  TEXT,
  error_code        TEXT,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_message_logs_owner ON message_logs (owner_id, created_at DESC);
```

---

## 엔티티 관계도

```
users
  └── stores (1:N)
        ├── store_platforms (1:N)  -- 플랫폼별 인증 정보
        ├── tone_profiles   (1:N)  -- 버전 관리, 활성 1개
        ├── reviews         (1:N)
        │     ├── pending_replies (1:1)
        │     └── crisis_alerts   (1:1)
        ├── health_scores   (1:N)  -- 주간/월간
        ├── reports         (1:N)
        └── collection_logs (1:N)

users
  └── message_logs (1:N)
```

---

## 관계 요약

| 관계 | 카디널리티 | 비고 |
|---|---|---|
| User → Store | 1:N | 사장님 1명이 여러 매장 보유 |
| Store → StorePlatform | 1:N | 매장당 최대 5개 플랫폼 |
| Store → ToneProfile | 1:N | 버전 관리. 활성 프로필은 1개 |
| Store → Review | 1:N | |
| Review → PendingReply | 1:1 | 리뷰당 초안 1개 |
| Review → CrisisAlert | 1:1 | ⭐1~2점 리뷰에만 존재 |
| PendingReply → CrisisAlert | N:1 | 위기 답글은 CrisisAlert 참조 |
| Store → HealthScore | 1:N | 주간/월간 각각 |
| Store → Report | 1:N | |
| Store → CollectionLog | 1:N | |
| User → MessageLog | 1:N | |

---

## 인덱스 전략 요약

| 조회 패턴 | 인덱스 |
|---|---|
| 매장별 최신 리뷰 목록 | `(store_id, collected_at DESC)` |
| 매장별 저평점 리뷰 | `(store_id, rating)` |
| 매장별 미답글 리뷰 | `(store_id, replied) WHERE replied = false` |
| 매장별 미컨펌 초안 | `(store_id, status)` |
| 위기 알림 미해결 건 | `(store_id, status)` |
| 수집 이력 최신순 | `(store_id, started_at DESC)` |
| 발송 이력 사용자별 | `(owner_id, created_at DESC)` |

---

## 주요 설계 결정

### 1. `platform_extra JSONB`
배민 `menu_ratings`, 쿠팡이츠 `ordered_menu`, 구글 `content_translated` 등 플랫폼 고유 필드는 컬럼을 추가하지 않고 `JSONB`로 보존한다. 정규화 시 버리면 복구 불가하므로, 원본을 보존하고 필요한 분석만 조회 시 추출한다.

### 2. `tone_profiles` 버전 관리
재학습 시 이전 프로필을 삭제하지 않는다. `is_active = false`로 비활성화하고 이력을 보존한다. 새 톤이 마음에 안 들면 이전 버전으로 롤백 가능.

### 3. `pending_replies` 발행 상태 분리
`status`(컨펌 여부)와 `publish_status`(플랫폼 발행 여부)를 분리한다. 사장님이 승인했어도 플랫폼 발행이 실패할 수 있고, 발행 재시도 추적이 필요하다.

### 4. `auth_credential` 암호화 저장
쿠키/토큰은 민감 정보다. DB에 평문 저장하지 않고 AES-256 암호화 후 저장, 애플리케이션 레이어에서 복호화한다. 암호화 키는 환경변수로 관리.
