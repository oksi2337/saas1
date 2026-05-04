/** 쿠키 문자열("NID=abc; NNB=xyz")을 Playwright Cookie 배열로 변환 */
export function parseCookieString(
  cookieStr: string,
  domain: string,
): Array<{ name: string; value: string; domain: string; path: string }> {
  return cookieStr
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return null;
      return {
        name: pair.slice(0, eq).trim(),
        value: pair.slice(eq + 1).trim(),
        domain,
        path: '/',
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}
