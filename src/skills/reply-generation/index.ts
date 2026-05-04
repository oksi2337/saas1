import Anthropic from '@anthropic-ai/sdk';
import type { Platform } from '../../types/review';
import type { ToneProfile } from '../../db/schema';

// ── Types ─────────────────────────────────────────────────

export interface ReplyGenerationInput {
  review: {
    content: string;
    rating: number;
    platform: Platform;
  };
  tone_profile: ToneProfile | null;
  context: {
    store_name: string;
    store_category: string;
  };
  generation_options: {
    mode: 'normal' | 'crisis';
    attempt: number;
    diversity_instruction?: string;
    previous_drafts?: string[];
  };
}

export type ReplyGenerationOutput =
  | { status: 'success'; draft: string; token_usage: { input_tokens: number; output_tokens: number } }
  | { status: 'failed'; error_message: string; draft: null };

// ── Constants ─────────────────────────────────────────────

const DEFAULT_SYSTEM_PROMPT = `당신은 소규모 식당 사장님입니다.
답글을 쓸 때 정중하고 따뜻한 말투를 사용합니다.
2~3문장으로 간결하게 작성하고, 고객의 의견에 공감하는 표현을 포함합니다.
과도한 마케팅 표현이나 상투적인 문구("항상 최선을 다하겠습니다" 등)는 피합니다.`;

const CRISIS_SUFFIX = `\n이 리뷰는 불만 리뷰입니다. 방어적이지 않게, 진심 어린 공감과 사과를 먼저 표현하고, 구체적인 개선 의지를 포함하세요.`;

// 플랫폼 정책 위반 패턴 (전화번호, 외부 URL)
const PHONE_RE = /\d{2,3}-\d{3,4}-\d{4}/g;
const URL_RE   = /https?:\/\/\S+/g;

const client = new Anthropic();

// ── Main ──────────────────────────────────────────────────

export async function generateReplyDraft(
  input: ReplyGenerationInput,
): Promise<ReplyGenerationOutput> {
  const { review, tone_profile, context, generation_options } = input;
  const { mode, attempt, diversity_instruction, previous_drafts } = generation_options;

  const temperature = Math.min(0.8 + (attempt - 1) * 0.05, 0.95);
  const systemPrompt =
    (tone_profile?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) +
    (mode === 'crisis' ? CRISIS_SUFFIX : '');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      temperature,
      system: systemPrompt,
      messages: [
        { role: 'user', content: buildUserPrompt(review.content, context, diversity_instruction, previous_drafts) },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const cleaned = cleanDraft(raw);

    if (cleaned.length < 10) {
      return { status: 'failed', error_message: '생성된 답글이 너무 짧습니다', draft: null };
    }

    return {
      status: 'success',
      draft: cleaned,
      token_usage: {
        input_tokens:  response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  } catch (err) {
    return {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      draft: null,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────

function buildUserPrompt(
  content: string,
  context: ReplyGenerationInput['context'],
  diversityInstruction?: string,
  previousDrafts?: string[],
): string {
  let prompt = `다음 리뷰에 대한 답글을 ${context.store_name} 사장님 입장에서 작성해주세요.\n\n`;

  if (!content.trim()) {
    prompt += `리뷰: (내용 없음 - 별점만 남긴 리뷰입니다)\n\n짧은 감사 인사를 작성해주세요.`;
  } else {
    prompt += `리뷰: "${content}"`;
  }

  if (diversityInstruction) {
    prompt += `\n\n주의: ${diversityInstruction}`;
  }

  if (previousDrafts && previousDrafts.length > 0) {
    prompt += `\n\n다음 답글들과 비슷한 표현을 피하세요:\n${previousDrafts.map((d, i) => `${i + 1}. "${d}"`).join('\n')}`;
  }

  return prompt;
}

function cleanDraft(text: string): string {
  return text.replace(PHONE_RE, '').replace(URL_RE, '').trim();
}
