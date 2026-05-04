/**
 * 카카오 비즈메시지 발송 skill.
 * 현재는 stub 구현: KAKAO_API_KEY 없으면 콘솔 출력 후 message_logs에 'skipped' 기록.
 * 실제 카카오 알림톡 API는 템플릿 심사 완료 후 연결한다.
 */
import { db } from '../../db';
import { messageLogs } from '../../db/schema';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────

export type MessageType =
  | 'draft_ready'
  | 'tone_setup_required'
  | 'crisis_alert'
  | 'weekly_report'
  | 'monthly_report'
  | 'system_error'
  | 'auth_required'
  | 'collection_blocked';

export interface KakaoAlertInput {
  recipient: 'owner' | 'operator';
  owner_id?: string;
  message_type: MessageType;
  content: Record<string, unknown>;
  options?: {
    retry_on_fail?: boolean;
    priority?: 'normal' | 'urgent';
  };
}

export type KakaoAlertOutput =
  | { status: 'success'; message_id: string; sent_at: string }
  | { status: 'failed'; error_code: string; error_message: string; retryable: boolean };

// ── Main ──────────────────────────────────────────────────

export async function sendKakaoAlert(input: KakaoAlertInput): Promise<KakaoAlertOutput> {
  const apiKey = process.env.KAKAO_API_KEY;

  if (!apiKey) {
    // 개발 모드: 콘솔 출력 + skipped 기록
    console.log(`\n[kakao-alert] STUB (${input.message_type})`);
    console.log(JSON.stringify(input.content, null, 2));
    const messageId = `stub_${uuidv4()}`;
    const sentAt = new Date().toISOString();
    await writeLog(input, 'skipped', null, null, null);
    return { status: 'success', message_id: messageId, sent_at: sentAt };
  }

  // TODO: 실제 알림톡 API 연결 (카카오 템플릿 심사 후)
  // 알림톡 → 친구톡 → SMS 폴백 순서
  await writeLog(input, 'skipped', null, null, null);
  return { status: 'success', message_id: `stub_${uuidv4()}`, sent_at: new Date().toISOString() };
}

// ── DB ────────────────────────────────────────────────────

async function writeLog(
  input: KakaoAlertInput,
  status: 'success' | 'failed' | 'skipped',
  channelUsed: 'alimtalk' | 'friendtalk' | 'sms' | null,
  kakaoMessageId: string | null,
  errorCode: string | null,
): Promise<void> {
  await db.insert(messageLogs).values({
    id:             uuidv4(),
    recipientType:  input.recipient,
    ownerId:        input.owner_id ?? null,
    messageType:    input.message_type,
    channelUsed,
    status,
    kakaoMessageId,
    errorCode,
    sentAt:         status === 'success' ? new Date() : null,
  });
}
