/** Kosmos portal hostları — basvuru + ana site */
export function isKosmosPortalHost(hostname: string): boolean {
  return /(^|\.)kosmosvize\.com\.tr$/i.test(hostname);
}

export function isKosmosPortalUrl(url: string): boolean {
  try {
    return isKosmosPortalHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Tanitim sitesi — kosmosvize.com.tr/tr (basvuru subdomain degil) */
export function isKosmosMarketingHome(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?kosmosvize\.com\.tr$/i.test(parsed.hostname)) {
      return false;
    }
    return !/^\/basvuru/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** basvuru.kosmosvize.com.tr */
export function isBasvuruPortalUrl(url: string): boolean {
  try {
    return /^basvuru\.kosmosvize\.com\.tr$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function portalOriginsMatch(pageUrl: string, expectedHomeUrl: string): boolean {
  try {
    const pageHost = new URL(pageUrl).hostname;
    const expectedHost = new URL(expectedHomeUrl).hostname;
    if (pageHost === expectedHost) {
      return true;
    }
    return isKosmosPortalHost(pageHost) && isKosmosPortalHost(expectedHost);
  } catch {
    return false;
  }
}
