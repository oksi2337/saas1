import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  text,
  boolean,
  integer,
  smallint,
  real,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────

export const planEnum = pgEnum('plan', ['lite', 'pro', 'agency']);

export const storeStatusEnum = pgEnum('store_status', ['active', 'paused', 'cancelled']);

export const platformEnum = pgEnum('platform', [
  'naver', 'baemin', 'coupangeats', 'kakaomap', 'google',
]);

export const authMethodEnum = pgEnum('auth_method', [
  'cookie', 'oauth', 'api_key', 'ceo_api',
]);

export const formalityEnum = pgEnum('formality', ['formal', 'semi-formal', 'casual']);
export const warmthEnum    = pgEnum('warmth',    ['warm', 'neutral', 'professional']);
export const lengthEnum    = pgEnum('length',    ['short', 'medium', 'long']);
export const emojiUsageEnum = pgEnum('emoji_usage', ['none', 'occasional', 'frequent']);

export const crisisTypeEnum = pgEnum('crisis_type', [
  'food', 'delivery', 'service', 'blackconsumer', 'unknown',
]);

export const crisisStatusEnum = pgEnum('crisis_status', [
  'alerted', 'replied', 'deletion_requested', 'resolved',
]);

export const replyStatusEnum = pgEnum('reply_status', [
  'pending', 'approved', 'rejected', 'edited',
]);

export const publishStatusEnum = pgEnum('publish_status', [
  'pending', 'published', 'failed',
]);

export const periodTypeEnum = pgEnum('period_type', ['weekly', 'monthly']);

export const reportStatusEnum = pgEnum('report_status', [
  'generating', 'generated', 'sent', 'failed',
]);

export const collectionStatusEnum = pgEnum('collection_status', [
  'success', 'failed', 'blocked', 'auth_expired', 'not_implemented',
]);

export const messageChannelEnum = pgEnum('message_channel', [
  'alimtalk', 'friendtalk', 'sms',
]);

export const messageStatusEnum = pgEnum('message_status', [
  'success', 'failed', 'skipped',
]);

export const recipientTypeEnum = pgEnum('recipient_type', ['owner', 'operator']);

// ── Tables ────────────────────────────────────────────────

