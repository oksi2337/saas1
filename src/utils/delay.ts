/** min~max ms 사이의 랜덤 딜레이 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 페이지 이동 간 기본 딜레이 (1~3초) */
export const pageDelay = () => randomDelay(1000, 3000);
