import Anthropic from '@anthropic-ai/sdk';
import type { Platform } from '../../types/review';

// ── Types ─────────────────────────────────────────────────

export interface SentimentClassificationInput {
  review: {
    content: string;
    rating: number;
    platform: Platform;
    reviewed_at: string;
  };
  store: {
    store_id: string;
    store_name: string;
    store_category: string;
    platform_store_id: string;
  };
}

export type CrisisType = 'food' | 'delivery' | 'service' | 'blackconsumer' | 'unknown';

export interface SentimentClassificationOutput {
  status: 'success' | 'failed';
  crisis_type: CrisisType;
  crisis_label: string;
  confidence: number;
  summary: string;
  response_guide: string;
  deletion_eligible: boolean;
  deletion_reason: string | null;
  deletion_guide: string | null;
  keywords: string[];
}

// ── Constants ─────────────────────────────────────────────

const DELETION_GUIDES: Record<Platform, string> = {
  naver:       '네이버 플레이스 관리자 → 해당 리뷰 → 신고하기 → 사유 선택',
  baemin:      '배민 사장님 센터 → 리뷰 관리 → 해당 리뷰 → 부적절한 리뷰 신고',
  coupangeats: '쿠팡이츠 사장님 센터 → 고객 리뷰 → 리뷰 신고',
  kakaomap:    '카카오맵 앱 → 해당 리뷰 → 신고',
  google:      '구글 비즈니스 프로필 → 리뷰 → 신고',
};

const FALLBACK_GUIDE = '고객의 불만 내용을 확인하고 진심 어린 답글을 달아주세요.';

const SYSTEM_PROMPT = `당신은 자영업 리뷰 관리 전문가입니다. 저평점 리뷰를 분석하여 위기 유형을 분류하고 사장님에게 실질적인 대응 가이드를 제공합니다.

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드 블록 없이 순수 JSON만 반환하세요.

{
  "crisis_type": "food" | "delivery" | "service" | "blackconsumer" | "unknown",
  "crisis_label": "한국어 레이블 (예: 음식 품질 문제)",
  "confidence": 0.0~1.0 숫자,
  "summary": "리뷰 핵심 요약 1문장",
  "response_guide": "사장님용 대응 가이드 2~3문장",
  "deletion_eligible": true 또는 false,
  "deletion_reason": "삭제 가능 사유 한국어 문자열 또는 null",
  "keywords": ["키워드1", "키워드2"]
}

위기 유형 분류 기준:
- food: 맛, 냄새, 위생, 이물질, 상함, 양, 온도
- delivery: 배달 시간, 늦음, 식음, 누락, 포장, 배달기사
- service: 불친절, 무시, 말투, 화냄, 환불 거부, 응대
- blackconsumer: 협박, "올리겠다", 과도한 보상 요구, 방문 기록 없음 주장, 반복 민원
- unknown: 위 유형 해당 없거나 내용 불충분

두 가지 이상 해당 시 가장 심각한 유형 선택 (응대 문제 + 협박 → blackconsumer).

삭제 요청 가능 기준 (하나라도 해당하면 deletion_eligible: true):
- 허위 사실 포함 (방문/주문 기록 없음 주장)
- 비속어/혐오 표현/협박
- 광고성/경쟁사 언급
- 개인정보 포함
- blackconsumer 패턴 + 보상 요구`;

// ── Main ──────────────────────────────────────────────────

const client = new Anthropic();

export async function classifyCrisis(
  input: SentimentClassificationInput,
): Promise<SentimentClassificationOutput> {
  if (input.review.rating > 2) {
    return fallback(input.review.content, 'rating > 2인 리뷰는 이 skill의 처리 범위 밖입니다.');
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = parseResponse(text);

    if (parsed.deletion_eligible && !parsed.deletion_guide) {
      parsed.deletion_guide = DELETION_GUIDES[input.review.platform] ?? null;
    }

    return { status: 'success', ...parsed };
  } catch {
    return fallback(input.review.content);
  }
}

// ── Helpers ───────────────────────────────────────────────

function buildUserPrompt(input: SentimentClassificationInput): string {
  return `매장명: ${input.store.store_name}
업종: ${input.store.store_category}
플랫폼: ${input.review.platform}
별점: ${input.review.rating}점
리뷰 내용: ${input.review.content || '(내용 없음)'}
작성일: ${input.review.reviewed_at}

위 리뷰를 분석하여 JSON으로 반환하세요.`;
}

function parseResponse(text: string): Omit<SentimentClassificationOutput, 'status'> {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON not found');

  const raw = JSON.parse(match[0]);
  return {
    crisis_type:       (raw.crisis_type ?? 'unknown') as CrisisType,
    crisis_label:      raw.crisis_label ?? '분류 불가',
    confidence:        typeof raw.confidence === 'number' ? raw.confidence : 0,
    summary:           raw.summary ?? '',
    response_guide:    raw.response_guide ?? FALLBACK_GUIDE,
    deletion_eligible: Boolean(raw.deletion_eligible),
    deletion_reason:   raw.deletion_reason ?? null,
    deletion_guide:    raw.deletion_guide ?? null,
    keywords:          Array.isArray(raw.keywords) ? (raw.keywords as string[]) : [],
  };
}

function fallback(content: string, _reason?: string): SentimentClassificationOutput {
  return {
    status:            'failed',
    crisis_type:       'unknown',
    crisis_label:      '분류 불가',
    confidence:        0,
    summary:           content.slice(0, 50),
    response_guide:    FALLBACK_GUIDE,
    deletion_eligible: false,
    deletion_reason:   null,
    deletion_guide:    null,
    keywords:          [],
  };
}
