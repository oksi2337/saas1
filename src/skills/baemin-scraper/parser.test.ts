import dayjs from 'dayjs';
import {
  parseBaeminDate,
  parseBaeminRating,
  parseMenuRatings,
  parseCookieString,
  generateBaeminFallbackId,
} from './parser';

describe('parseBaeminDate', () => {
  const now = dayjs();

  it('방금 전은 현재 시각', () => {
    expect(now.diff(dayjs(parseBaeminDate('방금 전')), 'second')).toBeLessThan(5);
  });

  it('N시간 전', () => {
    expect(Math.round(now.diff(dayjs(parseBaeminDate('2시간 전')), 'hour', true))).toBe(2);
  });

  it('YYYY.MM.DD 형식', () => {
    expect(parseBaeminDate('2026.05.04').startsWith('2026-05-04')).toBe(true);
  });

  it('YY.MM.DD 형식', () => {
    expect(parseBaeminDate('26.05.04').startsWith('2026-05-04')).toBe(true);
  });

  it('ISO 날짜 형식', () => {
    expect(parseBaeminDate('2026-05-04').startsWith('2026-05-04')).toBe(true);
  });
});

describe('parseBaeminRating', () => {
  it('"별점 4점" 형식', () => expect(parseBaeminRating('별점 4점')).toBe(4));
  it('"5점" 형식', () => expect(parseBaeminRating('5점')).toBe(5));
  it('"4점 만점에 5점" 형식', () => expect(parseBaeminRating('4점 만점에 5점')).toBe(5));
  it('빈 문자열 → 0', () => expect(parseBaeminRating('')).toBe(0));
  it('범위 밖 숫자 → 0', () => expect(parseBaeminRating('6점')).toBe(0));
});

describe('parseMenuRatings', () => {
  it('세 항목 모두 파싱', () => {
    const result = parseMenuRatings('맛 4', '양 3', '배달 5');
    expect(result).toEqual({ taste: 4, quantity: 3, delivery: 5 });
  });

  it('일부 항목만 있어도 반환', () => {
    const result = parseMenuRatings('맛 5', '', '');
    expect(result).toEqual({ taste: 5, quantity: undefined, delivery: undefined });
  });

  it('모두 빈 문자열 → undefined', () => {
    expect(parseMenuRatings('', '', '')).toBeUndefined();
  });
});

describe('parseCookieString (baemin domain)', () => {
  it('배민 도메인으로 파싱', () => {
    const cookies = parseCookieString('SESSION=abc; BSID=xyz', '.baemin.com');
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatchObject({ name: 'SESSION', value: 'abc', domain: '.baemin.com' });
  });
});

describe('generateBaeminFallbackId', () => {
  it('bm_generated_ 접두사', () => {
    expect(generateBaeminFallbackId('김**', '2026-05-04', '맛있어요')).toMatch(/^bm_generated_/);
  });

  it('동일 입력 → 동일 ID', () => {
    expect(generateBaeminFallbackId('김**', '2026-05-04', '맛있어요'))
      .toBe(generateBaeminFallbackId('김**', '2026-05-04', '맛있어요'));
  });

  it('다른 입력 → 다른 ID', () => {
    expect(generateBaeminFallbackId('김**', '2026-05-04', '맛있어요'))
      .not.toBe(generateBaeminFallbackId('이**', '2026-05-04', '맛있어요'));
  });
});
