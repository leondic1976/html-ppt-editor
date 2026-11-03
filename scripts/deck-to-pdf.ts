/**
 * PDF-001: a real PDF file with selectable text, via a local browser (plan §7, ADR-009).
 * Usage: pnpm deck-to-pdf <deck.html> [out.pdf] [--trust-file]
 *
 * This opens the file in a real browser with scripting on, unlike the editor. So it only accepts
 * decks this app saved (script pinned by CSP hash) unless --trust-file is given, and it blocks all
 * network access either way.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { hasDeckMarker, parseDeckHtml } from '@hps/export-html';
import { decodeHtml, scanHtmlFile, VERDICT_LABEL } from '@hps/security-scan';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const trust = args.includes('--trust-file');
const input = positional[0];
if (!input) {
  console.error('사용법: pnpm deck-to-pdf <deck.html> [out.pdf] [--trust-file]');
  process.exit(3);
}
const output = positional[1] ?? input.replace(/\.[^.]+$/, '.pdf');

const bytes = new Uint8Array(readFileSync(input));
const report = await scanHtmlFile(bytes, { fileName: input });
if (report.verdict === 'malicious' || report.verdict === 'dangerous') {
  console.error(
    `보안 검사 결과가 "${VERDICT_LABEL[report.verdict]}"이므로 변환하지 않습니다. pnpm scan 으로 확인하세요.`,
  );
  process.exit(2);
}
const text = decodeHtml(bytes).text;
const parsed = hasDeckMarker(text) ? await parseDeckHtml(text) : null;
if (!parsed?.runtimeIntact && !trust) {
  console.error(
    '이 앱이 저장한 파일이 아니거나 스크립트가 변경된 파일입니다. 이 변환은 파일의 스크립트를 실행합니다. 믿을 수 있는 파일이면 --trust-file 을 붙이세요.',
  );
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:'))
      void route.continue();
    else void route.abort();
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(input)).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  });
  await page.pdf({ path: output, printBackground: true, preferCSSPageSize: true });
  console.log(`저장: ${output}`);
} finally {
  await browser.close();
}
