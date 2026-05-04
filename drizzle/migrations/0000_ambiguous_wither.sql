CREATE TYPE "public"."auth_method" AS ENUM('cookie', 'oauth', 'api_key', 'ceo_api');--> statement-breakpoint
CREATE TYPE "public"."collection_status" AS ENUM('success', 'failed', 'blocked', 'auth_expired', 'not_implemented');--> statement-breakpoint
CREATE TYPE "public"."crisis_status" AS ENUM('alerted', 'replied', 'deletion_requested', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."crisis_type" AS ENUM('food', 'delivery', 'service', 'blackconsumer', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."emoji_usage" AS ENUM('none', 'occasional', 'frequent');--> statement-breakpoint
CREATE TYPE "public"."formality" AS ENUM('formal', 'semi-formal', 'casual');--> statement-breakpoint
CREATE TYPE "public"."length" AS ENUM('short', 'medium', 'long');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('alimtalk', 'friendtalk', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('success', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('lite', 'pro', 'agency');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('naver', 'baemin', 'coupangeats', 'kakaomap', 'google');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recipient_type" AS ENUM('owner', 'operator');--> statement-breakpoint
CREATE TYPE "public"."reply_status" AS ENUM('pending', 'approved', 'rejected', 'edited');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('generating', 'generated', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."warmth" AS ENUM('warm', 'neutral', 'professional');--> statement-breakpoint
CREATE TABLE "collection_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"status" "collection_status" NOT NULL,
	"new_review_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "crisis_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"review_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"rating" smallint NOT NULL,
	"crisis_type" "crisis_type" NOT NULL,
	"crisis_label" text NOT NULL,
	"confidence" real,
	"summary" text,
	"response_guide" text,
	"deletion_eligible" boolean DEFAULT false NOT NULL,
	"deletion_reason" text,
	"deletion_guide" text,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"alert_sent_at" timestamp with time zone,
	"status" "crisis_status" DEFAULT 'alerted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"score" smallint,
	"score_delta" smallint,
	"score_label" text,
	"impression_count" integer,
	"impression_delta" real,
	"click_count" integer,
	"click_rate" real,
	"click_rate_delta" real,
	"phone_click" integer,
	"direction_click" integer,
	"save_click" integer,
	"days_since_last_photo" integer,
	"photo_count_this_period" integer,
	"review_count_this_period" integer,
	"avg_rating_this_period" real,
	"avg_rating_delta" real,
	"negative_review_count" integer,
	"unanswered_review_count" integer,
	"warning_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"naver_stat_collected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_type" "recipient_type" NOT NULL,
	"owner_id" text,
	"message_type" text NOT NULL,
	"channel_used" "message_channel",
	"status" "message_status" NOT NULL,
	"kakao_message_id" text,
	"error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"review_id" text NOT NULL,
	"draft_content" text NOT NULL,
	"generation_attempt" smallint DEFAULT 1 NOT NULL,
	"diversity_score" real,
	"tone_profile_id" text,
	"is_crisis_reply" boolean DEFAULT false NOT NULL,
	"crisis_alert_id" text,
	"status" "reply_status" DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"final_content" text,
	"published_at" timestamp with time zone,
	"publish_status" "publish_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"report_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"health_score_id" text,
	"excel_file_url" text,
	"sent_at" timestamp with time zone,
	"status" "report_status" DEFAULT 'generating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_review_id" text NOT NULL,
	"author_name" text NOT NULL,
	"rating" smallint,
	"content" text DEFAULT '' NOT NULL,
	"image_urls" text[] DEFAULT '{}' NOT NULL,
	"replied" boolean DEFAULT false NOT NULL,
	"reply_content" text,
	"reviewed_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"platform_extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_platforms" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"platform_store_id" text NOT NULL,
	"auth_method" "auth_method" NOT NULL,
	"auth_credential" text,
	"auth_expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"address" text,
	"status" "store_status" DEFAULT 'active' NOT NULL,
	"last_photo_uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tone_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"formality" "formality" NOT NULL,
	"warmth" "warmth" NOT NULL,
	"length" "length" NOT NULL,
	"emoji_usage" "emoji_usage" NOT NULL,
	"signature_phrases" text[],
	"avoid_phrases" text[],
	"system_prompt" text NOT NULL,
	"sample_count" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"kakao_channel_consent" boolean DEFAULT false NOT NULL,
	"plan" "plan" NOT NULL,
	"plan_started_at" timestamp with time zone,
	"plan_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "collection_logs" ADD CONSTRAINT "collection_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_alerts" ADD CONSTRAINT "crisis_alerts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crisis_alerts" ADD CONSTRAINT "crisis_alerts_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_logs" ADD CONSTRAINT "message_logs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_replies" ADD CONSTRAINT "pending_replies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_replies" ADD CONSTRAINT "pending_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_replies" ADD CONSTRAINT "pending_replies_tone_profile_id_tone_profiles_id_fk" FOREIGN KEY ("tone_profile_id") REFERENCES "public"."tone_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_replies" ADD CONSTRAINT "pending_replies_crisis_alert_id_crisis_alerts_id_fk" FOREIGN KEY ("crisis_alert_id") REFERENCES "public"."crisis_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_replies" ADD CONSTRAINT "pending_replies_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_health_score_id_health_scores_id_fk" FOREIGN KEY ("health_score_id") REFERENCES "public"."health_scores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_platforms" ADD CONSTRAINT "store_platforms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tone_profiles" ADD CONSTRAINT "tone_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_logs_store_idx" ON "collection_logs" USING btree ("store_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crisis_alerts_store_review_idx" ON "crisis_alerts" USING btree ("store_id","review_id");--> statement-breakpoint
CREATE INDEX "crisis_alerts_store_status_idx" ON "crisis_alerts" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "health_scores_store_period_idx" ON "health_scores" USING btree ("store_id","period_type","period_start");--> statement-breakpoint
CREATE INDEX "message_logs_owner_idx" ON "message_logs" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_replies_store_review_idx" ON "pending_replies" USING btree ("store_id","review_id");--> statement-breakpoint
CREATE INDEX "pending_replies_status_idx" ON "pending_replies" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_store_type_period_idx" ON "reports" USING btree ("store_id","report_type","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_store_platform_review_idx" ON "reviews" USING btree ("store_id","platform","platform_review_id");--> statement-breakpoint
CREATE INDEX "reviews_store_collected_idx" ON "reviews" USING btree ("store_id","collected_at");--> statement-breakpoint
CREATE INDEX "reviews_store_rating_idx" ON "reviews" USING btree ("store_id","rating");--> statement-breakpoint
CREATE INDEX "reviews_unanswered_idx" ON "reviews" USING btree ("store_id","replied");--> statement-breakpoint
CREATE UNIQUE INDEX "store_platforms_store_platform_idx" ON "store_platforms" USING btree ("store_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "tone_profiles_active_idx" ON "tone_profiles" USING btree ("store_id") WHERE "tone_profiles"."is_active" = true;