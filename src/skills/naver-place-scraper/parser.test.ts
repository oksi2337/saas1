import dayjs from 'dayjs';
import { parseNaverDate, parseRating, generateFallbackReviewId, parseCookieString } from './parser';

describe('parseNaverDate', () => {
  const now = dayjs();

  it('방금 전은 현재 시각', () => {
    expect(now.diff(dayjs(parseNaverDate('방금 전')), 'second')).toBeLessThan(5);
  });

  it('N시간 전', () => {
    expect(Math.round(now.diff(dayjs(parseNaverDate('3시간 전')), 'hour', true))).toBe(3);
  });

  it('어제', () => {
    expect(now.diff(dayjs(parseNaverDate('어제')), 'day')).toBe(1);
  });

  it('N일 전', () => {
    expect(now.diff(dayjs(parseNaverDate('5일 전')), 'day')).toBe(5);
  });

  it('YYYY.MM.DD 형식', () => {
    expect(parseNaverDate('2026.05.04').startsWith('2026-05-04')).toBe(true);
  });

  it('YY.MM.DD 형식 (두 자리 연도)', () => {
    expect(parseNaverDate('26.05.04').startsWith('2026-05-04')).toBe(true);
  });

  it('ISO 날짜 형식', () => {
    expect(parseNaverDate('2026-05-04').startsWith('2026-05-04')).toBe(true);
  });
});

describe('parseRating', () => {
  it('aria-label "별점 4점"', () => expect(parseRating('별점 4점')).toBe(4));
  it('aria-label "별점5점" (공백 없음)', () => expect(parseRating('별점5점')).toBe(5));
  it('단순 숫자 문자열', () => expect(parseRating('3')).toBe(3));
  it('파싱 불가 → 0', () => expect(parseRating('unknown')).toBe(0));
});

describe('generateFallbackReviewId', () => {
  it('동일 입력은 항상 동일 ID', () => {
    expect(generateFallbackReviewId('홍길동', '2026-05-04', '맛있어요'))
      .toBe(generateFallbackReviewId('홍길동', '2026-05-04', '맛있어요'));
  });

  it('다른 입력은 다른 ID', () => {
    expect(generateFallbackReviewId('홍길동', '2026-05-04', '맛있어요'))
      .not.toBe(generateFallbackReviewId('김철수', '2026-05-04', '맛있어요'));
  });

  it('nv_generated_ 접두사', () => {
    expect(generateFallbackReviewId('홍길동', '2026-05-04', '맛있어요'))
      .toMatch(/^nv_generated_/);
  });
});

describe('parseCookieString', () => {
  it('세미콜론 구분 쿠키 파싱', () => {
    const cookies = parseCookieString('NID=abc123; NNB=xyz456', '.naver.com');
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatchObject({ name: 'NID', value: 'abc123', domain: '.naver.com' });
  });

  it('빈 문자열 → 빈 배열', () => {
    expect(parseCookieString('', '.naver.com')).toHaveLength(0);
  });

  it('값에 = 포함된 쿠키', () => {
    const cookies = parseCookieString('token=abc=def', '.naver.com');
    expect(cookies[0]).toMatchObject({ name: 'token', value: 'abc=def' });
  });
});
