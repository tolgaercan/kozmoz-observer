import type { Page } from "playwright";

export interface PageViewport {
  width: number;
  height: number;
}

/** CDP modunda page.viewportSize() null olabilir — window boyutuna düş */
export async function getPageViewport(page: Page): Promise<PageViewport> {
  const playwrightViewport = page.viewportSize();
  if (playwrightViewport) {
    return playwrightViewport;
  }

  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}
