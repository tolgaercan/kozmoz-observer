/**
 * Chrome debug açıkken portal index-*.js içinden cipher / GetClosedDate desenlerini çıkarır.
 *
 * Kullanım:
 *   npm run chrome:debug:profile-api
 *   npx tsx scripts/extract-portal-cipher.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const CDP_URL = process.env.CHROME_DEBUG_URL?.trim() ?? "http://127.0.0.1:9222";
const OUT_DIR = resolve(process.cwd(), "data/portal-assets");

const PATTERNS = [
  /GetClosedDate/gi,
  /AppointmentClosedDates/gi,
  /CryptoJS\.AES\.decrypt/gi,
  /\.AES\.decrypt\(/gi,
  /cipher/gi,
  /decrypt/gi,
  /U2FsdGVkX1/g,
];

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context?.pages().find((p) => p.url().includes("kosmos")) ?? context?.pages()[0];

  if (!page) {
    throw new Error("CDP sayfası bulunamadı — önce chrome:debug çalıştırın.");
  }

  const scriptUrls = await page.evaluate(() =>
    [...document.querySelectorAll("script[src]")]
      .map((el) => (el as HTMLScriptElement).src)
      .filter((src) => /index-.*\.js/i.test(src)),
  );

  console.log(`Bulunan index bundle: ${scriptUrls.length}`);
  const hits: string[] = [];

  for (const url of scriptUrls) {
    const fileName = url.split("/").pop() ?? "index.js";
    const outPath = resolve(OUT_DIR, fileName);
    const response = await page.evaluate(async (scriptUrl) => {
      const res = await fetch(scriptUrl, { credentials: "include" });
      return { status: res.status, text: await res.text() };
    }, url);

    if (response.status !== 200) {
      console.warn(`Atlandı (${response.status}): ${url}`);
      continue;
    }

    writeFileSync(outPath, response.text, "utf-8");
    console.log(`Kaydedildi: ${outPath}`);

    for (const pattern of PATTERNS) {
      const matches = response.text.match(pattern);
      if (matches?.length) {
        hits.push(`${fileName}: ${pattern.source} (${matches.length}x)`);
      }
    }

    const decryptSnippet = response.text.match(
      /.{0,120}(CryptoJS|AES\.decrypt|cipher).{0,200}/gi,
    );
    if (decryptSnippet?.length) {
      const snippetPath = resolve(OUT_DIR, `${fileName}.cipher-snippets.txt`);
      writeFileSync(snippetPath, decryptSnippet.slice(0, 20).join("\n---\n"), "utf-8");
      console.log(`Snippet: ${snippetPath}`);
    }
  }

  const reportPath = resolve(OUT_DIR, "cipher-scan-report.txt");
  writeFileSync(
    reportPath,
    hits.length ? hits.join("\n") : "cipher/GetClosedDate eşleşmesi yok",
    "utf-8",
  );
  console.log(`Rapor: ${reportPath}`);

  await browser.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