/** 사장님 계정 */
export const users = pgTable('users', {
  id:                   text('id').primaryKey(),
  email:                text('email').unique().notNull(),
  name:                 text('name').notNull(),
  phone:                text('phone').notNull(),
  kakaoChannelConsent:  boolean('kakao_channel_consent').default(false).notNull(),
  plan:                 planEnum('plan').notNull(),
  planStartedAt:        timestamp('plan_started_at',  { withTimezone: true }),
  planExpiresAt:        timestamp('plan_expires_at',  { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** 매장 */
export const stores = pgTable('stores', {
  id:                    text('id').primaryKey(),
  ownerId:               text('owner_id').notNull().references(() => users.id),
  name:                  text('name').notNull(),
  category:              text('category').notNull(),
  address:               text('address'),
  status:                storeStatusEnum('status').default('active').notNull(),
  lastPhotoUploadedAt:   timestamp('last_photo_uploaded_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 매장-플랫폼 연결 및 인증 정보.
 * auth_credential은 AES-256으로 암호화하여 저장한다.
 */
export const storePlatforms = pgTable('store_platforms', {
  id:               text('id').primaryKey(),
  storeId:          text('store_id').notNull().references(() => stores.id),
  platform:         platformEnum('platform').notNull(),
  platformStoreId:  text('platform_store_id').notNull(),
  authMethod:       authMethodEnum('auth_method').notNull(),
  authCredential:   text('auth_credential'),             // 암호화 필수
  authExpiresAt:    timestamp('auth_expires_at', { withTimezone: true }),
  isActive:         boolean('is_active').default(true).notNull(),
  lastCollectedAt:  timestamp('last_collected_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('store_platforms_store_platform_idx').on(t.storeId, t.platform),
]);

/** 사장님 답글 톤 프로필 (버전 관리, 활성 1개) */
export const toneProfiles = pgTable('tone_profiles', {
  id:               text('id').primaryKey(),
  storeId:          text('store_id').notNull().references(() => stores.id),
  version:          integer('version').default(1).notNull(),
  formality:        formalityEnum('formality').notNull(),
  warmth:           warmthEnum('warmth').notNull(),
  length:           lengthEnum('length').notNull(),
  emojiUsage:       emojiUsageEnum('emoji_usage').notNull(),
  signaturePhrases: text('signature_phrases').array(),
  avoidPhrases:     text('avoid_phrases').array(),
  systemPrompt:     text('system_prompt').notNull(),
  sampleCount:      integer('sample_count').notNull(),
  isActive:         boolean('is_active').default(true).notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  // 매장당 활성 프로필 1개 (WHERE is_active = true)
  uniqueIndex('tone_profiles_active_idx').on(t.storeId).where(sql`${t.isActive} = true`),
]);

/**
 * 수집된 리뷰.
 * platform_extra는 플랫폼별 고유 데이터(배민 menu_ratings 등)를 JSON으로 보존.
 */
export const reviews = pgTable('reviews', {
  id:               text('id').primaryKey(),
  storeId:          text('store_id').notNull().references(() => stores.id),
  platform:         platformEnum('platform').notNull(),
  platformReviewId: text('platform_review_id').notNull(),
  authorName:       text('author_name').notNull(),
  rating:           smallint('rating'),                 // 1~5. 별점 없는 리뷰는 NULL
  content:          text('content').notNull().default(''),
  imageUrls:        text('image_urls').array().default([]).notNull(),
  replied:          boolean('replied').default(false).notNull(),
  replyContent:     text('reply_content'),
  reviewedAt:       timestamp('reviewed_at', { withTimezone: true }).notNull(),
  collectedAt:      timestamp('collected_at', { withTimezone: true }).defaultNow().notNull(),
  platformExtra:    jsonb('platform_extra').default({}).notNull(),
}, (t) => [
  uniqueIndex('reviews_store_platform_review_idx').on(t.storeId, t.platform, t.platformReviewId),
  index('reviews_store_collected_idx').on(t.storeId, t.collectedAt),
  index('reviews_store_rating_idx').on(t.storeId, t.rating),
  index('reviews_unanswered_idx').on(t.storeId, t.replied),
]);

/** 위기 리뷰 감지 이력 (⭐1~2점) */
export const crisisAlerts = pgTable('crisis_alerts', {
  id:               text('id').primaryKey(),
  storeId:          text('store_id').notNull().references(() => stores.id),
  reviewId:         text('review_id').notNull().references(() => reviews.id),
  platform:         platformEnum('platform').notNull(),
  rating:           smallint('rating').notNull(),
  crisisType:       crisisTypeEnum('crisis_type').notNull(),
  crisisLabel:      text('crisis_label').notNull(),
  confidence:       real('confidence'),
  summary:          text('summary'),
  responseGuide:    text('response_guide'),
  deletionEligible: boolean('deletion_eligible').default(false).notNull(),
  deletionReason:   text('deletion_reason'),
  deletionGuide:    text('deletion_guide'),
  keywords:         text('keywords').array().default([]).notNull(),
  alertSentAt:      timestamp('alert_sent_at', { withTimezone: true }),
  status:           crisisStatusEnum('status').default('alerted').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('crisis_alerts_store_review_idx').on(t.storeId, t.reviewId),
  index('crisis_alerts_store_status_idx').on(t.storeId, t.status),
]);

/** 답글 초안 및 컨펌 이력 */
export const pendingReplies = pgTable('pending_replies', {
  id:                 text('id').primaryKey(),
  storeId:            text('store_id').notNull().references(() => stores.id),
  reviewId:           text('review_id').notNull().references(() => reviews.id),
  draftContent:       text('draft_content').notNull(),
  generationAttempt:  smallint('generation_attempt').default(1).notNull(),
  diversityScore:     real('diversity_score'),
  toneProfileId:      text('tone_profile_id').references(() => toneProfiles.id),
  isCrisisReply:      boolean('is_crisis_reply').default(false).notNull(),
  crisisAlertId:      text('crisis_alert_id').references(() => crisisAlerts.id),
  status:             replyStatusEnum('status').default('pending').notNull(),
  confirmedAt:        timestamp('confirmed_at', { withTimezone: true }),
  confirmedBy:        text('confirmed_by').references(() => users.id),
  finalContent:       text('final_content'),
  publishedAt:        timestamp('published_at', { withTimezone: true }),
  publishStatus:      publishStatusEnum('publish_status'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('pending_replies_store_review_idx').on(t.storeId, t.reviewId),
  index('pending_replies_status_idx').on(t.storeId, t.status),
]);

/** 주간/월간 헬스 스코어 */
export const healthScores = pgTable('health_scores', {
  id:                       text('id').primaryKey(),
  storeId:                  text('store_id').notNull().references(() => stores.id),
  periodType:               periodTypeEnum('period_type').notNull(),
  periodStart:              date('period_start').notNull(),
  periodEnd:                date('period_end').notNull(),
  score:                    smallint('score'),
  scoreDelta:               smallint('score_delta'),
  scoreLabel:               text('score_label'),
  // 네이버 플레이스 통계 (수집 성공 시)
  impressionCount:          integer('impression_count'),
  impressionDelta:          real('impression_delta'),
  clickCount:               integer('click_count'),
  clickRate:                real('click_rate'),
  clickRateDelta:           real('click_rate_delta'),
  phoneClick:               integer('phone_click'),
  directionClick:           integer('direction_click'),
  saveClick:                integer('save_click'),
  // DB 기반 지표
  daysSinceLastPhoto:       integer('days_since_last_photo'),
  photoCountThisPeriod:     integer('photo_count_this_period'),
  reviewCountThisPeriod:    integer('review_count_this_period'),
  avgRatingThisPeriod:      real('avg_rating_this_period'),
  avgRatingDelta:           real('avg_rating_delta'),
  negativeReviewCount:      integer('negative_review_count'),
  unansweredReviewCount:    integer('unanswered_review_count'),
  warningItems:             jsonb('warning_items').default([]).notNull(),
  naverStatCollected:       boolean('naver_stat_collected').default(false).notNull(),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('health_scores_store_period_idx').on(t.storeId, t.periodType, t.periodStart),
]);

/** 리포트 생성 및 발송 이력 */
export const reports = pgTable('reports', {
  id:             text('id').primaryKey(),
  storeId:        text('store_id').notNull().references(() => stores.id),
  reportType:     periodTypeEnum('report_type').notNull(),
  periodStart:    date('period_start').notNull(),
  periodEnd:      date('period_end').notNull(),
  healthScoreId:  text('health_score_id').references(() => healthScores.id),
  excelFileUrl:   text('excel_file_url'),
  sentAt:         timestamp('sent_at', { withTimezone: true }),
  status:         reportStatusEnum('status').default('generating').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('reports_store_type_period_idx').on(t.storeId, t.reportType, t.periodStart),
]);

/** 플랫폼별 수집 실행 이력 */
export const collectionLogs = pgTable('collection_logs', {
  id:              text('id').primaryKey(),
  storeId:         text('store_id').notNull().references(() => stores.id),
  platform:        platformEnum('platform').notNull(),
  status:          collectionStatusEnum('status').notNull(),
  newReviewCount:  integer('new_review_count').default(0).notNull(),
  errorMessage:    text('error_message'),
  startedAt:       timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt:      timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('collection_logs_store_idx').on(t.storeId, t.startedAt),
]);

/** 카카오톡/SMS 발송 이력 */
export const messageLogs = pgTable('message_logs', {
  id:              text('id').primaryKey(),
  recipientType:   recipientTypeEnum('recipient_type').notNull(),
  ownerId:         text('owner_id').references(() => users.id),
  messageType:     text('message_type').notNull(),
  channelUsed:     messageChannelEnum('channel_used'),
  status:          messageStatusEnum('status').notNull(),
  kakaoMessageId:  text('kakao_message_id'),
  errorCode:       text('error_code'),
  sentAt:          timestamp('sent_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('message_logs_owner_idx').on(t.ownerId, t.createdAt),
]);

// ── Type exports ──────────────────────────────────────────

export type User            = typeof users.$inferSelect;
export type NewUser         = typeof users.$inferInsert;
export type Store           = typeof stores.$inferSelect;
export type NewStore        = typeof stores.$inferInsert;
export type StorePlatform   = typeof storePlatforms.$inferSelect;
export type NewStorePlatform = typeof storePlatforms.$inferInsert;
export type ToneProfile     = typeof toneProfiles.$inferSelect;
export type Review          = typeof reviews.$inferSelect;
export type NewReview       = typeof reviews.$inferInsert;
export type CrisisAlert     = typeof crisisAlerts.$inferSelect;
export type NewCrisisAlert  = typeof crisisAlerts.$inferInsert;
export type PendingReply    = typeof pendingReplies.$inferSelect;
export type NewPendingReply = typeof pendingReplies.$inferInsert;
export type HealthScore     = typeof healthScores.$inferSelect;
export type Report          = typeof reports.$inferSelect;
export type CollectionLog   = typeof collectionLogs.$inferSelect;
export type NewCollectionLog = typeof collectionLogs.$inferInsert;
export type MessageLog      = typeof messageLogs.$inferSelect;
