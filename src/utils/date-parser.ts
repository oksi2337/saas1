import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.locale('ko');

/**
 * 한국 플랫폼(네이버·배민·쿠팡이츠·카카오맵)의 다양한 날짜 표현을 로컬 ISO 8601로 변환.
 *
 * 지원 형식:
 *   "방금 전" / "1시간 전" / "어제" / "3일 전" / "2주 전" / "1개월 전"
 *   "2026.05.04" / "26.05.04" / "2026-05-04"
 *
 * 날짜 전용값은 format()으로 로컬 시각 유지 — toISOString()은 UTC 변환으로
 * KST 자정이 전날 15:00Z로 출력되는 문제를 방지한다.
 */
export function parseKoreanDate(raw: string): string {
  const now = dayjs();
  const text = raw.trim();

  if (!text) return now.format();

  if (text === '방금 전' || text === '방금전') return now.format();

  const hoursMatch = text.match(/^(\d+)시간\s*전$/);
  if (hoursMatch) return now.subtract(+hoursMatch[1], 'hour').format();

  if (text === '어제') return now.subtract(1, 'day').startOf('day').format();

  const daysMatch = text.match(/^(\d+)일\s*전$/);
  if (daysMatch) return now.subtract(+daysMatch[1], 'day').startOf('day').format();

  const weeksMatch = text.match(/^(\d+)주\s*전$/);
  if (weeksMatch) return now.subtract(+weeksMatch[1], 'week').startOf('day').format();

  const monthsMatch = text.match(/^(\d+)개월\s*전$/);
  if (monthsMatch) return now.subtract(+monthsMatch[1], 'month').startOf('day').format();

  // YYYY.MM.DD
  const dotFull = text.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (dotFull) return dayjs(`${dotFull[1]}-${dotFull[2]}-${dotFull[3]}`).format();

  // YY.MM.DD
  const dotShort = text.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (dotShort) return dayjs(`20${dotShort[1]}-${dotShort[2]}-${dotShort[3]}`).format();

  // YYYY-MM-DD (날짜 전용)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dayjs(text).format();

  // 완전한 ISO / datetime 속성값
  const parsed = dayjs(text);
  if (parsed.isValid()) return parsed.format();

  console.warn(`[date-parser] 파싱 실패: "${raw}" → 현재 시각으로 대체`);
  return now.format();
}
