/**
 * 한국어 텍스트 다양성 검증.
 * 외부 임베딩 모델 없이 문자 바이그램 TF 코사인 유사도로 근사 측정.
 * 한국어 바이그램이 의미 단위를 충분히 포착하므로 답글 중복 감지에 적합하다.
 */

export const DIVERSITY_THRESHOLD = 0.70;
export const MAX_ATTEMPTS = 3;

/**
 * draft가 comparisons 집합 중 어느 하나와 DIVERSITY_THRESHOLD 이상 유사하면
 * 다양성 실패. 반환값은 비교 집합과의 최대 유사도.
 */
export function maxSimilarityAgainst(draft: string, comparisons: string[]): number {
  if (comparisons.length === 0) return 0;
  return Math.max(...comparisons.map((c) => cosineSimilarity(draft, c)));
}

export function passesDiversityCheck(draft: string, comparisons: string[]): boolean {
  return maxSimilarityAgainst(draft, comparisons) < DIVERSITY_THRESHOLD;
}

// ── Internals ─────────────────────────────────────────────

function cosineSimilarity(a: string, b: string): number {
  const vecA = toBigramVector(a);
  const vecB = toBigramVector(b);

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [gram, countA] of vecA) {
    dot += countA * (vecB.get(gram) ?? 0);
    magA += countA * countA;
  }
  for (const [, countB] of vecB) {
    magB += countB * countB;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function toBigramVector(text: string): Map<string, number> {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const vec = new Map<string, number>();
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    vec.set(gram, (vec.get(gram) ?? 0) + 1);
  }
  return vec;
}
